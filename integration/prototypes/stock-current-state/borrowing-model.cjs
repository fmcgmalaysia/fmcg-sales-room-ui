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
const remaining = relation => relation.quantity - relation.repaid - (relation.returned || 0);
const outgoing = (state, sourceId) => sum(state.relations.filter(r => r.replacementSourceId === sourceId).map(remaining));
const incoming = (state, taskId) => sum(state.relations.filter(r => r.lenderTaskId === taskId).map(remaining));
const legacyHeld = (state, taskId) => state.packingHolds.legacyBlockedByTask?.[taskId] === true;
function validate(state) {
  if (state.complete !== true || !count(state.revision) || !Array.isArray(state.tasks)
    || !Array.isArray(state.sources) || !Array.isArray(state.relations)) throw Error('Complete snapshot required');
  const key = stockKey(state), tasks = new Map(), sources = new Map(), ids = new Set(), sequences = new Set();
  if (state.packingHolds?.complete !== true || state.packingHolds.company !== state.company
    || state.packingHolds.scope !== 'TASK_TOTAL' || !state.packingHolds.version
    || !state.packingHolds.heldByTask || Array.isArray(state.packingHolds.heldByTask)) throw Error('Verified task packing snapshot required');
  for (const task of state.tasks) {
    if (!task.id || tasks.has(task.id) || !task.customerId || !count(task.requested) || !count(task.dispatched)
      || task.dispatched > task.requested || stockKey(task) !== key) throw Error('Task identity or demand conflict');
    tasks.set(task.id, task);
  }
  if (state.packingHolds.legacyBlockedByTask && (typeof state.packingHolds.legacyBlockedByTask !== 'object'
    || Array.isArray(state.packingHolds.legacyBlockedByTask) || Object.entries(state.packingHolds.legacyBlockedByTask).some(([id, flag]) => !tasks.has(id) || typeof flag !== 'boolean'))) throw Error('Legacy preparation guard requires review');
  for (const source of state.sources) {
    const freeOnly = source.ownerTaskId === null && source.ownerShare === 0 && source.receiptPolicy === 'EXPLICIT_ONLY';
    if (!source.id || sources.has(source.id) || !tasks.has(source.ownerTaskId) && !freeOnly || !source.poId
      || source.poValid !== true || stockKey(source) !== key || source.reviewRequired !== false
      || !['OWNER_DEMAND', 'EXPLICIT_ONLY'].includes(source.receiptPolicy)
      || !['planned', 'accepted', 'onHand', 'isolated', 'available'].every(k => count(source[k]))
      || !count(source.ownerShare) || source.ownerShare > source.planned
      || source.accepted > source.planned || !source.claims) throw Error('Source identity or balance conflict');
    for (const [taskId, qty] of Object.entries(source.claims)) {
      if (!tasks.has(taskId) || !count(qty)) throw Error('Claim conflict');
    }
    for (const [taskId, qty] of Object.entries(source.dispatchedByTask || {})) {
      if (!tasks.has(taskId) || !count(qty)) throw Error('Dispatch provenance conflict');
    }
    if (source.onHand !== sum([source.available, source.isolated, ...Object.values(source.claims)])) throw Error('Physical balance conflict');
    if (!count(source.replacementReceived ?? 0) || !count(source.supplierReturned ?? 0)
      || sum([source.onHand, source.supplierReturned || 0, ...Object.values(source.dispatchedByTask || {})])
        !== sum([source.accepted, source.replacementReceived || 0])) throw Error('Receipt/dispatch provenance conflict');
    sources.set(source.id, source);
  }
  for (const relation of state.relations) {
    const from = sources.get(relation.lenderSourceId), future = sources.get(relation.replacementSourceId);
    if (!relation.id || ids.has(relation.id) || !positive(relation.sequence) || sequences.has(relation.sequence)
      || !from || !future || from.id === future.id || !positive(relation.quantity) || !count(relation.repaid)
      || !count(relation.returned ?? 0) || relation.repaid + (relation.returned || 0) > relation.quantity
      || relation.returned > 0 && (!relation.returnReason || !relation.returnApprovedBy)
      || !relation.approvedBy || !relation.reason
      || !tasks.has(relation.lenderTaskId) || !tasks.has(relation.borrowerTaskId)
      || from.ownerTaskId !== relation.lenderTaskId || future.ownerTaskId !== relation.borrowerTaskId
      || relation.borrowerTaskId === relation.lenderTaskId
      || tasks.get(relation.borrowerTaskId).customerId === tasks.get(relation.lenderTaskId).customerId) throw Error('Borrowing relation conflict');
    ids.add(relation.id); sequences.add(relation.sequence);
  }
  for (const task of state.tasks) {
    if (!Object.hasOwn(state.packingHolds.heldByTask, task.id) || !count(state.packingHolds.heldByTask[task.id])
      || state.packingHolds.heldByTask[task.id] > reserved(state, task.id)) throw Error('Packing task coverage requires review');
    if (sum(state.sources.map(s => s.dispatchedByTask?.[task.id] || 0)) !== task.dispatched) throw Error('Task dispatch provenance conflict');
    if (sum([task.dispatched, reserved(state, task.id), incoming(state, task.id)]) > task.requested) throw Error('Customer coverage exceeded');
  }
  for (const source of state.sources) {
    if (outgoing(state, source.id) > Math.max(0, source.ownerShare - source.accepted)) throw Error('Future supply already committed');
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
    if (!donor || !future || !borrower || !state.tasks.some(t => t.id === donor.ownerTaskId) || future.ownerTaskId !== borrower.id || donor.ownerTaskId === borrower.id
      || state.packingHolds.heldByTask[borrower.id] !== 0 || legacyHeld(state, borrower.id)) throw Error('Eligible unheld borrower required');
    const lender = donor.ownerTaskId;
    if (state.packingHolds.heldByTask[lender] !== 0 || legacyHeld(state, lender)) throw Error('Packing task holds lender allocation');
    if (input.quantity > (donor.claims[lender] || 0)
      || input.quantity > Math.max(0, future.ownerShare - future.accepted) - outgoing(state, future.id)
      || input.quantity > borrower.requested - borrower.dispatched - reserved(state, borrower.id) - incoming(state, borrower.id)) throw Error('Insufficient eligible stock, demand or future supply');
    donor.claims[lender] -= input.quantity;
    donor.claims[borrower.id] = (donor.claims[borrower.id] || 0) + input.quantity;
    const sequence = Math.max(0, ...state.relations.map(r => r.sequence)) + 1;
    state.relations.push({ id: input.id, sequence, lenderSourceId: donor.id, replacementSourceId: future.id,
      lenderTaskId: lender, borrowerTaskId: borrower.id, quantity: input.quantity, repaid: 0, returned: 0,
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
      if (take) source.claims[relation.lenderTaskId] = (source.claims[relation.lenderTaskId] || 0) + take;
      relation.repaid += take;
      left -= take;
    }
    const owner = state.tasks.find(t => t.id === source.ownerTaskId);
    const need = owner ? owner.requested - owner.dispatched - reserved(state, owner.id) - incoming(state, owner.id) : 0;
    const repaidFromSource = sum(state.relations.filter(r => r.replacementSourceId === source.id).map(r => r.repaid));
    const ownCapacity = owner ? Math.max(0, source.ownerShare - repaidFromSource - (source.claims[owner.id] || 0) - (source.dispatchedByTask?.[owner.id] || 0)) : 0;
    const own = source.receiptPolicy === 'EXPLICIT_ONLY' ? 0 : Math.min(left, need, ownCapacity);
    if (own) source.claims[owner.id] = (source.claims[owner.id] || 0) + own;
    source.available += left - own;
  });
}
function dispatch(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId), task = state.tasks.find(t => t.id === input.taskId);
    if (!source || !task || !positive(input.quantity) || input.quantity > (source.claims[task.id] || 0)
      || state.packingHolds.heldByTask[task.id] !== 0 || legacyHeld(state, task.id)) throw Error('Validated dispatch source required');
    source.claims[task.id] -= input.quantity;
    source.onHand -= input.quantity;
    source.dispatchedByTask = { ...(source.dispatchedByTask || {}),
      [task.id]: (source.dispatchedByTask?.[task.id] || 0) + input.quantity };
    task.dispatched += input.quantity;
  });
}
function returnUnusedBorrow(before, input) {
  return transition(before, input.expectedRevision, state => {
    const r = state.relations.find(r => r.id === input.relationId);
    if (!r || !positive(input.quantity) || input.quantity > remaining(r)
      || !String(input.approvedBy || '').trim() || !String(input.reason || '').trim()) throw Error('Approved unused borrowing return required');
    const source = state.sources.find(s => s.id === r.lenderSourceId);
    // Conservative: do not guess which relationship supplied already shipped cartons.
    if ((source.dispatchedByTask?.[r.borrowerTaskId] || 0) > 0
      || state.packingHolds.heldByTask[r.borrowerTaskId] > 0 || state.packingHolds.heldByTask[r.lenderTaskId] > 0
      || legacyHeld(state, r.borrowerTaskId) || legacyHeld(state, r.lenderTaskId)
      || (source.claims[r.borrowerTaskId] || 0) < input.quantity) throw Error('Borrowed stock already used or held');
    source.claims[r.borrowerTaskId] -= input.quantity;
    source.claims[r.lenderTaskId] = (source.claims[r.lenderTaskId] || 0) + input.quantity;
    r.returned = (r.returned || 0) + input.quantity;
    r.returnApprovedBy = input.approvedBy; r.returnReason = input.reason;
  });
}
function correctAccepted(before, input) {
  if (!String(input.reason || '').trim()) throw Error('Receipt correction reason required');
  const prior = before.sources.find(s => s.id === input.sourceId);
  if (!prior || !count(input.cumulativeAccepted)) throw Error('Receipt correction basis required');
  if (input.cumulativeAccepted >= prior.accepted) return receive(before, input);
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    let reduction = source.accepted - input.cumulativeAccepted;
    const free = Math.min(reduction, source.available);
    source.available -= free; reduction -= free;
    const removeClaim = (taskId, max) => {
      const take = Math.min(reduction, source.claims[taskId] || 0, max);
      if (take && (state.packingHolds.heldByTask[taskId] > 0 || legacyHeld(state, taskId))) throw Error('Packing task holds corrected allocation');
      if (take) source.claims[taskId] = (source.claims[taskId] || 0) - take;
      reduction -= take; return take;
    };
    removeClaim(source.ownerTaskId, Number.MAX_SAFE_INTEGER);
    // Reverse most recently approved repayments first; original supplier PO never changes.
    for (const r of state.relations.filter(r => r.replacementSourceId === source.id).sort((a, b) => b.sequence - a.sequence)) {
      const take = removeClaim(r.lenderTaskId, r.repaid);
      r.repaid -= take;
    }
    if (reduction) throw Error('Correction would consume shipped, isolated or unrelated allocations');
    source.onHand -= source.accepted - input.cumulativeAccepted;
    source.accepted = input.cumulativeAccepted;
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
function allocateCumulative(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    if (!source || !Array.isArray(input.targets) || !String(input.reason || '').trim()
      || new Set(input.targets.map(t => t.taskId)).size !== input.targets.length) throw Error('Validated cumulative allocation required');
    const next = {};
    for (const target of input.targets) {
      const shipped = source.dispatchedByTask?.[target.taskId] || 0;
      if (!state.tasks.some(t => t.id === target.taskId) || !count(target.quantity) || target.quantity < shipped) throw Error('Allocation cannot remove dispatched provenance');
      next[target.taskId] = target.quantity - shipped;
    }
    for (const [taskId, shipped] of Object.entries(source.dispatchedByTask || {})) {
      if (shipped && !Object.hasOwn(next, taskId)) throw Error('Dispatched allocation target must remain');
    }
    const ids = new Set([...Object.keys(source.claims), ...Object.keys(next)]);
    for (const taskId of ids) {
      if ((next[taskId] || 0) < (source.claims[taskId] || 0)) {
        // Existing task-total packing evidence cannot prove source-specific release.
        if (state.packingHolds.heldByTask[taskId] > 0 || legacyHeld(state, taskId)) throw Error('Packing task holds allocation');
        if (state.relations.some(r => remaining(r) > 0
          && [r.lenderSourceId, r.replacementSourceId].includes(source.id)
          && [r.borrowerTaskId, r.lenderTaskId].includes(taskId))) throw Error('Outstanding borrowing allocation requires dedicated transfer return or repayment');
        // No release-then-reassign bypass of the both-PO borrowing approval rule.
        // Customer cancellation/approved release needs its own fact-bound transition.
        throw Error('Customer reservation release requires borrowing or approved cancellation workflow');
      }
    }
    const reserved = sum(Object.values(next));
    if (reserved > source.onHand - source.isolated) throw Error('Allocation exceeds usable physical stock');
    source.claims = next;
    source.available = source.onHand - source.isolated - reserved;
    source.receiptPolicy = 'EXPLICIT_ONLY';
  });
}
function adjustDemand(before, input) {
  return transition(before, input.expectedRevision, state => {
    const task = state.tasks.find(t => t.id === input.taskId);
    if (!task || !['INCREASE', 'SPLIT', 'REDUCE'].includes(input.mode) || !positive(input.requested)
      || input.requested > 9999 || input.beforeRequested !== task.requested || !Array.isArray(input.allocations)
      || new Set(input.allocations.map(a => a.sourceTaskId)).size !== input.allocations.length
      || (input.mode === 'INCREASE' ? input.requested <= task.requested : input.mode === 'SPLIT' ? input.requested !== task.requested : input.requested >= task.requested)
      || input.mode !== 'REDUCE' && input.allocations.length) throw Error('Validated demand adjustment required');
    for (const change of input.allocations) {
      const source = state.sources.find(s => s.id === change.sourceTaskId);
      if (!source || !Array.isArray(change.targets) || new Set(change.targets.map(t => t.taskId)).size !== change.targets.length) throw Error('Distinct cancellation source allocation required');
      const prior = cumulativeTargets(before, source.id), targets = new Map(change.targets.map(t => [t.taskId, t.quantity]));
      for (const [id, quantity] of targets) {
        if (!count(quantity) || !state.tasks.some(t => t.id === id)) throw Error('Known cancellation allocation required');
      }
      const ids = new Set([...prior.map(t => t.taskId), ...targets.keys()]);
      for (const id of ids) {
        if (id !== task.id && (targets.get(id) || 0) !== (prior.find(t => t.taskId === id)?.quantity || 0)) throw Error('Cancellation cannot alter another customer allocation');
      }
      const shipped = source.dispatchedByTask?.[task.id] || 0, current = source.claims[task.id] || 0;
      const cumulative = targets.get(task.id) || 0, release = current + shipped - cumulative;
      if (release < 0 || release > current) throw Error('Cancellation cannot create stock or remove dispatched provenance');
      if (release && (state.packingHolds.heldByTask[task.id] > 0 || legacyHeld(state, task.id))) throw Error('Packing task holds cancellation');
      if (release && state.relations.some(r => remaining(r) > 0 && [r.lenderSourceId, r.replacementSourceId].includes(source.id)
        && [r.borrowerTaskId, r.lenderTaskId].includes(task.id))) throw Error('Resolve borrowing before releasing linked customer stock');
      if (release) { source.claims[task.id] = current - release; source.available += release; source.receiptPolicy = 'EXPLICIT_ONLY'; }
    }
    task.requested = input.requested;
    // Missing implicit/batch ownership evidence fails final coverage validation; never
    // infer a release from an aggregate requested delta or steal another batch's stock.
  });
}
function dispatchReserved(before, input) {
  return transition(before, input.expectedRevision, state => {
    if (!Array.isArray(input.lines) || !input.lines.length || new Set(input.lines.map(l => l.taskId)).size !== input.lines.length) throw Error('Distinct validated shipment lines required');
    for (const line of input.lines) {
      const task = state.tasks.find(t => t.id === line.taskId);
      if (!task || !positive(line.quantity) || !Array.isArray(line.sources) || !line.sources.length
        || new Set(line.sources.map(s => s.sourceTaskId)).size !== line.sources.length
        || line.sources.some(s => !positive(s.quantity)) || sum(line.sources.map(s => s.quantity)) !== line.quantity
        || state.packingHolds.heldByTask[task.id] < line.quantity) throw Error('Confirmed shipment reservation required');
      // Consume THIS invoice reservation only; other active instructions stay held.
      state.packingHolds.heldByTask[task.id] -= line.quantity;
      for (const portion of line.sources) {
        const source = state.sources.find(s => s.id === portion.sourceTaskId);
        if (!source || portion.quantity > (source.claims[task.id] || 0)) throw Error('Dispatch exceeds source customer ownership');
        source.claims[task.id] -= portion.quantity; source.onHand -= portion.quantity;
        source.dispatchedByTask = { ...(source.dispatchedByTask || {}), [task.id]: (source.dispatchedByTask?.[task.id] || 0) + portion.quantity };
      }
      task.dispatched += line.quantity;
    }
  });
}
function quarantineFree(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    if (!source || !positive(input.quantity) || !['INTERNAL_DAMAGE', 'WRONG_ITEM', 'SHORT_EXPIRY'].includes(input.kind)
      || !String(input.reason || '').trim()) throw Error('Original stock exception required');
    // Only unassigned free quantity can be moved without choosing a customer's loss.
    // Reserved/held/borrowed attribution needs its own reviewed exception workflow.
    if (input.quantity > source.available) throw Error('Exception affects reserved stock; customer attribution review required');
    source.available -= input.quantity; source.isolated += input.quantity;
  });
}
function freeCaseMovement(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    if (!source || !positive(input.quantity) || !['RETURN', 'REPLACEMENT'].includes(input.action)) throw Error('Validated free-case physical movement required');
    if (input.action === 'RETURN') {
      if (input.quantity > source.isolated) throw Error('Supplier return exceeds isolated stock');
      source.isolated -= input.quantity; source.onHand -= input.quantity;
      source.supplierReturned = (source.supplierReturned || 0) + input.quantity;
    } else {
      source.onHand += input.quantity; source.available += input.quantity;
      source.replacementReceived = (source.replacementReceived || 0) + input.quantity;
    }
  });
}
function releaseFreeCase(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    if (!source || !positive(input.quantity) || input.quantity > source.isolated) throw Error('Approved isolated release quantity required');
    source.isolated -= input.quantity; source.available += input.quantity;
  });
}
module.exports = { validate, approveBorrow, receive, correctAccepted, returnUnusedBorrow, dispatch, dispatchReserved, adjustDemand, quarantineFree, freeCaseMovement, releaseFreeCase,
  allocateCumulative, procurementOutstanding, taskCoverage, cumulativeTargets, relationRemaining: remaining };
