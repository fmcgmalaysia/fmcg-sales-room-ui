'use strict';

const { hash } = require('./commit-proof.cjs');
const { same, copy } = require('./segmented-plan.cjs');
const { createSegmentedFencedProof } = require('./segmented-fenced-proof.cjs');
const { compareStockLifecycleShadow } = require('./lifecycle-shadow-parity.cjs');
const tables = { positions: 'StockPositions', claims: 'StockClaims', products: 'StockProducts' };
const taskTable = company => company === 'NCT' ? 'NCTTasks' : 'NCTTasks1';
const count = n => Number.isSafeInteger(n) && n >= 0;

// Server-only migration of an already versioned, complete captured cohort. Missing
// legacy versions require the separate conditional metadata initializer first.
// This does not create schema, assert old requests stopped, or enable ACTIVE.
function prepareMaintenanceMigration({ company, expected, taskRows, control, backupIdentity }) {
  if (!['NCT', 'GHR'].includes(company) || expected?.company !== company || expected.canPlan !== true
    || !expected.checkpointId || !expected.baseCheckpointId || expected.proposedTransferIndexVersion !== 2
    || !Array.isArray(expected.blockers) || expected.blockers.some(code => code !== 'ADMIN_MIGRATION_APPLY_NOT_IMPLEMENTED')
    || !count(expected.generation) || !count(expected.generation + 1) || !Array.isArray(expected.taskInitializations)
    || !Array.isArray(taskRows) || control?._id !== hash(company, 'STOCK_CONTROL') || control.company !== company
    || control.mode !== 'MAINTENANCE' || control.schemaVersion !== 1 || control.transferIndexVersion !== 2
    || !control._version || control.pending !== null || control.generation !== expected.generation
    || Object.keys(tables).some(kind => !Array.isArray(expected.rows?.[kind]))) throw Error('Verified maintenance migration capture required');
  const raw = new Map(taskRows.map(row => [row._id, row]));
  if (raw.size !== taskRows.length || raw.size !== expected.taskInitializations.length) throw Error('Complete migration task cohort required');
  const generation = expected.generation + 1, writes = [], seen = new Set();
  const target = copy(expected); target.generation = generation;
  target.blockers = []; target.canApply = false; target.activationReady = false;
  for (const kind of Object.keys(tables)) target.rows[kind] = expected.rows[kind].map(row => {
    if (row.company !== company || !row._id || row.checkpointGeneration !== expected.generation) throw Error('Captured migration stock scope conflict');
    const after = { ...copy(row), checkpointGeneration: generation };
    writes.push({ collection: tables[kind], before: null, after });
    return after;
  });
  target.taskInitializations = expected.taskInitializations.map(entry => {
    const before = raw.get(entry.id);
    if (!before || seen.has(entry.id) || before.company !== company || typeof before._version !== 'string' || !before._version
      || before.stockCommitVersion !== undefined || hash(before) !== entry.observedHash || before._version !== entry.observedVersion
      || entry.fields?.company !== company || entry.fields.stockCounterSchema !== 2
      || !count(entry.fields.stockDispatchedCumulative) || entry.fields.stockCounterGeneration !== expected.generation) {
      throw Error('Exact versioned migration task image required');
    }
    seen.add(entry.id);
    const fields = { ...copy(entry.fields), stockCounterGeneration: generation };
    writes.push({ collection: taskTable(company), before: copy(before), after: { ...copy(before), ...fields } });
    return { ...copy(entry), fields };
  });
  // Even an empty company uses a durable metadata checkpoint, not a fake product.
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  writes.push({ collection: journal, before: null, after: { _id: hash(company, 'MIGRATION', expected.checkpointId), company,
    action: 'STOCK_INITIALIZATION_CHECKPOINT', checkpointId: expected.checkpointId, generation,
    counts: copy(expected.counts), lifecycleVersion: 2 } });
  return { writes, migration: { company, checkpointId: expected.checkpointId, baseGeneration: expected.generation,
    expected: target, legacyTaskRows: copy(taskRows), ...(backupIdentity ? { backupIdentity: copy(backupIdentity) } : {}) } };
}

