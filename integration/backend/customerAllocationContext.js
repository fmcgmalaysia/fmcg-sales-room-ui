import { operationId } from 'backend/purchaseOperationJournal.js';
import { stockPosition } from 'backend/inventoryExceptions.js';
import { packingTaskHeld } from 'backend/packingListGuards.js';
import { physicalOutflowQuantity, readPhysicalOutflows } from 'backend/physicalOutflow.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readShipmentPlans } from 'backend/customerShipmentPlan.js';
import { allocateBatchSources, stockBatchEntries } from 'backend/shipmentBatchAllocation.js';
const copy=value=>JSON.parse(JSON.stringify(value));
export function readAllocationLoans(activity){
 const pending=activity.filter(row=>['PLANNER_ALLOCATION_SAVED','DESK_SHORTLOAD_RESOLVED'].includes(row.action)&&row.result==='SAVED'&&row.details?.loanChanges).flatMap(event=>event.details.loanChanges.map(change=>({event,change}))),loans=new Map();
 while(pending.length){
  const next=pending.filter(({change})=>(loans.get(change.id)?.revision||'')===change.beforeRevision);
  if(!next.length||new Set(next.map(({change})=>change.id)).size!==next.length)throw Error('Borrowing history requires review.');
  for(const row of next){const {change,event}=row,state=change.state,old=loans.get(change.id);
   if(!state||state.id!==change.id||!state.borrowerTaskId||!state.lenderTaskId||state.borrowerTaskId===state.lenderTaskId||!Number.isSafeInteger(state.quantity)||state.quantity<=0||!Number.isSafeInteger(state.outstanding)||state.outstanding<0||state.outstanding>state.quantity||!Array.isArray(state.sources)||state.sources.reduce((n,source)=>n+source.quantity,0)!==state.quantity||state.sources.some(source=>!source.sourceTaskId||!source.lenderBatchId||!Number.isSafeInteger(source.quantity)||source.quantity<=0)||old&&(operationId({...old,revision:undefined,outstanding:undefined})!==operationId({...state,revision:undefined,outstanding:undefined})||state.outstanding>=old.outstanding))throw Error('Borrowing responsibility requires review.');
   loans.set(change.id,{...copy(state),revision:event.title});pending.splice(pending.indexOf(row),1);
  }
 }
 return [...loans.values()];
}
export function customerAllocationContext(workspace,activity,allocations,version){
 const plans=readShipmentPlans(activity),shipments=readCustomerShipments(activity).filter(row=>row.status!=='CANCELLED');
 const outflows=readPhysicalOutflows(activity),guardActivity=activity.filter(row=>{const list=row.action==='SUPPORT_PACKING_LIST_CURRENT'?row.details?.list:null;return !list||list.status!=='COMPLETED'||list.change||list.lines.some(line=>line.loaded&&!outflows.some(flow=>flow.kind==='PACKING'&&flow.loadingId===list.id&&flow.taskId===line.taskId&&flow.quantity===line.loaded));});
 const tasks=workspace.tasks.filter(row=>!row.procurementSource&&!row.specialPurchase).map(row=>{
  const plan=plans.find(plan=>plan.customerId===row.customerId&&plan.orderId===row.orderId&&plan.batches.some(batch=>batch.lines.some(line=>line.taskId===row.id)));
  const batches=plan?stockBatchEntries(plan,row.id).map(batch=>({id:batch.id,quantity:batch.quantity})):[{id:'WHOLE',quantity:row.ord}];
  return {id:row.id,customerId:row.customerId,company:workspace.company,barcode:row.barcode,packing:row.packing,ea:row.ea,archived:row.archived===true,demand:row.ord,batches,invoiceLocked:Boolean(row.salesInvoiceNumber),held:packingTaskHeld({...workspace,activity:guardActivity},row.id)>0,returnLocked:physicalOutflowQuantity(activity,{taskId:row.id})>0||shipments.some(shipment=>shipment.lines.some(line=>line.taskId===row.id))};
 });
 const unfilled=new Map(tasks.map(task=>[task.id,Math.max(0,task.demand-allocations.reduce((n,source)=>n+(source.targets.find(target=>target.taskId===task.id)?.quantity||0),0))]));
 const sources=workspace.tasks.filter(row=>row.warehouse?.hasPhysicalReceipt&&row.po&&row.supplierId).map(row=>{
  const stock=stockPosition(row.id,row.warehouse.accepted,activity),saved=allocations.find(allocation=>allocation.sourceTaskId===row.id),owner=tasks.find(task=>task.id===(row.customerDemandTaskId||row.id));
  // A supplier's customer earmark is not free stock before the first explicit allocation.
  const earmarked=owner&&!saved?Math.min(unfilled.get(owner.id)||0,stock.usableReceived,Math.max(0,row.procurement?.customerCtn??((row.procurement?.totalCtn??owner.demand)-(row.procurement?.expectedExtra||0)))):0;
  if(owner&&!saved)unfilled.set(owner.id,(unfilled.get(owner.id)||0)-earmarked);
  const targets=copy(saved?.targets??(earmarked?[{taskId:owner.id,quantity:earmarked}]:[]));
  for(const target of targets)target.protectedQuantity=Math.max(physicalOutflowQuantity(activity,{sourceTaskId:row.id,taskId:target.taskId}),shipments.flatMap(shipment=>shipment.lines).filter(line=>line.taskId===target.taskId).flatMap(line=>line.sources).filter(source=>source.sourceTaskId===row.id).reduce((n,source)=>n+source.quantity,0));
  return {id:row.id,company:workspace.company,barcode:row.barcode,packing:row.packing,ea:row.ea,implicit:!saved,usableReceived:stock.usableReceived,availablePhysical:stock.availablePhysical,excluded:stock.excluded,received:true,quarantined:stock.held>0,targets};
 });
 for(const task of tasks){
  const plan=plans.find(plan=>plan.batches.some(batch=>batch.lines.some(line=>line.taskId===task.id))),related=sources.filter(source=>source.targets.some(target=>target.taskId===task.id));
  if(!plan){for(const source of related){const target=source.targets.find(target=>target.taskId===task.id);if(!target.batches)source.bindingNeeded=true;target.batches=[{id:'WHOLE',quantity:target.quantity}];}continue;}
  const entries=stockBatchEntries(plan,task.id),remaining=entries.map(batch=>batch.quantity),unbound=[];
  for(const source of related){const target=source.targets.find(target=>target.taskId===task.id);if(!target.quantity)continue;if(!target.batches){unbound.push({id:source.id,quantity:target.quantity});continue;}if(target.batches.reduce((n,batch)=>n+batch.quantity,0)!==target.quantity)throw Error('Customer source batch binding requires review.');for(const binding of target.batches){const index=entries.findIndex(batch=>batch.id===binding.id);if(index<0||binding.quantity>remaining[index])throw Error('Customer source batch ownership changed.');remaining[index]-=binding.quantity;}}
  const matrix=allocateBatchSources(entries.map((batch,index)=>({...batch,quantity:remaining[index]})),unbound);
  for(const source of related){const target=source.targets.find(target=>target.taskId===task.id);if(!target.batches){source.bindingNeeded=true;target.batches=entries.map((batch,index)=>({id:batch.id,quantity:matrix[index].find(row=>row.id===source.id)?.quantity||0}));}}
 }
 return {company:workspace.company,version,tasks,sources,loans:readAllocationLoans(activity)};
}
