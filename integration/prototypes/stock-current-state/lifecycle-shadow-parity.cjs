'use strict';

// Private initial-cutover READ ONLY proof. The original shadow comparison covers
// physical/customer fields, not v2 lifetime counters. This adds those requirements
// without changing that legacy diagnostic, selecting an authority or enabling mode.
const { hash } = require('./commit-proof.cjs');
const { compareStockShadow } = require('./shadow-parity.cjs');
const { same, copy } = require('./segmented-plan.cjs');
const count = n => Number.isSafeInteger(n) && n >= 0;
const taskMetadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId', '_version', 'stockCommitVersion',
  'company', 'stockCounterSchema', 'stockDispatchedCumulative', 'stockCounterGeneration']);
const businessImage = row => Object.fromEntries(Object.entries(copy(row)).filter(([field]) => !taskMetadata.has(field)));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
function compareStockLifecycleShadow({ company, expected, legacyTaskRows, current, controlBefore, controlAfter }) {
  if (!['NCT', 'GHR'].includes(company) || expected?.company !== company || expected.canPlan !== true
    || !expected.checkpointId || !expected.baseCheckpointId || !count(expected.generation)
    || expected.proposedTransferIndexVersion !== 2 || !Array.isArray(expected.taskInitializations)
    || !Array.isArray(legacyTaskRows) || current?.taskRowsComplete !== true || !Array.isArray(current.taskRows)
    || ['positions', 'claims', 'products'].some(table => !Array.isArray(expected.rows?.[table]))) throw Error('Complete lifecycle maintenance snapshots required');
  const base = compareStockShadow({ company, expected: { company, generation: expected.generation, ...expected.rows },
    current, controlBefore, controlAfter });
  const result = { ...base, schema: 'STOCK_INITIAL_LIFECYCLE_SHADOW_V2', lifecycleVerified: false, activationReady: false };
  if (!base.parity) return result;
  if (controlBefore.transferIndexVersion !== 2) return { ...result, parity: false, status: 'TRANSFER_INDEX_NOT_VERIFIED', fingerprint: hash(result.fingerprint, 'TRANSFER_INDEX_NOT_VERIFIED') };
  const differences = [...base.differences]; let differenceCount = base.differenceCount;
  const difference = (table, id, field, reason) => {
    differenceCount++;
    if (differences.length < 100) differences.push({ table, id, field, reason });
  };
  const fields = { positions: ['borrowRepaidCumulative'], claims: ['dispatchedCumulative'], products: ['lifecycleVersion', 'nextBorrowSequence'] };
  const fingerprints = {};
  for (const [table, critical] of Object.entries(fields)) {
    const observed = new Map(current[table].map(row => [row._id, row]));
    for (const row of expected.rows[table]) {
      if (table === 'positions' && row.borrowRepaidCumulative !== 0
        || table === 'claims' && !count(row.dispatchedCumulative)
        || table === 'products' && (row.lifecycleVersion !== 2 || row.nextBorrowSequence !== 1)) throw Error('Initial lifecycle baseline counters required');
      const after = observed.get(row._id);
      if (typeof after?._version !== 'string' || !after._version) difference(table, row._id, '_version', 'CURRENT_LIFECYCLE_METADATA_INVALID');
      for (const field of critical) if (!same(row[field], after?.[field])) difference(table, row._id, field, 'LIFECYCLE_COUNTER_MISMATCH');
      if (after?.checkpointGeneration !== expected.generation) difference(table, row._id, 'checkpointGeneration', 'INITIAL_CHECKPOINT_GENERATION_MISMATCH');
    }
    fingerprints[table] = current[table].map(row => [row._id, ...critical.map(field => row[field]), row.checkpointGeneration]).sort((a,b) => a[0].localeCompare(b[0]));
  }
  const initializations = new Map(), legacy = new Map(), actual = new Map();
  for (const entry of expected.taskInitializations) {
    if (typeof entry?.id !== 'string' || !entry.id || initializations.has(entry.id)
      || entry.fields?.company !== company || entry.fields.stockCounterSchema !== 2 || !count(entry.fields.stockDispatchedCumulative)
      || entry.fields.stockCounterGeneration !== expected.generation || !entry.observedHash) throw Error('Exact lifecycle task baseline required');
    initializations.set(entry.id, entry);
  }
  for (const row of legacyTaskRows) {
    if (!row?._id || legacy.has(row._id) || !initializations.has(row._id) || row.company && row.company !== company
      || hash(row) !== initializations.get(row._id).observedHash) throw Error('Captured legacy task evidence differs');
    legacy.set(row._id, row);
  }
  if (legacy.size !== initializations.size) throw Error('Complete captured legacy tasks required');
  for (const row of current.taskRows) {
    if (!row?._id || actual.has(row._id)) throw Error('Unique current task identities required');
    actual.set(row._id, row);
    if (!initializations.has(row._id)) difference('tasks', row._id, '_id', 'UNEXPECTED_CURRENT_TASK');
  }
  for (const [id, entry] of initializations) {
    const row = actual.get(id);
    if (!row) { difference('tasks', id, '_id', 'CURRENT_TASK_MISSING'); continue; }
    const version = row._version || row.stockCommitVersion;
    if (row.company !== company || typeof version !== 'string' || !version
      || row._version && row.stockCommitVersion && row._version !== row.stockCommitVersion) difference('tasks', id, '_version', 'CURRENT_TASK_METADATA_INVALID');
    for (const field of ['stockCounterSchema', 'stockDispatchedCumulative', 'stockCounterGeneration']) {
      if (!same(row[field], entry.fields[field])) difference('tasks', id, field, 'TASK_COUNTER_MISMATCH');
    }
    if (!same(businessImage(legacy.get(id)), businessImage(row))) difference('tasks', id, 'businessImage', 'ORIGINAL_TASK_CHANGED');
  }
  // Equality of two caches is insufficient: independently prove cumulative source
  // and task totals against exact claims, including CLOSED fully dispatched ones.
  const checkDispatch = (rows, tasks, label) => {
    const bySource = new Map(), byTask = new Map();
    for (const row of rows.claims) {
      if (!count(row.dispatchedCumulative)) { difference('claims', row._id, 'dispatchedCumulative', label + '_DISPATCH_INVALID'); continue; }
      for (const [map, id] of [[bySource, row.positionId], [byTask, row.taskId]]) {
        const total = (map.get(id) || 0) + row.dispatchedCumulative;
        if (!count(total)) throw Error('Lifecycle dispatch aggregate overflow');
        map.set(id, total);
      }
      if (!initializations.has(row.taskId)) difference('claims', row._id, 'taskId', label + '_TASK_MISSING');
    }
    for (const row of rows.positions) if ((bySource.get(row._id) || 0) !== row.dispatched) difference('positions', row._id, 'dispatched', label + '_CLAIM_DISPATCH_TOTAL_MISMATCH');
    for (const [id, task] of tasks) if ((byTask.get(id) || 0) !== task.stockDispatchedCumulative) difference('tasks', id, 'stockDispatchedCumulative', label + '_CLAIM_DISPATCH_TOTAL_MISMATCH');
  };
  checkDispatch(expected.rows, new Map([...initializations].map(([id, entry]) => [id, entry.fields])), 'EXPECTED');
  checkDispatch(current, actual, 'CURRENT');
  fingerprints.tasks = [...actual].map(([id, row]) => [id, row.company, row.stockCounterSchema, row.stockDispatchedCumulative,
    row.stockCounterGeneration, hash(canonical(businessImage(row)))]).sort((a,b) => a[0].localeCompare(b[0]));
  const parity = differenceCount === 0, status = parity ? base.status === 'PARITY_WITH_REVIEW_REQUIRED'
    ? 'LIFECYCLE_PARITY_WITH_REVIEW_REQUIRED' : 'LIFECYCLE_PARITY_CONFIRMED_KNOWN' : 'LIFECYCLE_DIFFERENCE_REVIEW_REQUIRED';
  const dataFingerprint = hash(base.dataFingerprint, expected.checkpointId, fingerprints);
  return { ...result, status, parity, lifecycleVerified: parity, differences, differenceCount, dataFingerprint,
    fingerprint: hash(base.fingerprint, status, dataFingerprint, differences, differenceCount) };
}
module.exports = { compareStockLifecycleShadow };
