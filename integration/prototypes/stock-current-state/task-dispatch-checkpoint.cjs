'use strict';

const { same, copy } = require('./segmented-plan.cjs');
const count = n => Number.isSafeInteger(n) && n >= 0;
// Exact normalized domain rows from private store, never projected/browser tasks.
// Caller includes this plan in the SAME stock fence; does not write separately.
function appendTaskDispatchCheckpoints({ company, plan, products, states, taskRows, generation }) {
  if (!['NCT', 'GHR'].includes(company) || !Array.isArray(plan?.writes) || !Array.isArray(products)
    || !Array.isArray(states) || !Array.isArray(taskRows) || !count(generation)) throw Error('Private dispatch checkpoint context required');
  const collection = company === 'NCT' ? 'NCTTasks' : 'NCTTasks1', result = copy(plan);
  const exact = new Map(taskRows.map(row => [row._id, row]));
  if (exact.size !== taskRows.length) throw Error('Duplicate exact dispatch task');
  const consumed = new Set();
  for (let index = 0; index < products.length; index++) {
    const before = products[index].state, after = states[index];
    if (before?.lifecycleVersion !== 2 || after?.lifecycleVersion !== 2 || before.company !== company || after.company !== company
      || before.tasks.length !== after.tasks.length) throw Error('Dispatch lifecycle checkpoint required');
    for (const task of before.tasks) {
      const next = after.tasks.find(t => t.id === task.id);
      if (!next || !count(task.dispatched) || !count(next.dispatched) || next.dispatched < task.dispatched) throw Error('Dispatch task identity/cumulative conflict');
      if (next.dispatched === task.dispatched) continue;
      const row = exact.get(task.id);
      if (!row || consumed.has(task.id) || row.company !== company || !row._version || row.stockCounterSchema !== 2
        || row.stockDispatchedCumulative !== task.dispatched || !count(row.stockCounterGeneration) || row.stockCounterGeneration > generation) throw Error('Exact task dispatch checkpoint stale');
      consumed.add(task.id);
      const existing = result.writes.find(w => w.collection === collection && w.after._id === task.id);
      if (existing && !same(existing.before, row)) throw Error('Dispatch task writer conflict');
      const checkpoint = { stockCounterSchema: 2, stockDispatchedCumulative: next.dispatched, stockCounterGeneration: generation + 1 };
      if (existing) Object.assign(existing.after, checkpoint);
      else result.writes.push({ collection, before: copy(row), after: { ...copy(row), ...checkpoint } });
    }
  }
  if (consumed.size !== exact.size) throw Error('Unrelated exact dispatch task rows');
  return result;
}
module.exports = { appendTaskDispatchCheckpoints };
