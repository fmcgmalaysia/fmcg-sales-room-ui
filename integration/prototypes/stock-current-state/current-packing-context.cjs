'use strict';

const { validate } = require('./borrowing-model.cjs');
const { hash } = require('./commit-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
// Original packing context keeps its identity, legacy guards, chats and language.
// Only quantity authority switches to complete server current-state snapshots.
function currentPackingContext({ context, states }) {
  if (!['NCT', 'GHR'].includes(context?.company) || !context.sourceVersion || !Array.isArray(context.tasks)
    || !Array.isArray(context.lists) || !Array.isArray(states)) throw Error('Original server packing context required');
  const tasks = new Map();
  for (const state of states) {
    validate(state);
    if (state.company !== context.company) throw Error('Packing current company conflict');
    for (const task of state.tasks) {
      if (tasks.has(task.id)) throw Error('Packing current task is ambiguous');
      tasks.set(task.id, { task, ready: state.sources.reduce((n, s) => n + (s.claims[task.id] || 0), 0),
        isolated: state.sources.reduce((n, s) => n + (s.isolatedClaims?.[task.id] || 0), 0) });
    }
  }
  if (new Set(context.tasks.map(t => t.taskId)).size !== context.tasks.length) throw Error('Original packing task is ambiguous');
  const result = copy(context);
  if ([...tasks.values()].some(row => row.isolated > 0) || context.lists.some(list => list.stockDamageReviewRequired === true)) result.stockDamageVersion = 1;
  result.tasks = context.tasks.map(row => {
    const current = tasks.get(row.taskId);
    if (!current || row.company !== context.company || current.task.customerId !== row.customerId
      || row.remaining !== current.task.requested - current.task.dispatched) throw Error('Exact packing demand provenance required');
    return { ...copy(row), ready: current.ready, remaining: current.task.requested - current.task.dispatched,
      ...(current.isolated > 0 ? { stockDamageIsolation: current.isolated } : {}) };
  });
  result.sourceVersion = hash(context.sourceVersion, states.map(s => [s.barcode, s.packing, s.ea, s.revision, s.packingHolds.version])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  return result;
}
module.exports = { currentPackingContext };
