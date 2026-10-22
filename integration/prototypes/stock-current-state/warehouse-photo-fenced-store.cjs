'use strict';
const {hash}=require('./commit-proof.cjs');
const {createSegmentedPlanCodec,same,copy}=require('./segmented-plan.cjs');
const {assertWarehousePhotoUploads,uploadWarehousePhotoSlot}=require('./warehouse-photo-plan.cjs');
const ACTION='WAREHOUSE_PHOTO_CONFIRMED';
const withoutVersion=row=>{const result=copy(row);delete result._version;return result;};
function photoReceipt({company,staff,requestId,input,plan,index}){
 assertWarehousePhotoUploads({company,staff,requestId,input,plan});
 if(!Number.isSafeInteger(index)||index<0||index>=plan.uploads.length)throw Error('Exact photo receipt slot required');
 const id=hash(company,requestId,staff.memberId,ACTION,index);
 return{_id:id,title:id,company,stockPhotoProtocol:1,action:ACTION,result:'SAVED',actorType:'STAFF',activityTime:plan.event.activityTime,
  initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,description:input.id,imageAltText:plan.event.imageAltText,
  details:{requestId,memberId:staff.memberId,index,eventId:plan.event._id,upload:copy(plan.uploads[index])}};
}
// Insert-only receipts precede the ORIGINAL event and every stock/hold after-image.
// They contain descriptors, never photo bytes or a browser-chosen destination.
function prependWarehousePhotoReceipts({company,staff,requestId,input,prepared,plan}){
 assertWarehousePhotoUploads({company,staff,requestId,input,plan:prepared});
 const journal=company==='NCT'?'NCTActivity':'NCTActivity1';
 if(!Array.isArray(plan?.writes)||plan.writes.filter(change=>change.collection===journal&&same(change.after,{...prepared.event,company})).length!==1
  ||plan.writes.some(change=>change.after?.action===ACTION||change.after?.stockPhotoProtocol!==undefined))throw Error('Exact original preparation stock plan required');
 const writes=prepared.uploads.map((_,index)=>({collection:journal,before:null,after:photoReceipt({company,staff,requestId,input,plan:prepared,index})}));
 return{...copy(plan),writes:[...writes,...copy(plan.writes)]};
}
// PRIVATE request-scoped adapter. Use only with the existing SEGMENTED_V2 protocol
// and <=1 APPLY write per invocation for bounded external work. No protocol rewrite,
// allocation/trash/update-file/TTL unlock or alternate stock authority is introduced.
function createWarehousePhotoFencedStore({company,staff,request,store,documentService,codecPolicy={}}){
 if(!['NCT','GHR'].includes(company)||!staff?.staffId||!staff.memberId||!staff.staffName||staff.canPrepareWarehouse!==true
  ||!/^[a-f0-9-]{36}$/i.test(request?.requestId||'')||request.stockProtocol!==1||!request.stockBuild
  ||!Number.isSafeInteger(request.stockGeneration)||request.stockGeneration<0||!Array.isArray(request.input?.photos)||request.input.photos.length>3
  ||['read','insert','compareAndSet','compareAndRemove'].some(method=>typeof store?.[method]!=='function')||typeof documentService!=='function')throw Error('Private fenced Warehouse photo dependencies required');
 const codec=createSegmentedPlanCodec({...codecPolicy,company,domainWrites:true}),{journal,lockId,controlId}=codec.ids,requestId=request.requestId;
 const key=hash(company+'/PURCHASE',requestId,staff.memberId),digest=hash({company,writer:'WAREHOUSE_PREPARATION',input:request.input,stockProtocol:request.stockProtocol,stockBuild:request.stockBuild,stockGeneration:request.stockGeneration});
 async function boundPlan(collection,row){
  const control=await store.read(journal,controlId),lock=await store.read(journal,lockId),manifest=await store.read(journal,key);
  if(!control?._version||control.company!==company||control.mode!=='ACTIVE'||control.generation!==request.stockGeneration
   ||control.pending?.key!==key||control.pending.digest!==digest||control.pending.phase!=='APPLY'
   ||manifest?.planHash!==control.pending.planHash||manifest.digest!==digest||manifest.baseGeneration!==request.stockGeneration
   ||lock?.company!==company||lock.owner!==key||typeof lock.attempt!=='string'||!lock.attempt)throw Error('Durable pending photo operation required');
  if(!Array.isArray(manifest.fragments)||manifest.fragments.length>32)throw Error('Bounded photo manifest required');
  const fragments=[];for(const ref of manifest.fragments)fragments.push(await store.read(journal,ref.id));
  const plan=codec.decode({manifest,fragments,key,digest,memberId:staff.memberId,requestId});
  if(!plan.writes.some(change=>change.collection===collection&&same(change.after,row)))throw Error('Photo write absent from immutable plan');
  const events=plan.writes.filter(change=>change.collection===journal&&change.after.action==='WAREHOUSE_PREPARATION_SAVED');
  if(events.length!==1||events[0].before!==null)throw Error('Exact immutable photo preparation event required');
  const event=withoutVersion(events[0].after),evidence=event.details?.state?.photos;
  if(!Array.isArray(evidence)||evidence.length<request.input.photos.length)throw Error('Original photo evidence required');
  const uploads=evidence.slice(evidence.length-request.input.photos.length).map(photo=>({action:'PHOTO_UPLOAD',company,department:'WAREHOUSE',poId:request.input.id,
   fileId:photo.fileId,type:photo.stage,mimeType:photo.mimeType,sha256:photo.sha256,size:photo.size,name:photo.name}));
  if(typeof event.initiatedByStaffName!=='string'||!event.initiatedByStaffName||event.initiatedByStaffName.length>200)throw Error('Original recorded photo actor required');
  // Current role/member/staff ID are reauthorized by the gateway. A display-name
  // edit must neither rewrite the captured audit nor strand a valid same actor.
  const recordedStaff={...staff,staffName:event.initiatedByStaffName};
  const prepared={version:request.input.version,event,uploads};assertWarehousePhotoUploads({company,staff:recordedStaff,requestId,input:request.input,plan:prepared});
  const receiptWrites=plan.writes.filter(change=>change.after.action===ACTION||change.after.stockPhotoProtocol!==undefined);
  if(receiptWrites.length!==uploads.length)throw Error('Complete immutable photo receipts required');
  for(let index=0;index<uploads.length;index++){
   const expected=photoReceipt({company,staff:recordedStaff,requestId,input:request.input,plan:prepared,index}),change=plan.writes[index];
   if(change?.collection!==journal||change.before!==null||!same(withoutVersion(change.after),expected))throw Error('Photo receipts must precede original business writes');
  }
  return{control,lock,prepared,recordedStaff,receipts:receiptWrites};
 }
 const metadata=(collection,row)=>collection===journal&&(row?._id===lockId||row?._id===controlId||row?.stockOperationProtocol===2);
 async function beforeDomainWrite(collection,row){
  const state=await boundPlan(collection,row),isReceipt=row.action===ACTION;
  const index=isReceipt?row.details?.index:state.receipts.length;
  if(!Number.isSafeInteger(index)||index<0||index>state.receipts.length||isReceipt&&index===state.receipts.length)throw Error('Exact bounded photo receipt required');
  for(let prior=0;prior<index;prior++)if(!same(await store.read(journal,state.receipts[prior].after._id),state.receipts[prior].after))throw Error('Earlier photo receipt unconfirmed');
  if(isReceipt)await uploadWarehousePhotoSlot({company,staff:state.recordedStaff,requestId,input:request.input,plan:state.prepared,index,documentService});
  const control=await store.read(journal,controlId),lock=await store.read(journal,lockId);
  if(!same(control,state.control)||!same(lock,state.lock))throw Error('Photo callback fence changed; original request remains pending');
 }
 return{
  read:(...args)=>store.read(...args),compareAndRemove:(collection,id,attempt)=>{
   if(collection!==journal||id!==lockId)throw Error('Only exact owned protocol lock release allowed');
   return store.compareAndRemove(collection,id,attempt);
  },
  compareAndSet:async(collection,id,version,row)=>{
   if(row?.action===ACTION||row?.stockPhotoProtocol!==undefined||row?.action==='WAREHOUSE_PREPARATION_SAVED')throw Error('Original photo evidence is insert-only');
   if(!metadata(collection,row))await beforeDomainWrite(collection,row);
   return store.compareAndSet(collection,id,version,row);
  },
  insert:async(collection,row)=>{
   if(!metadata(collection,row))await beforeDomainWrite(collection,row);
   return store.insert(collection,row);
  }
 };
}
module.exports={photoReceipt,prependWarehousePhotoReceipts,createWarehousePhotoFencedStore};
