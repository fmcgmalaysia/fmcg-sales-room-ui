'use strict';
const {hash}=require('./commit-proof.cjs'),{createSegmentedPlanCodec,copy,same}=require('./segmented-plan.cjs');
const {assertPackingPhotoUploads,uploadPackingPhotoSlot}=require('./packing-photo-plan.cjs');
const ACTION='PACKING_PHOTO_CONFIRMED',unversion=row=>{const result=copy(row);delete result._version;return result;};
function packingPhotoReceipt({company,staff,requestId,input,plan,index}){
 assertPackingPhotoUploads({company,staff,requestId,input,plan});if(!Number.isSafeInteger(index)||index<0||index>=plan.uploads.length)throw Error('Exact packing photo receipt slot required');
 const id=hash(company,requestId,staff.memberId,ACTION,index);
 return{_id:id,title:id,company,stockPhotoProtocol:1,action:ACTION,result:'SAVED',actorType:'STAFF',activityTime:plan.record.activityTime,
  initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,description:input.id,imageAltText:input.taskId,
  details:{requestId,memberId:staff.memberId,index,recordId:plan.record._id,upload:copy(plan.uploads[index])}};
}
function prependPackingPhotoReceipts({company,staff,requestId,input,prepared,plan}){
 assertPackingPhotoUploads({company,staff,requestId,input,plan:prepared});const journal=company==='NCT'?'NCTActivity':'NCTActivity1';
 if(!Array.isArray(plan?.writes)||plan.writes.filter(change=>change.collection===journal&&same(change.after,{...prepared.record,company})).length!==1
  ||plan.writes.some(change=>change.after?.action===ACTION||change.after?.stockPhotoProtocol!==undefined))throw Error('Exact original packing stock plan required');
 return{...copy(plan),writes:[...prepared.uploads.map((_,index)=>({collection:journal,before:null,after:packingPhotoReceipt({company,staff,requestId,input,plan:prepared,index})})),...copy(plan.writes)]};
}
// Request-scoped private adapter, paired to segmented coordinator with one APPLY
// write per invocation. Mutable original packing record remains conditional CAS;
// file receipts insert-only. No allocation/file update/trash/lock theft capability.
function createPackingPhotoFencedStore({company,staff,request,store,documentService,codecPolicy={},coordination='EXCLUSIVE_LOCK'}){
 if(!['EXCLUSIVE_LOCK','CONTROL_CAS_CANDIDATE'].includes(coordination))throw Error('Explicit server photo coordination required');
 const exclusive=coordination==='EXCLUSIVE_LOCK';
 if(!['NCT','GHR'].includes(company)||staff?.packingDepartment!=='WAREHOUSE'||!staff.staffId||!staff.memberId||!staff.staffName||request?.department!=='WAREHOUSE'
  ||request.input?.action!=='PHOTOS'||!Array.isArray(request.input.photos)||request.input.photos.length<1||request.input.photos.length>3
  ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||request.stockProtocol!==1||!request.stockBuild||!Number.isSafeInteger(request.stockGeneration)||request.stockGeneration<0
  ||['read','insert','compareAndSet','compareAndRemove'].some(method=>typeof store?.[method]!=='function')||typeof documentService!=='function')throw Error('Private fenced packing photo dependencies required');
 const codec=createSegmentedPlanCodec({...codecPolicy,company,domainWrites:true}),{journal,lockId,controlId}=codec.ids,requestId=request.requestId;
 const key=hash(company+'/PURCHASE',requestId,staff.memberId),digest=hash({company,writer:'PACKING',input:{department:'WAREHOUSE',details:request.input},stockProtocol:request.stockProtocol,
  stockBuild:request.stockBuild,stockGeneration:request.stockGeneration,...(request.stockIdentity!==undefined?{stockIdentity:request.stockIdentity}:{})});
 async function boundPlan(collection,row){
  const control=await store.read(journal,controlId),lock=exclusive?await store.read(journal,lockId):null,manifest=await store.read(journal,key);
  if(!control?._version||control.company!==company||control.mode!=='ACTIVE'||control.generation!==request.stockGeneration||control.pending?.key!==key||control.pending.digest!==digest||control.pending.phase!=='APPLY'
   ||manifest?.planHash!==control.pending.planHash||manifest.digest!==digest||manifest.baseGeneration!==request.stockGeneration||exclusive&&(lock?.company!==company||lock.owner!==key||!lock.attempt))throw Error('Durable pending packing photo operation required');
  if(!Array.isArray(manifest.fragments)||manifest.fragments.length>32)throw Error('Bounded packing photo manifest required');const fragments=[];
  for(const ref of manifest.fragments)fragments.push(await store.read(journal,ref.id));const plan=codec.decode({manifest,fragments,key,digest,memberId:staff.memberId,requestId});
  if(!plan.writes.some(change=>change.collection===collection&&same(change.after,row)))throw Error('Packing photo write absent from immutable plan');
  const records=plan.writes.filter(change=>change.collection===journal&&change.after.action==='SUPPORT_PACKING_LIST_CURRENT');
  if(records.length!==1||!records[0].before?._version||records[0].before.details?.list?.revision!==request.input.revision)throw Error('Exact original conditional packing record required');
  const record=unversion(records[0].after),line=record.details?.list?.lines?.find(item=>item.taskId===request.input.taskId);
  if(!Array.isArray(line?.photos)||line.photos.length<request.input.photos.length||typeof record.initiatedByStaffName!=='string'||!record.initiatedByStaffName||record.initiatedByStaffName.length>200)throw Error('Original packing photo evidence/actor required');
  const uploads=line.photos.slice(-request.input.photos.length).map(photo=>({action:'PHOTO_UPLOAD',company,department:'WAREHOUSE',poId:hash(company,request.input.id,request.input.taskId,'PACKING_PHOTO'),
   fileId:photo.fileId,type:photo.stage,mimeType:photo.mimeType,sha256:photo.sha256,size:photo.size,name:photo.name}));
  const recordedStaff={...staff,staffName:record.initiatedByStaffName},prepared={record,uploads,beforeRevision:request.input.revision,expectedVersion:request.input.version};
  assertPackingPhotoUploads({company,staff:recordedStaff,requestId,input:request.input,plan:prepared});
  const receipts=plan.writes.filter(change=>change.after.action===ACTION||change.after.stockPhotoProtocol!==undefined);if(receipts.length!==uploads.length)throw Error('Complete original packing photo receipts required');
  for(let index=0;index<uploads.length;index++){
   const change=plan.writes[index],expected=packingPhotoReceipt({company,staff:recordedStaff,requestId,input:request.input,plan:prepared,index});
   if(change?.collection!==journal||change.before!==null||!same(unversion(change.after),expected))throw Error('Packing photo receipts must precede business writes');
  }
  return{control,lock,prepared,recordedStaff,receipts};
 }
 const metadata=(collection,row)=>collection===journal&&(row?._id===lockId||row?._id===controlId||row?.stockOperationProtocol===2);
 async function beforeDomainWrite(collection,row){
  const state=await boundPlan(collection,row),receipt=row.action===ACTION,index=receipt?row.details?.index:state.receipts.length;
  if(!Number.isSafeInteger(index)||index<0||index>state.receipts.length||receipt&&index===state.receipts.length)throw Error('Exact packing photo receipt required');
  for(let prior=0;prior<index;prior++)if(!same(await store.read(journal,state.receipts[prior].after._id),state.receipts[prior].after))throw Error('Earlier packing photo receipt unconfirmed');
  if(receipt)await uploadPackingPhotoSlot({company,staff:state.recordedStaff,requestId,input:request.input,plan:state.prepared,index,documentService});
  // The immutable file slot is retryable; mutable packing after-images are not:
  // they still require the original version even if a callback returns late.
  if(!same(await store.read(journal,controlId),state.control)||exclusive&&!same(await store.read(journal,lockId),state.lock))throw Error('Packing photo callback fence changed; retain request');
 }
 return{read:(...args)=>store.read(...args),compareAndRemove:(collection,id,attempt)=>{if(collection!==journal||id!==lockId)throw Error('Only exact owned packing protocol lock release allowed');return store.compareAndRemove(collection,id,attempt);},
  insert:async(collection,row)=>{if(!metadata(collection,row))await beforeDomainWrite(collection,row);return store.insert(collection,row);},
  compareAndSet:async(collection,id,version,row)=>{if(row?.action===ACTION||row?.stockPhotoProtocol!==undefined)throw Error('Packing photo receipts are insert-only');if(!metadata(collection,row))await beforeDomainWrite(collection,row);return store.compareAndSet(collection,id,version,row);}};
}
module.exports={packingPhotoReceipt,prependPackingPhotoReceipts,createPackingPhotoFencedStore};
