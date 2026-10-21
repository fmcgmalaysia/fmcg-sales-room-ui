const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createStockExceptionOperations, stockExceptionVersion, stockPosition } = load('inventoryExceptions.js');
const { quarantineFree, allocateCumulative } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const { prepareFreeQuarantine } = require('../prototypes/stock-current-state/borrowing-stock-plan.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const copy = v => JSON.parse(JSON.stringify(v));
function fixture() {
  const identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 };
  const task = { id: 'T', orderId: 'O', sourceLineId: 'L', customerId: 'C', po: 'PO', supplierId: 'SUP', netCostCtn: 10,
    warehouse: { hasPhysicalReceipt: true, accepted: 100 } };
  const state = { ...identity, complete: true, revision: 0,
    tasks: [{ ...identity, ...task, requested: 100, dispatched: 0 }],
    packingHolds: { company: 'NCT', complete: true, scope: 'TASK_TOTAL', version: 'H0', heldByTask: { T: 0 } },
    sources: [{ ...identity, id: 'T', ownerTaskId: 'T', poId: 'PO-ID', orderId: 'O', sourceLineId: 'L', poValid: true, reviewRequired: false,
      receiptPolicy: 'EXPLICIT_ONLY', ownerShare: 100, planned: 100, accepted: 100, onHand: 100, isolated: 0, available: 20, claims: { T: 80 } }], relations: [] };
  const records = new Map(), context = { company: 'NCT', tasks: [task], activity: [] };
  const store = { read: async (c, id) => copy(records.get(id) || null), insert: async (c, row) => { if (records.has(row._id)) throw Error('Duplicate'); records.set(row._id, copy(row)); return row; }, remove: async (c, id) => records.delete(id) };
  const save = createStockExceptionOperations({ store, names: { NCT: { activity: 'NCTActivity' } }, readContext: async () => context,
    now: () => new Date('2026-10-22T06:00:00Z') });
  const request = { company: 'NCT', requestId: '11111111-1111-4111-8111-111111111111', staff: { memberId: 'M', staffId: 'W', staffName: 'LAW', canReportStockException: true },
    input: { action: 'QUARANTINE', sourceTaskId: 'T', quantity: 10, kind: 'SHORT_EXPIRY', reason: 'Physical expiry check', version: stockExceptionVersion(context) } };
  return { identity, state, context, records, save, request };
}
test('original quarantined free stock stays on hand and cannot reappear in usable allocation', async () => {
  const f = fixture(); await f.save(f.request);
  const event = [...f.records.values()].find(r => r.action === 'STOCK_EXCEPTION_REPORTED');
  const original = stockPosition('T', 100, [event]); assert.equal(original.availablePhysical, 90);
  const after = quarantineFree(f.state, { expectedRevision: 0, sourceId: 'T', ...event.details }).after;
  assert.deepEqual([after.sources[0].onHand, after.sources[0].available, after.sources[0].isolated, after.sources[0].claims.T, after.sources[0].accepted], [100, 10, 10, 80, 100]);
  assert.throws(() => allocateCumulative(after, { expectedRevision: 1, sourceId: 'T', reason: 'Allocate', targets: [{ taskId: 'T', quantity: 100 }] }), /usable/);
});
test('reserved stock loss is refused rather than assigning customer losses without authority', () => {
  const f = fixture(), before = JSON.stringify(f.state);
  assert.throws(() => quarantineFree(f.state, { expectedRevision: 0, sourceId: 'T', quantity: 21, kind: 'INTERNAL_DAMAGE', reason: 'Found damage' }), /attribution review/);
  assert.equal(JSON.stringify(f.state), before);
});
test('original exception authorization, approved physical basis and stale version remain enforced', async () => {
  const f = fixture();
  await assert.rejects(f.save({ ...f.request, staff: { ...f.request.staff, canReportStockException: false } }), /authorized/);
  await assert.rejects(f.save({ ...f.request, input: { ...f.request.input, quantity: 101 } }), /physical stock/);
  await assert.rejects(f.save({ ...f.request, input: { ...f.request.input, version: 'OLD' } }), /changed/);
});
test('same original exception event and current quarantine publish in one plan without changing receipts', async () => {
  const f = fixture(); await f.save(f.request); const event = [...f.records.values()].find(r => r.action === 'STOCK_EXCEPTION_REPORTED');
  const key = stockKey(f.identity), pid = hash('NCT', key, 'PURCHASE_SOURCE', 'T');
  const base = { _version: 'V0', company: 'NCT', stockKey: key, revision: 0, checkpointGeneration: 0, status: 'ACTIVE', reviewCodes: [] };
  const rows = { complete: true, transfers: [], positions: [{ ...base, _id: pid, sourceKind: 'PURCHASE_SOURCE', sourceId: 'T', sourceTaskId: 'T', poId: 'PO-ID',
    receiptAccepted: 100, replacementReceived: 0, dispatched: 0, onHand: 100, isolated: 0, available: 20, reservedUsable: 80 }],
    claims: [{ ...base, _id: hash('NCT', pid, 'T'), positionId: pid, taskId: 'T', customerId: 'C', orderId: 'O', sourceLineId: 'L', reservedUsable: 80, isolatedAttributed: 0 }],
    product: { ...base, _id: hash('NCT', key), onHand: 100, isolated: 0, available: 20, reservedUsable: 80, reviewRequired: false } };
  const result = prepareFreeQuarantine({ state: f.state, rows, event, generation: 0 });
  assert.deepEqual(result.plan.writes[0].after.details, event.details);
  assert.equal(result.plan.writes.some(w => w.collection === 'StockClaims'), false);
  const product = result.plan.writes.find(w => w.collection === 'StockProducts').after;
  assert.deepEqual([product.onHand, product.isolated, product.available, product.reservedUsable], [100, 10, 10, 80]);
});
