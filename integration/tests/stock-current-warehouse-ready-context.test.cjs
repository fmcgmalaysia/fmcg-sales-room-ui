const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { currentWarehouseReadyContext } = require('../prototypes/stock-current-state/current-warehouse-ready-context.cjs');
const { approveBorrow, dispatch } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const { readAllocations } = load('plannerAllocation.js'), { readCustomerShipments } = load('customerShipmentLedger.js');
const { projectPreparation } = load('warehousePreparation.js');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 };
  const tasks = ['A', 'B'].map(id => ({ ...identity, id, customerId: 'C-' + id, orderId: 'O-' + id, sourceLineId: 'L-' + id, requested: 100, ord: 100,
    inc: id === 'B' ? 100 : 0, po: 'PO-' + id, procurement: { totalCtn: 100, customerCtn: 100 },
    warehouse: id === 'B' ? { hasPhysicalReceipt: true, accepted: 100, stock: { availablePhysical: 100, cases: [] } } : null }));
  const state = { ...identity, complete: true, revision: 0, tasks: tasks.map(t => ({ ...identity, id: t.id, customerId: t.customerId,
    orderId: t.orderId, sourceLineId: t.sourceLineId, requested: 100, dispatched: 0 })),
    packingHolds: { company: 'NCT', complete: true, scope: 'TASK_TOTAL', version: 'H0', heldByTask: { A: 0, B: 0 } },
    sources: tasks.map(t => ({ ...identity, id: t.id, ownerTaskId: t.id, orderId: t.orderId, sourceLineId: t.sourceLineId, poId: 'P-' + t.id,
      poValid: true, reviewRequired: false, receiptPolicy: 'OWNER_DEMAND', planned: 100, ownerShare: 100, accepted: t.id === 'B' ? 100 : 0,
      onHand: t.id === 'B' ? 100 : 0, available: 0, isolated: 0, claims: t.id === 'B' ? { B: 100 } : {} })), relations: [] };
  return { context: { company: 'NCT', tasks, activity: [], customers: [{ id: 'C-A', name: 'A' }, { id: 'C-B', name: 'B' }] }, states: [state], readAllocations, readCustomerShipments };
}
const borrowed = state => approveBorrow(state, { expectedRevision: 0, id: 'R', lenderSourceId: 'B', replacementSourceId: 'A', borrowerTaskId: 'A',
  quantity: 30, approvedBy: 'P', reason: 'Fill container' }).after;
test('unchanged stock preserves original Warehouse signatures, versions, rows and receipt facts', () => {
  const f = fixture(), before = JSON.stringify(f.context), projected = projectPreparation(f.context), context = currentWarehouseReadyContext(f);
  assert.deepEqual(projectPreparation(context), projected); assert.equal(JSON.stringify(f.context), before);
  assert.deepEqual(context.tasks[1].warehouse, f.context.tasks[1].warehouse);
});
test('after borrowing, original Ready reads A30/B70 from same physical100 rather than old allocation/physical999', () => {
  const f = fixture(); f.states[0] = borrowed(f.states[0]); f.context.tasks[1].warehouse.stock.availablePhysical = 999;
  const context = currentWarehouseReadyContext(f), rows = projectPreparation(context);
  assert.equal(rows.find(r => r.taskId === 'A').readyStock, 30); assert.equal(rows.find(r => r.taskId === 'B').readyStock, 70);
  assert.equal(context.tasks[1].warehouse.stock.availablePhysical, 100); assert.equal(context.tasks[1].warehouse.accepted, 100);
  assert.equal(context.tasks[0].inc, 30); assert.equal(context.tasks[1].inc, 70);
  assert.equal(f.context.tasks[1].warehouse.stock.availablePhysical, 999);
});
test('actual dispatch subtracts once, retains cumulative progress and requires matching original shipment evidence', () => {
  const f = fixture(), state = borrowed(f.states[0]);
  f.states[0] = dispatch(state, { expectedRevision: 1, sourceId: 'B', taskId: 'A', quantity: 20 }).after;
  assert.throws(() => currentWarehouseReadyContext(f), /provenance differs/);
  const lines = [{ taskId: 'A', quantity: 20, sources: [{ sourceTaskId: 'B', quantity: 20 }] }];
  f.context.activity = ['REQUESTED', 'INVOICED', 'DISPATCHED'].map((status, i) => ({ title: 'SHIP' + i, description: 'SHIP',
    action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED', activityTime: '2026-10-22T00:00:00Z', details: { beforeRevision: i ? 'SHIP' + (i - 1) : '',
      shipment: { id: 'SHIP', company: 'NCT', customerId: 'C-A', currency: 'USD', status, lines,
        ...(i ? { invoice: { number: 'INV', amountCents: 100, currency: 'USD', rateToMyr: 4 } } : {}) } } }));
  const context = currentWarehouseReadyContext(f), rows = projectPreparation(context);
  assert.equal(context.tasks[1].warehouse.stock.availablePhysical, 80);
  assert.equal(rows.find(r => r.taskId === 'A').readyStock, 10); assert.equal(rows.find(r => r.taskId === 'B').readyStock, 70);
  assert.equal(context.tasks[0].inc, 30); assert.equal(f.states[0].relations[0].repaid, 0);
});
test('multiple products keep every current allocation view instead of reverting an earlier product to history', () => {
  const f = fixture(); f.states[0] = borrowed(f.states[0]);
  const second = copy(f.states[0]); second.barcode = '2'; second.relations = []; second.revision = 0;
  second.tasks = second.tasks.map(t => ({ ...t, barcode: '2', id: t.id + '2', customerId: t.customerId + '2', orderId: t.orderId + '2', sourceLineId: t.sourceLineId + '2' }));
  second.sources = second.sources.map(s => ({ ...s, barcode: '2', id: s.id + '2', ownerTaskId: s.ownerTaskId + '2', claims: s.id === 'B' ? { B2: 100 } : {} }));
  second.packingHolds.heldByTask = { A2: 0, B2: 0 };
  f.context.tasks.push(...copy(f.context.tasks).map(t => ({ ...t, barcode: '2', id: t.id + '2', customerId: t.customerId + '2', orderId: t.orderId + '2', sourceLineId: t.sourceLineId + '2' })));
  f.states.push(second); const context = currentWarehouseReadyContext(f), rows = projectPreparation(context);
  assert.equal(rows.find(r => r.taskId === 'A').readyStock, 30); assert.equal(rows.find(r => r.taskId === 'B').readyStock, 70);
  assert.equal(rows.find(r => r.taskId === 'B2').readyStock, 100); assert.equal(context.allocations.length, 4);
});
test('incomplete source/task/product or changed accepted authority refuses, not legacy fallback', () => {
  const f = fixture(); f.states = []; assert.throws(() => currentWarehouseReadyContext(f), /coverage/);
  const g = fixture(); g.context.tasks[1].warehouse.accepted = 99; assert.throws(() => currentWarehouseReadyContext(g), /accepted/);
  const h = fixture(); h.states.push(copy(h.states[0])); assert.throws(() => currentWarehouseReadyContext(h), /Distinct/);
});
