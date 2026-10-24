const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../prototypes/stock-current-state/stockMaintenanceAdmin.web.js'), 'utf8');
const backupRequestId = '88888888-1111-4111-8111-111111111111', requestId = '77777777-1111-4111-8111-111111111111';
const checkpointId = 'a'.repeat(32), plain = value => JSON.parse(JSON.stringify(value));
function fixture({ openTestBoundary = false, member = { _id: 'ACTUAL_ADMIN', status: 'APPROVED' } } = {}) {
  const registrations = [], calls = [], configurations = {};
  const currentMember = { getMember: async input => { calls.push(['identity', plain(input)]); return member; } };
  const rows = { read: async () => {}, normalizeListedRow() {} }, protocol = { readControl: async () => ({ mode: 'MAINTENANCE' }) };
  const reader = { read: async () => { calls.push(['capture']); return 'CAPTURE'; },
    readOwnedMigration: async input => { calls.push(['ownedCapture', plain(input)]); return 'OWNED_CAPTURE'; } };
  const backup = { retain: async input => { calls.push(['retain', plain(input)]); return 'RETAIN'; },
    inspect: async input => { calls.push(['backup', plain(input)]); return 'BACKUP'; },
    metadataReader: input => { calls.push(['metadataReader', plain(input)]); return 'METADATA_READER'; } };
  const bindings = { currentMember, items: { query() { throw Error('unexpected native item query'); } },
    collections: { getDataCollection: async (name, options) => { calls.push(['privacy', name, plain(options)]); return {
      _id: name, permissions: { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' } }; } },
    Permissions: { Admin: 'ADMIN_ONLY' }, webMethod: (permission, fn) => { registrations.push(permission); return fn; },
    projectPurchaseWorkspace() {}, projectStockCard() {}, projectPurchaseOrders() {},
    planCollections: (company, domain) => { calls.push(['scope', company, domain]); return ['EXACT_NATIVE_SCOPE']; },
    createSdkConditionalStore: input => { configurations.store = input; return rows; },
    createSegmentedFencedProof: input => { configurations.protocol = input; return protocol; },
    createMaintenanceSnapshotReader: input => { configurations.reader = input; return reader; },
    createMaintenanceBackupStore: input => { configurations.backup = input; return backup; },
    createMaintenanceInstalledReader: input => { configurations.installed = input; return 'INSTALLED'; },
    createMaintenanceMetadataInitializer: input => { configurations.metadata = input; return { step: async value => { calls.push(['metadata', plain(value)]); return 'INITIALIZED'; } }; },
    createRetainedMaintenanceCapture: input => { configurations.capture = input; return 'RETAINED_CAPTURE'; },
    createMaintenanceControlInitializer: input => { configurations.control = input; return {
      initialize: async value => { calls.push(['initializeControl', plain(value)]); return 'CONTROL_INITIALIZED'; },
      inspect: async value => { calls.push(['inspectControl', plain(value)]); return 'CONTROL_INSPECTED'; } }; },
    createMaintenanceMigration: input => { configurations.migration = input; return { apply: async value => { calls.push(['apply', plain(value)]); return 'APPLIED'; },
      inspect: async value => { calls.push(['inspect', plain(value)]); return 'INSPECTED'; } }; } };
  let executable = source.replace(/^import\s+[\s\S]*?from '[^']+';\r?\n/gm, '').replace(/^export /gm, '');
  if (openTestBoundary) {
    const closed = /async function verifyLegacyDrain\(\) \{\r?\n  throw Error\('[^']+'\);\r?\n\}/;
    assert.match(executable, closed);
    // Test harness only: actual distributed source ALWAYS throws. This checks the
    // downstream composition, not native drain evidence or installation success.
    executable = executable.replace(closed, 'async function verifyLegacyDrain() { return true; }');
  }
  const exports = [...source.matchAll(/^export const (\w+)/gm)].map(match => match[1]);
  const api = vm.runInNewContext('(function(){' + executable + '\nreturn {' + exports.join(',') + '};})()', bindings);
  return { api, registrations, calls, configurations, bindings, backup };
}
const operationInputs = company => ({
  initializeStockMaintenanceControl: { company, requestId }, inspectStockMaintenanceControl: { company, requestId },
  captureStockMaintenance: { company }, retainStockMaintenanceBackup: { company, backupRequestId },
  inspectStockMaintenanceBackup: { company, backupRequestId }, initializeStockMaintenanceMetadata: { company, backupRequestId, checkpointId, ordinal: 0 },
  applyStockMaintenanceMigration: { company, backupRequestId, checkpointId, requestId },
  inspectStockMaintenanceMigration: { company, backupRequestId, checkpointId, requestId }
});
test('all eight real maintenance exports require platform Admin, not SiteMember or staff-role inference', () => {
  const f = fixture(); assert.equal(f.registrations.length, 8); assert.ok(f.registrations.every(value => value === 'ADMIN_ONLY'));
  assert.doesNotMatch(source, /Permissions\.(Anyone|SiteMember)|suppressAuth|elevate\(|getPurchaseStaffContext|\.getRoles\(/);
  assert.doesNotMatch(source, /protocol\.initialize\(|mode:\s*'ACTIVE'|writerCoverage|setTimeout|\.catch\(/);
});
test('shipped native root refuses every operation before any SDK or pipeline work while drain is unknown', async () => {
  for (const [name, input] of Object.entries(operationInputs('NCT'))) {
    const f = fixture(); await assert.rejects(f.api[name](input), /provider drain or sufficient legacy fencing/);
    assert.deepEqual(f.calls, [['identity', { fieldsets: ['FULL'] }]]); assert.deepEqual(f.configurations, {});
  }
});
test('malformed identities and browser authority/images/policies refuse before even identity access', async () => {
  for (const [name, input] of Object.entries(operationInputs('NCT'))) for (const extra of [
    { isAdmin: true }, { memberId: 'OTHER' }, { drain: true }, { mode: 'MAINTENANCE' }, { policy: {} }, { rows: [] }, { company: 'FOREIGN' }
  ]) { const f = fixture(); await assert.rejects(f.api[name]({ ...input, ...extra }), /Exact original/); assert.deepEqual(f.calls, []); }
});
test('missing/unapproved actual member refuses without fallback identities, even with test boundary opened', async () => {
  for (const member of [null, {}, { _id: 'M', status: 'BLOCKED' }, { status: 'APPROVED', _id: '' }]) {
    const f = fixture({ member, openTestBoundary: true });
    await assert.rejects(f.api.captureStockMaintenance({ company: 'NCT' }), /Actual approved/); assert.deepEqual(f.configurations, {});
  }
});
for (const company of ['NCT', 'GHR']) test(company + ' explicit test-only boundary connects exact native scope and all original migration seams', async () => {
  const f = fixture({ openTestBoundary: true }), input = operationInputs(company), c = f.configurations;
  assert.equal(await f.api.initializeStockMaintenanceControl(input.initializeStockMaintenanceControl), 'CONTROL_INITIALIZED');
  assert.equal(await f.api.inspectStockMaintenanceControl(input.inspectStockMaintenanceControl), 'CONTROL_INSPECTED');
  assert.equal(await f.api.captureStockMaintenance(input.captureStockMaintenance), 'CAPTURE');
  assert.equal(c.reader.items, f.bindings.items); assert.equal(c.store.items, f.bindings.items);
  assert.equal(c.store.company, company); assert.deepEqual(plain(c.store.collections), ['EXACT_NATIVE_SCOPE']);
  assert.deepEqual(plain(c.store.dateTimeFields), { [company === 'NCT' ? 'NCTActivity' : 'NCTActivity1']: ['activityTime'],
    [company === 'NCT' ? 'NCTOrders' : 'NCTOrders1']: ['masterReceivedTime', 'salesSubmissionTime'],
    [company === 'NCT' ? 'NCTTasks' : 'NCTTasks1']: ['lastCostCaptureTime'] });
  assert.equal(await f.api.retainStockMaintenanceBackup(input.retainStockMaintenanceBackup), 'RETAIN');
  assert.equal(await f.api.inspectStockMaintenanceBackup(input.inspectStockMaintenanceBackup), 'BACKUP');
  assert.equal(await f.api.initializeStockMaintenanceMetadata(input.initializeStockMaintenanceMetadata), 'INITIALIZED');
  assert.equal(c.metadata.readCapturedRow, 'METADATA_READER');
  assert.equal(await f.api.applyStockMaintenanceMigration(input.applyStockMaintenanceMigration), 'APPLIED');
  assert.equal(c.migration.capture, 'RETAINED_CAPTURE'); assert.equal(c.migration.readInstalled, 'INSTALLED');
  assert.deepEqual(plain(c.capture.backupRequest), { requestId: backupRequestId });
  const owned = { requestId, checkpointId }; assert.equal(await c.capture.readSnapshot(owned), 'OWNED_CAPTURE');
  assert.equal(await c.capture.readSnapshot(), 'CAPTURE');
  assert.equal(await f.api.inspectStockMaintenanceMigration(input.inspectStockMaintenanceMigration), 'INSPECTED');
  assert.deepEqual(f.calls.filter(row => ['metadata', 'apply', 'inspect'].includes(row[0])), [
    ['metadata', { checkpointId, ordinal: 0 }], ['apply', { checkpointId, requestId }], ['inspect', { checkpointId, requestId }]
  ]);
  assert.deepEqual(plain(await c.reader.authenticateAdmin()), { isAdmin: true, memberId: 'ACTUAL_ADMIN' });
  f.bindings.currentMember.getMember = async () => ({ _id: 'OTHER_ADMIN', status: 'APPROVED' });
  await assert.rejects(c.reader.authenticateAdmin(), /administrator changed/);
});
test('private retention verifier reads exact company journal metadata; no ACL mutation or ability equals privacy', async () => {
  const f = fixture({ openTestBoundary: true }); await f.api.captureStockMaintenance({ company: 'NCT' });
  const verify = f.configurations.backup.verifyPrivateRetention;
  assert.equal(await verify({ company: 'NCT', collection: 'NCTActivity' }), true);
  for (const permissions of [null, {}, { read: 'ANYONE', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' }]) {
    f.bindings.collections.getDataCollection = async () => ({ _id: 'NCTActivity', permissions });
    assert.equal(await verify({ company: 'NCT', collection: 'NCTActivity' }), false);
  }
  await assert.rejects(verify({ company: 'GHR', collection: 'NCTActivity1' }), /Exact private/);
});
test('native control schema verifier rejects missing/wrong/duplicate field metadata without any schema mutation', async () => {
  const f = fixture({ openTestBoundary: true }); await f.api.captureStockMaintenance({ company: 'NCT' });
  const verify = f.configurations.control.verifyControlSchema;
  const required = { company: 'TEXT', stockCommitVersion: 'TEXT', mode: 'TEXT', schemaVersion: 'NUMBER',
    transferIndexVersion: 'NUMBER', generation: 'NUMBER', pending: 'OBJECT' };
  const fields = Object.entries(required).map(([key, type]) => ({ key, type }));
  f.bindings.collections.getDataCollection = async () => ({ _id: 'NCTActivity', fields });
  assert.equal(await verify({ company: 'NCT', collection: 'NCTActivity' }), true);
  for (const bad of [fields.slice(1), [...fields, fields[0]], fields.map(field => field.key === 'pending' ? { ...field, type: 'TEXT' } : field)]) {
    f.bindings.collections.getDataCollection = async () => ({ _id: 'NCTActivity', fields: bad });
    assert.equal(await verify({ company: 'NCT', collection: 'NCTActivity' }), false);
  }
});
test('unknown native mutation outcomes propagate once without creating new request identities or automatic retry', async () => {
  const f = fixture({ openTestBoundary: true });
  const error = Error('Unknown native write outcome'); let attempts = 0;
  f.backup.retain = async input => { attempts++; assert.deepEqual(plain(input), { requestId: backupRequestId }); throw error; };
  await assert.rejects(f.api.retainStockMaintenanceBackup({ company: 'NCT', backupRequestId }), value => value === error);
  assert.equal(attempts, 1);
  assert.doesNotMatch(source, /catch\s*\(|while\s*\(|for\s*\(/);
});
