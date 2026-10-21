const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { projectStockCard } = load('stockCardProjection.js');
const { stockKey, convertProjectedStock, readProductPage } = require('../prototypes/stock-current-state/current-model.cjs');
const task = (id, accepted, share, extra = {}) => ({ id, customerId: id, barcode: '0001', name: 'TEST',
  packing: '12x1', ea: 12, ord: share, requested: share, po: 'PO-' + id,
  procurement: { totalCtn: accepted, customerCtn: share },
  warehouse: { hasPhysicalReceipt: true, accepted }, ...extra });
function convert(tasks, activity = [], company = 'NCT') {
  const context = { company, tasks, activity }, before = JSON.stringify(context);
  const result = convertProjectedStock({ snapshot: projectStockCard(context), tasks, generation: 0 });
  assert.equal(JSON.stringify(context), before); return result;
}
test('free old20 plus B200 converts to source balances and only B customer claim', () => {
  const r = convert([task('FOC', 20, 0, { archived: true, specialPurchase: true }), task('B', 200, 200)]);
  assert.equal(r.positions.length, 2); assert.equal(r.claims.length, 1); assert.equal(r.products.length, 1);
  assert.equal(r.products[0].onHand, 220); assert.equal(r.products[0].available, 20);
  assert.equal(r.claims[0].customerId, 'B'); assert.equal(r.claims[0].reservedUsable, 200);
  assert.equal(r.activationReady, true);
});
test('empty stock does not create catalogue placeholder rows; unreceived demand is not stock', () => {
  assert.deepEqual(convert([]).products, []);
  const r = convert([task('A', 100, 100, { warehouse: { hasPhysicalReceipt: false, accepted: 0 } })]);
  assert.equal(r.positions.length, 0); assert.equal(r.products.length, 0);
});
test('partial receipt reserves actual80 rather than customer demand200', () => {
  const r = convert([task('B', 80, 200, { procurement: { totalCtn: 200, customerCtn: 200 } })]);
  assert.equal(r.products[0].onHand, 80); assert.equal(r.products[0].reservedUsable, 80);
  assert.equal(r.claims[0].reservedUsable, 80);
});
test('unknown ownership remains unknown and blocks activation', () => {
  const r = convert([task('B', 80, 200, { procurement: { totalCtn: 200 } })]);
  assert.equal(r.products[0].available, null); assert.equal(r.activationReady, false);
});
test('quarantine preserves physical totals and does not guess claim-level usable attribution', () => {
  const issue = { title: 'ISSUE', imageAltText: 'B', action: 'STOCK_EXCEPTION_REPORTED', result: 'SAVED',
    initiatedByStaffId: 'W', activityTime: '2026-10-20T00:00:00Z',
    details: { company: 'NCT', quantity: 5, kind: 'INTERNAL_DAMAGE', reason: 'Counted damage' } };
  const allocation = { title: 'ALLOC', action: 'PLANNER_ALLOCATION_SAVED', result: 'SAVED', imageAltText: 'B',
    activityTime: '2026-10-20T00:00:00Z', details: { beforeRevision: '', targets: [{ taskId: 'B', quantity: 40 }] } };
  const r = convert([task('B', 40, 40)], [allocation, issue]);
  assert.equal(r.products[0].onHand, 40); assert.equal(r.products[0].isolated, 5);
  assert.equal(r.products[0].reservedUsable, 35); assert.equal(r.claims[0].reservedUsable, null);
  assert.equal(r.claims[0].isolatedAttributed, null); assert.equal(r.activationReady, false);
});
test('packing and company identity stay separate; row overflow and duplicate sources reject', () => {
  assert.notEqual(stockKey({ ...task('A', 1, 0), company: 'NCT' }), stockKey({ ...task('A', 1, 0), company: 'GHR' }));
  const r = convert([task('A', 1, 0), task('B', 1, 0, { packing: '24x1', ea: 24 })]);
  assert.equal(r.products.length, 2);
  assert.throws(() => convert([task('A', 1, 0), task('A', 1, 0)]), /identity/);
  const tasks = [task('A', 1, 0)], snapshot = projectStockCard({ company: 'NCT', tasks, activity: [] });
  snapshot.items[0].sources[0].onHand = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => convertProjectedStock({ snapshot, tasks, generation: 0 }), /quantity/);
});
test('product sums may exceed a single-task limit without truncating physical stock', () => {
  const r = convert([task('A', 9000, 0), task('B', 9000, 0)]);
  assert.equal(r.products[0].onHand, 18000); assert.equal(r.products[0].available, 18000);
});
test('dispatched40 converts lifetime allocation100 to current claim60 without mutating old events', () => {
  const allocation = { title: 'ALLOC', action: 'PLANNER_ALLOCATION_SAVED', result: 'SAVED', imageAltText: 'B',
    activityTime: '2026-10-20T00:00:00Z', details: { beforeRevision: '', targets: [{ taskId: 'B', quantity: 100 }] } };
  const lines = [{ taskId: 'B', quantity: 40, sources: [{ sourceTaskId: 'B', quantity: 40 }] }];
  const events = ['REQUESTED', 'INVOICED', 'DISPATCHED'].map((status, i) => ({
    title: 'SHIP-' + i, description: 'SHIP', action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED',
    activityTime: '2026-10-20T00:00:00Z', details: { beforeRevision: i ? 'SHIP-' + (i - 1) : '',
      shipment: { id: 'SHIP', company: 'NCT', customerId: 'B', currency: 'MYR', status, lines,
        ...(i ? { invoice: { number: 'SI', amountCents: 100, currency: 'MYR', rateToMyr: 1 } } : {}) } }
  }));
  const r = convert([task('B', 120, 100, { archived: true })], [allocation, ...events]);
  assert.equal(r.products[0].onHand, 80); assert.equal(r.products[0].available, 20);
  assert.equal(r.positions[0].receiptAccepted, 120); assert.equal(r.positions[0].dispatched, 40);
  assert.equal(r.positions[0].replacementReceived, 0);
  assert.equal(r.claims[0].reservedUsable, 60); assert.equal(allocation.details.targets[0].quantity, 100);
});
test('product pagination calls bounded repository only and rejects cross-company output', async () => {
  let query;
  const protocol = { readSnapshot: async fn => ({ rows: await fn(), generation: 3 }) };
  const repository = { queryProducts: async args => { query = args; return { items: [], totalCount: 0 }; } };
  const r = await readProductPage({ protocol, repository, company: 'NCT', page: 2, pageSize: 25, search: '0001' });
  assert.equal(query.pageSize, 25); assert.equal(query.page, 2); assert.equal(query.consistentRead, true);
  assert.equal(r.generation, 3);
  repository.queryProducts = async () => ({ items: [{ company: 'GHR', status: 'ACTIVE' }], totalCount: 1 });
  await assert.rejects(readProductPage({ protocol, repository, company: 'NCT' }), /Invalid product page/);
});
