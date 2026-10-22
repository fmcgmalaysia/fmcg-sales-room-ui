const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { stockBootstrapPreflight } = require('../prototypes/stock-current-state/bootstrap-preflight.cjs');
const { lifecycleBootstrapPreflight } = require('../prototypes/stock-current-state/lifecycle-bootstrap-preflight.cjs');
const { projectStockCard } = load('stockCardProjection.js'), { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
function fixture() {
  const tasks = [['FOC', 20, 0], ['B', 200, 200], ['NEW', 0, 100]].map(([id, received, share]) => ({ id, company: 'NCT', barcode: id === 'NEW' ? '2' : '1',
    name: 'Item', packing: '12', ea: 12, orderId: 'O-' + id, sourceLineId: 'L-' + id, customerId: 'C-' + id, po: received ? 'PO-' + id : '',
    supplierId: 'SUP', ord: share, requested: share, lpCtn: 12, lpPc: 1, disc1: 0, disc2: 0, disc3: 0, history: [],
    procurement: { totalCtn: received || share, customerCtn: share }, warehouse: received ? { hasPhysicalReceipt: true, accepted: received } : null }));
  const context = { company: 'NCT', tasks, activity: [], suppliers: [{ id: 'SUP', name: 'Supplier' }], customers: tasks.map(t => ({ id: t.customerId, name: t.customerId })) };
  const args = { company: 'NCT', context, purchaseRecords: [], includeProjection: true,
    control: { _id: hash('NCT', 'STOCK_CONTROL'), company: 'NCT', mode: 'MAINTENANCE', schemaVersion: 1, generation: 0, pending: null, _version: 'C0' },
    existing: { complete: true, positions: [], claims: [], products: [], transfers: [] }, projectStockCard, projectPurchaseOrders };
  const taskRows = tasks.map(t => ({ _id: t.id, description: t.orderId, imageAltText: t.sourceLineId, ourPoNumber: t.po, manualCostField: ['KEEP'] }));
  return { args, context, taskRows, prepare: () => lifecycleBootstrapPreflight({ company: 'NCT', context, base: stockBootstrapPreflight(args), taskRows, generation: 0 }) };
}
test('maintenance v2 dry run preserves220physical/free20 and adds only real new-order product zero checkpoint', () => {
  const f = fixture(), before = JSON.stringify(f.context), report = f.prepare();
  assert.deepEqual(report.counts, { positions: 2, claims: 1, products: 2, tasks: 3 });
  assert.equal(report.rows.products.reduce((n, p) => n + p.onHand, 0), 220);
  assert.equal(report.rows.products.reduce((n, p) => n + p.available, 0), 20);
  assert.ok(report.rows.positions.every(p => p.borrowRepaidCumulative === 0));
  assert.ok(report.rows.claims.every(c => c.dispatchedCumulative === 0));
  assert.ok(report.rows.products.every(p => p.lifecycleVersion === 2 && p.nextBorrowSequence === 1));
  assert.ok(report.blockers.includes('TASK_VERSION_INITIALIZATION_NOT_VERIFIED')); assert.equal(report.canApply, false); assert.equal(report.activationReady, false);
  assert.equal(JSON.stringify(f.context), before); assert.equal(f.taskRows[0].ourPoNumber, 'PO-FOC');
});
test('historical source dispatch initializes both stable claim and task cumulative, never silently zero', () => {
  const f = fixture(), lines = [{ taskId: 'B', orderId: 'O-B', sourceLineId: 'L-B', barcode: '1', packing: '12', quantity: 20,
    sources: [{ sourceTaskId: 'B', quantity: 20 }] }];
  const shipment = { id: 'S', company: 'NCT', customerId: 'C-B', currency: 'USD', lines };
  f.context.activity.push(...['REQUESTED', 'INVOICED', 'DISPATCHED'].map((status, i) => ({ _id: 'E' + i, title: 'E' + i,
    description: 'S', image: 'C-B', action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED', activityTime: '2026-10-22T05:00:0' + i + 'Z',
    details: { beforeRevision: i ? 'E' + (i - 1) : '', shipment: { ...shipment, status,
      ...(i ? { invoice: { number: 'INV', amountCents: 100, currency: 'USD', rateToMyr: 4 } } : {}), ...(i === 2 ? { dispatch: { reference: 'OUT' } } : {}) } } })));
  const report = f.prepare(); assert.equal(report.rows.claims.filter(c => c.taskId === 'B').reduce((n, c) => n + c.dispatchedCumulative, 0), 20);
  assert.equal(report.taskInitializations.find(t => t.id === 'B').fields.stockDispatchedCumulative, 20);
  assert.equal(report.rows.products.reduce((n, p) => n + p.onHand, 0), 200);
});
test('missing raw task/identity, corrupted dispatch and existing conflicting counter are blocked, not applied', () => {
  const a = fixture(); a.taskRows.pop(); assert.throws(a.prepare, /exact legacy/);
  const b = fixture(); b.taskRows[0].imageAltText = 'OTHER'; assert.throws(b.prepare, /identity/);
  const c = fixture(); c.taskRows[0].stockCounterSchema = 2; c.taskRows[0].stockDispatchedCumulative = 9;
  assert.ok(c.prepare().blockers.includes('EXISTING_TASK_COUNTER_REQUIRES_REVIEW'));
  const d = fixture(), base = stockBootstrapPreflight(d.args); base.privateProjection.items[0].sources[0].dispatched = 1;
  assert.throws(() => lifecycleBootstrapPreflight({ company: 'NCT', context: d.context, base, taskRows: d.taskRows, generation: 0 }), /dispatch total/);
});

test('candidate nonzero-movement projection avoids storing unrelated zero claims during bootstrap', () => {
  const f = fixture(); f.args.projectStockCard = load('../prototypes/stock-current-state/stockCardProjection.candidate.js').projectStockCard;
  const lines = [{ taskId: 'B', orderId: 'O-B', sourceLineId: 'L-B', barcode: '1', packing: '12', quantity: 20, sources: [{ sourceTaskId: 'B', quantity: 20 }] }];
  const shipment = { id: 'S', company: 'NCT', customerId: 'C-B', currency: 'USD', lines };
  f.context.activity.push(...['REQUESTED', 'INVOICED', 'DISPATCHED'].map((status, i) => ({ _id: 'E' + i, title: 'E' + i, description: 'S',
    action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED', activityTime: '2026-10-22T05:00:0' + i + 'Z', details: { beforeRevision: i ? 'E' + (i - 1) : '',
      shipment: { ...shipment, status, ...(i ? { invoice: { number: 'INV', amountCents: 100, currency: 'USD', rateToMyr: 4 } } : {}),
        ...(i === 2 ? { dispatch: { reference: 'OUT' } } : {}) } } })));
  const report = f.prepare(); assert.equal(report.rows.claims.length, 1);
  assert.equal(report.rows.claims[0].dispatchedCumulative, 20); assert.equal(report.rows.claims[0].reservedUsable, 180);
  assert.equal(report.rows.products.reduce((n, p) => n + p.available, 0), 20);
});
