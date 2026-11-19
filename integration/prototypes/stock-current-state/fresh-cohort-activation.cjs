'use strict';
// Fresh, empty R2 authority only. This module is not a deployed web endpoint.
// Native acceptance comes from a server-owned verifier, never browser flags.
const { COHORT } = require('./isolated-cohort.cjs');
const { WRITERS } = require('./stock-admission.cjs');
const { hash } = require('./commit-proof.cjs');
const { same, copy } = require('./segmented-plan.cjs');
const REQUIRED = Object.freeze(['isolation', 'nativeSchema', 'nativeQueries',
  'nativeConditionalWrites', 'nativeCapacity', 'nativeRecovery', 'pairedInstallation']);

function createFreshCohortActivation({ company, build, store, authenticateAdmin,
  inspectFreshBusiness, verifyNativeAcceptance }) {
  if (!['NCT', 'GHR'].includes(company) || !/^[a-f0-9]{40}$/.test(build || '')
    || ['read', 'compareAndSet'].some(name => typeof store?.[name] !== 'function')
    || [authenticateAdmin, inspectFreshBusiness, verifyNativeAcceptance].some(fn => typeof fn !== 'function')) {
    throw Error('Fixed fresh-cohort activation dependencies required');
  }
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const controlId = hash(company, 'STOCK_CONTROL');
  async function authorize(owner) {
    const actor = await authenticateAdmin();
    if (actor?.isAdmin !== true || typeof actor.memberId !== 'string' || !actor.memberId
      || owner && actor.memberId !== owner) throw Error('Same actual administrator required');
    return actor.memberId;
  }
  function request(input) {
    if (!input || Array.isArray(input) || Object.keys(input).join(',') !== 'requestId'
      || typeof input.requestId !== 'string'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.requestId)) throw Error('Only activation request identity is accepted');
  }
  function requireMaintenance(row) {
    if (!row || row._id !== controlId || row.company !== company || row.cohort !== COHORT
      || row.mode !== 'MAINTENANCE' || row.generation !== 0 || row.pending !== null
      || row.schemaVersion !== 1 || row.transferIndexVersion !== 2 || !row._version
      || !row.bootstrapMemberId || !row.bootstrapRequestId || row.writerBuild) {
      throw Error('Unchanged fresh maintenance genesis required; no legacy migration or reactivation');
    }
  }
  async function readiness(owner, before) {
    await authorize(owner);
    const empty = await inspectFreshBusiness({ cohort: COHORT, company });
    if (empty?.cohort !== COHORT || empty.company !== company || empty.emptyBusiness !== true
      || empty.pending !== false || empty.unknownRecords !== false) throw Error('Fresh business emptiness not verified');
    const evidence = await verifyNativeAcceptance({ cohort: COHORT, company, build });
    if (evidence?.cohort !== COHORT || evidence.company !== company || evidence.build !== build
      || !/^[a-f0-9]{64}$/.test(evidence.digest || '')
      || REQUIRED.some(name => evidence.checks?.[name] !== true)
      || WRITERS.some(name => evidence.writers?.[name]?.verified !== true || evidence.writers[name].build !== build)
      || evidence.realInvoiceEnabled !== false || evidence.physicalDispatchEnabled !== false) {
      throw Error('Native acceptance incomplete; activation remains blocked');
    }
    await authorize(owner);
    if (!same(await store.read(journal, controlId), before)) throw Error('Maintenance control changed during acceptance');
    return evidence.digest;
  }
  async function activate(input) {
    request(input);
    const owner = await authorize(), before = await store.read(journal, controlId);
    requireMaintenance(before);
    const digest = await readiness(owner, before);
    const after = { ...copy(before), mode: 'ACTIVE', writerBuild: build,
      activationRequestId: input.requestId, activationMemberId: owner,
      activationEvidenceDigest: digest,
      _version: hash(COHORT, company, before._version, build, input.requestId, digest) };
    // Exactly one conditional mutation. A lost reply propagates, without retry,
    // rollback, lock deletion, generation reset or inference from elapsed time.
    await store.compareAndSet(journal, controlId, before._version, after);
    if (!same(await store.read(journal, controlId), after)) throw Error('Activation outcome unconfirmed; inspect original request');
    await authorize(owner);
    return { cohort: COHORT, company, build, requestId: input.requestId, mode: 'ACTIVE',
      generation: 0, realInvoiceEnabled: false, physicalDispatchEnabled: false };
  }
  async function inspect(input) {
    request(input); const owner = await authorize(), row = await store.read(journal, controlId);
    await authorize(owner);
    const confirmed = row?._id === controlId && row.company === company && row.cohort === COHORT
      && row.mode === 'ACTIVE' && row.writerBuild === build && row.activationRequestId === input.requestId
      && row.activationMemberId === owner && /^[a-f0-9]{64}$/.test(row.activationEvidenceDigest || '');
    return { cohort: COHORT, company, build, requestId: input.requestId, activationRecorded: confirmed,
      mode: row?.mode || null, businessAcceptanceImplied: false };
  }
  return { activate, inspect };
}
module.exports = { createFreshCohortActivation, REQUIRED };
