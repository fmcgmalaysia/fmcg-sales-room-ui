'use strict';
const {readArrangements,projectArrangementLinks}=require('./purchase-arrangement.cjs');
const whole=n=>Number.isSafeInteger(n)&&n>=0;
// Read-only attribution of existing CURRENT instruction links to actual list holds.
// Immutable link audit retains identity after the CURRENT instruction is replaced.
// No quantity comes from audit; actual holds still come only from current lists.
function attachBatchAvailability({company,workspace,activity,readPackingLists,packingHeld}){
 if(workspace?.company!==company||!Array.isArray(workspace.tasks)||!Array.isArray(activity)
   ||typeof readPackingLists!=='function'||typeof packingHeld!=='function')throw Error('Current batch availability context required');
 const linked=projectArrangementLinks(company,readArrangements(company,activity),activity).filter(i=>i.status==='LINKED');
 const bindings=new Map();
 function bind(d){
  const prior=bindings.get(d.packingListId);
  if(prior&&['taskId','batchId','customerId','orderId'].some(k=>prior[k]!==d[k]))throw Error('Ambiguous batch packing link');
  bindings.set(d.packingListId,d);
 }
 for(const d of linked)bind(d);
 const audits=new Set();
 for(const row of activity.filter(r=>r.action==='PURCHASE_ARRANGEMENT_LINKED')){
  const d=row.details;
  if(!d||row.company!==company||row.result!=='SAVED'||row.title!==row._id||row._id!==d.revision||audits.has(row._id)
    ||row.description!==d.orderId||d.status!=='LINKED'||!d.taskId||typeof d.batchId!=='string'||!d.customerId
    ||!d.orderId||!d.packingListId||!d.packingRevision||!d.linkedByStaffId||!row.initiatedByStaffId
    ||!whole(d.quantity)||d.quantity<1)throw Error('Batch packing link audit requires review');
  audits.add(row._id);bind(d);
 }
 const lists=readPackingLists(activity,company);
 for(const task of workspace.tasks.filter(t=>!t.procurementSource&&!t.specialPurchase&&Array.isArray(t.stockAllocatedBatches))){
  const f=task.stockAllocationFacts,batches=task.stockAllocatedBatches;
  if(!f||!['usable','held','dispatched','availableToArrange'].every(k=>whole(f[k]))||typeof f.review!=='boolean'
    ||f.usable+f.dispatched!==task.stockAllocatedCumulative||f.availableToArrange!==(f.review?0:Math.max(0,f.usable-f.held))
    ||new Set(batches.map(b=>b.id)).size!==batches.length||batches.some(b=>!b.id||!whole(b.demand)||!whole(b.allocated)||b.allocated>b.demand)
    ||batches.reduce((n,b)=>n+b.allocated,0)!==task.stockAllocatedCumulative)throw Error('Current batch allocation requires review');
  const held=new Map(batches.map(b=>[b.id,0]));
  for(const instruction of [...bindings.values()].filter(i=>i.taskId===task.id&&held.has(i.batchId))){
   const list=lists.find(l=>l.id===instruction.packingListId);
   if(!list||list.company!==company||list.customerId!==task.customerId||instruction.customerId!==task.customerId
     ||instruction.orderId!==task.orderId)throw Error('Actual batch packing list required');
   const quantity=packingHeld(list,task.id);
   if(!whole(quantity))throw Error('Actual batch packing hold required');
   held.set(instruction.batchId,held.get(instruction.batchId)+quantity);
  }
  const known=[...held.values()].reduce((n,q)=>n+q,0),unscopedHeld=f.held-known;
  if(!whole(known)||!whole(unscopedHeld))throw Error('Batch hold exceeds authoritative task holds');
  task.stockBatchAllocationFacts=batches.map(b=>({id:b.id,demand:b.demand,allocated:b.allocated,held:held.get(b.id),unscopedHeld,
    unscopedDispatched:f.dispatched,review:f.review,
    availableToArrange:f.review?0:Math.min(f.availableToArrange,Math.max(0,b.allocated-held.get(b.id)-unscopedHeld-f.dispatched))}));
 }
 return workspace;
}
module.exports={attachBatchAvailability};
