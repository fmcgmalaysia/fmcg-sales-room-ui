'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createFreshCohortActivation, REQUIRED } = require('../prototypes/stock-current-state/fresh-cohort-activation.cjs');
const { COHORT } = require('../prototypes/stock-current-state/isolated-cohort.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const build = 'a'.repeat(40), requestId = '11111111-1111-4111-8111-111111111111';
function fixture(company = 'NCT') {
  let row = { _id: hash(company, 'STOCK_CONTROL'), company, cohort: COHORT, mode: 'MAINTENANCE',
    schemaVersion: 1, transferIndexVersion: 2, generation: 0, pending: null, _version: 'GENESIS',
    bootstrapMemberId: 'original-admin', bootstrapRequestId: 'original-request' };
  const f = { calls: [], empty: true, unknown: false, loseReply: false, actor: 'admin',
    evidence: { cohort: COHORT, company, build, digest: 'b'.repeat(64),
      checks: Object.fromEntries(REQUIRED.map(name => [name, true])),
      writers: Object.fromEntries(WRITERS.map(name => [name, { verified: true, build }])),
      realInvoiceEnabled: false, physicalDispatchEnabled: false },
    mutate: patch => Object.assign(row, patch), row: () => structuredClone(row) };
  f.api = createFreshCohortActivation({ company, build,
    store: { read: async (c, id) => { f.calls.push(['read', c, id]); return structuredClone(row); },
      compareAndSet: async (c, id, version, after) => {
        f.calls.push(['CAS', c, id]);
        if (f.race) row._version = 'CONCURRENT';
        if (row._version !== version) throw Error('CAS_CONFLICT');
        row = structuredClone(after); if (f.loseReply) throw Error('LOST_REPLY'); return row;
      } }, authenticateAdmin: async () => ({ isAdmin: !!f.actor, memberId: f.actor }),
    inspectFreshBusiness: async () => ({ cohort: COHORT, company, emptyBusiness: f.empty, pending: false, unknownRecords: f.unknown }),
    verifyNativeAcceptance: async () => { if (f.changeDuringEvidence) row._version = 'CHANGED'; return f.evidence; } });
  return f;
}
test('fresh NCT/GHR transition preserves bootstrap and generation, uses only paired R2 journal and one CAS', async () => {
  for (const company of ['NCT', 'GHR']) {
    const f = fixture(company), before = f.row();
    assert.equal((await f.api.activate({ requestId })).mode, 'ACTIVE');
    assert.equal(f.row().bootstrapRequestId, before.bootstrapRequestId);
    assert.equal(f.row().generation, 0);
    assert.equal(f.calls.filter(([op]) => op === 'CAS').length, 1);
    assert.ok(f.calls.every(([, c]) => c === (company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1')));
    assert.equal((await f.api.inspect({ requestId })).activationRecorded, true);
  }
});
test('each missing native gate or writer refuses without mutation', async () => {
  for (const name of REQUIRED) {
    const f = fixture(); f.evidence.checks[name] = false;
    await assert.rejects(f.api.activate({ requestId }), /acceptance incomplete/);
    assert.equal(f.calls.some(([op]) => op === 'CAS'), false);
  }
  for (const name of WRITERS) {
    const f = fixture(); f.evidence.writers[name].build = 'other-build';
    await assert.rejects(f.api.activate({ requestId }), /acceptance incomplete/);
    assert.equal(f.calls.some(([op]) => op === 'CAS'), false);
  }
});
test('business data, unknown rows, legacy control, pending save and non-admin cannot activate', async () => {
  for (const change of [f => f.empty = false, f => f.unknown = true, f => f.actor = '',
    f => f.mutate({ mode: 'LEGACY' }), f => f.mutate({ generation: 1 }), f => f.mutate({ pending: {} }),
    f => f.mutate({ cohort: 'OLD' }), f => f.mutate({ writerBuild: build })]) {
    const f = fixture(); change(f); await assert.rejects(f.api.activate({ requestId }));
    assert.equal(f.calls.some(([op]) => op === 'CAS'), false);
  }
});
test('browser cannot supply coverage or build; changed control and atomic race refuse', async () => {
  const f = fixture();
  await assert.rejects(f.api.activate({ requestId, coverage: true }));
  assert.equal(f.calls.length, 0);
  f.changeDuringEvidence = true;
  await assert.rejects(f.api.activate({ requestId }), /control changed/);
  assert.equal(f.calls.some(([op]) => op === 'CAS'), false);
  const raced = fixture(); raced.race = true;
  await assert.rejects(raced.api.activate({ requestId }), /CAS_CONFLICT/);
  assert.equal(raced.row().mode, 'MAINTENANCE');
});
test('lost response is never retried; read-only same-request inspection confirms retained activation', async () => {
  const f = fixture(); f.loseReply = true;
  await assert.rejects(f.api.activate({ requestId }), /LOST_REPLY/);
  assert.equal((await f.api.inspect({ requestId })).activationRecorded, true);
  assert.equal((await f.api.inspect({ requestId: '22222222-2222-4222-8222-222222222222' })).activationRecorded, false);
  await assert.rejects(f.api.activate({ requestId }), /maintenance genesis/);
  assert.equal(f.calls.filter(([op]) => op === 'CAS').length, 1);
});

test('malformed or coercible request identity is rejected before any storage read', async () => {
  for (const invalid of ['-'.repeat(36), 'a'.repeat(36), [requestId], { toString: () => requestId }, null]) {
    const f = fixture();
    await assert.rejects(f.api.activate({ requestId: invalid }), /request identity/);
    await assert.rejects(f.api.inspect({ requestId: invalid }), /request identity/);
    assert.equal(f.calls.length, 0);
  }
});
