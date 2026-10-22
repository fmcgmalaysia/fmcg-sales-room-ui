'use strict';

const { stockKey } = require('./current-model.cjs');
const { currentAllocationContext } = require('./current-allocation-context.cjs');
const { originalProductState } = require('./original-product-state.cjs');
const { readScopedCurrentProduct } = require('./scoped-current-reader.cjs');
const { copy } = require('./segmented-plan.cjs');
// Private snapshot adapter. It does not authenticate, refresh GP, apply a save,
// create a workspace route, mark writer coverage or authorize activation.
function prepareCurrentPurchaseProjection({ context, states, readAllocations, generation }) {
  if (!['NCT','GHR'].includes(context?.company) || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
    || !Array.isArray(states) || !Number.isSafeInteger(generation) || generation < 0 || typeof readAllocations !== 'function') throw Error('Complete private Purchase projection required');
  const products=new Set(), demands=new Map(), sources=new Map(), allocations=[];
  const prior=readAllocations(context.activity);
  for (const state of states) {
    const key=stockKey(state);
    if (state.company !== context.company || state.scope !== 'CURRENT_ACTIVE_PRODUCT' || state.lifecycleVersion !== 2 || products.has(key)) throw Error('Distinct verified Purchase current products required');
    products.add(key);
    const current=currentAllocationContext({state,context,readAllocations:()=>prior});
    for (const task of state.tasks) {
      if (demands.has(task.id)) throw Error('Ambiguous Purchase demand coverage');
      demands.set(task.id,{taskId:task.id,quantity:current.tasks.find(row=>row.id===task.id).inc});
    }
    for (const source of state.sources) {
      if (sources.has(source.id)) throw Error('Ambiguous Purchase source coverage');
      sources.set(source.id,{taskId:source.id,accepted:source.accepted,availableCtn:source.available,availablePhysical:source.onHand-source.isolated});
      allocations.push(current.allocations.find(row=>row.sourceTaskId===source.id));
    }
  }
  for (const task of context.tasks.filter(row=>!row.archived)) {
    if (!task.procurementSource && !task.specialPurchase && !demands.has(task.id)
      || task.po && task.procurement?.totalCtn > 0 && !sources.has(task.id)) throw Error('Complete working Purchase demand/source coverage required');
  }
  return {schema:'PURCHASE_CURRENT_PROJECTION_V2',company:context.company,generation,
    taskReceived:[...demands.values()],sourceAvailable:[...sources.values()],
    allocations:[...prior.filter(row=>!sources.has(row.sourceTaskId)),...allocations].map(copy)};
}

// Call INSIDE the common generation barrier after original Purchase auth. Current
// values enter the ORIGINAL projector before split/batch metrics, not afterward.
async function readCurrentPurchaseProjection({ company, context, staff, control, items, store, originalArguments,
  projectPurchaseWorkspace, currentProjectionVersion, readCurrentTaskRows, readPurchaseRecords, projectPurchaseOrders,
  readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation,
  metrics={queries:0,exactReads:0},retainedTaskIds=[] }) {
  if (!['NCT','GHR'].includes(company) || !control || control.company !== company || control.mode !== 'ACTIVE' || control.schemaVersion !== 1 || control.pending
    || control.transferIndexVersion !== 2 || !control.writerBuild || !Number.isSafeInteger(control.generation) || control.generation < 0
    || context?.company !== company || !staff?.staffId || !staff.memberId || originalArguments?.company !== company
    || currentProjectionVersion !== 2 || typeof projectPurchaseWorkspace !== 'function' || typeof readCurrentTaskRows !== 'function'
    || typeof readPurchaseRecords !== 'function' || typeof projectPurchaseOrders !== 'function'
    ||!Array.isArray(retainedTaskIds)||new Set(retainedTaskIds).size!==retainedTaskIds.length
    ||retainedTaskIds.some(id=>typeof id!=='string'||!context.tasks.some(task=>task.id===id))) throw Error('Paired private current Purchase snapshot required');
  const groups=new Map();
  for (const task of context.tasks.filter(row=>!row.archived||retainedTaskIds.includes(row.id))) {
    const identity={company,barcode:task.barcode,packing:task.packing,ea:task.ea},key=stockKey(identity);
    if (!groups.has(key)) groups.set(key,{identity,taskIds:[],sourceIds:[]});
    if (!task.procurementSource && !task.specialPurchase) groups.get(key).taskIds.push(task.id);
    if (task.po && task.procurement?.totalCtn > 0) groups.get(key).sourceIds.push(task.id);
  }
  const orders=groups.size?projectPurchaseOrders({company,workspace:context,records:await readPurchaseRecords(company,staff)}):[];
  const states=[],products=new Map(),prior=readAllocations(context.activity);
  for (const [key,group] of groups) {
    const builder=originalProductState({company,context,orders,identity:group.identity,readAllocations:()=>prior,
      readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation});
    const rows=await readScopedCurrentProduct({company,identity:group.identity,items,store,metrics,
      transferIndexVersion:control.transferIndexVersion,sourceTaskIds:group.sourceIds,demandTaskIds:group.taskIds,
      claimPairs:builder.sources.filter(source=>group.sourceIds.includes(source.id)&&source.ownerTaskId)
        .map(source=>({sourceTaskId:source.id,taskId:source.ownerTaskId}))});
    if (!rows.product || rows.product.lifecycleVersion !== 2) throw Error('Current Purchase product checkpoint missing');
    rows.taskRows=await readCurrentTaskRows(company,builder.scopeTaskIds(rows),staff);rows.generation=control.generation;
    const state=builder.buildState(rows);states.push(state);products.set(key,{state,rows});
  }
  const currentStock=prepareCurrentPurchaseProjection({context,states,readAllocations:()=>prior,generation:control.generation});
  const workspace=projectPurchaseWorkspace({...originalArguments,staff,currentStock});
  if (workspace?.company !== company || workspace.stockAllocationView !== 'CURRENT_V2' || !Array.isArray(workspace.tasks)
    || workspace.tasks.length !== context.tasks.length || new Set(workspace.tasks.map(row=>row.id)).size !== workspace.tasks.length) throw Error('Original current Purchase projector not connected');
  for (const row of workspace.tasks) {
    const original=context.tasks.find(task=>task.id===row.id);
    if (!original || ['id','customerId','orderId','sourceLineId','barcode','packing','ea','po','ord','requested'].some(field=>row[field]!==original[field])
      || Boolean(row.procurementSource)!==Boolean(original.procurementSource) || Boolean(row.specialPurchase)!==Boolean(original.specialPurchase)
      || (row.customerDemandTaskId||null)!==(original.customerDemandTaskId||null)
      || row.procurement?.totalCtn!==original.procurement?.totalCtn) throw Error('Original current Purchase authority changed');
  }
  return {workspace,products,metrics};
}
module.exports={prepareCurrentPurchaseProjection,readCurrentPurchaseProjection};
