'use strict';

const { copy } = require('./segmented-plan.cjs');
const count = n => Number.isSafeInteger(n) && n >= 0;
// Original projection remains business authority. Add ONLY exact migrated/current
// task counters which that legacy projection does not expose. No history fallback.
function currentTaskContext({ company, context, taskRows, generation }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks)
    || !Array.isArray(taskRows) || !count(generation)) throw Error('Private current task context required');
  const rows = new Map(taskRows.map(row => [row._id, row]));
  if (rows.size !== taskRows.length || rows.size !== context.tasks.length
    || new Set(context.tasks.map(task => task.id)).size !== context.tasks.length) throw Error('Complete exact current task reads required');
  return { ...copy(context), tasks: context.tasks.map(task => {
    const row = rows.get(task.id), version = row?._version || row?.stockCommitVersion;
    if (!row || row.company !== company || typeof version !== 'string' || !version
      || row._version && row.stockCommitVersion && row._version !== row.stockCommitVersion
      || row.stockCounterSchema !== 2 || !count(row.stockDispatchedCumulative) || !count(row.stockCounterGeneration)
      || row.stockCounterGeneration > generation || row.description !== task.orderId || row.imageAltText !== task.sourceLineId) throw Error('Current task checkpoint missing or changed');
    return { ...copy(task), stockCounterSchema: 2, stockDispatchedCumulative: row.stockDispatchedCumulative,
      stockCounterGeneration: row.stockCounterGeneration, stockCommitVersion: version };
  }) };
}
module.exports = { currentTaskContext };
