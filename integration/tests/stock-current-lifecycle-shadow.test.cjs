const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { compareStockLifecycleShadow } = require('../prototypes/stock-current-state/lifecycle-shadow-parity.cjs');
const { compareStockShadow } = require('../prototypes/stock-current-state/shadow-parity.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const file = require.resolve('./stock-current-lifecycle-bootstrap.test.cjs');
const factory = vm.runInNewContext(fs.readFileSync(file, 'utf8').replace("const test = require('node:test')", 'const test = () => {}') + ';fixture;', { require: createRequire(file) });
const ghrFactory = vm.runInNewContext(fs.readFileSync(file, 'utf8').replace("const test = require('node:test')", 'const test = () => {}')
  .replaceAll("'NCT'", 'company') + ';fixture;', { require: createRequire(file), company: 'GHR' });
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(company = 'NCT') {
  const f = company === 'NCT' ? factory() : ghrFactory(), expected = copy(f.prepare()), control = { ...copy(f.args.control), transferIndexVersion: 2 };
  const taskRows = f.taskRows.map(row => ({ ...copy(row), ...expected.taskInitializations.find(t => t.id === row._id).fields, _version: 'MIGRATED' }));
  return { company, expected, legacyTaskRows: copy(f.taskRows), current: { company, generation: 0, complete: true,
    ...copy(expected.rows), transfers: [], taskRowsComplete: true, taskRows }, controlBefore: control, controlAfter: copy(control) };
}
test('complete initial lifecycle parity includes zero real-order product, physical220/free20 and exact original task images, never activation', () => {
  for (const company of ['NCT', 'GHR']) {
    const f = fixture(company), before = JSON.stringify(f), result = compareStockLifecycleShadow(f);
    assert.equal(result.status, 'LIFECYCLE_PARITY_CONFIRMED_KNOWN'); assert.equal(result.parity, true);
    assert.equal(result.lifecycleVerified, true); assert.equal(result.activationReady, false); assert.equal(result.differenceCount, 0);
    assert.equal(JSON.stringify(f), before); assert.doesNotMatch(JSON.stringify(result), /manualCostField|Original supplier|Item|KEEP/);
  }
});
test('retained counterexample: legacy physical shadow ignores broken lifetime metadata, new v2 check refuses each case', () => {
  for (const [table, field, value] of [['positions', 'borrowRepaidCumulative', 1], ['claims', 'dispatchedCumulative', 20],
    ['products', 'lifecycleVersion', 1], ['products', 'nextBorrowSequence', 2]]) {
    const f = fixture(); f.current[table][0][field] = value;
    assert.equal(compareStockShadow({ ...f, expected: { company: 'NCT', generation: 0, ...f.expected.rows } }).parity, true, 'old comparator is not v2 authority');
    const result = compareStockLifecycleShadow(f); assert.equal(result.parity, false); assert.equal(result.activationReady, false);
    assert.ok(result.differences.some(d => d.field === field && d.reason === 'LIFECYCLE_COUNTER_MISMATCH'));
  }
});
test('missing/foreign/version-conflicting task or altered PO/cost/quantity cannot pass while aggregate stock is unchanged', () => {
  for (const kind of ['missing', 'extra', 'company', 'version', 'counter', 'po', 'cost', 'quantity']) {
    const f = fixture(), row = f.current.taskRows[0];
    if (kind === 'missing') f.current.taskRows.pop();
    if (kind === 'extra') f.current.taskRows.push({ _id: 'UNEXPECTED', company: 'NCT', _version: 'V0', stockDispatchedCumulative: 0 });
    if (kind === 'company') row.company = 'GHR';
    if (kind === 'version') row.stockCommitVersion = 'CONFLICT';
    if (kind === 'counter') row.stockDispatchedCumulative = 20;
    if (kind === 'po') row.ourPoNumber = 'CHANGED';
    if (kind === 'cost') row.manualCostField = ['WRONG'];
    if (kind === 'quantity') row.purchaseQtyInCtn = 10;
    const result = compareStockLifecycleShadow(f); assert.equal(result.parity, false, kind); assert.equal(result.lifecycleVerified, false);
    assert.doesNotMatch(JSON.stringify(result), /:"CHANGED"|:"WRONG"|\["WRONG"\]/);
  }
});
test('same equally wrong claim/task counters still fail independent cumulative source totals', () => {
  const f = fixture(), expectedClaim = f.expected.rows.claims[0], currentClaim = f.current.claims[0];
  expectedClaim.dispatchedCumulative = currentClaim.dispatchedCumulative = 20;
  const id = expectedClaim.taskId; f.expected.taskInitializations.find(t => t.id === id).fields.stockDispatchedCumulative = 20;
  f.current.taskRows.find(t => t._id === id).stockDispatchedCumulative = 20;
  const result = compareStockLifecycleShadow(f); assert.equal(result.parity, false);
  assert.ok(result.differences.some(d => d.reason === 'CURRENT_CLAIM_DISPATCH_TOTAL_MISMATCH'));
});
test('changed/pending/ACTIVE/relation snapshots and unverified index never certify initial v2 parity', () => {
  for (const kind of ['changed', 'pending', 'active', 'relation', 'index']) {
    const f = fixture();
    if (kind === 'changed') f.controlAfter._version = 'OTHER';
    if (kind === 'pending') f.controlBefore.pending = f.controlAfter.pending = { key: 'P' };
    if (kind === 'active') f.controlBefore.mode = f.controlAfter.mode = 'ACTIVE';
    if (kind === 'relation') f.current.transfers.push({ _id: 'NOT_AN_INITIAL_BASELINE' });
    if (kind === 'index') f.controlBefore.transferIndexVersion = f.controlAfter.transferIndexVersion = 1;
    assert.equal(compareStockLifecycleShadow(f).parity, false, kind);
  }
});
test('incomplete raw evidence, duplicate actual tasks and corrupted initial baselines reject without projection or writes', () => {
  for (const kind of ['raw', 'duplicate', 'complete', 'generation', 'sequence', 'repayment']) {
    const f = fixture();
    if (kind === 'raw') f.legacyTaskRows[0].ourPoNumber = 'TAMPER';
    if (kind === 'duplicate') f.current.taskRows.push(copy(f.current.taskRows[0]));
    if (kind === 'complete') f.current.taskRowsComplete = false;
    if (kind === 'generation') f.expected.taskInitializations[0].fields.stockCounterGeneration = 1;
    if (kind === 'sequence') f.expected.rows.products[0].nextBorrowSequence = 2;
    if (kind === 'repayment') f.expected.rows.positions[0].borrowRepaidCumulative = 1;
    assert.throws(() => compareStockLifecycleShadow(f), undefined, kind);
  }
});
test('fingerprint binds counters and original business image, not native metadata or key order in current rows', () => {
  const f = fixture(), first = compareStockLifecycleShadow(f);
  f.current.taskRows.forEach(row => { row._updatedDate = 'SYSTEM'; row._owner = 'SYSTEM'; });
  f.current.taskRows = f.current.taskRows.map(row => Object.fromEntries(Object.entries(row).reverse()));
  assert.equal(compareStockLifecycleShadow(f).dataFingerprint, first.dataFingerprint);
  f.current.taskRows[0].manualCostField = ['WRONG']; assert.notEqual(compareStockLifecycleShadow(f).dataFingerprint, first.dataFingerprint);
});
test('empty complete company remains empty and review parity remains Review, never fabricated zero or activation', () => {
  const f = fixture(); f.expected.rows = { positions: [], claims: [], products: [] }; f.expected.taskInitializations = []; f.legacyTaskRows = [];
  Object.assign(f.current, { positions: [], claims: [], products: [], taskRows: [] });
  assert.equal(compareStockLifecycleShadow(f).status, 'LIFECYCLE_PARITY_CONFIRMED_KNOWN');
  const g = fixture(); for (const rows of [g.expected.rows.positions, g.current.positions]) rows[0].reviewCodes = ['REVIEW'];
  for (const rows of [g.expected.rows.products, g.current.products]) rows[0].reviewRequired = true;
  const result = compareStockLifecycleShadow(g); assert.equal(result.status, 'LIFECYCLE_PARITY_WITH_REVIEW_REQUIRED'); assert.equal(result.activationReady, false);
});
test('real historical partial and fully CLOSED dispatched claims initialize exact task/source cumulative parity', () => {
  for (const quantity of [20, 200]) {
    const legacy = factory(), lines = [{ taskId: 'B', orderId: 'O-B', sourceLineId: 'L-B', barcode: '1', packing: '12', quantity,
      sources: [{ sourceTaskId: 'B', quantity }] }], shipment = { id: 'S', company: 'NCT', customerId: 'C-B', currency: 'USD', lines };
    legacy.context.activity.push(...['REQUESTED', 'INVOICED', 'DISPATCHED'].map((status, i) => ({ _id: 'E' + i, title: 'E' + i,
      description: 'S', image: 'C-B', action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED', activityTime: '2026-10-22T05:00:0' + i + 'Z',
      details: { beforeRevision: i ? 'E' + (i-1) : '', shipment: { ...shipment, status,
        ...(i ? { invoice: { number: 'INV', amountCents: 100, currency: 'USD', rateToMyr: 4 } } : {}),
        ...(i === 2 ? { dispatch: { reference: 'OUT' } } : {}) } } })));
    const expected = copy(legacy.prepare()), f = fixture(); f.expected = expected; f.legacyTaskRows = copy(legacy.taskRows);
    Object.assign(f.current, copy(expected.rows), { taskRows: legacy.taskRows.map(row => ({ ...copy(row),
      ...expected.taskInitializations.find(t => t.id === row._id).fields, _version: 'MIGRATED' })) });
    assert.equal(f.current.claims.filter(row => row.taskId === 'B').reduce((sum, row) => sum + row.dispatchedCumulative, 0), quantity);
    assert.equal(compareStockLifecycleShadow(f).status, 'LIFECYCLE_PARITY_CONFIRMED_KNOWN');
    if (quantity === 200) assert.ok(f.current.claims.some(row => row.taskId === 'B' && row.dispatchedCumulative === 200 && row.status === 'CLOSED'));
  }
});
test('non-string current stock versions are not validated merely because an old physical-only comparison accepted truthy metadata', () => {
  const f = fixture(); f.current.positions[0]._version = 123;
  assert.equal(compareStockShadow({ ...f, expected: { company: 'NCT', generation: 0, ...f.expected.rows } }).parity, true);
  assert.ok(compareStockLifecycleShadow(f).differences.some(d => d.reason === 'CURRENT_LIFECYCLE_METADATA_INVALID'));
});
test('lifecycle discrepancy report stays bounded without hiding the actual discrepancy count', () => {
  const f = fixture();
  for (let i = 0; i < 300; i++) f.current.taskRows.push({ _id: 'EXTRA-' + i, company: 'NCT', _version: 'V0', stockDispatchedCumulative: 0 });
  const result = compareStockLifecycleShadow(f);
  assert.equal(result.parity, false); assert.equal(result.differenceCount, 300); assert.equal(result.differences.length, 100);
});
