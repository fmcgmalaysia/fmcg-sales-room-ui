const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { quoteUnusedBorrowReturn } = require('../prototypes/stock-current-state/purchase-borrow-return-options.cjs');
const { approveBorrow, returnUnusedBorrow, dispatch, receive } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const source = fs.readFileSync(require.resolve('./stock-current-borrowing.test.cjs'), 'utf8');
const fixture = vm.runInNewContext('('+source.slice(source.indexOf('function fixture()'), source.indexOf('\nconst approval'))+')',
  { identity: { company: 'NCT', barcode: '0001', packing: '24x1', ea: 24 } });
const borrowed = () => approveBorrow(fixture(), { expectedRevision: 0, id: 'R', quantity: 30, lenderSourceId: 'S-B', replacementSourceId: 'S-A',
  borrowerTaskId: 'A', approvedBy: 'P', reason: 'Fill container' }).after;

test('unused return quote uses current claims and remaining debt without mutation; partial return and repayment lower its cap', () => {
  let state = borrowed(), before = JSON.stringify(state), quote = quoteUnusedBorrowReturn({ state, relationId: 'R' });
  assert.equal(quote.maximumQuantity, 30); assert.equal(quote.expectedRevision, 1); assert.equal(quote.borrowerTaskId, 'A');
  assert.equal(JSON.stringify(state), before);
  state = returnUnusedBorrow(state, { expectedRevision: 1, relationId: 'R', quantity: 10, approvedBy: 'P', reason: 'Unused cartons' }).after;
  quote = quoteUnusedBorrowReturn({ state, relationId: 'R' }); assert.equal(quote.maximumQuantity, 20); assert.equal(quote.remaining, 20);
  state = receive(state, { expectedRevision: 2, sourceId: 'S-A', cumulativeAccepted: 5 }).after;
  quote = quoteUnusedBorrowReturn({ state, relationId: 'R' }); assert.equal(quote.maximumQuantity, 15); assert.equal(quote.remaining, 15);
});

test('loaded/packed/legacy-held/already-dispatched borrowed stock cannot be quoted as returnable; unknown state is never zero', () => {
  for (const who of ['A', 'B']) {
    const state = borrowed(); state.packingHolds.heldByTask[who] = 1;
    const result = quoteUnusedBorrowReturn({ state, relationId: 'R' }); assert.equal(result.maximumQuantity, 0); assert.equal(result.remaining, 30);
  }
  const legacy = borrowed(); legacy.packingHolds.legacyBlockedByTask = { A: true };
  assert.equal(quoteUnusedBorrowReturn({ state: legacy, relationId: 'R' }).maximumQuantity, 0);
  const shipped = dispatch(borrowed(), { expectedRevision: 1, taskId: 'A', sourceId: 'S-B', quantity: 1 }).after;
  assert.equal(quoteUnusedBorrowReturn({ state: shipped, relationId: 'R' }).maximumQuantity, 0);
  assert.equal(quoteUnusedBorrowReturn({ state: shipped, relationId: 'R' }).remaining, 30);
  assert.throws(() => quoteUnusedBorrowReturn({ state: borrowed(), relationId: 'UNKNOWN' }), /unavailable/);
  const broken = borrowed(); broken.sources[1].onHand = 999; assert.throws(() => quoteUnusedBorrowReturn({ state: broken, relationId: 'R' }));
});
