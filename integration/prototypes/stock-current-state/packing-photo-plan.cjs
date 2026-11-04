'use strict';
const {hash}=require('./commit-proof.cjs'),{copy,same}=require('./segmented-plan.cjs');
const validFile=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(value);
// ORIGINAL packing validators and prepare only. Server-supplied generated IDs;
// no legacy apply or file upload may run inside this scratch capture.
async function captureOriginalPackingPhotoPlan({company,staff,requestId,input,context,createPackingListOperations,now,slots}){
 if(!['NCT','GHR'].includes(company)||context?.company!==company||!Array.isArray(context.tasks)||!Array.isArray(context.lists)
  ||staff?.packingDepartment!=='WAREHOUSE'||!staff.memberId||!staff.staffId||!staff.staffName||input?.action!=='PHOTOS'
  ||!Array.isArray(input.photos)||!input.photos.length||input.photos.length>3||!Array.isArray(slots)||slots.length!==input.photos.length
  ||slots.some(id=>!validFile(id))||new Set(slots).size!==slots.length||typeof createPackingListOperations!=='function'||typeof now!=='function')throw Error('Original private packing photo scope required');
 const journal=company==='NCT'?'NCTActivity':'NCTActivity1',scratch=new Map(),boundary=Error('Original private packing photo boundary');let captured,reads=0,allocated=0;
 const scope=collection=>{if(collection!==journal)throw Error('Original packing photo collection scope');};
 const store={read:async(collection,id)=>{scope(collection);return copy(scratch.get(id)||null);},
  insert:async(collection,row)=>{scope(collection);
   if(row.action==='PURCHASE_OPERATION_PREPARED'&&row.details?.kind==='PREPARED'){
    if(captured||scratch.size!==1||row.details.plan?.record?.action!=='SUPPORT_PACKING_LIST_CURRENT')throw Error('Original packing photo plan conflict');
    captured=copy(row.details.plan);throw boundary;
   }
   if(row.action!=='PURCHASE_OPERATION_LOCK'||row.details?.kind!=='LOCK'||scratch.size)throw Error('Original packing photo apply forbidden');scratch.set(row._id,copy(row));return copy(row);
  },remove:async(collection,id)=>{scope(collection);if(scratch.get(id)?.action!=='PURCHASE_OPERATION_LOCK')throw Error('Only original scratch lock removal allowed');scratch.delete(id);}};
 const save=createPackingListOperations({store,names:{[company]:{activity:journal}},now,
  readContext:async(selected,employee)=>{if(selected!==company||employee.memberId!==staff.memberId||employee.staffId!==staff.staffId||++reads!==1)throw Error('Original packing photo actor/context conflict');return copy(context);},
  documentService:async command=>{if(!same(command,{action:'ALLOCATE',company})||allocated>=slots.length)throw Error('Original external photo call forbidden during capture');return{ok:true,fileId:slots[allocated++]};}});
 try{await save({company,staff:copy(staff),requestId,input:copy(input)});throw Error('Original packing photo boundary missing');}catch(error){if(error!==boundary)throw error;}
 if(!captured||reads!==1||scratch.size||allocated!==slots.length||captured.uploads?.some((upload,index)=>upload.fileId!==slots[index]))throw Error('Original packing photo capture incomplete');
 assertPackingPhotoUploads({company,staff,requestId,input,plan:captured});return captured;
}
function assertPackingPhotoUploads({company,staff,requestId,input,plan}){
 const record=plan?.record,list=record?.details?.list,uploads=plan?.uploads,photos=input?.photos;
 if(!['NCT','GHR'].includes(company)||staff?.packingDepartment!=='WAREHOUSE'||!staff.staffId||!staff.memberId||!staff.staffName
  ||!/^[a-f0-9-]{36}$/i.test(requestId||'')||input?.action!=='PHOTOS'||!input.id||!input.taskId||!input.revision||!input.version
  ||!Array.isArray(photos)||photos.length<1||photos.length>3||!Array.isArray(uploads)||uploads.length!==photos.length
  ||record?._id!==hash(company,input.id,'PACKING_CURRENT')||record.title!==input.id||record.description!==input.id||record.action!=='SUPPORT_PACKING_LIST_CURRENT'||record.result!=='SAVED'
  ||record.initiatedByStaffId!==staff.staffId||record.initiatedByStaffName!==staff.staffName||!Number.isFinite(Date.parse(record.activityTime))
  ||list?.id!==input.id||list.company!==company||list.revision!==hash(company,requestId,staff.memberId,'PACKING_REVISION')
  ||list.updatedByStaffId!==staff.staffId||list.updatedBy!==staff.staffName||list.updatedAt!==record.activityTime||list.invoiceId||list.dispatchedAt
  ||plan.expectedVersion!==input.version||plan.beforeRevision!==input.revision||!Array.isArray(list.lines))throw Error('Immutable original packing photo plan required');
 const lines=list.lines.filter(line=>line.taskId===input.taskId),seen=new Set();if(lines.length!==1||!Array.isArray(lines[0].photos)||lines[0].photos.length<photos.length)throw Error('Original packing photo line required');
 const evidence=lines[0].photos.slice(-photos.length);
 for(const[index,upload]of uploads.entries()){
  const photo=photos[index],extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[photo?.mimeType];
  const expected={action:'PHOTO_UPLOAD',company,department:'WAREHOUSE',poId:hash(company,input.id,input.taskId,'PACKING_PHOTO'),fileId:upload.fileId,type:input.photoStage,
   mimeType:photo?.mimeType,sha256:photo?.sha256,size:upload.size,name:company+'-'+input.id+'-'+input.photoStage+'-'+requestId+'-'+index+'.'+extension};
  if(!extension||!['PACKING','LOADING'].includes(input.photoStage)||!validFile(upload.fileId)||seen.has(upload.fileId)||!same(upload,expected)
   ||typeof photo?.base64!=='string'||photo.base64.length>2800000||!/^[a-f0-9]{64}$/i.test(photo.sha256||'')||!Number.isSafeInteger(upload.size)||upload.size<12||upload.size>2*1024*1024
   ||!same(evidence[index],{fileId:upload.fileId,name:upload.name,sha256:upload.sha256,mimeType:upload.mimeType,size:upload.size,stage:upload.type,at:record.activityTime,by:staff.staffName}))throw Error('Immutable original packing photo upload conflict');
  seen.add(upload.fileId);
 }
 return true;
}
async function uploadPackingPhotoSlot({company,staff,requestId,input,plan,index,documentService}){
 assertPackingPhotoUploads({company,staff,requestId,input,plan});if(!Number.isSafeInteger(index)||index<0||index>=plan.uploads.length||typeof documentService!=='function')throw Error('Exact original packing photo slot required');
 const upload=copy(plan.uploads[index]),receipt=await documentService({...upload,base64:input.photos[index].base64});
 if(receipt?.ok!==true||['fileId','company','poId','name','sha256','mimeType','size'].some(key=>receipt[key]!==upload[key]))throw Error('Original packing photo upload unconfirmed; retain same slot');
 return{fileId:upload.fileId,company,poId:upload.poId,name:upload.name,sha256:upload.sha256,mimeType:upload.mimeType,size:upload.size};
}
module.exports={captureOriginalPackingPhotoPlan,assertPackingPhotoUploads,uploadPackingPhotoSlot};
