const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { projectStockCard } = load('stockCardProjection.js');
const at = '2026-10-20T00:00:00Z';
const task = (id, extra = {}) => ({ id, customerId: 'C', barcode: '0001', name: 'TEST', packing: '12x1', ea: 12,
  ord: 100, po: 'PO-1', procurement: { totalCtn: 120 }, ...extra });
const received = n => ({ hasPhysicalReceipt: true, accepted: n });
const allocation = (targets, source = 'A') => ({ title: 'ALLOC-' + source, action: 'PLANNER_ALLOCATION_SAVED', result: 'SAVED',
  imageAltText: source, activityTime: at, details: { beforeRevision: '', targets } });
const context = (tasks, activity = [], company = 'NCT') => ({ company, tasks, activity });
function shipmentChain(status, amount = 40) {
  const lines = [{ taskId: 'A', quantity: amount, sources: [{ sourceTaskId: 'A', quantity: amount }] }];
  return ['REQUESTED', 'INVOICED', 'DISPATCHED'].slice(0, ['REQUESTED', 'INVOICED', 'DISPATCHED'].indexOf(status) + 1).map((state, i) => ({
    title: 'SHIP-' + i, description: 'SHIP', action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED', activityTime: at,
    details: { beforeRevision: i ? 'SHIP-' + (i - 1) : '', shipment: { id: 'SHIP', company: 'NCT', customerId: 'C', currency: 'MYR',
      status: state, lines, ...(i ? { invoice: { number: 'SI', amountCents: 100, currency: 'MYR', rateToMyr: 1 } } : {}) } }
  }));
}
test('120 received, 100 explicitly customer-owned: 20 free; reads never mutate their inputs', () => {
  const c = context([task('A', { warehouse: received(120) })], [allocation([{ taskId: 'A', quantity: 100 }])]);
  const before = JSON.stringify(c), row = projectStockCard(c).items[0];
  assert.equal(row.usableOnHand, 120); assert.equal(row.reserved, 100); assert.equal(row.available, 20);
  assert.equal(JSON.stringify(c), before); assert.equal(projectStockCard(c).items[0].available, 20);
});
test('absent ownership is held for review, never advertised as 120 free cartons', () => {
  const row = projectStockCard(context([task('A', { warehouse: received(120) })])).items[0];
  assert.equal(row.available, null); assert.equal(row.unassigned, 120); assert.equal(row.reviewRequired, true);
});
test('empty planner targets do not silently release an existing customer-source entitlement', () => {
  const row = projectStockCard(context([task('A', { warehouse: received(120) })], [allocation([])])).items[0];
  assert.equal(row.available, null); assert.equal(row.reviewRequired, true);
  const released = projectStockCard(context([task('A', { warehouse: received(120), ord: 0, requested: 0 })], [allocation([])])).items[0];
  assert.equal(released.available, 120);
});
test('invoicing and Support selection do not deduct physical stock or reserve twice', () => {
  for (const status of ['REQUESTED', 'INVOICED']) {
    const row = projectStockCard(context([task('A', { warehouse: received(120) })],
      [allocation([{ taskId: 'A', quantity: 100 }]), ...shipmentChain(status)])).items[0];
    assert.equal(row.usableOnHand, 120); assert.equal(row.reserved, 100); assert.equal(row.available, 20);
  }
});
test('dispatch reduces physical stock and outstanding reservation once, preserving the free balance', () => {
  const row = projectStockCard(context([task('A', { warehouse: received(120), archived: true })],
    [allocation([{ taskId: 'A', quantity: 100 }]), ...shipmentChain('DISPATCHED')])).items[0];
  assert.equal(row.usableOnHand, 80); assert.equal(row.reserved, 60); assert.equal(row.available, 20);
});
test('40 reserved then 5 quarantined: 35 usable, shortfall 5; does not silently reduce customer claim', () => {
  const issue = { title: 'ISSUE', imageAltText: 'A', action: 'STOCK_EXCEPTION_REPORTED', result: 'SAVED', initiatedByStaffId: 'W',
    activityTime: at, details: { company: 'NCT', quantity: 5, kind: 'INTERNAL_DAMAGE', reason: 'Counted damage' } };
  const row = projectStockCard(context([task('A', { warehouse: received(40) })],
    [allocation([{ taskId: 'A', quantity: 40 }]), issue])).items[0];
  assert.equal(row.usableOnHand, 35); assert.equal(row.reserved, 40); assert.equal(row.shortage, 5); assert.equal(row.available, null);
});
test('transferred stock is not another physical receipt; split shipment display rows do not multiply sources', () => {
  const rows = [task('A', { warehouse: received(120), batchEntitlements: [{ quantity: 60 }, { quantity: 40 }] }),
    task('B', { warehouse: { hasPhysicalReceipt: false, accepted: 0 }, po: '' })];
  const result = projectStockCard(context(rows, [allocation([{ taskId: 'A', quantity: 60 }, { taskId: 'B', quantity: 40 }])]));
  assert.equal(result.items.length, 1); assert.equal(result.items[0].sources.length, 1); assert.equal(result.items[0].received, 120);
});
test('6000 catalogue products with no physical receipt create no stock rows', () => {
  assert.equal(projectStockCard(context(Array.from({ length: 6000 }, (_, i) => task('CAT-' + i, { po: '', warehouse: null })))).items.length, 0);
});
test('incoming, company, carton size and source identity are kept separate', () => {
  const a = task('A', { warehouse: received(80) });
  const b = task('B', { warehouse: received(10), ea: 24, packing: '24x1' });
  const rows = projectStockCard(context([a, b], [allocation([], 'A'), allocation([], 'B')])).items;
  assert.equal(rows.length, 2); assert.equal(rows.find(row => row.ea === 12).incoming, 40);
  assert.notEqual(rows[0].key, projectStockCard(context([a], [allocation([])], 'GHR')).items[0].key);
  assert.throws(() => projectStockCard(context([a, a])), /identity/);
});
test('a derived stock snapshot mismatch blocks an apparently free balance', () => {
  const row = projectStockCard(context([task('A', { warehouse: { ...received(120), stock: { availablePhysical: 999 } } })], [allocation([])])).items[0];
  assert.equal(row.available, null); assert.equal(row.reviewRequired, true);
});
