'use strict';

const { validate, cumulativeTargets } = require('./borrowing-model.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
// Compatibility VIEW only, never an independent writer or a synthetic stored event.
// Current physical ownership + actual dispatched provenance is authoritative at ACTIVE.
// Existing allocation revision is kept for the original append-only history chain.
function currentAllocationContext({ state, context, readAllocations }) {
  validate(state);
  if (context.company !== state.company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
    || typeof readAllocations !== 'function' || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Original authenticated allocation context required');
  const prior = readAllocations(context.activity), currentSources = new Set(state.sources.map(s => s.id));
  const tasks = new Map(state.tasks.map(t => [t.id, t]));
  for (const task of state.tasks) {
    const original = context.tasks.find(t => t.id === task.id);
    if (!original || original.customerId !== task.customerId || original.orderId !== task.orderId || original.sourceLineId !== task.sourceLineId
      || original.barcode !== state.barcode || original.packing !== state.packing || original.ea !== state.ea
      || (original.requested ?? original.ord) !== task.requested) throw Error('Current demand and original task identity differ');
  }
  const converted = state.sources.map(source => {
    const old = prior.find(a => a.sourceTaskId === source.id);
    return { sourceTaskId: source.id, revision: old?.revision || '', at: old?.at || null, by: old?.by || '',
      targets: cumulativeTargets(state, source.id).map(target => {
        const task = tasks.get(target.taskId);
        return { ...target, orderId: task.orderId, sourceLineId: task.sourceLineId, customerId: task.customerId };
      }) };
  });
  return { ...clone(context), allocations: [...prior.filter(a => !currentSources.has(a.sourceTaskId)), ...converted],
    tasks: context.tasks.map(original => {
      const task = tasks.get(original.id);
      if (!task) return clone(original);
      // Original inc/customerReceived contract is cumulative, NOT current onHand.
      const inc = (task.dispatchedOutsideScope || 0) + converted.reduce((n, a) => n + (a.targets.find(t => t.taskId === task.id)?.quantity || 0), 0);
      return { ...clone(original), inc };
    }) };
}
module.exports = { currentAllocationContext };
