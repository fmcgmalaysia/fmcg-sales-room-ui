const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { quoteBorrowOptions } = require('../prototypes/stock-current-state/purchase-borrow-options.cjs');
const { approveBorrow } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const source = fs.readFileSync(require.resolve('./stock-current-borrowing.test.cjs'), 'utf8');
const fixture = vm.runInNewContext('(' + source.slice(source.indexOf('function fixture()'), source.indexOf('\nconst approval')) + ')', {
  identity: { company: 'NCT', barcode: '0001', packing: '24x1', ea: 24 }
});
test('quoted maxima match actual borrower demand, donor reserved and uncommitted replacement PO rules', () => {
  let state = fixture(); const before = JSON.stringify(state);
  const quoted = quoteBorrowOptions({ state, borrowerTaskId: 'A' });
  assert.equal(quoted.options.length, 2); assert.ok(quoted.options.every(o => o.maximumQuantity === 100));
  assert.equal(JSON.stringify(state), before);
  state = approveBorrow(state, { expectedRevision: 0, id: 'FIRST', quantity: 30, borrowerTaskId: 'A', lenderSourceId: 'S-B',
    replacementSourceId: 'S-A', approvedBy: 'PURCHASE', reason: 'First container' }).after;
  assert.ok(quoteBorrowOptions({ state, borrowerTaskId: 'A' }).options.every(o => o.maximumQuantity === 70));
});
test('no own PO, customer lock or packing hold yields no false borrowable option; unknown state throws', () => {
  let state = fixture(); state.sources = state.sources.filter(s => s.ownerTaskId !== 'A');
  assert.equal(quoteBorrowOptions({ state, borrowerTaskId: 'A' }).options.length, 0);
  state = fixture(); state.packingHolds.heldByTask.B = 1;
  assert.equal(quoteBorrowOptions({ state, borrowerTaskId: 'A', blockedTaskIds: ['C'] }).options.length, 0);
  state = fixture(); state.sources[1].onHand = 999;
  assert.throws(() => quoteBorrowOptions({ state, borrowerTaskId: 'A' }), /balance|provenance/i);
  assert.throws(() => quoteBorrowOptions({ state: fixture(), borrowerTaskId: 'A', maxPairs: 1 }), /fanout/);
});
