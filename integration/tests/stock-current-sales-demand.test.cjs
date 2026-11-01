const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createSalesOrderAdjustmentOperations, salesAdjustmentVersion, readSalesDemand } = load('salesOrderAdjustment.js');
const { readShipmentPlans, shipmentPlanVersion } = load('customerShipmentPlan.js');
const { readAllocations } = load('plannerAllocation.js');
const { validateOriginalSales } = require('../prototypes/stock-current-state/original-sales-validation.cjs');
const { adjustDemand, approveBorrow } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const { prepareSalesDemand } = require('../prototypes/stock-current-state/borrowing-stock-plan.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 }, activity = [];
  for (const [id, quantity] of [['A', 300], ['B', 200]]) activity.push({ _id: id, title: id, imageAltText: id, action: 'PLANNER_ALLOCATION_SAVED', result: 'SAVED',
    activityTime: '2026-10-20T00:00:00Z', details: { beforeRevision: '', targets: [{ taskId: 'T', quantity }] } });
  const context = () => { const demand = readSalesDemand('T', 500, activity); return { company: 'NCT', activity, allocations: readAllocations(activity),
    tasks: [{ ...identity, id: 'T', orderId: 'O', sourceLineId: 'L', customerId: 'C', ord: demand.requested, requested: demand.requested,
      inc: readAllocations(activity).reduce((n, a) => n + (a.targets.find(t => t.taskId === 'T')?.quantity || 0), 0),
      salesCommittedQty: Math.min(500, demand.requested), procurement: { totalCtn: 500, expectedExtra: 0, revision: 'V0' } }] }; };
  const staff = { memberId: 'SOURCE/S', staffId: 'S', staffName: 'LAW', customerId: 'C', canSelectShipment: true };
  const args = { createSalesOrderAdjustmentOperations, company: 'NCT', staff, requestId: '11111111-1111-4111-8111-111111111111',
    readPlans: readShipmentPlans, planVersion: shipmentPlanVersion, now: () => new Date('2026-10-22T04:00:00Z') };
  const input = (mode, quantity, batchId = '') => ({ action: 'ADJUST', customerId: 'C', orderId: 'O', taskId: 'T', mode, quantity, batchId,
    version: salesAdjustmentVersion(context(), shipmentPlanVersion) });
  const state = { ...identity, complete: true, revision: 0,
    tasks: [{ ...identity, id: 'T', customerId: 'C', orderId: 'O', sourceLineId: 'L', requested: 500, dispatched: 0 }],
    packingHolds: { company: 'NCT', complete: true, scope: 'TASK_TOTAL', version: 'H0', heldByTask: { T: 0 } },
    sources: [['A', 300], ['B', 200]].map(([id, n]) => ({ ...identity, id, ownerTaskId: 'T', poId: 'PO-' + id, orderId: 'O', sourceLineId: id,
      poValid: true, reviewRequired: false, receiptPolicy: 'EXPLICIT_ONLY', ownerShare: n, planned: n, accepted: n, onHand: n,
      isolated: 0, available: 0, claims: { T: n } })), relations: [] };
  return { identity, activity, context, staff, args, input, state };
}
const transitionInput = (state, event) => ({ expectedRevision: state.revision, taskId: event.imageAltText,
  beforeRequested: event.details.beforeRequested, requested: event.details.requested, mode: event.details.mode, allocations: event.details.allocations });
