const test = require('node:test'), assert = require('node:assert/strict');
const { rollForwardProduct } = require('../prototypes/stock-current-state/product-delta.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const identity = { company: 'NCT', barcode: '1', packing: '12x1', ea: 12 };
const source = (id, n, reserved = n) => ({ ...identity, id, onHand: n, available: n - reserved, isolated: 0, claims: { A: reserved } });
function fixture() {
  const key = stockKey(identity);
  return { identity, product: { _id: hash('NCT', key), company: 'NCT', stockKey: key, _version: 'P0', revision: 10,
    onHand: 10000, reservedUsable: 8000, available: 1500, isolated: 500, reviewRequired: false, reviewCodes: [], lifecycleVersion: 2, nextBorrowSequence: 51 },
    beforeSources: [source('S1', 100, 70)], afterSources: [source('S1', 130, 90)], generation: 20, revision: 10,
    lifecycle: { version: 2, nextBorrowSequence: 51 } };
}
test('affected source delta preserves all unrelated current stock, including isolation, without history scan', () => {
  const f = fixture(), next = rollForwardProduct(f);
  assert.equal(next.onHand, 10030); assert.equal(next.reservedUsable, 8020); assert.equal(next.available, 1510); assert.equal(next.isolated, 500);
  assert.equal(next.revision, 11); assert.equal(next.checkpointGeneration, 21);
  assert.equal(f.product.onHand, 10000); assert.equal(next.nextBorrowSequence, 51);
});
test('receipt, dispatch and ownership-only deltas preserve product physical balance', () => {
  const f = fixture(); let current = f.product;
  for (const [before, after] of [[source('S1', 100), source('S1', 130)], [source('S1', 130), source('S1', 90)],
    [source('S1', 90), source('S1', 90, 50)]]) {
    current = rollForwardProduct({ ...f, product: current, revision: current.revision, beforeSources: [before], afterSources: [after] });
    assert.equal(current.onHand, current.reservedUsable + current.available + current.isolated);
  }
  assert.equal(current.onHand, 9990); assert.equal(current.available, 1540);
});
test('unknown/missing/stale product, changed source identity, underflow and sequence reversal reject', () => {
  for (const mutate of [f => { f.product.onHand = null; }, f => { f.product.reviewRequired = true; },
    f => { f.product.revision--; }, f => { f.afterSources[0].id = 'other'; },
    f => { f.product = null; }, f => { f.lifecycle.nextBorrowSequence = 1; }, f => { f.lifecycle = null; },
    f => { f.product.available = 10; f.product.reservedUsable = 9490; },
    f => { f.product.available = 0; f.product.reservedUsable = 9500; f.afterSources = [source('S1', 70)]; }]) {
    const f = fixture(); mutate(f); assert.throws(() => rollForwardProduct(f));
  }
});
