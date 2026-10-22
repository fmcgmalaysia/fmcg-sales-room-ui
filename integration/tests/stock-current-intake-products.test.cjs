const test = require('node:test'), assert = require('node:assert/strict');
const { appendIntakeProductCheckpoints } = require('../prototypes/stock-current-state/intake-product-checkpoint.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
function fixture() {
  const identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 };
  return { company: 'NCT', body: { destination: 'NCT', lines: [{ unitBarcode: '1', packingSize: '12', eaPerCtn: 12, itemName: 'Item' }] },
    generation: 10, plan: { writes: [{ collection: 'NCTActivity', before: null, after: { _id: 'ACCEPTED', action: 'ORDER_RECEIVED' } }] },
    productRows: [{ identity, row: null }] };
}
test('new product receives zero metadata once, existing product is neither reset nor relabelled', () => {
  const f = fixture(), created = appendIntakeProductCheckpoints(f), row = created.writes[0].after;
  assert.equal(row.stockKey, stockKey(f.productRows[0].identity)); assert.equal(row.onHand, 0); assert.equal(row.lifecycleVersion, 2);
  assert.equal(row.checkpointGeneration, 11); assert.equal(created.writes[1].after.action, 'ORDER_RECEIVED');
  f.productRows[0].row = { ...row, _version: 'P0', onHand: 900, name: 'KEEP', nextBorrowSequence: 777 };
  assert.deepEqual(appendIntakeProductCheckpoints(f), f.plan);
  assert.equal(f.productRows[0].row.onHand, 900); assert.equal(f.productRows[0].row.nextBorrowSequence, 777);
});
test('partial/duplicate/foreign/unversioned product reads never become fabricated zero', () => {
  for (const mutate of [f => { f.productRows = []; }, f => { f.productRows.push(f.productRows[0]); },
    f => { f.productRows[0].identity.company = 'GHR'; }, f => { f.productRows[0].row = {}; },
    f => { f.generation = Number.MAX_SAFE_INTEGER; }]) {
    const f = fixture(); mutate(f); assert.throws(() => appendIntakeProductCheckpoints(f));
  }
  const f = fixture(), key = stockKey(f.productRows[0].identity);
  f.productRows[0].row = { _id: hash('NCT', key), company: 'NCT', stockKey: key, lifecycleVersion: 2, nextBorrowSequence: 1 };
  assert.throws(() => appendIntakeProductCheckpoints(f), /checkpoint conflict/);
});
