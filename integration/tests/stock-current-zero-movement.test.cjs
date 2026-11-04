const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { execFileSync } = require('node:child_process'), path = require('node:path');
function fixture() {
  const tasks = ['A', 'B'].map(id => ({ id, company: 'NCT', barcode: id, packing: '12', ea: 12, name: 'Item' + id,
    orderId: 'O-' + id, sourceLineId: 'L-' + id, customerId: 'C-' + id, requested: 100, ord: 100,
    po: 'PO-' + id, procurement: { totalCtn: 100, customerCtn: 100 }, warehouse: { hasPhysicalReceipt: true, accepted: 100 } }));
  const shipment = { id: 'S', company: 'NCT', customerId: 'C-A', currency: 'USD', lines: [{ taskId: 'A', orderId: 'O-A', sourceLineId: 'L-A',
    barcode: 'A', packing: '12', quantity: 20, sources: [{ sourceTaskId: 'A', quantity: 20 }] }] };
  const activity = ['REQUESTED', 'INVOICED', 'DISPATCHED'].map((status, i) => ({ _id: 'E' + i, title: 'E' + i, description: 'S',
    action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED', activityTime: '2026-10-22T05:00:0' + i + 'Z', details: { beforeRevision: i ? 'E' + (i - 1) : '',
      shipment: { ...shipment, status, ...(i ? { invoice: { number: 'INV', amountCents: 100, currency: 'USD', rateToMyr: 4 } } : {}),
        ...(i === 2 ? { dispatch: { reference: 'OUT' } } : {}) } } }));
  return { company: 'NCT', tasks, activity };
}
test('original projection counterexample: unrelated zero-source movement creates false cross-product review', () => {
  const result = load('stockCardProjection.js').projectStockCard(fixture()), b = result.items.find(p => p.barcode === 'B');
  assert.equal(b.reviewRequired, true);
  assert.ok(b.sources[0].issues.includes('ALLOCATION_TARGET_REQUIRES_REVIEW'));
  assert.ok(b.sources[0].reservations.some(r => r.taskId === 'A' && r.dispatched === 0 && r.remaining === 0));
});
test('one-line candidate omits only zero movement; real20dispatch/80remaining and other product100 survive', () => {
  assert.match(execFileSync(process.execPath, [path.join(__dirname, '../prototypes/stock-current-state/build-stock-projection-candidate.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const result = load('../prototypes/stock-current-state/stockCardProjection.candidate.js').projectStockCard(fixture());
  const a = result.items.find(p => p.barcode === 'A'), b = result.items.find(p => p.barcode === 'B');
  assert.equal(a.onHand, 80); assert.equal(a.reservedUsable, 80); assert.equal(a.dispatched, 20);
  assert.equal(b.onHand, 100); assert.equal(b.reservedUsable, 100); assert.equal(b.reviewRequired, false);
  assert.equal(b.sources[0].reservations.some(r => r.taskId === 'A'), false);
});
