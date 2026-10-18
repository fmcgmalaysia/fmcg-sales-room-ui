import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { readShipmentPlans } from 'backend/customerShipmentPlan.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { createHash } from 'crypto';
import { Buffer } from 'buffer';

const text=value=>String(value??'').trim();
const qty=value=>Number.isSafeInteger(value)&&value>=0&&value<=9999;
export const PREPARATION_ACTION='WAREHOUSE_PREPARATION_SAVED';

// Separate physical preparation evidence. It never posts dispatch, invoices or stock allocations.
export function readPreparation(activity){
 const pending=activity.filter(e=>e.action===PREPARATION_ACTION&&e.result==='SAVED'),states=new Map();
 while(pending.length){
  const next=pending.filter(e=>(states.get(e.description)?.revision||'')===e.details?.beforeRevision);
  if(!next.length||new Set(next.map(e=>e.description)).size!==next.length)throw Error('Warehouse preparation history requires review.');
  for(const e of next){const d=e.details,s=d?.state;
   if(!e.title||!s||s.id!==e.description||!s.taskId||!s.customerId||!['NCT','GHR'].includes(s.company)||!qty(s.quantity)||!qty(s.loaded)||s.loaded>s.quantity||!Array.isArray(s.photos)||!e.initiatedByStaffId||!Number.isFinite(Date.parse(e.activityTime)))throw Error('Warehouse preparation identity requires review.');
   states.set(s.id,{...s,revision:e.title,at:new Date(e.activityTime).toISOString(),by:e.initiatedByStaffName});pending.splice(pending.indexOf(e),1);
  }
 }
 return states;
}

export function projectPreparation(context){
 const plans=readShipmentPlans(context.activity),states=readPreparation(context.activity),shipments=readCustomerShipments(context.activity),customers=new Map((context.customers||[]).map(c=>[c.id,c.name])),items=[];
 for(const task of context.tasks.filter(t=>!t.archived&&!t.specialPurchase&&!t.procurementSource)){
  const goal=task.shortage?.customerDecision==='STOP'?(task.inc||0):task.ord;
  if(!qty(goal)||!goal)continue;
  const plan=plans.find(p=>p.customerId===task.customerId&&p.orderId===task.orderId&&p.batches.some(b=>b.lines.some(l=>l.taskId===task.id)));
  const batches=plan?plan.batches.flatMap(b=>{const l=b.lines.find(l=>l.taskId===task.id);return l?[{key:plan.id+'|'+b.sequence,label:b.label,date:b.date,quantity:l.quantity,planRevision:plan.revision}]:[]}):[{key:'WHOLE',label:'',date:task.estimatedShipmentDate,quantity:goal,planRevision:''}];
  const planMismatch=batches.reduce((n,b)=>n+b.quantity,0)!==goal;
  for(const batch of batches){
   const id=operationId(context.company,task.id,batch.key),saved=states.get(id),signature=operationId(task.id,task.orderId,task.sourceLineId,goal,batch.quantity,batch.planRevision),valid=!planMismatch&&saved?.signature===signature;
   const dispatched=shipments.filter(s=>s.status==='DISPATCHED').flatMap(s=>s.lines).filter(l=>l.taskId===task.id).reduce((n,l)=>n+l.quantity,0);
   items.push({id,taskId:task.id,orderId:task.orderId,customerId:task.customerId,customerName:customers.get(task.customerId)||task.customerId,barcode:task.barcode,name:task.name,packing:task.packing,quantity:batch.quantity,sourceTaskIds:context.tasks.filter(t=>t.id===task.id||t.customerDemandTaskId===task.id).map(t=>t.id),planMismatch,batch:batch.label,estimatedShipmentDate:batch.date||task.estimatedShipmentDate||null,readyStock:null,allocated:task.inc||0,signature,revision:saved?.revision||'',prepared:valid&&saved.prepared===true,preparedAt:valid?saved?.preparedAt||null:null,loaded:saved?.loaded||0,loadedAt:saved?.loadedAt||null,photos:saved?.photos||[],note:saved?.note||'',updatedAt:saved?.at||null,updatedBy:saved?.by||'',stale:Boolean(saved&&!valid)||planMismatch,dispatched,history:context.activity.filter(e=>e.action===PREPARATION_ACTION&&e.result==='SAVED'&&e.description===id).map(e=>({at:new Date(e.activityTime).toISOString(),by:e.initiatedByStaffName,action:e.details.action,note:e.details.state.note,loaded:e.details.state.loaded,photos:e.details.state.photos}))});
  }
 }
 for(const [id,s] of states)if(s.loaded>0&&!items.some(i=>i.id===id))items.push({...s,revision:s.revision,customerName:customers.get(s.customerId)||s.customerId,readyStock:null,allocated:0,prepared:false,stale:true,orphaned:true,dispatched:0,history:[]});
 return items.map(item=>{const stockChanged=items.filter(i=>i.taskId===item.taskId&&i.prepared&&!i.stale).reduce((n,i)=>n+i.quantity,0)>item.allocated;return {...item,prepared:item.prepared&&!stockChanged,stale:item.stale||stockChanged,version:operationId(item.signature,item.revision,item.allocated,item.dispatched),status:item.stale||stockChanged?'ISSUE':item.loaded===item.quantity?'LOADED':item.loaded>0?'PARTIAL':item.prepared?'READY':'PENDING'};});
}

