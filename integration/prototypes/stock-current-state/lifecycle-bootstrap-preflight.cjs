'use strict';

const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const { copy } = require('./segmented-plan.cjs');
const count = n => Number.isSafeInteger(n) && n >= 0;
// Private maintenance DRY RUN. Reuses the original bootstrap projection, never
// fabricates counters from an incomplete current page. NO database capability.
function lifecycleBootstrapPreflight({ company, context, base, taskRows, generation }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks)
    || base?.canBootstrap !== true || !base.checkpointId || base.privateProjection?.company !== company
    || !Array.isArray(base.privateProjection.items) || !Array.isArray(base.rows?.positions) || !Array.isArray(base.rows.claims)
    || !Array.isArray(base.rows.products) || !Array.isArray(taskRows) || !count(generation)) throw Error('Complete original maintenance bootstrap evidence required');
  const raw = new Map(taskRows.map(row => [row._id, row])), tasks = new Map(context.tasks.map(t => [t.id, t]));
  if (raw.size !== taskRows.length || tasks.size !== context.tasks.length || raw.size !== tasks.size) throw Error('Complete exact legacy task snapshot required');
  const dispatched = new Map(), sourceDispatch = new Map(), products = new Map(base.rows.products.map(p => [p.stockKey, copy(p)]));
  for (const item of base.privateProjection.items) for (const source of item.sources) {
    if (!tasks.has(source.sourceTaskId) || sourceDispatch.has(source.sourceTaskId) || !Array.isArray(source.reservations)) throw Error('Bootstrap source provenance conflict');
    let total = 0;
    for (const reservation of source.reservations) {
      if (!tasks.has(reservation.taskId) || !count(reservation.dispatched) || !count(total + reservation.dispatched)) throw Error('Known historical dispatch provenance required');
      total += reservation.dispatched;
      const key = source.sourceTaskId + '/' + reservation.taskId;
      if (dispatched.has(key)) throw Error('Duplicate bootstrap dispatch claim');
      dispatched.set(key, reservation.dispatched);
    }
    if (total !== source.dispatched) throw Error('Bootstrap source dispatch total differs');
    sourceDispatch.set(source.sourceTaskId, total);
  }
  const taskTotals = new Map([...tasks.keys()].map(id => [id, 0]));
  const positionMap = new Map(base.rows.positions.map(p => [p._id, p]));
  const claims = base.rows.claims.map(claim => {
    const position = positionMap.get(claim.positionId), source = position?.sourceTaskId;
    if (!source || !dispatched.has(source + '/' + claim.taskId)) throw Error('Bootstrap claim dispatch evidence missing');
    const amount = dispatched.get(source + '/' + claim.taskId), prior = taskTotals.get(claim.taskId);
    if (!count(prior) || !count(prior + amount)) throw Error('Bootstrap task dispatch overflow');
    taskTotals.set(claim.taskId, prior + amount);
    return { ...copy(claim), dispatchedCumulative: amount };
  });
  const positions = base.rows.positions.map(position => {
    if (sourceDispatch.get(position.sourceTaskId) !== position.dispatched) throw Error('Bootstrap exact source dispatch conflict');
    return { ...copy(position), borrowRepaidCumulative: 0 };
  });
  const blockers = base.reviewRequired ? ['STOCK_ATTRIBUTION_REQUIRES_REVIEW'] : [], taskInitializations = [];
  for (const task of context.tasks) {
    const row = raw.get(task.id), amount = taskTotals.get(task.id), version = row?._version || row?.stockCommitVersion;
    if (!row || row.company && row.company !== company || row.description !== task.orderId || row.imageAltText !== task.sourceLineId
      || !count(amount) || typeof (task.requested ?? task.ord) !== 'number' || amount > (task.requested ?? task.ord)) throw Error('Legacy task identity/dispatch conflict');
    if (row.stockCounterSchema != null && (row.stockCounterSchema !== 2 || row.stockDispatchedCumulative !== amount
      || !count(row.stockCounterGeneration) || row.stockCounterGeneration > generation)) blockers.push('EXISTING_TASK_COUNTER_REQUIRES_REVIEW');
    if (!version) blockers.push('TASK_VERSION_INITIALIZATION_NOT_VERIFIED');
    else if (typeof version !== 'string' || row._version && row.stockCommitVersion && row._version !== row.stockCommitVersion) throw Error('Legacy task version conflict');
    taskInitializations.push({ id: task.id, observedHash: hash(row), observedVersion: version || null,
      fields: { company, stockCounterSchema: 2, stockDispatchedCumulative: amount, stockCounterGeneration: generation } });
    // Existing real order products with no physical receipt still need one zero
    // identity/high-water checkpoint. Never create rows for the whole catalogue.
    const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea }, key = stockKey(identity);
    if (!products.has(key)) products.set(key, { _id: hash(company, key), schemaVersion: 1, ...identity, stockKey: key, name: task.name || '',
      onHand: 0, isolated: 0, reservedUsable: 0, available: 0, reviewRequired: false, reviewCodes: [], revision: 0,
      checkpointGeneration: generation, status: 'CLOSED' });
  }
  const productRows = [...products.values()].map(p => ({ ...p, lifecycleVersion: 2, nextBorrowSequence: 1 }));
  const checkpointId = hash(base.checkpointId, 'LIFECYCLE_V2', taskInitializations);
  const rows = Object.fromEntries(Object.entries({ positions, claims, products: productRows }).map(([kind, values]) => [kind,
    values.map(row => ({ ...row, _version: hash(checkpointId, kind, row._id) }))]));
  return { company, checkpointId, baseCheckpointId: base.checkpointId, canPlan: true,
    canApply: false, activationReady: false, blockers: [...new Set([...blockers, 'ADMIN_MIGRATION_APPLY_NOT_IMPLEMENTED'])],
    rows, taskInitializations, proposedTransferIndexVersion: 2,
    // No immutable prepared plan/endpoint may treat these fields as executable CAS
    // evidence until missing legacy version initialization and freshness are proven.
    counts: { positions: positions.length, claims: claims.length, products: productRows.length, tasks: taskInitializations.length } };
}
module.exports = { lifecycleBootstrapPreflight };
