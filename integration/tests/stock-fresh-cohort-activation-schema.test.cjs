'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createFreshCohortActivationSchemaVerifier, activationAuditFields } = require('../prototypes/stock-current-state/fresh-cohort-activation-schema.cjs');
const { controlFields } = require('../prototypes/stock-current-state/fresh-cohort-bootstrap.cjs');
function fixture() {
  const metadata = new Map(['R2NCTActivity', 'R2NCTActivity1'].map(target => [target, {
    _id: target, revision: '1', fields: Object.entries(activationAuditFields).map(([key, type]) => ({ key, type })),
    permissions: { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' }
  }]));
  const f = { metadata, calls: [], actor: 'ADMIN', authorizations: 0 };
  const collections = { getDataCollection: async (target, options) => {
    f.calls.push([target, options]);
    if (f.error) throw Error('NATIVE_READ_UNKNOWN');
    let result = structuredClone(metadata.get(target));
    if (f.transform) result = f.transform(result, f.calls.length);
    return result;
  } };
  for (const method of ['updateDataCollectionField', 'updateDataCollection', 'createDataCollection', 'removeDataCollection']) {
    collections[method] = () => { throw Error('NO_SCHEMA_MUTATION'); };
  }
  f.api = createFreshCohortActivationSchemaVerifier({ collections,
    authenticateAdmin: async () => { f.authorizations++; if (f.authChange) f.authChange(f); return { isAdmin: !!f.actor, memberId: f.actor }; },
    items: new Proxy({}, { get: () => { throw Error('NO_ITEM_CAPABILITY'); } }),
    indexes: new Proxy({}, { get: () => { throw Error('STOPPED_INDEX_PATH'); } }) });
  return f;
}

test('fixed two-journal read-only check never claims whole business/schema, writer or activation acceptance', async () => {
  const f = fixture(), before = structuredClone(f.metadata), result = await f.api.inspect({});
  assert.equal(result.activationAuditSchemaMatches, true); assert.deepEqual(result.issues, []);
  assert.deepEqual(f.calls.map(([target]) => target), ['R2NCTActivity', 'R2NCTActivity', 'R2NCTActivity1', 'R2NCTActivity1']);
  assert.ok(f.calls.every(([, options]) => options.consistentRead === true));
  for (const flag of ['indexesRead', 'businessRowsRead', 'mutationCapability', 'fullBusinessSchemaAccepted', 'writerCoverageAccepted', 'activationAllowed']) assert.equal(result[flag], false);
  assert.ok(result.rows.every(row => /^[a-f0-9]{64}$/.test(row.metadataSha256)));
  assert.deepEqual(f.metadata, before);
});

test('the previously accepted bootstrap field set is insufficient for persisted activation audit', async () => {
  const f = fixture(), bootstrap = { ...controlFields, bootstrapMemberId: 'TEXT', bootstrapRequestId: 'TEXT' };
  for (const row of f.metadata.values()) row.fields = Object.entries(bootstrap).map(([key, type]) => ({ key, type }));
  const result = await f.api.inspect({});
  assert.equal(result.activationAuditSchemaMatches, false); assert.equal(result.issues.length, 8);
  assert.deepEqual([...new Set(result.issues.map(row => row.field))].sort(),
    ['activationEvidenceDigest', 'activationMemberId', 'activationRequestId', 'writerBuild']);
  assert.ok(result.issues.every(row => row.code === 'AUDIT_FIELD_MISSING'));
});

test('every required field missing or mistyped is reported without overwrite, for both companies', async () => {
  for (const target of ['R2NCTActivity', 'R2NCTActivity1']) for (const key of Object.keys(activationAuditFields)) {
    const f = fixture(), row = f.metadata.get(target); row.fields = row.fields.filter(field => field.key !== key);
    let result = await f.api.inspect({});
    assert.deepEqual(result.issues, [{ collection: target, field: key, expectedType: activationAuditFields[key], code: 'AUDIT_FIELD_MISSING' }]);
    row.fields.push({ key, type: activationAuditFields[key] === 'TEXT' ? 'NUMBER' : 'TEXT' });
    result = await f.api.inspect({}); assert.equal(result.issues[0].code, 'FIELD_TYPE_CONFLICT_NO_OVERWRITE');
  }
});

test('extra preserved fields and object key reordering are not schema conflicts', async () => {
  const f = fixture();
  for (const row of f.metadata.values()) row.fields.push({ key: 'unrelated', type: 'TEXT', displayName: 'Existing display' });
  f.transform = (row, call) => call % 2 ? row : Object.fromEntries(Object.entries(row).reverse());
  assert.equal((await f.api.inspect({})).activationAuditSchemaMatches, true);
});

test('metadata revision, permissions or field changes during the paired read refuse without retry', async () => {
  for (const change of [row => row.revision = '2', row => row.fields.push({ key: 'newField', type: 'TEXT' }),
    row => row.permissions.read = 'ANYONE']) {
    const f = fixture(); f.transform = (row, call) => { if (call === 2) change(row); return row; };
    await assert.rejects(f.api.inspect({}), /changed during readback|Admin-only/);
    assert.equal(f.calls.length, 2);
  }
});

test('reused mutable SDK response cannot erase the earlier observation', async () => {
  const row = { _id: 'R2NCTActivity', revision: '1', fields: [], permissions: { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' } };
  let calls = 0;
  const api = createFreshCohortActivationSchemaVerifier({ authenticateAdmin: async () => ({ isAdmin: true, memberId: 'ADMIN' }),
    collections: { getDataCollection: async () => { if (++calls === 2) row.revision = '2'; return row; } } });
  await assert.rejects(api.inspect({}), /changed during readback/); assert.equal(calls, 2);
});

test('denied or changed administrator stops reads before further metadata access', async () => {
  for (const at of [1, 2, 3, 4]) {
    const f = fixture(); f.authChange = current => { if (current.authorizations === at) current.actor = at === 1 ? '' : 'DIFFERENT_ADMIN'; };
    await assert.rejects(f.api.inspect({}), /Same actual administrator/);
    assert.equal(f.calls.length, [0, 1, 3, 4][at - 1]);
  }
});

test('browser cannot choose collection, company, build, coverage, mode or operation', async () => {
  for (const input of [null, [], '', 1, { collection: 'NCTActivity' }, { company: 'GHR' }, { build: 'x' },
    { coverage: true }, { mode: 'ACTIVE' }, { step: 'SEED' }]) {
    const f = fixture(); await assert.rejects(f.api.inspect(input), /server-owned/);
    assert.equal(f.calls.length, 0); assert.equal(f.authorizations, 0);
  }
});

test('malformed, duplicate, oversized or public metadata never becomes positive evidence', async () => {
  for (const change of [row => row._id = 'NCTActivity', row => delete row.revision, row => row.revision = NaN,
    row => row.revision = '', row => row.fields.push(row.fields[0]), row => row.fields = {},
    row => row.fields.push({ key: '', type: 'TEXT' }), row => row.fields.push({ key: 'unknown' }),
    row => row.fields = Array.from({ length: 501 }, (_, i) => ({ key: 'f' + i, type: 'TEXT' })),
    ...['read', 'insert', 'update', 'remove'].map(op => row => row.permissions[op] = 'MEMBER')]) {
    const f = fixture(); change(f.metadata.get('R2NCTActivity'));
    await assert.rejects(f.api.inspect({}), /Complete Admin-only/); assert.equal(f.calls.length, 1);
  }
});

test('unknown native metadata error propagates once; no repair, new request or fallback', async () => {
  const f = fixture(); f.error = true;
  await assert.rejects(f.api.inspect({}), /NATIVE_READ_UNKNOWN/); assert.equal(f.calls.length, 1);
});

test('required fields cover actual persisted activation audit, not derived ALLOC projection or internal version alias', () => {
  const folder = path.join(__dirname, '../prototypes/stock-current-state');
  const activation = fs.readFileSync(path.join(folder, 'fresh-cohort-activation.cjs'), 'utf8');
  for (const field of ['writerBuild', 'activationRequestId', 'activationMemberId', 'activationEvidenceDigest']) {
    assert.match(activation, new RegExp('\\b' + field + '\\s*:')); assert.equal(activationAuditFields[field], 'TEXT');
  }
  const projection = fs.readFileSync(path.join(folder, 'build-purchase-projection-candidate.cjs'), 'utf8');
  assert.match(projection, /row\.stockAllocatedCumulative=entry\.quantity/);
  assert.equal(activationAuditFields.stockAllocatedCumulative, undefined);
  assert.equal(activationAuditFields._version, undefined); assert.equal(activationAuditFields.stockCommitVersion, 'TEXT');
  assert.equal(Object.isFrozen(activationAuditFields), true);
});

test('constructor refuses missing read/admin dependencies without creating another capability', () => {
  for (const input of [{}, { collections: {} }, { collections: { getDataCollection() {} } }, { authenticateAdmin() {} }]) {
    assert.throws(() => createFreshCohortActivationSchemaVerifier(input), /Read-only native/);
  }
});

test('actual generated native endpoint is Admin-only and cannot accept table, coverage or activation input', async () => {
  const { source } = require('../prototypes/stock-current-state/build-r2-activation-schema.cjs');
  const vm = require('node:vm'), { createHash } = require('node:crypto');
  const f = fixture(), calls = [], logs = [], registered = [];
  let member = { _id: 'ADMIN', status: 'APPROVED' };
  const context = { createHash, currentMember: { getMember: async () => member },
    collections: { getDataCollection: async (target, options) => { calls.push([target, options]); return structuredClone(f.metadata.get(target)); } },
    Permissions: { Admin: 'EXACT_ADMIN_ONLY' },
    webMethod: (permission, callback) => { registered.push(permission); return callback; },
    console: { info: text => logs.push(text) } };
  vm.createContext(context);
  vm.runInContext(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '')
    + '\nglobalThis.endpoint=inspectActivationAuditSchema;', context);
  assert.deepEqual(registered, ['EXACT_ADMIN_ONLY']);
  assert.equal((await context.endpoint({})).activationAuditSchemaMatches, true);
  assert.equal(calls.length, 4); assert.match(logs[0], /^R2ACTIVATION_SCHEMA_RECEIPT /);
  assert.equal(JSON.parse(logs[0].slice('R2ACTIVATION_SCHEMA_RECEIPT '.length)).activationAllowed, false);
  await assert.rejects(context.endpoint({ collection: 'NCTActivity' }), /server-owned/); assert.equal(calls.length, 4);
  member = { _id: 'ADMIN', status: 'PENDING' };
  await assert.rejects(context.endpoint({}), /approved administrator/); assert.equal(calls.length, 4);
  assert.doesNotMatch(source, /\bitems\b|auth\.elevate|listIndexes|createIndex|updateDataCollection|initializeFreshCohort|compareAndSet/);
});

test('successful audit-field subcheck cannot stand in for full native acceptance at the real activation gate', async () => {
  const { createFreshCohortActivation } = require('../prototypes/stock-current-state/fresh-cohort-activation.cjs');
  const { COHORT } = require('../prototypes/stock-current-state/isolated-cohort.cjs');
  const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
  const schemaEvidence = await fixture().api.inspect({});
  const control = { _id: hash('NCT', 'STOCK_CONTROL'), company: 'NCT', cohort: COHORT, mode: 'MAINTENANCE',
    generation: 0, pending: null, schemaVersion: 1, transferIndexVersion: 2, _version: 'GENESIS',
    bootstrapMemberId: 'ADMIN', bootstrapRequestId: 'original' };
  let mutations = 0;
  const api = createFreshCohortActivation({ company: 'NCT', build: 'a'.repeat(40),
    authenticateAdmin: async () => ({ isAdmin: true, memberId: 'ADMIN' }),
    store: { read: async () => structuredClone(control), compareAndSet: async () => { mutations++; } },
    inspectFreshBusiness: async () => ({ cohort: COHORT, company: 'NCT', emptyBusiness: true, pending: false, unknownRecords: false }),
    verifyNativeAcceptance: async () => schemaEvidence });
  await assert.rejects(api.activate({ requestId: '11111111-1111-4111-8111-111111111111' }), /Native acceptance incomplete/);
  assert.equal(mutations, 0); assert.equal(control.mode, 'MAINTENANCE');
});
