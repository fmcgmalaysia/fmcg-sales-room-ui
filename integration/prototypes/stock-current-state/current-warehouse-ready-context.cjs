'use strict';

const { currentAllocationContext } = require('./current-allocation-context.cjs');
const { stockKey } = require('./current-model.cjs');
const { hash } = require('./commit-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
// Explicit adapter ONLY for original Warehouse Ready/preparation consumers.
// Not a replacement for readFulfilmentContext or financial/exception case facts.
function currentWarehouseReadyContext({ context, states, readAllocations, readCustomerShipments }) {
  if (!['NCT', 'GHR'].includes(context?.company) || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
    || !Array.isArray(states) || typeof readAllocations !== 'function' || typeof readCustomerShipments !== 'function') throw Error('Complete Warehouse ready context required');
  const products = new Set(), tasks = new Map(), sources = new Map(), allocations = [];
  for (const state of states) {
    const key = stockKey(state);
    if (state.company !== context.company || products.has(key)) throw Error('Distinct company ready products required');
    products.add(key);
    const converted = currentAllocationContext({ state, context, readAllocations });
    for (const task of state.tasks) {
      if (tasks.has(task.id)) throw Error('Warehouse demand coverage is ambiguous');
      tasks.set(task.id, converted.tasks.find(t => t.id === task.id));
    }
    for (const source of state.sources) {
      if (sources.has(source.id)) throw Error('Warehouse source coverage is ambiguous'); sources.set(source.id, source);
      allocations.push(converted.allocations.find(a => a.sourceTaskId === source.id));
    }
  }
  for (const task of context.tasks) {
    if (!task.procurementSource && !task.specialPurchase && !tasks.has(task.id)
      || task.warehouse?.hasPhysicalReceipt === true && !sources.has(task.id)) throw Error('Complete current-ready task/source coverage required');
  }
  const shipments = readCustomerShipments(context.activity);
  if (shipments.some(s => s.company !== context.company)) throw Error('Warehouse shipment company conflict');
  const dispatched = shipments.filter(s => s.status === 'DISPATCHED'), actual = new Map(), expected = new Map();
  for (const shipment of dispatched) for (const line of shipment.lines) for (const source of line.sources) {
    if (!sources.has(source.sourceTaskId) || !tasks.has(line.taskId)) throw Error('Warehouse shipment provenance outside current snapshot');
    const key = hash(source.sourceTaskId, line.taskId); actual.set(key, (actual.get(key) || 0) + source.quantity);
  }
  for (const source of sources.values()) {
    for (const [taskId, qty] of Object.entries(source.dispatchedByTask || {})) if (qty) expected.set(hash(source.id, taskId), qty);
  }
  if (expected.size !== actual.size || [...expected].some(([key, qty]) => actual.get(key) !== qty)) throw Error('Warehouse dispatched provenance differs');
  const prior = readAllocations(context.activity);
  return { ...copy(context), allocations: [...prior.filter(a => !sources.has(a.sourceTaskId)), ...allocations], tasks: context.tasks.map(original => {
    const row = copy(tasks.get(original.id) || original), source = sources.get(original.id);
    if (!source) return row;
    if ((original.warehouse?.hasPhysicalReceipt === true ? original.warehouse.accepted : 0) !== source.accepted
      || source.accepted > 0 && original.warehouse?.hasPhysicalReceipt !== true) throw Error('Warehouse accepted receipt provenance differs');
    if (original.warehouse?.hasPhysicalReceipt === true) row.warehouse = { ...copy(original.warehouse), stock: {
      ...copy(original.warehouse.stock || {}), availablePhysical: source.onHand - source.isolated } };
    return row;
  }) };
}
module.exports = { currentWarehouseReadyContext };
