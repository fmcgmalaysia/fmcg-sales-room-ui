const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { compareStockShadow } = require('../prototypes/stock-current-state/shadow-parity.cjs');
const { convertProjectedStock } = require('../prototypes/stock-current-state/current-model.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { projectStockCard } = load('stockCardProjection.js');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(n = 2, unknown = false) {
  const tasks = Array.from({ length: n }, (_, i) => ({ id: 'T' + i, company: 'NCT', customerId: 'PRIVATE-CUSTOMER-' + i,
    orderId: 'PRIVATE-ORDER-' + i, sourceLineId: 'L' + i, barcode: '1', name: 'PRIVATE-PRODUCT', packing: '12', ea: 12,
    ord: 10, requested: 10, po: 'PO' + i, poId: 'INTERNAL' + i, procurement: { totalCtn: 10, ...(unknown && i === 0 ? {} : { customerCtn: 10 }) },
    warehouse: { hasPhysicalReceipt: true, accepted: 10 } }));
  const expected = convertProjectedStock({ snapshot: projectStockCard({ company: 'NCT', tasks, activity: [] }), tasks, generation: 5 });
  const current = { ...copy(expected), complete: true, transfers: [] };
  for (const table of ['positions', 'claims', 'products']) for (const row of current[table]) { row._version = 'CURRENT'; row.revision = 2; }
  const controlBefore = { _id: hash('NCT', 'STOCK_CONTROL'), company: 'NCT', generation: 5, _version: 'CONTROL', mode: 'SHADOW', schemaVersion: 1, pending: null };
  return { company: 'NCT', expected, current, controlBefore, controlAfter: copy(controlBefore) };
}
test('exact source/claim/product parity is diagnostic only, independent of names and revision counters', () => {
  const f = fixture(); f.current.products[0].name = 'UPDATED DISPLAY'; const before = JSON.stringify(f);
  const result = compareStockShadow(f); assert.equal(result.status, 'PARITY_CONFIRMED_KNOWN'); assert.equal(result.parity, true); assert.equal(result.activationReady, false);
  assert.equal(result.differenceCount, 0);
  assert.equal(JSON.stringify(f), before);
  delete f.current.products[0].name; delete f.expected.products[0].name;
  assert.equal(compareStockShadow(f).dataFingerprint, result.dataFingerprint);
});
test('same grand total with wrong customer ownership fails without exposing customer values', () => {
  const f = fixture(); [f.current.claims[0].customerId, f.current.claims[1].customerId] = [f.current.claims[1].customerId, f.current.claims[0].customerId];
  const result = compareStockShadow(f);
  assert.equal(result.status, 'DIFFERENCE_REVIEW_REQUIRED'); assert.equal(result.differenceCount, 2);
  assert.equal(result.differences.every(d => d.field === 'customerId'), true);
  assert.equal(JSON.stringify(result).includes('PRIVATE-CUSTOMER'), false); assert.equal(JSON.stringify(result).includes('PRIVATE-PRODUCT'), false);
});
test('offset source discrepancies do not pass merely because cached grand total remains identical', () => {
  const f = fixture(); f.current.positions[0].onHand--; f.current.positions[1].onHand++;
  const result = compareStockShadow(f); assert.equal(result.parity, false);
  assert.ok(result.differences.some(d => d.reason === 'PHYSICAL_BALANCE_MISMATCH'));
});
test('source and claim aggregates are independently checked even if both compared caches are equally wrong', () => {
  const f = fixture(); f.current.products[0].onHand++; f.expected.products[0].onHand++;
  const result = compareStockShadow(f); assert.equal(result.parity, false); assert.ok(result.differences.some(d => d.reason === 'SOURCE_TOTAL_MISMATCH'));
  const g = fixture(); g.current.claims[0].reservedUsable--;
  assert.ok(compareStockShadow(g).differences.some(d => d.reason === 'CLAIM_TOTAL_MISMATCH'));
});
test('unknown parity remains Review Required and null cannot be replaced with zero', () => {
  const f = fixture(2, true), result = compareStockShadow(f);
  assert.equal(result.status, 'PARITY_WITH_REVIEW_REQUIRED'); assert.equal(result.activationReady, false);
  f.current.products[0].available = 0; assert.equal(compareStockShadow(f).parity, false);
});
test('changed, pending, wrong-generation, active and relation-unaware snapshots never certify parity', () => {
  for (const [mutate, status] of [[f => { f.controlAfter._version = 'OTHER'; }, 'SNAPSHOT_CHANGED_RECHECK'],
    [f => { f.controlBefore.pending = f.controlAfter.pending = { key: 'P', digest: 'D' }; }, 'SAVE_PENDING_STAY_BLOCKED'],
    [f => { f.current.generation = 4; }, 'GENERATION_MISMATCH'],
    [f => { f.controlBefore.mode = f.controlAfter.mode = 'ACTIVE'; }, 'MODE_NOT_ELIGIBLE'],
    [f => { f.current.transfers.push({ _id: 'RELATION' }); }, 'RELATION_AWARE_BASELINE_REQUIRED']]) {
    const f = fixture(); mutate(f); const result = compareStockShadow(f); assert.equal(result.status, status); assert.equal(result.parity, false);
  }
});
test('missing rows, malformed scope and unversioned current metadata do not silently disappear', () => {
  const f = fixture(); f.current.claims.pop(); assert.equal(compareStockShadow(f).parity, false);
  const g = fixture(); g.current.positions[0].company = 'GHR'; assert.throws(() => compareStockShadow(g), /identity/);
  const h = fixture(); delete h.current.products[0]._version; assert.ok(compareStockShadow(h).differences.some(d => d.reason === 'CURRENT_METADATA_INVALID'));
  const i = fixture(); i.current.complete = false; assert.throws(() => compareStockShadow(i), /Complete/);
});
test('offline1000-source comparison preserves every customer difference while report is bounded', () => {
  const f = fixture(1000); assert.equal(compareStockShadow(f).status, 'PARITY_CONFIRMED_KNOWN');
  for (const claim of f.current.claims) claim.customerId = 'WRONG';
  const result = compareStockShadow(f); assert.equal(result.differenceCount, 1000); assert.equal(result.differences.length, 100); assert.equal(result.parity, false);
});
