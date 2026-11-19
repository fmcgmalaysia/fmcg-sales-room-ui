'use strict';
const {hash}=require('./commit-proof.cjs'),{createSegmentedPlanCodec,copy,same}=require('./segmented-plan.cjs');
const {assertCustomerDocumentPlan,uploadCustomerDocumentSlot}=require('./customer-document-plan.cjs'),{requireOriginalSalesDelegation}=require('./sales-delegation.cjs');
const unversion=row=>{const result=copy(row);delete result._version;delete result.company;return result;};
// The ORIGINAL document event is already immutable and contains its file receipt.
// Upload then conditional INSERT that event: no extra CMS file-confirmation row,
// no mutable ledger rewrite, no separate stock authority or legacy apply.
function createCustomerDocumentFencedStore({company,staff,request,store,documentService,codecPolicy={},coordination='EXCLUSIVE_LOCK'}){
 if(!['EXCLUSIVE_LOCK','CONTROL_CAS_CANDIDATE'].includes(coordination))throw Error('Explicit server document coordination required');
 const exclusive=coordination==='EXCLUSIVE_LOCK';
 requireOriginalSalesDelegation(staff,request?.input?.customerId);
 if(!['NCT','GHR'].includes(company)||staff.canUploadCustomerDocument!==true||request.input?.action!=='DOCUMENT'
  ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||request.stockProtocol!==1||typeof request.stockBuild!=='string'||!request.stockBuild
  ||!Number.isSafeInteger(request.stockGeneration)||request.stockGeneration<0||request.stockIdentity?.staffId!==staff.staffId||request.stockIdentity?.memberId!==staff.memberId
  ||['read','insert','compareAndSet','compareAndRemove'].some(method=>typeof store?.[method]!=='function')||typeof documentService!=='function')throw Error('Private original customer file fence required');
 const codec=createSegmentedPlanCodec({...codecPolicy,company,domainWrites:true}),{journal,lockId,controlId}=codec.ids;
 // Existing source fulfilment co-writer category, not a new financial capability.
 const key=hash(company+'/PURCHASE',request.requestId,staff.memberId),digest=hash({company,writer:'SHIPMENT',input:request.input,stockProtocol:request.stockProtocol,
  stockBuild:request.stockBuild,stockGeneration:request.stockGeneration,stockIdentity:request.stockIdentity});
 const documentId=hash(company,request.requestId,staff.memberId,'CUSTOMER_DOCUMENT');
 async function beforeDocumentInsert(collection,row){
  const control=await store.read(journal,controlId),lock=exclusive?await store.read(journal,lockId):null,manifest=await store.read(journal,key);
  if(collection!==journal||row?._id!==documentId||row.action!=='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'||row.company!==company
   ||!control?._version||control.company!==company||control.mode!=='ACTIVE'||control.writerBuild!==request.stockBuild||control.generation!==request.stockGeneration
   ||control.pending?.key!==key||control.pending.digest!==digest||control.pending.phase!=='APPLY'||control.pending.cursor!==0||control.pending.count!==1||manifest?.digest!==digest||manifest.planHash!==control.pending.planHash
   ||manifest.baseGeneration!==request.stockGeneration||exclusive&&(lock?.company!==company||lock.owner!==key||!lock.attempt))throw Error('Durable original customer document APPLY fence required');
  if(!Array.isArray(manifest.fragments)||manifest.fragments.length>32)throw Error('Bounded original document manifest required');const fragments=[];
  for(const ref of manifest.fragments)fragments.push(await store.read(journal,ref.id));const plan=codec.decode({manifest,fragments,key,digest,memberId:staff.memberId,requestId:request.requestId});
  if(plan.writes.length!==1||plan.writes[0].collection!==journal||plan.writes[0].before!==null||!same(plan.writes[0].after,row))throw Error('Exact immutable original document insertion required');
  const event=unversion(row),doc=event.details?.document,recordedStaff={...staff,staffName:event.initiatedByStaffName};
  const prepared={expectedVersion:request.input.version,event,upload:{action:'UPLOAD',company,department:'SALES',type:doc?.type,poId:documentId,fileId:doc?.fileId,name:doc?.name,sha256:doc?.sha256}};
  assertCustomerDocumentPlan({company,staff:recordedStaff,requestId:request.requestId,input:request.input,plan:prepared});
  await uploadCustomerDocumentSlot({company,staff:recordedStaff,requestId:request.requestId,input:request.input,plan:prepared,documentService});
  // A late file callback does not authorize a late CMS write. Never take/renew/
  // steal any lease or accept a changed owner, checkpoint, mode or generation.
  if(!same(await store.read(journal,controlId),control)||exclusive&&!same(await store.read(journal,lockId),lock))throw Error('Original document callback fence changed; retain request');
 }
 const metadata=(collection,row)=>collection===journal&&row?._id!==documentId&&row?.action!=='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'&&(row?._id===lockId||row?._id===controlId||row?.stockOperationProtocol===2);
 return{read:(...args)=>store.read(...args),
  insert:async(collection,row)=>{if(!metadata(collection,row))await beforeDocumentInsert(collection,row);return store.insert(collection,row);},
  compareAndSet:(collection,id,version,row)=>{if(!metadata(collection,row)||id!==row._id)throw Error('Original customer document is insert-only');return store.compareAndSet(collection,id,version,row);},
  compareAndRemove:(collection,id,attempt)=>{if(collection!==journal||id!==lockId)throw Error('Only exact owned document protocol lock release allowed');return store.compareAndRemove(collection,id,attempt);}};
}
module.exports={createCustomerDocumentFencedStore};