export function preparationSummary(taskId,context){
 if(!context.activity.some(e=>e.action===PREPARATION_ACTION&&e.result==='SAVED'&&e.imageAltText===taskId))return null;
 const items=projectPreparation(context).filter(i=>i.taskId===taskId&&!i.orphaned);
 if(!items.length)return null;
 const ready=items.every(i=>i.prepared&&!i.stale),packedQty=items.reduce((n,i)=>n+(i.prepared&&!i.stale?i.quantity:0),0),loadedQty=items.reduce((n,i)=>n+i.loaded,0);
 return {ready,packedQty,loadedQty,packedAt:ready?items.map(i=>i.preparedAt).filter(Boolean).sort().at(-1)||null:null,loadedAt:loadedQty?items.map(i=>i.loadedAt).filter(Boolean).sort().at(-1)||null:null,issue:items.some(i=>i.stale),batches:items.map(i=>({label:i.batch,quantity:i.quantity,prepared:i.prepared&&!i.stale,loaded:i.loaded,at:i.updatedAt}))};
}

export function createPreparationOperations({store,names,readContext,documentService,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  if(!names[company]||staff?.canPrepareWarehouse!==true||!['PACK','LOAD','UNPACK','PHOTOS'].includes(input?.action))throw Error('Warehouse preparation action is not authorized.');
  const photos=input.photos||[];
  if(!Array.isArray(photos)||photos.length>3)throw Error('Warehouse select up to three photos per save.');
  let total=0;
  const verified=photos.map(p=>{
   if(!p||!['image/jpeg','image/png','image/webp'].includes(p.mimeType)||typeof p.base64!=='string'||p.base64.length>2800000||!/^\w{64}$/.test(p.sha256||''))throw Error('Warehouse photo format is invalid.');
   const bytes=Buffer.from(p.base64,'base64');total+=bytes.length;
   const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
   if(bytes.length<12||total>2*1024*1024||!({ 'image/jpeg':jpeg,'image/png':png,'image/webp':webp })[p.mimeType]||createHash('sha256').update(bytes).digest('hex')!==p.sha256)throw Error('Warehouse photo content or total size is invalid.');
   return {mimeType:p.mimeType,sha256:p.sha256,base64:p.base64,size:bytes.length};
  });
  const safeInput={...input,photos:verified.map(({base64,...p})=>p)};
  async function current(){const context=await readContext(company,staff),items=projectPreparation(context),item=items.find(i=>i.id===input.id);if(context.company!==company||!item||item.version!==input.version)throw Error('Warehouse task changed. Refresh before saving; input is retained.');return {context,items,item};}
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{preparation:safeInput},prepare:async()=>{
   const {items,item}=await current(),note=text(input.note),at=now().toISOString();
   if(item.dispatched>0)throw Error('Warehouse this task has dispatched goods. Use the supervised correction process.');
   if(item.planMismatch||item.orphaned||item.stale&&item.loaded>0)throw Error('Warehouse loading no longer matches the current task. Ask Sales to restore or review its batch plan.');
   if(note.length>1000)throw Error('Warehouse note is too long.');
   let prepared=item.prepared,loaded=item.loaded,preparedAt=item.preparedAt,loadedAt=item.loadedAt;
   if(input.action==='PACK'){
    const other=items.filter(i=>i.taskId===item.taskId&&i.id!==item.id&&i.prepared&&!i.stale).reduce((n,i)=>n+i.quantity,0);
    if(item.allocated<other+item.quantity)throw Error('Warehouse allocated goods are insufficient. Ask Purchase to confirm stock allocation.');
    prepared=true;preparedAt=at;
   }
   if(input.action==='UNPACK'){if(item.loaded>0||!note)throw Error('Warehouse unload first and provide a correction reason before reversing preparation.');prepared=false;preparedAt=null;}
   if(input.action==='LOAD'){
    if(!prepared||!qty(input.loaded)||input.loaded>item.quantity)throw Error('Warehouse prepare this batch first and enter valid loaded cartons.');
    if((input.loaded<item.quantity||input.loaded<loaded)&&!note)throw Error('Warehouse explain partial loading or a quantity correction.');
    const other=items.filter(i=>i.taskId===item.taskId&&i.id!==item.id).reduce((n,i)=>n+i.loaded,0);
    if(other+input.loaded>item.allocated)throw Error('Warehouse loaded cartons exceed the customer allocation.');
    loaded=input.loaded;loadedAt=at;
   }
   if(input.action==='PHOTOS'&&!prepared&&!loaded)throw Error('Warehouse confirm preparation or loading before adding evidence.');
   if(verified.length&&(!['PACKING','LOADING'].includes(input.photoStage)||input.action==='PACK'&&input.photoStage!=='PACKING'||input.action==='LOAD'&&input.photoStage!=='LOADING'||input.photoStage==='LOADING'&&!loaded))throw Error('Warehouse photo stage is required.');
   const uploads=[];
   for(let index=0;index<verified.length;index++){const p=verified[index],allocated=await documentService({action:'ALLOCATE',company}),ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[p.mimeType];uploads.push({action:'PHOTO_UPLOAD',company,department:'WAREHOUSE',poId:item.id,fileId:allocated.fileId,type:input.photoStage,mimeType:p.mimeType,sha256:p.sha256,size:p.size,name:company+'-'+item.barcode+'-'+input.photoStage+'-'+requestId+'-'+index+'.'+ext});}
   const state={id:item.id,taskId:item.taskId,orderId:item.orderId,customerId:item.customerId,company,barcode:item.barcode,name:item.name,packing:item.packing,batch:item.batch,quantity:item.quantity,sourceTaskIds:item.sourceTaskIds,signature:item.signature,prepared,preparedAt,loaded,loadedAt,note:note||item.note,photos:[...item.photos,...uploads.map(u=>({fileId:u.fileId,name:u.name,sha256:u.sha256,mimeType:u.mimeType,size:u.size,stage:u.type,at,by:staff.staffName}))]};
   if(state.photos.length>30)throw Error('Warehouse photo history is full. Contact Admin.');
   const id=operationId(company,requestId,staff.memberId,'WAREHOUSE_PREPARATION');
   return {version:item.version,uploads,event:{_id:id,title:id,description:item.id,image:item.customerId,imageAltText:item.taskId,action:PREPARATION_ACTION,result:'SAVED',actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,activityTime:at,message:note,details:{action:input.action,beforeRevision:item.revision,state}}};
  },apply:async plan=>{
   const saved=await store.read(names[company].activity,plan.event._id);
   if(saved){if(operationId(saved.details)!==operationId(plan.event.details))throw Error('Warehouse preparation identity conflict.');}
   else{
    await current();
    for(let i=0;i<plan.uploads.length;i++){
     const upload=plan.uploads[i],receipt=await documentService({...upload,base64:verified[i].base64});
     if(receipt?.ok!==true||['fileId','company','poId','name','sha256','mimeType','size'].some(key=>receipt[key]!==upload[key]))throw Error('Warehouse photo upload is unconfirmed. Retry the same save.');
    }
    await current();
    await store.insert(names[company].activity,{...plan.event,activityTime:new Date(plan.event.activityTime)});
   }
   return {ok:true,company,requestId,id:plan.event.description,savedAt:plan.event.activityTime};
  }});
 };
}
