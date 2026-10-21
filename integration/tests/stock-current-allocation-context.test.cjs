const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { currentAllocationContext } = require('../prototypes/stock-current-state/current-allocation-context.cjs');
const { validateOriginalSales } = require('../prototypes/stock-current-state/original-sales-validation.cjs');
const { adjustDemand, dispatch } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const { readAllocations } = load('plannerAllocation.js');
const { createSalesOrderAdjustmentOperations, salesAdjustmentVersion } = load('salesOrderAdjustment.js');
const { readShipmentPlans, shipmentPlanVersion } = load('customerShipmentPlan.js');
const { prepareCurrentSales } = require('../prototypes/stock-current-state/current-sales-plan.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 };
  const task = { ...identity, id: 'T', customerId: 'C', orderId: 'O', sourceLineId: 'L', ord: 500, requested: 500, dispatched: 0,
    inc: 0, procurement: { totalCtn: 500, expectedExtra: 0, revision: 'POV' }, salesCommittedQty: 500 };
  const state = { ...identity, complete: true, revision: 0, tasks: [copy(task)],
    packingHolds: { company: 'NCT', complete: true, scope: 'TASK_TOTAL', version: 'H0', heldByTask: { T: 0 } },
    sources: [['A', 300], ['B', 200]].map(([id, n]) => ({ ...identity, id, ownerTaskId: 'T', poId: 'PO-' + id, orderId: 'O', sourceLineId: id,
      poValid: true, reviewRequired: false, receiptPolicy: 'OWNER_DEMAND', ownerShare: n, planned: n, accepted: n, onHand: n, isolated: 0, available: 0, claims: { T: n } })), relations: [] };
  return { state, context: { company: 'NCT', tasks: [task], activity: [] } };
}
const view = f => currentAllocationContext({ ...f, readAllocations });
test('current claims become cumulative original-interface view without inventing saved history', () => {
  const f = fixture(), before = JSON.stringify(f), result = view(f);
  assert.equal(result.tasks[0].inc, 500); assert.equal(result.allocations[0].revision, '');
  assert.deepEqual(result.allocations.map(a => a.targets[0].quantity), [300, 200]);
  assert.equal(result.activity.length, 0); assert.equal(JSON.stringify(f), before);
});
test('after dispatch the compatibility view still includes actual shipped cartons', () => {
  const f = fixture(); f.state = dispatch(f.state, { expectedRevision: 0, sourceId: 'A', taskId: 'T', quantity: 40 }).after;
  const result = view(f); assert.equal(result.tasks[0].inc, 500);
  assert.equal(result.allocations[0].targets[0].quantity, 300); assert.equal(f.state.sources[0].claims.T, 260);
});
test('existing allocation chain revision is preserved while unrelated module facts are untouched', () => {
  const f = fixture(); f.context.activity.push({ title: 'OLD', imageAltText: 'A', action: 'PLANNER_ALLOCATION_SAVED', result: 'SAVED',
    activityTime: '2026-10-21T00:00:00Z', details: { beforeRevision: '', targets: [{ taskId: 'T', quantity: 250 }] } });
  f.context.tasks[0].netCostCtn = 12; f.context.tasks.push({ id: 'UNRELATED', barcode: 'OTHER', inc: 17 });
  const result = view(f); assert.equal(result.allocations[0].revision, 'OLD'); assert.equal(result.allocations[0].targets[0].quantity, 300);
  assert.equal(result.tasks[0].netCostCtn, 12); assert.deepEqual(result.tasks[1], f.context.tasks[1]);
});
test('original Sales split then reduction releases implicit current ownership with valid first allocation chain', async () => {
  const f = fixture(); let serial = 0;
  async function prepare(mode, quantity, batchId = '') {
    const context = view(f);
    return validateOriginalSales({ createSalesOrderAdjustmentOperations, company: 'NCT',
      staff: { memberId: 'SOURCE/S', staffId: 'S', staffName: 'LAW', customerId: 'C', canSelectShipment: true },
      requestId: String(++serial).padStart(8, '0') + '-1111-4111-8111-111111111111', context,
      readPlans: readShipmentPlans, planVersion: shipmentPlanVersion, now: () => new Date('2026-10-22T07:00:00Z'),
      input: { action: 'ADJUST', customerId: 'C', orderId: 'O', taskId: 'T', mode, quantity, batchId, version: salesAdjustmentVersion(context, shipmentPlanVersion) } });
  }
  const split = await prepare('SPLIT', 300); f.context.activity.push(split.event);
  const reduced = await prepare('REDUCE', 50, split.event.description + '|1');
  assert.equal(reduced.event.details.allocations[0].beforeRevision, '');
  const after = adjustDemand(f.state, { expectedRevision: 0, taskId: 'T', beforeRequested: 500, requested: 450, mode: 'REDUCE', allocations: reduced.event.details.allocations }).after;
  assert.deepEqual(after.sources.map(s => [s.claims.T, s.available]), [[250, 50], [200, 0]]);
  const legacy = readAllocations([...f.context.activity, reduced.event]);
  assert.equal(legacy.find(a => a.sourceTaskId === 'A').targets[0].quantity, 250);
  // SourceB remains current-owned despite no old saved allocation; view, not fallback.
  f.state = after; f.context.activity.push(reduced.event); f.context.tasks[0].requested = 450; f.context.tasks[0].ord = 450;
  assert.deepEqual(view(f).allocations.map(a => a.targets[0].quantity), [250, 200]);
});
test('company/task/demand mismatch cannot silently map current balances onto another order', () => {
  for (const mutate of [f => f.context.company = 'GHR', f => f.context.tasks[0].customerId = 'OTHER',
    f => f.context.tasks[0].requested = 499, f => f.context.tasks[0].sourceLineId = 'OTHER']) {
    const f = fixture(); mutate(f); assert.throws(() => view(f));
  }
});
test('single composed Sales plan releases previously implicit stock without creating a competing allocation event', async () => {
  const f = fixture(), key = stockKey(f.state);
  const base = { _version: 'V0', company: 'NCT', stockKey: key, revision: 0, checkpointGeneration: 0, status: 'ACTIVE', reviewCodes: [] };
  const rows = { complete: true, positions: [], claims: [], transfers: [], product: { ...base, _id: hash('NCT', key),
    onHand: 500, isolated: 0, available: 0, reservedUsable: 500, reviewRequired: false } };
  for (const source of f.state.sources) {
    const pid = hash('NCT', key, 'PURCHASE_SOURCE', source.id);
    rows.positions.push({ ...base, _id: pid, sourceKind: 'PURCHASE_SOURCE', sourceId: source.id, sourceTaskId: source.id, poId: source.poId,
      receiptAccepted: source.accepted, replacementReceived: 0, dispatched: 0, onHand: source.onHand, available: 0, isolated: 0, reservedUsable: source.onHand });
    rows.claims.push({ ...base, _id: hash('NCT', pid, 'T'), positionId: pid, taskId: 'T', customerId: 'C', orderId: 'O', sourceLineId: 'L', reservedUsable: source.onHand, isolatedAttributed: 0 });
  }
  const result = await prepareCurrentSales({ state: f.state, rows, generation: 0, context: f.context, createSalesOrderAdjustmentOperations,
    readAllocations, readPlans: readShipmentPlans, planVersion: shipmentPlanVersion, now: () => new Date('2026-10-22T07:00:00Z'),
    request: { company: 'NCT', requestId: '11111111-1111-4111-8111-111111111111',
      staff: { memberId: 'SOURCE/S', staffId: 'S', staffName: 'LAW', customerId: 'C', canSelectShipment: true },
      input: { action: 'ADJUST', customerId: 'C', orderId: 'O', taskId: 'T', mode: 'REDUCE', quantity: 50,
        version: salesAdjustmentVersion(view(f), shipmentPlanVersion) } } });
  assert.equal(result.state.tasks[0].requested, 450);
  assert.equal(result.plan.writes.filter(w => w.after.action === 'SALES_ORDER_ADJUSTMENT_SAVED').length, 1);
  assert.equal(result.plan.writes.some(w => w.after.action === 'PLANNER_ALLOCATION_SAVED'), false);
  assert.equal(result.state.sources.reduce((n, s) => n + s.available, 0), 50);
  assert.equal(f.context.activity.length, 0);
});
