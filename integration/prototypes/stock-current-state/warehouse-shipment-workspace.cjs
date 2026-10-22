'use strict';
const { stockKey } = require('./current-model.cjs');
const { originalProductState } = require('./original-product-state.cjs');
const { readScopedCurrentProduct } = require('./scoped-current-reader.cjs');
const { currentAllocationContext } = require('./current-allocation-context.cjs');
const { copy } = require('./segmented-plan.cjs');
// PRIVATE original company fulfilment context, not a source Sales customer scope.
// Same selected set must feed its original READ/version and DISPATCH validation.
async function readCurrentWarehouseShipmentWorkspace({ company, staff, context, control, items, store,
  readCurrentTaskRows, readPurchaseRecords, projectPurchaseOrders, readAllocations, readCustomerShipments,
  readPackingLists, packingHeld, readPreparation, projectPreparation, metrics = { exactReads: 0, queries: 0 } }) {
  if (!['NCT', 'GHR'].includes(company) || !staff?.memberId || !staff.staffId
    || staff.canDispatchShipment !== true && staff.readFinancial !== true || staff.customerId
    || context?.company !== company || control?.company !== company || control.mode !== 'ACTIVE' || control.pending
    || control.schemaVersion !== 1 || !Number.isSafeInteger(control.generation) || control.generation < 0
    || control.transferIndexVersion !== 2 || typeof control.writerBuild !== 'string' || !control.writerBuild
    || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
    || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Private original Warehouse shipment context required');
  const shipments = readCustomerShipments(context.activity);
  if (shipments.some(s => s.company !== company)) throw Error('Shipment company context conflict');
  const retained = new Set(shipments.filter(s => ['REQUESTED', 'INVOICED'].includes(s.status)).flatMap(s => s.lines.map(l => l.taskId)));
  const selected = context.tasks.filter(t => !t.procurementSource && !t.specialPurchase && (!t.archived || retained.has(t.id)));
  if ([...retained].some(id => !selected.some(t => t.id === id))) throw Error('Original outstanding shipment task missing');
  const groups = new Map();
  for (const task of selected) {
    const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea }, key = stockKey(identity);
    if (!groups.has(key)) groups.set(key, { identity, taskIds: [] }); groups.get(key).taskIds.push(task.id);
  }
  const records = groups.size ? await readPurchaseRecords(company, staff) : [];
  const orders = groups.size ? projectPurchaseOrders({ company, workspace: context, records }) : [];
  const prior = readAllocations(context.activity), products = new Map(), tasks = new Map(), sources = new Set(), allocations = [];
  for (const [key, group] of groups) {
    const builder = originalProductState({ company, context, orders, identity: group.identity, readAllocations: () => prior,
      readCustomerShipments: () => shipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
    const explicitSources = [...new Set(shipments.filter(s => ['REQUESTED', 'INVOICED'].includes(s.status))
      .flatMap(s => s.lines.filter(l => group.taskIds.includes(l.taskId)).flatMap(l => l.sources.map(p => p.sourceTaskId))))];
    const rows = await readScopedCurrentProduct({ company, identity: group.identity, items, store, metrics,
      transferIndexVersion: control.transferIndexVersion, sourceTaskIds: explicitSources, demandTaskIds: group.taskIds });
    if (!rows.product) throw Error('Warehouse shipment product checkpoint missing');
    rows.taskRows = await readCurrentTaskRows(company, builder.scopeTaskIds(rows), staff); rows.generation = control.generation;
    const state = builder.buildState(rows), view = currentAllocationContext({ state, context, readAllocations: () => prior });
    for (const task of state.tasks) {
      if (tasks.has(task.id)) throw Error('Warehouse shipment task product ambiguous'); tasks.set(task.id, view.tasks.find(t => t.id === task.id));
    }
    for (const source of state.sources) {
      if (sources.has(source.id)) throw Error('Warehouse shipment source product ambiguous'); sources.add(source.id);
      allocations.push(view.allocations.find(a => a.sourceTaskId === source.id));
    }
    products.set(key, { state, rows });
  }
  return { context: { ...copy(context), stockAllocationView: 'CURRENT_V2', tasks: context.tasks.map(t => copy(tasks.get(t.id) || t)),
    allocations: [...prior.filter(a => !sources.has(a.sourceTaskId)), ...allocations] }, products, metrics };
}
module.exports = { readCurrentWarehouseShipmentWorkspace };
