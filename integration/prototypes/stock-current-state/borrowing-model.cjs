'use strict';

// Isolated business specification. Complete, trusted product snapshots only.
// No CMS access or production authorization: caller must retain real permission,
// PO validity, financial locks, packing guards and conditional commit validation.
const { stockKey } = require('./current-model.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const count = n => Number.isSafeInteger(n) && n >= 0;
const positive = n => count(n) && n > 0;
const sum = values => {
  const result = values.reduce((a, b) => a + b, 0);
  if (!count(result)) throw Error('Quantity overflow');
  return result;
};
const reserved = (state, taskId) => sum(state.sources.map(s => s.claims[taskId] || 0));
const remaining = relation => relation.quantity - relation.repaid;
const outgoing = (state, sourceId) => sum(state.relations.filter(r => r.replacementSourceId === sourceId).map(remaining));
const incoming = (state, taskId) => sum(state.relations.filter(r => r.lenderTaskId === taskId).map(remaining));
function validate(state) {
  if (state.complete !== true || !count(state.revision) || !Array.isArray(state.tasks)
    || !Array.isArray(state.sources) || !Array.isArray(state.relations)) throw Error('Complete snapshot required');
  const key = stockKey(state), tasks = new Map(), sources = new Map(), ids = new Set(), sequences = new Set();
  for (const task of state.tasks) {
    if (!task.id || tasks.has(task.id) || !task.customerId || !count(task.requested) || !count(task.dispatched)
      || task.dispatched > task.requested || stockKey(task) !== key) throw Error('Task identity or demand conflict');
    tasks.set(task.id, task);
  }
  for (const source of state.sources) {
    if (!source.id || sources.has(source.id) || !tasks.has(source.ownerTaskId) || !source.poId
      || source.poValid !== true || stockKey(source) !== key || source.reviewRequired !== false
      || !['planned', 'accepted', 'onHand', 'isolated', 'available'].every(k => count(source[k]))
      || source.accepted > source.planned || !source.claims || !source.held) throw Error('Source identity or balance conflict');
    for (const [taskId, qty] of Object.entries(source.claims)) {
      if (!tasks.has(taskId) || !count(qty)) throw Error('Claim conflict');
    }
    for (const [taskId, qty] of Object.entries(source.held)) {
      if (!count(qty) || qty > (source.claims[taskId] || 0)) throw Error('Confirmed source hold required');
    }
    for (const [taskId, qty] of Object.entries(source.dispatchedByTask || {})) {
      if (!tasks.has(taskId) || !count(qty)) throw Error('Dispatch provenance conflict');
    }
    if (source.onHand !== sum([source.available, source.isolated, ...Object.values(source.claims)])) throw Error('Physical balance conflict');
    if (sum([source.onHand, ...Object.values(source.dispatchedByTask || {})]) !== source.accepted) throw Error('Receipt/dispatch provenance conflict');
    sources.set(source.id, source);
  }
  for (const relation of state.relations) {
    const from = sources.get(relation.lenderSourceId), future = sources.get(relation.replacementSourceId);
    if (!relation.id || ids.has(relation.id) || !positive(relation.sequence) || sequences.has(relation.sequence)
      || !from || !future || from.id === future.id || !positive(relation.quantity) || !count(relation.repaid)
      || relation.repaid > relation.quantity || !relation.approvedBy || !relation.reason
      || from.ownerTaskId !== relation.lenderTaskId || future.ownerTaskId !== relation.borrowerTaskId
      || relation.borrowerTaskId === relation.lenderTaskId
      || tasks.get(relation.borrowerTaskId).customerId === tasks.get(relation.lenderTaskId).customerId) throw Error('Borrowing relation conflict');
    ids.add(relation.id); sequences.add(relation.sequence);
  }
  for (const task of state.tasks) {
    if (sum(state.sources.map(s => s.dispatchedByTask?.[task.id] || 0)) !== task.dispatched) throw Error('Task dispatch provenance conflict');
    if (sum([task.dispatched, reserved(state, task.id), incoming(state, task.id)]) > task.requested) throw Error('Customer coverage exceeded');
  }
  for (const source of state.sources) {
    if (outgoing(state, source.id) > source.planned - source.accepted) throw Error('Future supply already committed');
  }
  return state;
}
function transition(before, expectedRevision, change) {
  validate(before);
  if (before.revision !== expectedRevision) throw Error('Snapshot changed');
  const after = clone(before);
  change(after);
  after.revision += 1;
  validate(after);
  return { beforeRevision: expectedRevision, after };
}
function approveBorrow(before, input) {
  return transition(before, input.expectedRevision, state => {
    if (!positive(input.quantity) || !input.id || state.relations.some(r => r.id === input.id)
      || !String(input.approvedBy || '').trim() || !String(input.reason || '').trim()) throw Error('Approval evidence required');
    const donor = state.sources.find(s => s.id === input.lenderSourceId);
    const future = state.sources.find(s => s.id === input.replacementSourceId);
    const borrower = state.tasks.find(t => t.id === input.borrowerTaskId);
    if (!donor || !future || !borrower || future.ownerTaskId !== borrower.id || donor.ownerTaskId === borrower.id
      || sum(state.sources.map(s => s.held[borrower.id] || 0)) !== 0) throw Error('Eligible unheld borrower required');
    const lender = donor.ownerTaskId;
    if (input.quantity > (donor.claims[lender] || 0) - (donor.held[lender] || 0)
      || input.quantity > future.planned - future.accepted - outgoing(state, future.id)
      || input.quantity > borrower.requested - borrower.dispatched - reserved(state, borrower.id) - incoming(state, borrower.id)) throw Error('Insufficient eligible stock, demand or future supply');
    donor.claims[lender] -= input.quantity;
    donor.claims[borrower.id] = (donor.claims[borrower.id] || 0) + input.quantity;
    const sequence = Math.max(0, ...state.relations.map(r => r.sequence)) + 1;
    state.relations.push({ id: input.id, sequence, lenderSourceId: donor.id, replacementSourceId: future.id,
      lenderTaskId: lender, borrowerTaskId: borrower.id, quantity: input.quantity, repaid: 0,
      approvedBy: input.approvedBy, reason: input.reason });
  });
}
function receive(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    if (!source || !count(input.cumulativeAccepted) || input.cumulativeAccepted < source.accepted
      || input.cumulativeAccepted > source.planned) throw Error('Validated accepted receipt required');
    let left = input.cumulativeAccepted - source.accepted;
    source.accepted = input.cumulativeAccepted;
    source.onHand += left;
    for (const relation of state.relations.filter(r => r.replacementSourceId === source.id).sort((a, b) => a.sequence - b.sequence)) {
      const take = Math.min(left, remaining(relation));
      source.claims[relation.lenderTaskId] = (source.claims[relation.lenderTaskId] || 0) + take;
      relation.repaid += take;
      left -= take;
    }
    const owner = state.tasks.find(t => t.id === source.ownerTaskId);
    const need = owner.requested - owner.dispatched - reserved(state, owner.id) - incoming(state, owner.id);
    const own = Math.min(left, need);
    source.claims[owner.id] = (source.claims[owner.id] || 0) + own;
    source.available += left - own;
  });
}
function dispatch(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId), task = state.tasks.find(t => t.id === input.taskId);
    if (!source || !task || !positive(input.quantity) || input.quantity > (source.claims[task.id] || 0)
      || (source.held[task.id] || 0) !== 0) throw Error('Validated dispatch source required');
    source.claims[task.id] -= input.quantity;
    source.onHand -= input.quantity;
    source.dispatchedByTask = { ...(source.dispatchedByTask || {}),
      [task.id]: (source.dispatchedByTask?.[task.id] || 0) + input.quantity };
    task.dispatched += input.quantity;
  });
}
function procurementOutstanding(state, taskId) {
  validate(state);
  return state.relations.filter(r => remaining(r) > 0 && [r.borrowerTaskId, r.lenderTaskId].includes(taskId))
    .map(r => ({ relationId: r.id, remaining: remaining(r), direction: r.borrowerTaskId === taskId ? 'REPAY' : 'AWAIT' }));
}
// Display facts, not a replacement for existing invoice/financial archive gates.
function taskCoverage(state, taskId) {
  validate(state);
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) throw Error('Task missing');
  const usable = reserved(state, taskId), pendingReplacement = incoming(state, taskId);
  return { taskId, requested: task.requested, dispatched: task.dispatched, reservedUsable: usable,
    pendingReplacement, uncovered: task.requested - task.dispatched - usable - pendingReplacement,
    deliveryQuantityComplete: task.dispatched === task.requested,
    transfers: procurementOutstanding(state, taskId) };
}
// Legacy allocation targets are cumulative, including already dispatched cartons.
// Do not substitute current remaining claims into that existing contract.
function cumulativeTargets(state, sourceId) {
  validate(state);
  const source = state.sources.find(s => s.id === sourceId);
  if (!source) throw Error('Source missing');
  const ids = new Set([...Object.keys(source.claims), ...Object.keys(source.dispatchedByTask || {})]);
  return [...ids].sort().map(taskId => ({ taskId,
    quantity: sum([source.claims[taskId] || 0, source.dispatchedByTask?.[taskId] || 0]) })).filter(t => t.quantity > 0);
}
module.exports = { validate, approveBorrow, receive, dispatch, procurementOutstanding, taskCoverage, cumulativeTargets };
