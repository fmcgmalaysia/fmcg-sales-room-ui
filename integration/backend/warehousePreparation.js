import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { requirePackingReleased } from 'backend/packingListGuards.js';
import { readShipmentPlans } from 'backend/customerShipmentPlan.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { createHash } from 'crypto';
import { Buffer } from 'buffer';
import { allocateBatchMetric, resolveBatchStock, preferredSourceBatch, allocateBatchSources, stockBatchEntries } from 'backend/shipmentBatchAllocation.js';
import { readPhysicalOutflows, loadingOutflowId, planLoadedSources, assertLoadedOutflows } from 'backend/physicalOutflow.js';

const text=value=>String(value??'').trim();
const qty=value=>Number.isSafeInteger(value)&&value>=0&&value<=9999;
const validExpiry=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export const PREPARATION_ACTION='WAREHOUSE_PREPARATION_SAVED';

// Preparation evidence and confirmed Loaded outflow share the original save journal.
export function readPreparation(activity){
 const pending=activity.filter(e=>e.action===PREPARATION_ACTION&&e.result==='SAVED'),states=new Map();
 while(pending.length){
  const next=pending.filter(e=>(states.get(e.description)?.revision||'')===e.details?.beforeRevision);
  if(!next.length||new Set(next.map(e=>e.description)).size!==next.length)throw Error('Warehouse preparation history requires review.');
  for(const e of next){const d=e.details,s=d?.state;
   if(!e.title||!s||s.id!==e.description||!s.taskId||!s.customerId||!['NCT','GHR'].includes(s.company)||!qty(s.quantity)||!qty(s.loaded)||s.loaded>s.quantity||!Array.isArray(s.photos)||(s.expiryDate!==undefined&&s.expiryDate!==null&&!validExpiry(s.expiryDate))||!e.initiatedByStaffId||!Number.isFinite(Date.parse(e.activityTime)))throw Error('Warehouse preparation identity requires review.');
   states.set(s.id,{...s,revision:e.title,at:new Date(e.activityTime).toISOString(),by:e.initiatedByStaffName});pending.splice(pending.indexOf(e),1);
  }
 }
 return states;
}

// Read physical stock for this customer demand; do not post or change allocations.
function readyStockFor(task,context,shipments,onlySourceId){
 const dispatched=readPhysicalOutflows(context.activity);
 const shippedFrom=(sourceId,targetId)=>dispatched.filter(l=>l.taskId===targetId).flatMap(l=>l.sources).filter(s=>s.sourceTaskId===sourceId).reduce((n,s)=>n+s.quantity,0);
 const total=context.tasks.reduce((sum,source)=>{
  if(onlySourceId&&source.id!==onlySourceId)return sum;
  if(!source.warehouse?.hasPhysicalReceipt)return sum;
  const physical=source.warehouse.stock?.availablePhysical;
  if(!Number.isSafeInteger(physical)||physical<0)return sum;
  const targets=(context.allocations||[]).find(a=>a.sourceTaskId===source.id)?.targets||[];
  const heldElsewhere=targets.filter(t=>t.taskId!==task.id).reduce((n,t)=>n+Math.max(0,t.quantity-shippedFrom(source.id,t.taskId)),0);
  const available=Math.max(0,physical-heldElsewhere),own=source.id===task.id||source.customerDemandTaskId===task.id;
  const incoming=Math.max(0,(targets.find(t=>t.taskId===task.id)?.quantity||0)-shippedFrom(source.id,task.id));
  const share=source.procurement?.customerCtn,totalCtn=source.procurement?.totalCtn;
  const knownShare=Number.isSafeInteger(share)&&share>=0&&Number.isSafeInteger(totalCtn)&&totalCtn>=share;
  const ownLimit=targets.some(t=>t.taskId===task.id)?incoming:knownShare?Math.max(0,share-shippedFrom(source.id,task.id)):available;
  return sum+(own?Math.min(available,ownLimit):Math.min(available,incoming));
 },0);
 const sent=dispatched.filter(l=>l.taskId===task.id).reduce((n,l)=>n+l.quantity,0);
 return Math.min(total,Math.max(0,Math.min(task.ord,Math.max(task.salesCommittedQty??task.ord,task.inc||0))-sent));
}

