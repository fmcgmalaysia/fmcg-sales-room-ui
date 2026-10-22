'use strict';
const {createHash}=require('node:crypto');
const {Buffer}=require('node:buffer');
const { hash } = require('./commit-proof.cjs'), { copy,same,createSegmentedPlanCodec } = require('./segmented-plan.cjs');
// Private original file callbacks under the SAME pending manifest/owner. No lease
// theft, automatic cleanup, PDF journal payload, new collection, or legacy write.
function createOrderFileFencedStore({ company,department,staff,request,store,documentService,codecPolicy={} }) {
  const purchase=department==='PURCHASE',upload=request?.input?.action===(purchase?'DOCUMENT':'DOCUMENT_UPLOAD');
  if (!['NCT','GHR'].includes(company)||!['PURCHASE','ACCOUNT'].includes(department)||!staff?.staffId||!staff.memberId
    ||request?.stockProtocol!==1||request.stockIdentity?.staffId!==staff.staffId||request.stockIdentity?.memberId!==staff.memberId
    ||typeof request.stockBuild!=='string'||!request.stockBuild||!Number.isSafeInteger(request.stockGeneration)||request.stockGeneration<0
    ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||!(upload||!purchase&&request.input?.action==='PAYMENT_FILE_DELETE')
    ||['read','insert','compareAndSet','compareAndRemove'].some(method=>typeof store?.[method]!=='function')||typeof documentService!=='function')throw Error('Private original order file fence required');
  const codec=createSegmentedPlanCodec({...codecPolicy,company,domainWrites:true}),{journal,controlId,lockId}=codec.ids;
  const key=hash(company+'/PURCHASE',request.requestId,staff.memberId),digest=hash({company,writer:purchase?'PURCHASE_ORDER_RECORD':'ACCOUNT_PURCHASE_RECORD',input:request.input,
    stockProtocol:request.stockProtocol,stockBuild:request.stockBuild,stockGeneration:request.stockGeneration,stockIdentity:request.stockIdentity});
  async function beforeWrite(collection,row,expectedVersion) {
    const control=await store.read(journal,controlId),lock=await store.read(journal,lockId),manifest=await store.read(journal,key);
    if(collection!=='PurchaseOrders'||row?._id!==request.input.id||row.company!==company||!control?._version||control.company!==company||control.mode!=='ACTIVE'
      ||control.writerBuild!==request.stockBuild||control.generation!==request.stockGeneration||control.pending?.key!==key||control.pending.digest!==digest
      ||control.pending.phase!=='APPLY'||control.pending.cursor!==0||control.pending.count!==1||manifest?.digest!==digest||manifest.planHash!==control.pending.planHash
      ||manifest.baseGeneration!==request.stockGeneration||lock?.company!==company||lock.owner!==key||!lock.attempt)throw Error('Durable original order file APPLY fence required');
    if(!Array.isArray(manifest.fragments)||!manifest.fragments.length||manifest.fragments.length>codec.policy.maxFragments)throw Error('Bounded original order file manifest required');
    const fragments=[];for(const ref of manifest.fragments)fragments.push(await store.read(journal,ref.id));
    const plan=codec.decode({manifest,fragments,key,digest,memberId:staff.memberId,requestId:request.requestId}),change=plan.writes[0],side=change?.orderFile;
    if(plan.writes.length!==1||change.collection!==collection||!same(change.after,row)||(change.before?._version||null)!==expectedVersion
      ||!side||!same(Object.keys(side).sort(),['department','trash','uploads'])||side.department!==department||!Array.isArray(side.uploads))throw Error('Exact original order file image required');
    if(!same(await store.read(collection,row._id),change.before))throw Error('Original file before-image changed');
    const auditId=hash(company,request.requestId,staff.memberId,purchase?'PO_AUDIT':'FINANCE'),audit=row.details?.audit?.at(-1);
    if(audit?.id!==auditId||audit.actorStaffId!==staff.staffId||audit.result!=='SAVED'||audit.action!==(purchase?'SUPPLIER_DOCUMENT_UPLOADED':'ACCOUNT_'+request.input.action)
      ||!same(row.details.audit.slice(0,-1),change.before?.details?.audit||[]))throw Error('Original file audit fence conflict');
    const assertFence=async()=>{if(!same(await store.read(journal,controlId),control)||!same(await store.read(journal,lockId),lock))throw Error('Original order file callback fence changed; retain request');};
    if(upload){
      const payloads=[request.input.base64,...(!purchase&&Array.isArray(request.input.attachments)?request.input.attachments.map(file=>file.base64):[])];
      if(side.trash!==null||side.uploads.length!==payloads.length||!payloads.length||payloads.length>(purchase?1:6)||new Set(side.uploads.map(command=>command.fileId)).size!==payloads.length)throw Error('Original upload count conflict');
      for(const [index,command]of side.uploads.entries()){
        const bytes=Buffer.from(payloads[index],'base64');
        if(bytes.length<5||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.toString('base64')!==payloads[index]||command.action!=='UPLOAD'||command.company!==company
          ||command.poId!==row._id||command.type!==request.input.type||typeof command.fileId!=='string'||!/^[A-Za-z0-9_-]{10,200}$/.test(command.fileId)
          ||command.sha256!==createHash('sha256').update(bytes).digest('hex')||(command.department||'PURCHASE')!==(!purchase&&request.input.type==='PAYMENT'?'ACCOUNT':'PURCHASE'))throw Error('Original immutable PDF/slot conflict');
        const documents=purchase||request.input.type==='DO'?row.details.documents:(row.details.finance?.payments||[]).flatMap(payment=>payment.proofs||[payment.proof]);
        const matches=(documents||[]).filter(doc=>doc?.fileId===command.fileId);
        if(matches.length!==1||matches[0].linked!==true||matches[0].sha256!==command.sha256||matches[0].name!==command.name||matches[0].type!==command.type||matches[0].size!==bytes.length
          ||matches[0].uploadedByStaffId!==staff.staffId||purchase&&matches[0].url!=='https://drive.google.com/file/d/'+command.fileId+'/view')throw Error('Original uploaded association conflict');
        await assertFence();const receipt=await documentService({...copy(command),base64:payloads[index]});
        if(receipt?.ok!==true||['fileId','company','poId','sha256','name'].some(field=>receipt[field]!==command[field]))throw Error('Original order file upload unconfirmed; retain slot/request');
        await assertFence();
      }
    }else{
      const command=side.trash,payment=change.before?.details?.finance?.payments?.find(value=>value.id===request.input.paymentId),proof=(payment?.proofs||[payment?.proof]).find(value=>value?.fileId===request.input.fileId);
      if(side.uploads.length||!proof||!same(command,{action:'TRASH',department:'ACCOUNT',company,poId:row._id,fileId:proof.fileId,sha256:proof.sha256,name:proof.name,type:'PAYMENT'}))throw Error('Original payment trash identity conflict');
      await assertFence();const receipt=await documentService(copy(command));
      if(receipt?.ok!==true||receipt.trashed!==true||['fileId','company','poId','sha256','name','type'].some(field=>receipt[field]!==command[field]))throw Error('Original payment trash unconfirmed; retain request');
      await assertFence();
    }
  }
  const metadata=(collection,row)=>collection===journal&&(row?._id===lockId||row?._id===controlId||row?.stockOperationProtocol===2);
  return{read:(...args)=>store.read(...args),
    insert:async(collection,row)=>{if(!metadata(collection,row))await beforeWrite(collection,row,null);return store.insert(collection,row);},
    compareAndSet:async(collection,id,version,row)=>{if(id!==row._id)throw Error('Original file conditional identity conflict');if(!metadata(collection,row))await beforeWrite(collection,row,version);return store.compareAndSet(collection,id,version,row);},
    compareAndRemove:(collection,id,attempt)=>{if(collection!==journal||id!==lockId)throw Error('Only exact owned order file protocol lock release allowed');return store.compareAndRemove(collection,id,attempt);}};
}
module.exports={createOrderFileFencedStore};
