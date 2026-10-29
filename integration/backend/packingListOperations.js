import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { changePackingList, packingAvailability } from 'backend/packingListModel.js';
import { Buffer } from 'buffer';
import { validatePackingPhotos } from 'backend/packingListPhotos.js';
import { loadingOutflowId, planLoadedSources, assertLoadedOutflows } from 'backend/physicalOutflow.js';
import { planDeskDelivery, changeDeskDelivery } from 'backend/deskDelivery.js';
import { reserveSupportDeskDelivery } from 'backend/supportDesk.js';

export const PACKING_CURRENT='SUPPORT_PACKING_LIST_CURRENT';
const validEvidence=line=>line.photos===undefined||Array.isArray(line.photos)&&line.photos.length<=30&&line.photos.every(photo=>photo&&typeof photo.fileId==='string'&&photo.fileId.length>0&&typeof photo.sha256==='string'&&/^[a-f0-9]{64}$/i.test(photo.sha256)&&['PACKING','LOADING'].includes(photo.stage)&&Number.isSafeInteger(photo.size)&&photo.size>0&&photo.size<=2*1024*1024&&!Object.hasOwn(photo,'base64'));
export function readPackingLists(activity,company){
 const records=activity.filter(row=>row.action===PACKING_CURRENT);
 const ids=new Set();
 return records.map(row=>{const list=row.details?.list;
  if(!list||row._id!==operationId(company,list.id,'PACKING_CURRENT')||row.description!==list.id||list.company!==company||ids.has(list.id)||!list.revision||!list.customerId||!list.currency||!['DRAFT','SENT','PROCESSING','COMPLETED','CANCELLED'].includes(list.status)||!Array.isArray(list.lines)||list.lines.length<1||list.lines.length>300||new Set(list.lines.map(line=>line.taskId)).size!==list.lines.length||list.lines.some(line=>!line.taskId||![line.quantity,line.packed,line.loaded].every(value=>Number.isSafeInteger(value)&&value>=0&&value<=9999)||line.quantity===0||line.loaded>line.packed||line.packed>line.quantity))throw Error('Packing list identity requires review.');
  if(list.change&&(!Array.isArray(list.change.lines)||!list.change.lines.length||list.change.lines.length>300||new Set(list.change.lines.map(line=>line.taskId)).size!==list.change.lines.length||list.change.lines.some(line=>!line.taskId||!Number.isSafeInteger(line.quantity)||line.quantity<=0||line.quantity>9999)))throw Error('Packing change requires review.');
  if(Buffer.byteLength(JSON.stringify(list),'utf8')>200000||!list.lines.every(validEvidence)||list.change&&!list.change.lines.every(validEvidence)||list.retiredLines!==undefined&&(!Array.isArray(list.retiredLines)||list.retiredLines.length>300||!list.retiredLines.every(line=>line&&line.taskId&&line.retiredAt&&validEvidence(line))))throw Error('Packing evidence requires review.');
  ids.add(list.id);return JSON.parse(JSON.stringify(list));
 });
}
export function packingVersion(context){return operationId(context.company,context.sourceVersion,context.tasks,context.lists);}
export function projectPackingWorkroom(context,department){
 if(!['SUPPORT','WAREHOUSE'].includes(department))throw Error('Packing department is not authorized.');
 return {company:context.company,version:packingVersion(context),tasks:department==='SUPPORT'?packingAvailability(context):[],lists:context.lists.filter(list=>department==='SUPPORT'||list.status!=='DRAFT').map(list=>({...list,lines:list.lines.map(line=>({...line,chatContexts:context.tasks.find(task=>task.taskId===line.taskId)?.chatContexts||[]}))})),readAt:context.readAt||null};
}
// Shared consumer guards must be deployed alongside this endpoint.
export function createPackingListOperations({store,names,readContext,documentService,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  const department=staff?.packingDepartment;
  if(!names[company]||!['SUPPORT','WAREHOUSE'].includes(department)||!input)throw Error('Packing access is not authorized.');
  const deskLoad=input.action==='DESK_LOAD',deskAction=['DESK_SEND','DESK_LOAD','DESK_RECALL'].includes(input.action),photoSave=input.action==='PHOTOS'||deskLoad&&input.photos?.length>0;
  if(deskLoad&&input.photos!==undefined&&!Array.isArray(input.photos))throw Error('Warehouse photo format is invalid.');
  if(photoSave&&(department!=='WAREHOUSE'||!documentService))throw Error('Warehouse photo upload is not authorized.');
  const verified=photoSave?validatePackingPhotos(input.photos):[];
  const safeInput=photoSave||deskLoad?{...input,photos:verified.map(({base64,...photo})=>photo)}:input;
  const collection=names[company].activity;
  return journal({collection,scope:company+'/PURCHASE',requestId,staff,input:{packing:safeInput},prepare:async()=>{
   const context=await readContext(company,staff);
   if(context.company!==company||!deskAction&&packingVersion(context)!==input.version)throw Error('Packing workroom changed. Refresh before saving.');
   const creating=input.action==='CREATE'||input.action==='DESK_SEND',id=creating?operationId(company,requestId,staff.memberId,'PACKING'):input.id;
   const current=context.lists.find(list=>list.id===id);
   if(!creating&&!current)throw Error('Packing list is unavailable.');
   const revision=operationId(company,requestId,staff.memberId,'PACKING_REVISION'),at=now().toISOString();
   const uploads=[],photoStage=deskLoad?'LOADING':input.photoStage,deskNext=deskAction?(input.action==='DESK_SEND'?planDeskDelivery({context,input,actor:department,id,revision,at}):changeDeskDelivery({context,list:current,input,actor:department,id,revision,at})):null;
   if(photoSave){
    if(!current?.lines.some(line=>line.taskId===input.taskId)||!['PACKING','LOADING'].includes(photoStage))throw Error('Warehouse photo task or stage requires review.');
    // Reject invalid state/revision/history before allocating external file IDs.
    if(!deskLoad)changePackingList({list:current,input:{...input,attachments:verified.map(photo=>({fileId:'VALIDATION_ONLY',sha256:photo.sha256,stage:photoStage}))},context,actor:department,id,revision,at});
    for(let index=0;index<verified.length;index++){const photo=verified[index],allocated=await documentService({action:'ALLOCATE',company}),extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[photo.mimeType];if(!allocated?.fileId)throw Error('Warehouse photo allocation is unconfirmed.');uploads.push({action:'PHOTO_UPLOAD',company,department:'WAREHOUSE',poId:operationId(company,id,input.taskId,'PACKING_PHOTO'),fileId:allocated.fileId,type:photoStage,mimeType:photo.mimeType,sha256:photo.sha256,size:photo.size,name:company+'-'+id+'-'+photoStage+'-'+requestId+'-'+index+'.'+extension});}
   }
   const attachments=uploads.map(upload=>({fileId:upload.fileId,name:upload.name,sha256:upload.sha256,mimeType:upload.mimeType,size:upload.size,stage:upload.type,at,by:staff.staffName}));
   const next=deskNext||changePackingList({list:current,input:{...input,company,attachments},context,actor:department,id,revision,at});
   if(deskLoad&&attachments.length)next.lines=next.lines.map(line=>line.taskId===input.taskId?{...line,photos:[...(line.photos||[]),...attachments]}:line);
   if(deskLoad&&next.lines.some(line=>line.photos?.length>30))throw Error('Warehouse photo history is full.');
   if(input.action==='PROGRESS'||deskLoad)for(const line of next.lines){
    if(!context.physicalContext)throw Error('Packing physical stock context is unavailable.');
    line.physicalSources=planLoadedSources(context.physicalContext,{id:loadingOutflowId(company,'PACKING',id,line.taskId),taskId:line.taskId,loaded:line.loaded,previous:current.lines.find(row=>row.taskId===line.taskId)?.physicalSources||[]});
   }
   if(input.action==='PROGRESS'||deskLoad)assertLoadedOutflows(context.physicalContext,next.lines.map(line=>({id:loadingOutflowId(company,'PACKING',id,line.taskId),taskId:line.taskId,quantity:line.loaded,sources:line.physicalSources})));
   next.updatedBy=staff.staffName;next.updatedByStaffId=staff.staffId;
   if(Buffer.byteLength(JSON.stringify(next),'utf8')>200000)throw Error('Packing list is too large. Use a smaller packing list.');
   const deskReservation=input.action==='DESK_SEND'?{customerId:next.customerId,desk:next.desk.number,revision:input.deskRevision,listId:id,taskIds:next.lines.map(line=>line.taskId),digest:operationId(next)}:null;
   return {uploads,deskReservation,...(deskReservation?{authorizationInput:safeInput}:{}),expectedVersion:packingVersion(context),beforeRevision:current?.revision||'',record:{_id:operationId(company,id,'PACKING_CURRENT'),title:id,description:id,image:next.customerId,action:PACKING_CURRENT,result:'SAVED',actorType:'STAFF',activityTime:at,initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,details:{list:next}}};
  },apply:async plan=>{
   const existing=await store.read(collection,plan.record._id),list=plan.record.details.list;let deskState=null;
   if(existing?.details?.list?.revision===list.revision){
    if(operationId(existing.details)!==operationId(plan.record.details))throw Error('Packing receipt conflict.');
    if(plan.deskReservation){const hold=await store.read(collection,operationId(operationId(company,list.customerId,'SUPPORT_DESK'),plan.deskReservation.revision,'NEXT'));if(!hold?.details?.state?.deliveryHolds?.some(row=>row.listId===list.id&&row.requestId===requestId&&row.memberId===staff.memberId&&row.digest===plan.deskReservation.digest))throw Error('Desk delivery receipt is unconfirmed. Retry the same save.');deskState={...hold.details.state,revision:hold.title};}
   }else{
    if((existing?.details?.list?.revision||'')!==plan.beforeRevision)throw Error('Packing list changed while saving.');
    const checked=await readContext(company,staff);
    if(packingVersion(checked)!==plan.expectedVersion)throw Error('Stock or packing workroom changed while saving.');
    if(plan.deskReservation)deskState=await reserveSupportDeskDelivery({store,names,context:checked.physicalContext,staff,requestId,...plan.deskReservation,now});
    if(list.lines.some(line=>line.loaded>0))assertLoadedOutflows(checked.physicalContext,list.lines.filter(line=>line.loaded>0).map(line=>({id:loadingOutflowId(company,'PACKING',list.id,line.taskId),taskId:line.taskId,quantity:line.loaded,sources:line.physicalSources})));
    for(let index=0;index<(plan.uploads||[]).length;index++){const upload=plan.uploads[index],receipt=await documentService({...upload,base64:verified[index].base64});if(receipt?.ok!==true||['fileId','company','poId','name','sha256','mimeType','size'].some(key=>receipt[key]!==upload[key]))throw Error('Warehouse photo upload is unconfirmed. Retry this same save.');}
    if(packingVersion(await readContext(company,staff))!==plan.expectedVersion)throw Error('Stock or packing workroom changed while saving.');
    const row={...plan.record,activityTime:new Date(plan.record.activityTime)};
    if(existing)await store.update(collection,row);else await store.insert(collection,row);
   }
   return {ok:true,company,requestId,id:list.id,revision:list.revision,status:list.status,...(list.desk?{list,deskState}:{} )};
  }});
 };
}