test('original split then partial cancellation releases only exact saved source and leaves next batch intact', async () => {
  const f = fixture(), split = await validateOriginalSales({ ...f.args, context: f.context(), input: f.input('SPLIT', 300) });
  assert.equal(f.activity.length, 2); f.activity.push(split.event);
  const state = adjustDemand(f.state, transitionInput(f.state, split.event)).after;
  const reduce = await validateOriginalSales({ ...f.args, context: f.context(), input: f.input('REDUCE', 50, split.event.details.plan.id + '|1') });
  const result = adjustDemand(state, transitionInput(state, reduce.event)).after;
  assert.equal(result.tasks[0].requested, 450);
  assert.deepEqual(result.sources.map(s => [s.id, s.claims.T, s.available, s.onHand]), [['A', 250, 50, 300], ['B', 200, 0, 200]]);
  assert.deepEqual(reduce.event.details.plan.batches.map(b => b.lines[0].quantity), [250, 200]);
  assert.deepEqual(result.sources.map(s => s.accepted), [300, 200]);
});
test('increase adds demand only, not inventory; missing release evidence never guesses aggregate cancellation', async () => {
  const f = fixture(), increase = await validateOriginalSales({ ...f.args, context: f.context(), input: f.input('INCREASE', 20) });
  const result = adjustDemand(f.state, transitionInput(f.state, increase.event)).after;
  assert.equal(result.tasks[0].requested, 520); assert.deepEqual(result.sources, f.state.sources);
  assert.throws(() => adjustDemand(f.state, { expectedRevision: 0, taskId: 'T', beforeRequested: 500, requested: 450, mode: 'REDUCE', allocations: [] }), /coverage/);
});
test('original wrong customer, stale version and existing loaded instruction remain blocked', async () => {
  const f = fixture(), input = f.input('REDUCE', 50);
  await assert.rejects(validateOriginalSales({ ...f.args, staff: { ...f.staff, customerId: 'OTHER' }, context: f.context(), input }), /authorized/);
  await assert.rejects(validateOriginalSales({ ...f.args, context: f.context(), input: { ...input, version: 'OLD' } }), /changed/);
  f.activity.push({ title: 'PACK', action: 'WAREHOUSE_PREPARATION_SAVED', result: 'SAVED', details: { beforeRevision: '', state: { taskId: 'T', prepared: true, loaded: 10 } } });
  await assert.rejects(validateOriginalSales({ ...f.args, context: f.context(), input: f.input('REDUCE', 50) }), /preparation/);
});
test('cancellation cannot release packing-held or dispatched cartons, invent stock or change another customer', () => {
  const f = fixture(), base = { expectedRevision: 0, taskId: 'T', beforeRequested: 500, requested: 450, mode: 'REDUCE',
    allocations: [{ sourceTaskId: 'A', targets: [{ taskId: 'T', quantity: 250 }] }] };
  f.state.packingHolds.heldByTask.T = 10; assert.throws(() => adjustDemand(f.state, base), /Packing/); f.state.packingHolds.heldByTask.T = 0;
  const increase = copy(base); increase.allocations[0].targets[0].quantity = 301; assert.throws(() => adjustDemand(f.state, increase), /create stock/);
  const unknown = copy(base); unknown.allocations[0].targets.push({ taskId: 'OTHER', quantity: 5 }); assert.throws(() => adjustDemand(f.state, unknown), /Known/);
  f.state.sources[0].claims.T = 200; f.state.sources[0].onHand = 200; f.state.sources[0].dispatchedByTask = { T: 100 }; f.state.tasks[0].dispatched = 100;
  const shipped = copy(base); shipped.allocations[0].targets[0].quantity = 50; assert.throws(() => adjustDemand(f.state, shipped), /dispatched/);
});
test('Sales event and source releases map into one plan without changing receipt or PO facts', async () => {
  const f = fixture(), validated = await validateOriginalSales({ ...f.args, context: f.context(), input: f.input('REDUCE', 50) });
  const key = stockKey(f.identity), base = { _version: 'V0', company: 'NCT', stockKey: key, revision: 0, checkpointGeneration: 0, status: 'ACTIVE', reviewCodes: [] };
  const rows = { complete: true, transfers: [], positions: [], claims: [], product: { ...base, _id: hash('NCT', key), onHand: 500, reservedUsable: 500, available: 0, isolated: 0, reviewRequired: false } };
  for (const source of f.state.sources) {
    const pid = hash('NCT', key, 'PURCHASE_SOURCE', source.id);
    rows.positions.push({ ...base, _id: pid, sourceKind: 'PURCHASE_SOURCE', sourceTaskId: source.id, sourceId: source.id, poId: source.poId,
      receiptAccepted: source.accepted, replacementReceived: 0, dispatched: 0, onHand: source.onHand, isolated: 0, available: 0, reservedUsable: source.onHand });
    rows.claims.push({ ...base, _id: hash('NCT', pid, 'T'), positionId: pid, taskId: 'T', customerId: 'C', orderId: 'O', sourceLineId: 'L', reservedUsable: source.onHand, isolatedAttributed: 0 });
  }
  const result = prepareSalesDemand({ state: f.state, rows, event: validated.event, generation: 0 });
  assert.deepEqual(result.plan.writes[0].after.details, validated.event.details);
  const product = result.plan.writes.find(w => w.collection === 'StockProducts').after;
  assert.deepEqual([product.onHand, product.reservedUsable, product.available], [500, 450, 50]);
  const foreign = copy(validated.event); foreign.image = 'OTHER'; assert.throws(() => prepareSalesDemand({ state: f.state, rows, event: foreign, generation: 0 }), /Sales/);
});
test('cancellation preserves both parties replacement commitment; uncovered reduction need not erase debt', () => {
  const f = fixture();
  f.state.tasks.push({ ...f.identity, id: 'U', customerId: 'OTHER', requested: 100, dispatched: 0 });
  f.state.packingHolds.heldByTask.U = 0;
  f.state.sources.push({ ...f.identity, id: 'S-U', ownerTaskId: 'U', poId: 'PO-U', orderId: 'OU', sourceLineId: 'LU',
    poValid: true, reviewRequired: false, receiptPolicy: 'OWNER_DEMAND', ownerShare: 100, planned: 100, accepted: 0,
    onHand: 0, isolated: 0, available: 0, claims: {} });
  const borrowed = approveBorrow(f.state, { expectedRevision: 0, id: 'REL', lenderSourceId: 'A', replacementSourceId: 'S-U',
    borrowerTaskId: 'U', quantity: 30, approvedBy: 'P', reason: 'Fill container' }).after;
  assert.throws(() => adjustDemand(borrowed, { expectedRevision: 1, taskId: 'T', mode: 'REDUCE', beforeRequested: 500, requested: 450,
    allocations: [{ sourceTaskId: 'A', targets: [{ taskId: 'T', quantity: 220 }, { taskId: 'U', quantity: 30 }] }] }), /Resolve borrowing/);
  assert.throws(() => adjustDemand(borrowed, { expectedRevision: 1, taskId: 'U', mode: 'REDUCE', beforeRequested: 100, requested: 20, allocations: [] }), /coverage/);
  const result = adjustDemand(borrowed, { expectedRevision: 1, taskId: 'U', mode: 'REDUCE', beforeRequested: 100, requested: 80, allocations: [] }).after;
  assert.deepEqual(result.relations, borrowed.relations); assert.equal(result.sources[2].planned, 100);
});
