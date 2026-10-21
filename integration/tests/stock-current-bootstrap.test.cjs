const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { stockBootstrapPreflight } = require('../prototypes/stock-current-state/bootstrap-preflight.cjs');
const { projectStockCard } = load('stockCardProjection.js'), { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const tasks = [['FOC', 20, 0], ['B', 200, 200]].map(([id, received, share]) => ({ id, company: 'NCT', barcode: '1', name: 'Item', packing: '12', ea: 12,
    orderId: 'O-' + id, sourceLineId: 'L-' + id, customerId: 'C-' + id, po: 'PO-' + id, supplierId: 'SUP', ord: share, requested: share,
    lpCtn: 12, lpPc: 1, disc1: 0, disc2: 0, disc3: 0, history: [], procurement: { totalCtn: received, customerCtn: share },
    warehouse: { hasPhysicalReceipt: true, accepted: received } }));
  return { company: 'NCT', context: { company: 'NCT', tasks, activity: [], suppliers: [{ id: 'SUP', name: 'Supplier' }],
    customers: tasks.map(t => ({ id: t.customerId, name: t.customerId })), readAt: '2026-10-22T00:00:00Z' }, purchaseRecords: [],
    control: { _id: hash('NCT', 'STOCK_CONTROL'), company: 'NCT', mode: 'MAINTENANCE', schemaVersion: 1, generation: 0, pending: null, _version: 'C0' },
    existing: { complete: true, positions: [], claims: [], products: [], transfers: [] }, projectStockCard, projectPurchaseOrders };
}
test('dry run resolves actual internal PO identities and prepares exact220/free20/claim200 without writes', () => {
  const f = fixture(), before = JSON.stringify(f), report = stockBootstrapPreflight(f);
  assert.equal(report.canBootstrap, true); assert.equal(report.activationReady, false); assert.equal(report.reviewRequired, false);
  assert.deepEqual(report.counts, { positions: 2, claims: 1, products: 1 });
  assert.equal(report.rows.products[0].onHand, 220); assert.equal(report.rows.products[0].available, 20);
  assert.equal(report.rows.claims[0].reservedUsable, 200);
  assert.equal(report.rows.positions.every(p => p.poId !== 'PO-' + p.sourceTaskId && typeof p._version === 'string'), true);
  assert.equal(JSON.stringify(f), before);
});
test('not maintenance, pending control, existing target or business locks block before projection', () => {
  for (const mutate of [f => { f.control.mode = 'LEGACY'; }, f => { f.control.pending = { key: 'P', digest: 'D' }; },
    f => { f.existing.positions.push({ _id: 'EXISTS' }); }, f => { f.context.activity.push({ _id: hash('NCT/PURCHASE', 'LOCK') }); },
    f => { f.context.activity.push({ _id: hash('NCT', 'B', 'COST_LOCK') }); }]) {
    const f = fixture(); mutate(f); let projected = false; f.projectStockCard = () => { projected = true; throw Error('Must not project'); };
    const report = stockBootstrapPreflight(f); assert.equal(report.canBootstrap, false); assert.equal(report.rows, null); assert.equal(projected, false);
  }
});
test('unconfirmed legacy save blocks and completed matching receipt allows dry run only', () => {
  const f = fixture(), id = 'OLD'; f.context.activity.push({ _id: id, action: 'PURCHASE_OPERATION_PREPARED', details: { digest: 'D', kind: 'PREPARED' } });
  assert.ok(stockBootstrapPreflight(f).blockers.includes('LEGACY_SAVE_NOT_CONFIRMED'));
  f.context.activity.push({ _id: hash(id, 'RESULT'), action: 'PURCHASE_OPERATION_RESULT', result: 'SAVED', details: { kind: 'RESULT', digest: 'D', outcome: { ok: true } } });
  const report = stockBootstrapPreflight(f); assert.equal(report.canBootstrap, true); assert.equal(report.activationReady, false);
});

test('mere result-shaped row or inconsistent current generation is not completion evidence', () => {
  const f = fixture(), id = 'OLD'; f.context.activity.push({ _id: id, action: 'PURCHASE_OPERATION_PREPARED', details: { kind: 'PREPARED', digest: 'D' } });
  f.context.activity.push({ _id: hash(id, 'RESULT'), action: 'PURCHASE_OPERATION_RESULT', details: { digest: 'D' } });
  assert.equal(stockBootstrapPreflight(f).canBootstrap, false);
  const g = fixture(); g.context.activity.push({ _id: 'NEW', company: 'NCT', baseGeneration: 0, digest: 'D', plan: { writes: [] } });
  g.context.activity.push({ _id: hash('NEW', 'RESULT'), company: 'NCT', baseGeneration: 0, digest: 'D', outcome: { ok: true, operationId: 'NEW', generation: 1 } });
  assert.ok(stockBootstrapPreflight(g).blockers.includes('CURRENT_SAVE_NOT_CONFIRMED'));
});
test('unknown ownership is preserved as null/review, not made zero to pass migration', () => {
  const f = fixture(); delete f.context.tasks[1].procurement.customerCtn;
  const report = stockBootstrapPreflight(f); assert.equal(report.canBootstrap, true); assert.equal(report.reviewRequired, true);
  assert.equal(report.rows.products[0].available, null); assert.equal(report.activationReady, false);
});
test('checkpoint changes with real business/control changes, not read timestamp or object key ordering', () => {
  const f = fixture(), report = stockBootstrapPreflight(f), again = { ...f, context: { ...copy(f.context), readAt: '2026-10-23T00:00:00Z' } };
  assert.equal(stockBootstrapPreflight(again).checkpointId, report.checkpointId);
  again.context.tasks[1].warehouse.accepted = 199;
  assert.notEqual(stockBootstrapPreflight(again).checkpointId, report.checkpointId);
  const changed = fixture(); changed.control._version = 'C1'; assert.notEqual(stockBootstrapPreflight(changed).checkpointId, report.checkpointId);
});
test('empty company creates no catalogue placeholders and ambiguous/foreign snapshot refuses', () => {
  const f = fixture(); f.context.tasks = []; const report = stockBootstrapPreflight(f); assert.deepEqual(report.counts, { positions: 0, claims: 0, products: 0 });
  const g = fixture(); g.context.activity = [{ _id: 'X', company: 'GHR' }]; assert.throws(() => stockBootstrapPreflight(g), /journal/);
  const h = fixture(); h.existing.complete = false; assert.throws(() => stockBootstrapPreflight(h), /Complete/);
});