export function projectPreparation(context){
 const plans=readShipmentPlans(context.activity),states=readPreparation(context.activity),shipments=readCustomerShipments(context.activity),customers=new Map((context.customers||[]).map(c=>[c.id,c.name])),items=[];
 for(const task of context.tasks.filter(t=>!t.archived&&!t.specialPurchase&&!t.procurementSource)){
  const readyStock=readyStockFor(task,context,shipments);
  const goal=task.shortage?.customerDecision==='STOP'?(task.inc||0):task.ord;
  if(!qty(goal)||!goal)continue;
  const plan=plans.find(p=>p.customerId===task.customerId&&p.orderId===task.orderId&&p.batches.some(b=>b.lines.some(l=>l.taskId===task.id)));
  const batches=plan?plan.batches.flatMap(b=>{const l=b.lines.find(l=>l.taskId===task.id);return l?[{key:plan.id+'|'+b.sequence,label:b.label,date:b.date,quantity:l.quantity,coverage:l.coverage,planRevision:plan.revision}]:[]}):[{key:'WHOLE',label:'',date:task.estimatedShipmentDate,quantity:goal,planRevision:''}];
  const explicit=Boolean(plan&&(context.allocations||[]).some(allocation=>allocation.targets.some(target=>target.taskId===task.id&&target.batches))),anchored=batches.some(batch=>batch.coverage)||explicit,stockSources=anchored?(context.allocations||[]).flatMap(allocation=>{const target=allocation.targets.find(target=>target.taskId===task.id),quantity=target?.quantity;return quantity?[{id:allocation.sourceTaskId,quantity,batchId:preferredSourceBatch(allocation.sourceTaskId,context.activity),...(target.batches?{bindings:target.batches}:{})}]:[];}):[];
  const outflows=readPhysicalOutflows(context.activity).filter(row=>row.taskId===task.id),sent=outflows.reduce((sum,row)=>sum+row.quantity,0);
  const readyByBatch=anchored&&stockSources.length?resolveBatchStock(plan,task.id,explicit?stockSources:stockSources.map(source=>({...source,quantity:Math.min(source.quantity,readyStockFor(task,context,shipments,source.id)+outflows.flatMap(row=>row.sources).filter(row=>row.sourceTaskId===source.id).reduce((sum,row)=>sum+row.quantity,0))}))):allocateBatchMetric(batches,readyStock+sent,'received'),allocatedByBatch=anchored?(stockSources.length?resolveBatchStock(plan,task.id,stockSources):allocateBatchMetric(batches,task.inc||0,'received')):null;
  const sourceByBatch=anchored&&stockSources.length?allocateBatchSources(stockBatchEntries(plan,task.id),stockSources):null,stockVersion=operationId(context.allocations||[],outflows);
  const planTotal=batches.reduce((n,b)=>n+b.quantity,0),planMismatch=planTotal!==goal&&(!plan||task.shortage?.customerDecision==='STOP'||planTotal!==(task.requested??goal));
  const commercialSent=shipments.filter(row=>row.status==='DISPATCHED').flatMap(row=>row.lines).filter(row=>row.taskId===task.id).reduce((sum,row)=>sum+row.quantity,0);
  let batchOffset=0;
  let unassigned=outflows.filter(row=>row.kind!=='WAREHOUSE').reduce((sum,row)=>sum+row.quantity,0);
  for(const [batchIndex,batch] of batches.entries()){
   const id=operationId(context.company,task.id,batch.key),saved=states.get(id),signature=operationId(task.id,task.orderId,task.sourceLineId,goal,batch.quantity,batch.planRevision),valid=!planMismatch&&saved?.signature===signature;
   const ownLoaded=outflows.filter(row=>row.kind==='WAREHOUSE'&&row.loadingId===id).reduce((sum,row)=>sum+row.quantity,0),otherLoaded=Math.min(Math.max(0,batch.quantity-ownLoaded),unassigned);
   const consumed=ownLoaded+otherLoaded;unassigned-=otherLoaded;const dispatched=Math.min(batch.quantity,Math.max(0,commercialSent-batchOffset));batchOffset+=batch.quantity;
   const batchAllocated=allocatedByBatch?allocatedByBatch[batchIndex]:null;
   items.push({id,taskId:task.id,orderId:task.orderId,customerId:task.customerId,customerName:customers.get(task.customerId)||task.customerId,barcode:task.barcode,name:task.name,packing:task.packing,quantity:batch.quantity,sourceTaskIds:context.tasks.filter(t=>t.id===task.id||t.customerDemandTaskId===task.id).map(t=>t.id),planMismatch,batch:batch.label,estimatedShipmentDate:batch.date||task.estimatedShipmentDate||null,batchAllocated,sourceLimits:sourceByBatch?.[batchIndex],stockVersion,readyStock:Math.max(0,readyByBatch[batchIndex]-consumed),allocated:task.inc||0,signature,revision:saved?.revision||'',prepared:valid&&saved.prepared===true,preparedAt:valid?saved?.preparedAt||null:null,expiryDate:saved?.expiryDate||null,loaded:saved?.loaded||0,physicalSources:saved?.physicalSources||[],loadedAt:saved?.loadedAt||null,photos:saved?.photos||[],note:saved?.note||'',updatedAt:saved?.at||null,updatedBy:saved?.by||'',stale:Boolean(saved&&!valid)||planMismatch,dispatched,loadedOutflowQty:consumed,history:context.activity.filter(e=>e.action===PREPARATION_ACTION&&e.result==='SAVED'&&e.description===id).map(e=>({at:new Date(e.activityTime).toISOString(),by:e.initiatedByStaffName,action:e.details.action,note:e.details.state.note,loaded:e.details.state.loaded,photos:e.details.state.photos}))});
  }
 }
 for(const [id,s] of states)if(s.loaded>0&&!items.some(i=>i.id===id))items.push({...s,revision:s.revision,customerName:customers.get(s.customerId)||s.customerId,readyStock:null,allocated:0,prepared:false,stale:true,orphaned:true,dispatched:0,history:[]});
 return items.map(item=>{const stockChanged=items.filter(i=>i.taskId===item.taskId&&i.prepared&&!i.stale).reduce((n,i)=>n+i.quantity,0)>item.allocated;return {...item,prepared:item.prepared&&!stockChanged,stale:item.stale||stockChanged,version:(item.batchAllocated===null?operationId(item.signature,item.revision,item.allocated,item.dispatched,item.loadedOutflowQty,item.stockVersion):operationId(item.signature,item.revision,item.allocated,item.dispatched,item.batchAllocated,item.loadedOutflowQty,item.stockVersion)),status:item.stale||stockChanged?'ISSUE':item.loaded===item.quantity?'LOADED':item.loaded>0?'PARTIAL':item.prepared?'READY':'PENDING'};});
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
  if(!names[company]||staff?.canPrepareWarehouse!==true||!['PACK','LOAD','UNPACK','PHOTOS','EXPIRY'].includes(input?.action))throw Error('Warehouse preparation action is not authorized.');
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
  async function current(){const context=await readContext(company,staff),items=projectPreparation(context),item=items.find(i=>i.id===input.id);if(context.company!==company||!item||item.version!==input.version)throw Error('Warehouse task changed. Refresh before saving; input is retained.');requirePackingReleased(context,[item.taskId]);return {context,items,item};}
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{preparation:safeInput},prepare:async()=>{
   const {context,items,item}=await current(),note=text(input.note),at=now().toISOString();
   if(readCustomerShipments(context.activity).some(row=>row.status==='DISPATCHED'&&row.lines.some(line=>line.taskId===item.taskId)))throw Error('Warehouse this task has dispatched goods. Use the supervised correction process.');
   if(item.planMismatch||item.orphaned||item.stale&&item.loaded>0)throw Error('Warehouse loading no longer matches the current task. Ask Sales to restore or review its batch plan.');
   if(input.action==='EXPIRY'&&(!validExpiry(input.expiryDate)||input.expiryDate<'1900-01-01'||verified.length))throw Error('Warehouse enter a valid expiry date.');
   if(note.length>1000)throw Error('Warehouse note is too long.');
   let prepared=item.prepared,loaded=item.loaded,preparedAt=item.preparedAt,loadedAt=item.loadedAt,physicalSources=item.physicalSources;
   if(input.action==='PACK'){
    if(item.batchAllocated!==null&&item.quantity>item.batchAllocated)throw Error('This shipment batch has insufficient allocated cartons. Ask Purchase to arrange its pending quantity.');
    const other=items.filter(i=>i.taskId===item.taskId&&i.id!==item.id&&i.prepared&&!i.stale).reduce((n,i)=>n+i.quantity,0);
    if(item.allocated<other+item.quantity)throw Error('Warehouse allocated goods are insufficient. Ask Purchase to confirm stock allocation.');
    prepared=true;preparedAt=at;
   }
   if(input.action==='UNPACK'){if(item.loaded>0||!note)throw Error('Warehouse unload first and provide a correction reason before reversing preparation.');prepared=false;preparedAt=null;}
   if(input.action==='LOAD'){
    if(item.batchAllocated!==null&&input.loaded>item.batchAllocated)throw Error('Loaded cartons exceed this shipment batch allocation.');
    if(!prepared||!qty(input.loaded)||input.loaded>item.quantity)throw Error('Warehouse prepare this batch first and enter valid loaded cartons.');
    if((input.loaded<item.quantity||input.loaded<loaded)&&!note)throw Error('Warehouse explain partial loading or a quantity correction.');
    const other=items.filter(i=>i.taskId===item.taskId&&i.id!==item.id).reduce((n,i)=>n+i.loaded,0);
    if(other+input.loaded>item.allocated)throw Error('Warehouse loaded cartons exceed the customer allocation.');
    physicalSources=planLoadedSources(context,{id:loadingOutflowId(company,'WAREHOUSE',item.id,item.taskId),taskId:item.taskId,loaded:input.loaded,previous:item.physicalSources,sourceLimits:item.sourceLimits});
    loaded=input.loaded;loadedAt=at;
   }
   if(input.action==='PHOTOS'&&!prepared&&!loaded)throw Error('Warehouse confirm preparation or loading before adding evidence.');
   if(verified.length&&(!['PACKING','LOADING'].includes(input.photoStage)||input.action==='PACK'&&input.photoStage!=='PACKING'||input.action==='LOAD'&&input.photoStage!=='LOADING'||input.photoStage==='LOADING'&&!loaded))throw Error('Warehouse photo stage is required.');
   const uploads=[];
   for(let index=0;index<verified.length;index++){const p=verified[index],allocated=await documentService({action:'ALLOCATE',company}),ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[p.mimeType];uploads.push({action:'PHOTO_UPLOAD',company,department:'WAREHOUSE',poId:item.id,fileId:allocated.fileId,type:input.photoStage,mimeType:p.mimeType,sha256:p.sha256,size:p.size,name:company+'-'+item.barcode+'-'+input.photoStage+'-'+requestId+'-'+index+'.'+ext});}
   const state={id:item.id,taskId:item.taskId,orderId:item.orderId,customerId:item.customerId,company,barcode:item.barcode,name:item.name,packing:item.packing,batch:item.batch,quantity:item.quantity,sourceTaskIds:item.sourceTaskIds,signature:item.signature,...(input.action==='EXPIRY'?{expiryDate:input.expiryDate}:item.expiryDate?{expiryDate:item.expiryDate}:{}),prepared,preparedAt,loaded,physicalSources,loadedAt,note:note||item.note,photos:[...item.photos,...uploads.map(u=>({fileId:u.fileId,name:u.name,sha256:u.sha256,mimeType:u.mimeType,size:u.size,stage:u.type,at,by:staff.staffName}))]};
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
    const checked=await current(),state=plan.event.details.state;
    if(state.loaded>0)assertLoadedOutflows(checked.context,[{id:loadingOutflowId(company,'WAREHOUSE',state.id,state.taskId),taskId:state.taskId,quantity:state.loaded,sources:state.physicalSources}]);
    await store.insert(names[company].activity,{...plan.event,activityTime:new Date(plan.event.activityTime)});
   }
   return {ok:true,company,requestId,id:plan.event.description,savedAt:plan.event.activityTime};
  }});
 };
}