function createMaintenanceMigration({ company, store, authenticateAdmin, verifyLegacyDrain, capture,
  readInstalled, protocolOptions = {} }) {
  if (!['NCT', 'GHR'].includes(company) || [authenticateAdmin, verifyLegacyDrain, capture, readInstalled].some(fn => typeof fn !== 'function')) {
    throw Error('Private migration authority, drain verification and snapshot readers required');
  }
  const protocol = createSegmentedFencedProof({ ...protocolOptions, company, store, domainWrites: true });
  async function requireDrain(checkpointId) {
    if (await verifyLegacyDrain({ company, checkpointId }) !== true) throw Error('Legacy request drain is not verified');
  }
  async function apply(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'checkpointId,requestId'
      || !/^[a-f0-9-]{36}$/i.test(input.requestId || '') || !/^[a-f0-9]{32}$/.test(input.checkpointId || '')) throw Error('Original migration request and checkpoint required');
    const admin = await authenticateAdmin();
    if (!admin?.memberId || admin.isAdmin !== true) throw Error('Administrator migration authority required');
    // Verify before any lock/staging write as well as under the owned protocol.
    // A missing provider/installed admission verifier is an error, never a flag
    // accepted from the browser or an inference from elapsed time/empty locks.
    await requireDrain(input.checkpointId);
    return protocol.commit({ requestId: input.requestId, memberId: admin.memberId,
      input: { kind: 'INITIAL_STOCK_MIGRATION_V2', checkpointId: input.checkpointId },
      authorize: async operation => {
        const currentAdmin = await authenticateAdmin(), control = operation.control;
        if (currentAdmin?.isAdmin !== true || currentAdmin.memberId !== admin.memberId
          || control.mode !== 'MAINTENANCE' || control.schemaVersion !== 1 || control.transferIndexVersion !== 2) throw Error('Migration maintenance authority changed');
        await requireDrain(input.checkpointId);
      },
      prepare: async () => {
        const observed = await capture({ company, requestId: input.requestId, checkpointId: input.checkpointId });
        if (observed?.expected?.checkpointId !== input.checkpointId || observed.emptyCurrentConfirmed !== true) throw Error('Original complete empty-current checkpoint required');
        if (observed.durableBackupConfirmed !== true) throw Error('Durable private original migration backup required');
        const proof = observed.backupIdentity;
        if (!proof || Object.keys(proof).sort().join(',') !== 'backupId,checkpointId,requestId,retainedBy'
          || !/^[a-f0-9-]{36}$/i.test(proof.requestId || '') || !/^[a-f0-9]{32}$/.test(proof.backupId || '')
          || !/^[a-f0-9]{32}$/.test(proof.checkpointId || '') || proof.retainedBy !== admin.memberId) throw Error('Original retained backup identity required');
        const control = await protocol.readControl();
        if (!same(control, observed.control)) throw Error('Migration capture changed');
        return prepareMaintenanceMigration({ company, ...observed, control });
      },
      validate: async plan => {
        // Before RESULT/generation publication require the entire installed cohort,
        // not sums from one display page. The protocol has already checked each
        // after-image; this also detects extra rows not present in the plan.
        const installed = await readInstalled({ company, requestId: input.requestId, checkpointId: input.checkpointId });
        if (installed?.company !== company || installed.complete !== true || installed.taskRowsComplete !== true
          || !Array.isArray(installed.transfers) || installed.transfers.length) throw Error('Complete initial migration readback required');
        for (const [kind, collection] of Object.entries({ ...tables, taskRows: taskTable(company) })) {
          const actual = installed[kind], expectedRows = plan.writes.filter(w => w.collection === collection).map(w => w.after);
          if (!Array.isArray(actual) || actual.length !== expectedRows.length || new Set(actual.map(row => row._id)).size !== actual.length
            || expectedRows.some(row => !same(row, actual.find(value => value._id === row._id)))) throw Error('Initial migration cohort differs');
        }
      } });
  }
  async function inspect(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'checkpointId,requestId'
      || !/^[a-f0-9-]{36}$/i.test(input.requestId || '') || !/^[a-f0-9]{32}$/.test(input.checkpointId || '')) throw Error('Original migration inspection required');
    const admin = await authenticateAdmin();
    if (admin?.isAdmin !== true || !admin.memberId) throw Error('Administrator migration authority required');
    const before = await protocol.readControl();
    if (before.mode !== 'MAINTENANCE' || before.pending) throw Error('Completed maintenance migration required');
    const key = hash(company + '/PURCHASE', input.requestId, admin.memberId), result = await store.read(protocol.ids.journal, hash(key, 'RESULT'));
    const manifest = await store.read(protocol.ids.journal, key);
    if (result?.company !== company || result._id !== hash(key, 'RESULT') || result.stockOperationProtocol !== 2
      || result.outcome?.ok !== true || result.outcome.operationId !== key
      || result.digest !== hash({ kind: 'INITIAL_STOCK_MIGRATION_V2', checkpointId: input.checkpointId })
      || manifest?.digest !== result.digest || result.baseGeneration !== manifest.baseGeneration
      || result.outcome.generation !== result.baseGeneration + 1 || before.generation !== result.outcome.generation) throw Error('Confirmed original migration result required');
    // Decode the exact retained operation; never recapture a different baseline.
    const { createSegmentedPlanCodec } = require('./segmented-plan.cjs');
    const codec = createSegmentedPlanCodec({ ...protocolOptions.codecPolicy, company, domainWrites: true });
    const fragments = [];
    for (const ref of manifest.fragments || []) fragments.push(await store.read(protocol.ids.journal, ref.id));
    const plan = codec.decode({ manifest, fragments, key, digest: result.digest, memberId: admin.memberId, requestId: input.requestId });
    if (plan.migration?.checkpointId !== input.checkpointId) throw Error('Migration checkpoint identity differs');
    const current = await readInstalled({ company, requestId: input.requestId, checkpointId: input.checkpointId }), after = await protocol.readControl();
    return compareStockLifecycleShadow({ company, expected: plan.migration.expected, legacyTaskRows: plan.migration.legacyTaskRows,
      current: { ...current, generation: result.outcome.generation }, controlBefore: before, controlAfter: after });
  }
  return { apply, inspect };
}
module.exports = { prepareMaintenanceMigration, createMaintenanceMigration };
