import { operationId } from 'backend/purchaseOperationJournal.js';
import { stockPosition } from 'backend/inventoryExceptions.js';
import { packingTaskHeld } from 'backend/packingListGuards.js';
import { readPackingLists } from 'backend/packingListOperations.js';
import { physicalOutflowQuantity, readPhysicalOutflows } from 'backend/physicalOutflow.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readShipmentPlans } from 'backend/customerShipmentPlan.js';
import { allocateBatchSources, stockBatchEntries } from 'backend/shipmentBatchAllocation.js';
const copy=value=>JSON.parse(JSON.stringify(value));
// Supply is a view of the same PO shares and physical claims, never a second ledger.
// A planned carton cannot enter targets or become usable before its real receipt.
export function projectSupplyAllocation(workspace,physical){
 const valid=value=>Number.isSafeInteger(value)&&value>=0;
 if(workspace.company!==physical.company)throw Error('Supply company mismatch.');
 return workspace.tasks.filter(row=>!row.procurementSource&&!row.specialPurchase).map(task=>{
  const demand=task.requested??task.ord;
  if(!valid(demand))throw Error('Customer supply demand requires review.');
  const owned=physical.sources.flatMap(source=>source.targets.filter(target=>target.taskId===task.id).map(target=>({source,quantity:source.targets.filter(row=>row.quantity>0).length===1&&valid(source.usableReceived)?Math.min(target.quantity,source.usableReceived):target.quantity})));
  const received=owned.reduce((n,row)=>n+row.quantity,0);
  if(received>demand)throw Error('Customer physical allocation exceeds demand.');
  const sources=workspace.tasks.filter(row=>(row.id===task.id||row.customerDemandTaskId===task.id)&&row.po&&row.supplierId&&valid(row.procurement?.totalCtn));
  const shares=sources.map(source=>({source,quantity:Math.max(0,source.procurement.customerCtn??(source.procurement.totalCtn-(source.procurement.expectedExtra||0)))}));
  if(shares.some(row=>!valid(row.quantity)||row.quantity>row.source.procurement.totalCtn))throw Error('PO customer share requires review.');
  const external=owned.filter(row=>!shares.some(share=>share.source.id===row.source.id)).reduce((n,row)=>n+row.quantity,0);
  const pending=new Map(shares.map(({source,quantity})=>{const decision=source.quantityCases?.find(row=>row.kind==='RECEIPT')?.decision;return [source.id,source.warehouse?.issue&&decision?.supplierDeliveryDecision!=='WAIT'||decision?.supplierDeliveryDecision==='STOP'?0:Math.min(Math.max(0,source.procurement.totalCtn-(source.warehouse?.accepted||0)),Math.max(0,quantity-owned.filter(row=>row.source.id===source.id).reduce((n,row)=>n+row.quantity,0)))];}));
  let planned=Math.max(received,Math.min(demand,shares.reduce((n,row)=>n+row.quantity,0)+external));
  const batches=task.batchEntitlements?.map(batch=>{
   const claims=owned.map(row=>({...row,quantity:row.source.targets.find(target=>target.taskId===task.id)?.batches?.find(binding=>binding.id===batch.id)?.quantity||0}));
   const physical=claims.reduce((n,row)=>n+row.quantity,0),outside=claims.filter(row=>!shares.some(share=>share.source.id===row.source.id)).reduce((n,row)=>n+row.quantity,0);
   const formal=(batch.sources||[]).filter(source=>shares.some(share=>share.source.id===source.id)).reduce((n,source)=>n+source.quantity,0);
   const target=Math.max(physical,Math.min(batch.quantity,formal+outside));let arriving=0;
   for(const source of batch.sources||[]){const own=claims.find(row=>row.source.id===source.id)?.quantity||0,take=Math.min(pending.get(source.id)||0,Math.max(0,source.quantity-own));arriving+=take;if(pending.has(source.id))pending.set(source.id,pending.get(source.id)-take);}
   return {id:batch.id,planned:target,received:physical,waiting:Math.min(target-physical,arriving)};
  });
  if(batches){planned=batches.reduce((n,row)=>n+row.planned,0);if(planned<received||planned>demand)throw Error('Planned source batch ownership requires review.');}
  const waiting=batches?batches.reduce((n,row)=>n+row.waiting,0):Math.min(planned-received,[...pending.values()].reduce((n,quantity)=>n+quantity,0));
  return {taskId:task.id,planned,received,waiting,gap:planned-received-waiting,unplaced:demand-planned,...(batches?{batches}:{})};
 });
}
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
 const guardedLists=readPackingLists(guardActivity,workspace.company);
 const tasks=workspace.tasks.filter(row=>!row.procurementSource&&!row.specialPurchase).map(row=>{
  const plan=plans.find(plan=>plan.customerId===row.customerId&&plan.orderId===row.orderId&&plan.batches.some(batch=>batch.lines.some(line=>line.taskId===row.id)));
  const batches=plan?stockBatchEntries(plan,row.id).map(batch=>({id:batch.id,quantity:batch.quantity,waiting:row.supplyAllocation?.batches?.find(item=>item.id===batch.id)?.waiting||0})):[{id:'WHOLE',quantity:row.ord,waiting:row.supplyAllocation?.waiting||0}];
  return {id:row.id,customerId:row.customerId,company:workspace.company,barcode:row.barcode,packing:row.packing,ea:row.ea,archived:row.archived===true,demand:row.ord,batches,invoiceLocked:Boolean(row.salesInvoiceNumber),held:packingTaskHeld({...workspace,activity:guardActivity},row.id,guardedLists)>0,returnLocked:physicalOutflowQuantity(activity,{taskId:row.id},outflows)>0||shipments.some(shipment=>shipment.lines.some(line=>line.taskId===row.id))};
 });
 const unfilled=new Map(tasks.map(task=>[task.id,Math.max(0,task.demand-allocations.reduce((n,source)=>n+(source.targets.find(target=>target.taskId===task.id)?.quantity||0),0))]));
 const sources=workspace.tasks.filter(row=>row.warehouse?.hasPhysicalReceipt&&row.po&&row.supplierId).map(row=>{
  const stock=stockPosition(row.id,row.warehouse.accepted,activity),saved=allocations.find(allocation=>allocation.sourceTaskId===row.id),owner=tasks.find(task=>task.id===(row.customerDemandTaskId||row.id));
  // A supplier's customer earmark is not free stock before the first explicit allocation.
  const earmarked=owner&&!saved?Math.min(unfilled.get(owner.id)||0,stock.usableReceived,Math.max(0,row.procurement?.customerCtn??((row.procurement?.totalCtn??owner.demand)-(row.procurement?.expectedExtra||0)))):0;
  if(owner&&!saved)unfilled.set(owner.id,(unfilled.get(owner.id)||0)-earmarked);
  const targets=copy(saved?.targets??(earmarked?[{taskId:owner.id,quantity:earmarked}]:[]));
  let automaticDelta=0;
  if(owner&&saved&&Number.isSafeInteger(saved.receivedTotalAtSave)){
   const target=targets.find(target=>target.taskId===owner.id),owned=target?.quantity||0,other=targets.reduce((n,target)=>n+(target.taskId===owner.id?0:target.quantity),0),customer=Math.max(0,row.procurement?.customerCtn??((row.procurement?.totalCtn??owner.demand)-(row.procurement?.expectedExtra||0)));
   automaticDelta=Math.max(0,Math.min(row.warehouse.accepted-saved.receivedTotalAtSave,unfilled.get(owner.id)||0,stock.usableReceived-targets.reduce((n,target)=>n+target.quantity,0),customer-owned-other));
   if(automaticDelta)unfilled.set(owner.id,(unfilled.get(owner.id)||0)-automaticDelta);
  }
  for(const target of targets)target.protectedQuantity=Math.max(physicalOutflowQuantity(activity,{sourceTaskId:row.id,taskId:target.taskId},outflows),shipments.flatMap(shipment=>shipment.lines).filter(line=>line.taskId===target.taskId).flatMap(line=>line.sources).filter(source=>source.sourceTaskId===row.id).reduce((n,source)=>n+source.quantity,0));
  return {id:row.id,ownerTaskId:owner?.id||null,company:workspace.company,barcode:row.barcode,packing:row.packing,ea:row.ea,implicit:!saved,automaticDelta,receivedTotal:row.warehouse.accepted,usableReceived:stock.usableReceived,availablePhysical:stock.availablePhysical,excluded:stock.excluded,received:true,quarantined:stock.held>0,targets};
 });
 for(const task of tasks){
  const plan=plans.find(plan=>plan.batches.some(batch=>batch.lines.some(line=>line.taskId===task.id))),related=sources.filter(source=>source.targets.some(target=>target.taskId===task.id));
  if(!plan){for(const source of related){const target=source.targets.find(target=>target.taskId===task.id);if(!target.batches)source.bindingNeeded=true;target.batches=[{id:'WHOLE',quantity:target.quantity}];}continue;}
  const entries=stockBatchEntries(plan,task.id),remaining=entries.map(batch=>batch.quantity),unbound=[];
  for(const source of related){const target=source.targets.find(target=>target.taskId===task.id);if(!target.quantity)continue;if(!target.batches){unbound.push({id:source.id,quantity:target.quantity});continue;}if(target.batches.reduce((n,batch)=>n+batch.quantity,0)!==target.quantity)throw Error('Customer source batch binding requires review.');for(const binding of target.batches){const index=entries.findIndex(batch=>batch.id===binding.id);if(index<0||binding.quantity>remaining[index])throw Error('Customer source batch ownership changed.');remaining[index]-=binding.quantity;}}
  const matrix=allocateBatchSources(entries.map((batch,index)=>({...batch,quantity:remaining[index]})),unbound);
  for(const source of related){const target=source.targets.find(target=>target.taskId===task.id);if(!target.batches){source.bindingNeeded=true;target.batches=entries.map((batch,index)=>({id:batch.id,quantity:matrix[index].find(row=>row.id===source.id)?.quantity||0}));}}
 }
 // Add only proven new receipt cartons after preserving all saved batch bindings.
 for(const source of sources.filter(source=>source.automaticDelta>0)){
  const owner=tasks.find(task=>task.id===source.ownerTaskId);let target=source.targets.find(target=>target.taskId===owner.id);
  if(!target){target={taskId:owner.id,quantity:0,batches:owner.batches.map(batch=>({id:batch.id,quantity:0})),protectedQuantity:0};source.targets.push(target);}
  let remaining=source.automaticDelta;
  for(const batch of owner.batches){const occupied=sources.reduce((n,row)=>n+(row.targets.find(item=>item.taskId===owner.id)?.batches?.find(item=>item.id===batch.id)?.quantity||0),0),take=Math.min(remaining,Math.max(0,batch.quantity-occupied));if(take){let binding=target.batches.find(row=>row.id===batch.id);if(!binding){binding={id:batch.id,quantity:0};target.batches.push(binding);}binding.quantity+=take;target.quantity+=take;remaining-=take;}}
  if(remaining)throw Error('New receipt batch ownership requires review.');source.bindingNeeded=true;
 }
 // Preserve the existing earliest-batch consumption used by Warehouse preparation.
 // Explicit Warehouse batch movements retain their exact binding; unbound packing
 // movements protect the earliest remaining entitlement, never a later free batch.
 for(const task of tasks){
  let unbound=outflows.filter(flow=>flow.taskId===task.id&&flow.kind!=='WAREHOUSE').reduce((n,flow)=>n+flow.quantity,0);
  const consumed=task.batches.map(batch=>{const own=outflows.filter(flow=>flow.taskId===task.id&&flow.kind==='WAREHOUSE'&&flow.loadingId===operationId(workspace.company,task.id,batch.id)).reduce((n,flow)=>n+flow.quantity,0),other=Math.min(Math.max(0,batch.quantity-own),unbound);unbound-=other;return {id:batch.id,quantity:own+other};});
  const mapped=consumed.reduce((n,row)=>n+row.quantity,0),actual=outflows.filter(flow=>flow.taskId===task.id).reduce((n,row)=>n+row.quantity,0);
  const invoiced=shipments.flatMap(shipment=>shipment.lines).filter(line=>line.taskId===task.id).reduce((n,line)=>n+line.quantity,0);
  if(unbound||mapped!==actual||invoiced>actual)continue;
  // Read-only task metadata is never written into source allocation history.
  task.protectedBatches=consumed.filter(row=>row.quantity>0).map(row=>row.id);
 }
 return {company:workspace.company,version,tasks,sources,loans:readAllocationLoans(activity)};
}
