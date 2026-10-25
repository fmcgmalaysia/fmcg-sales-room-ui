'use strict';
const {hash}=require('./commit-proof.cjs');
const {same,copy}=require('./segmented-plan.cjs');
const fileId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(value);
// PRIVATE boundary: slots must come from the server's durable plan, never browser
// file IDs. Capture ORIGINAL validation/prepare with no legacy apply or file call.
async function captureOriginalWarehousePhotoPlan({company,staff,requestId,input,context,createPreparationOperations,now,slots}){
 if(!['NCT','GHR'].includes(company)||context?.company!==company||!Array.isArray(context.tasks)||!Array.isArray(context.activity)
  ||!staff?.memberId||!staff.staffId||!staff.staffName||staff.canPrepareWarehouse!==true
  ||!/^[a-f0-9-]{36}$/i.test(requestId||'')||!['PACK','LOAD','UNPACK','PHOTOS'].includes(input?.action)
  ||!Array.isArray(input.photos)||input.photos.length>3||!Array.isArray(slots)||slots.length!==input.photos.length
  ||slots.some(id=>!fileId(id))||new Set(slots).size!==slots.length
  ||typeof createPreparationOperations!=='function'||typeof now!=='function')throw Error('Private original Warehouse photo plan scope required');
 const journal=company==='NCT'?'NCTActivity':'NCTActivity1',scratch=new Map(),boundary=Error('Private photo prepare boundary');
 let captured,reads=0,allocated=0;
 const scope=collection=>{if(collection!==journal)throw Error('Private Warehouse photo journal scope');};
 const store={
  read:async(collection,id)=>{scope(collection);return copy(scratch.get(id)||null);},
  insert:async(collection,row)=>{scope(collection);
   if(row.action==='PURCHASE_OPERATION_PREPARED'&&row.details?.kind==='PREPARED'){
    if(captured||scratch.size!==1||row.details.plan?.event?.action!=='WAREHOUSE_PREPARATION_SAVED')throw Error('Unexpected original photo prepare');
    captured=copy(row.details.plan);throw boundary;
   }
   if(row.action!=='PURCHASE_OPERATION_LOCK'||row.details?.kind!=='LOCK'||scratch.size)throw Error('Original photo apply forbidden');
   scratch.set(row._id,copy(row));return copy(row);
  },
  remove:async(collection,id)=>{scope(collection);if(scratch.get(id)?.action!=='PURCHASE_OPERATION_LOCK')throw Error('Only scratch photo lock removal allowed');scratch.delete(id);}
 };
 const save=createPreparationOperations({store,names:{[company]:{activity:journal}},now,
  readContext:async(c,actor)=>{if(c!==company||actor.memberId!==staff.memberId||++reads!==1)throw Error('Original photo context scope');return copy(context);},
  documentService:async command=>{
   if(!same(command,{action:'ALLOCATE',company})||allocated>=slots.length)throw Error('External photo call forbidden during capture');
   return{ok:true,fileId:slots[allocated++]};
  }});
 try{await save({company,staff:copy(staff),requestId,input:copy(input)});throw Error('Original photo prepare boundary not reached');}
 catch(error){if(error!==boundary)throw error;}
 if(!captured||reads!==1||scratch.size||allocated!==slots.length||captured.version!==input.version
  ||captured.event._id!==hash(company,requestId,staff.memberId,'WAREHOUSE_PREPARATION')||captured.event.initiatedByStaffId!==staff.staffId
  ||captured.event.description!==input.id||captured.event.details?.action!==input.action||captured.event.details.state?.id!==input.id
  ||captured.uploads.length!==slots.length||captured.uploads.some((upload,index)=>upload.fileId!==slots[index]))throw Error('Original photo plan identity conflict');
 assertWarehousePhotoUploads({company,staff,requestId,input,plan:captured});
 return captured;
}
// Validate ONLY exact immutable upload descriptors already captured from original
// prepare. The authenticated caller must hold durable pending before upload; this
// helper intentionally has NO network/storage/lock/allocate/trash capability.
function assertWarehousePhotoUploads({company,staff,requestId,input,plan}){
 const event=plan?.event,photos=input?.photos,uploads=plan?.uploads;
 if(!['NCT','GHR'].includes(company)||!staff?.staffId||!staff.memberId||!staff.staffName
  ||!/^[a-f0-9-]{36}$/i.test(requestId||'')||!['PACK','LOAD','UNPACK','PHOTOS'].includes(input?.action)
  ||!Array.isArray(photos)||photos.length>3||!Array.isArray(uploads)||uploads.length!==photos.length
  ||event?._id!==hash(company,requestId,staff.memberId,'WAREHOUSE_PREPARATION')||event.title!==event._id
  ||event.action!=='WAREHOUSE_PREPARATION_SAVED'||event.result!=='SAVED'||event.description!==input.id
  ||event.initiatedByStaffId!==staff.staffId||event.initiatedByStaffName!==staff.staffName
  ||event.details?.action!==input.action||event.details.state?.id!==input.id||plan.version!==input.version
  ||event.details.state.company!==company||!Array.isArray(event.details.state.photos)||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Immutable original photo plan required');
 const evidence=event.details.state.photos.slice(-uploads.length),seen=new Set();
 for(const[index,upload]of uploads.entries()){
  const photo=photos[index],ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[photo?.mimeType];
  const expected={action:'PHOTO_UPLOAD',company,department:'WAREHOUSE',poId:input.id,fileId:upload.fileId,type:input.photoStage,mimeType:photo?.mimeType,
   sha256:photo?.sha256,size:upload.size,name:company+'-'+event.details.state.barcode+'-'+input.photoStage+'-'+requestId+'-'+index+'.'+ext};
  if(!ext||!fileId(upload.fileId)||seen.has(upload.fileId)||!same(upload,expected)||!['PACKING','LOADING'].includes(upload.type)
   ||typeof photo?.base64!=='string'||photo.base64.length>2800000||!/^[a-f0-9]{64}$/i.test(photo.sha256||'')
   ||!Number.isSafeInteger(upload.size)||upload.size<12||upload.size>2*1024*1024
   ||!same(evidence[index],{fileId:upload.fileId,name:upload.name,sha256:upload.sha256,mimeType:upload.mimeType,size:upload.size,stage:upload.type,at:event.activityTime,by:staff.staffName}))throw Error('Immutable original photo upload conflict');
  seen.add(upload.fileId);
 }
 return true;
}
// A single deterministic slot is one bounded external action. Replays reuse the
// exact original file ID; legacy service is create-only + same-ID content check.
// A timeout/unknown response throws: caller must keep its pending operation. There
// is no TTL unlock or interpretation of a timeout as callback termination here.
async function uploadWarehousePhotoSlot({company,staff,requestId,input,plan,index,documentService}){
 assertWarehousePhotoUploads({company,staff,requestId,input,plan});
 if(!Number.isSafeInteger(index)||index<0||index>=plan.uploads.length||typeof documentService!=='function')throw Error('Exact original photo slot required');
 const upload=copy(plan.uploads[index]),receipt=await documentService({...upload,base64:input.photos[index].base64});
 if(receipt?.ok!==true||['fileId','company','poId','name','sha256','mimeType','size'].some(key=>receipt[key]!==upload[key]))throw Error('Original photo upload unconfirmed; retain same slot');
 return{fileId:upload.fileId,company,poId:upload.poId,name:upload.name,sha256:upload.sha256,mimeType:upload.mimeType,size:upload.size};
}
module.exports={captureOriginalWarehousePhotoPlan,assertWarehousePhotoUploads,uploadWarehousePhotoSlot};
