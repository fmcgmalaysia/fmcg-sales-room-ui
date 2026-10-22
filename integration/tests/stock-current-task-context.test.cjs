const test = require('node:test'), assert = require('node:assert/strict');
const { currentTaskContext } = require('../prototypes/stock-current-state/current-task-context.cjs');
function fixture() {
  return { company: 'NCT', generation: 8, context: { company: 'NCT', activity: [], tasks: [{ id: 'A', orderId: 'O', sourceLineId: 'L',
    po: 'KEEP', requested: 100, stockDispatchedCumulative: 9999 }] }, taskRows: [{ _id: 'A', company: 'NCT', description: 'O', imageAltText: 'L',
    _version: 'T8', stockCounterSchema: 2, stockCounterGeneration: 7, stockDispatchedCumulative: 20 }] };
}
test('original projection retains business fields, exact raw checkpoint replaces forged/stale projected count', () => {
  const f = fixture(), result = currentTaskContext(f);
  assert.equal(result.tasks[0].stockDispatchedCumulative, 20); assert.equal(result.tasks[0].stockCommitVersion, 'T8');
  assert.equal(result.tasks[0].po, 'KEEP'); assert.equal(f.context.tasks[0].stockDispatchedCumulative, 9999);
});
test('missing/versionless/foreign/mismatched/future checkpoints stop instead of replaying old dispatch history', () => {
  for (const mutate of [f => { f.taskRows = []; }, f => { delete f.taskRows[0]._version; },
    f => { f.taskRows[0].company = 'GHR'; }, f => { f.taskRows[0].imageAltText = 'OTHER'; },
    f => { f.taskRows[0].stockDispatchedCumulative = null; }, f => { f.taskRows[0].stockCounterGeneration = 9; },
    f => { f.taskRows[0].stockCommitVersion = 'CONFLICT'; }, f => { f.taskRows.push(f.taskRows[0]); }]) {
    const f = fixture(); mutate(f); assert.throws(() => currentTaskContext(f));
  }
});
