const test = require('node:test'), assert = require('node:assert/strict');
const { guardProcurementStock } = require('../prototypes/stock-current-state/procurement-stock-guard.cjs');
const { domainAfterSnapshot } = require('../prototypes/stock-current-state/domain-after-snapshot.cjs');
const { approveBorrow, receive } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 };
  return { ...identity, complete: true, revision: 0, packingHolds: { company: 'NCT', complete: true, scope: 'TASK_TOTAL', version: 'H0', heldByTask: { A: 0, B: 0 } },
    tasks: ['A', 'B'].map(id => ({ ...identity, id, customerId: id, orderId: 'O-' + id, sourceLineId: 'L-' + id, requested: 100, dispatched: 0 })),
    sources: ['A', 'B'].map(id => ({ ...identity, id: 'S-' + id, ownerTaskId: id, orderId: 'O-' + id, sourceLineId: 'L-' + id, poId: 'PO-' + id,
      poValid: true, reviewRequired: false, receiptPolicy: 'OWNER_DEMAND', ownerShare: 100, planned: 100, accepted: id === 'B' ? 100 : 0,
      onHand: id === 'B' ? 100 : 0, isolated: 0, available: 0, claims: id === 'B' ? { B: 100 } : {} })), relations: [] };
}
test('normal unreceived source quantity change does not manufacture physical stock', () => {
  const before = fixture(), after = copy(before); after.sources[0].planned = 120;
  assert.deepEqual(guardProcurementStock({ before, after }).changedSources, ['S-A']);
  assert.equal(after.sources[0].onHand, 0);
});
test('approved future repayment cannot be removed by quantity/share/PO/customer changes', () => {
  const before = approveBorrow(fixture(), { expectedRevision: 0, id: 'R', lenderSourceId: 'S-B', replacementSourceId: 'S-A', borrowerTaskId: 'A', quantity: 30, approvedBy: 'P', reason: 'Fill container' }).after;
  for (const mutate of [a => { a.sources[0].ownerShare = 20; }, a => { a.sources[0].planned = 20; }, a => { a.sources[0].poId = 'OTHER'; },
    a => { a.sources[0].ownerTaskId = 'B'; }, a => { a.relations[0].repaid = 30; }]) {
    const after = copy(before); mutate(after); assert.throws(() => guardProcurementStock({ before, after }));
  }
  const after = copy(before); after.sources[0].ownerShare = 80; after.sources[0].planned = 80;
  assert.deepEqual(guardProcurementStock({ before, after }).changedSources, ['S-A']);
});
test('already repaid borrowing still retains original source ownership provenance', () => {
  const borrowed = approveBorrow(fixture(), { expectedRevision: 0, id: 'R', lenderSourceId: 'S-B', replacementSourceId: 'S-A', borrowerTaskId: 'A', quantity: 30, approvedBy: 'P', reason: 'Fill container' }).after;
  const before = receive(borrowed, { expectedRevision: 1, sourceId: 'S-A', cumulativeAccepted: 100 }).after;
  const after = copy(before); after.sources[1].ownerShare = 70;
  assert.throws(() => guardProcurementStock({ before, after }), /committed customer stock/);
});
test('procurement cannot silently release current reservations, alter receipts or drop source/task', () => {
  for (const mutate of [a => { a.sources[1].claims.B = 90; a.sources[1].available = 10; },
    a => { a.sources[1].accepted = 90; a.sources[1].onHand = 90; a.sources[1].claims.B = 90; },
    a => { a.sources.pop(); }, a => { a.tasks[1].orderId = 'OTHER'; }]) {
    const before = fixture(), after = copy(before); mutate(after); assert.throws(() => guardProcurementStock({ before, after }));
  }
});
test('new unreceived matching source is not a second receipt', () => {
  const before = fixture(), after = copy(before);
  after.sources.push({ ...copy(after.sources[0]), id: 'S-A2', poId: 'PO-A2', planned: 20, ownerShare: 20 });
  assert.deepEqual(guardProcurementStock({ before, after }).changedSources, ['S-A2']);
  const physical = copy(after); physical.sources[2].accepted = 1; physical.sources[2].onHand = 1; physical.sources[2].available = 1;
  assert.throws(() => guardProcurementStock({ before, after: physical }), /not a physical receipt/);
});

test('accepted free surplus is not a negative outstanding borrowing promise', () => {
  const before = fixture(); before.sources[1].planned = 110; before.sources[1].accepted = 110;
  before.sources[1].onHand = 110; before.sources[1].available = 10;
  const after = copy(before); after.sources[1].planned = 120;
  assert.deepEqual(guardProcurementStock({ before, after }).changedSources, ['S-B']);
  assert.equal(after.sources[1].claims.B, 100); assert.equal(after.sources[1].available, 10);
});
test('domain after snapshot uses exact original before-images without mutating source tables', () => {
  const row = { _id: 'T', company: 'NCT', _version: 'V', quantity: 100 }, tables = { NCTTasks: [row], NCTActivity: [] };
  const plan = { writes: [{ collection: 'NCTTasks', before: row, after: { ...row, quantity: 120 } }] };
  const next = domainAfterSnapshot({ company: 'NCT', tables, plan }); assert.equal(next.NCTTasks[0].quantity, 120); assert.equal(tables.NCTTasks[0].quantity, 100);
  assert.throws(() => domainAfterSnapshot({ company: 'NCT', tables, plan: { writes: [{ ...plan.writes[0], before: { ...row, quantity: 90 } }] } }), /before-image/);
  assert.throws(() => domainAfterSnapshot({ company: 'NCT', tables, plan: { writes: [{ ...plan.writes[0], collection: 'NCTTasks1' }] } }), /scope/);
  assert.throws(() => domainAfterSnapshot({ company: 'NCT', tables: { ...tables, StockPositions: [] }, plan: { writes: [{ collection: 'StockPositions', before: null, after: { _id: 'P', company: 'NCT' } }] } }), /scope/);
});
