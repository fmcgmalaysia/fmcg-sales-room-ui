'use strict';

const { stockKey } = require('./current-model.cjs');
const { originalProductState } = require('./original-product-state.cjs');
const { readScopedCurrentProduct } = require('./scoped-current-reader.cjs');
const { currentAllocationContext } = require('./current-allocation-context.cjs');
const { copy } = require('./segmented-plan.cjs');
// Same complete customer-product view for READ and ADJUST. Keeping the ORIGINAL
// global adjustmentVersion contract avoids inconsistent per-line save versions.
async function readCurrentSalesWorkspace({ company, context, staff, control, items, store, metrics = { queries: 0, exactReads: 0 },
  readCurrentTaskRows, readPurchaseRecords, projectPurchaseOrders, readAllocations, readCustomerShipments,
  readPackingLists, packingHeld, readPreparation, projectPreparation }) {
  if (context?.company !== company || control?.company !== company || control.pending || control.mode !== 'ACTIVE' || control.schemaVersion !== 1
    || !Number.isSafeInteger(control.generation) || control.generation < 0 || !control.writerBuild || control.transferIndexVersion !== 2
    || !staff?.customerId || !Array.isArray(context.tasks) || !Array.isArray(context.activity)) throw Error('Complete private Sales current context required');
  const groups = new Map();
  for (const task of context.tasks.filter(t => t.customerId === staff.customerId && !t.procurementSource && !t.specialPurchase && !t.archived)) {
    const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea }, key = stockKey(identity);
    if (!groups.has(key)) groups.set(key, { identity, taskIds: [] }); groups.get(key).taskIds.push(task.id);
  }
  const records = groups.size ? await readPurchaseRecords(company, staff) : [];
  const orders = groups.size ? projectPurchaseOrders({ company, workspace: context, records }) : [];
  const prior = readAllocations(context.activity), currentTasks = new Map(), currentSources = new Set(), allocations = [], products = new Map();
  for (const [key, group] of groups) {
    const product = originalProductState({ company, context, orders, identity: group.identity, readAllocations: () => prior,
      readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
    const own = product.sources.filter(s => group.taskIds.includes(s.ownerTaskId));
    const rows = await readScopedCurrentProduct({ company, identity: group.identity, items, store, metrics, transferIndexVersion: control.transferIndexVersion,
      sourceTaskIds: own.map(s => s.id), demandTaskIds: group.taskIds, claimPairs: own.map(s => ({ sourceTaskId: s.id, taskId: s.ownerTaskId })) });
    rows.taskRows = await readCurrentTaskRows(company, product.scopeTaskIds(rows), staff); rows.generation = control.generation;
    const state = product.buildState(rows), converted = currentAllocationContext({ state, context, readAllocations: () => prior });
    for (const task of state.tasks) {
      if (currentTasks.has(task.id)) throw Error('Ambiguous current Sales task product');
      currentTasks.set(task.id, converted.tasks.find(t => t.id === task.id));
    }
    for (const source of state.sources) {
      if (currentSources.has(source.id)) throw Error('Ambiguous current Sales source product');
      currentSources.add(source.id); allocations.push(converted.allocations.find(a => a.sourceTaskId === source.id));
    }
    products.set(key, { state, rows });
  }
  return { context: { ...copy(context), stockAllocationView: 'CURRENT_V2',
    tasks: context.tasks.map(task => copy(currentTasks.get(task.id) || task)),
    allocations: [...prior.filter(a => !currentSources.has(a.sourceTaskId)), ...allocations] }, products, metrics };
}
module.exports = { readCurrentSalesWorkspace };
