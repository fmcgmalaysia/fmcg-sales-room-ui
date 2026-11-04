const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process'), { createHash } = require('node:crypto');
const { verifyNativeTypedRoundtrip } = require('../prototypes/stock-current-state/native-typed-roundtrip-probe.cjs');
const { createSdkConditionalStore } = require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const folder = path.join(__dirname, '../prototypes/stock-current-state'), id = 'SPT-TYPE-bebf13e4-dd59-4240-9390-97fc106a66b0';
const input = { confirmation: 'ONE_RETAINED_TYPED_SYNTHETIC_ROW_NO_DELETE' };
function fixture(fault = {}) {
 let row = fault.occupied ? { _id: id, privatePayload: 'RETAIN_PRIVATE_EXISTING' } : null;
 const calls = { queries: [], inserts: [], patches: [] }, date = value => Object.prototype.toString.call(value) === '[object Date]';
 const clone = value => structuredClone(value);
 const readReply = () => {
  if (!row) return null; const reply = clone(row);
  if (fault.dateStringAtRead === calls.queries.length) reply.activityTime = row.activityTime.toISOString();
  return reply;
 };
 const items = {
  query(collection) {
   assert.equal(collection, 'StockProtocolTest'); let identities;
   const q = { eq: (field, value) => { assert.equal(field, '_id'); assert.equal(value, id); identities = [value]; return q; },
    hasSome: (field, values) => { assert.equal(field, '_id'); assert.equal(values.length, 1); assert.equal(values[0], id); identities = values; return q; },
    limit: size => { assert.equal(size, 2); return q; },
    find: async options => {
     assert.equal(options.consistentRead, true); calls.queries.push({ identities, options: clone(options) });
     if (calls.queries.length === fault.errorReadAt) throw Error('PRIVATE transport details');
     const reply = readReply(), page = { items: reply ? [reply] : [], totalCount: reply ? 1 : 0 };
     if (calls.queries.length === fault.partialReadAt) page.totalCount++;
     if (calls.queries.length === fault.foreignReadAt && page.items[0]) page.items[0]._id = 'FOREIGN_PRIVATE_ID';
     return page;
    } }; return q;
  },
  async insert(collection, value) {
   assert.equal(collection, 'StockProtocolTest'); assert.equal(value._id, id); assert.equal(value.company, 'NCT');
   for (const field of ['activityTime', 'lastCostCaptureTime', 'estimatedShipmentDate', 'masterReceivedTime', 'salesSubmissionTime']) assert.ok(date(value[field]), field);
   calls.inserts.push(clone(value)); if (row) throw Error('PRIVATE duplicate fixture');
   row = { ...clone(value), _createdDate: new Date(), _updatedDate: new Date(), _owner: 'PRIVATE_OWNER' };
   if (fault.dateLookingTextAsDate) row.message = new Date(row.message);
   if (fault.nestedDate) row.details.activityTime = new Date(row.details.activityTime);
   if (fault.booleanString) row.reviewRequired = 'false';
   if (fault.leadingZeroLoss) row.barcode = Number(row.barcode);
   if (fault.extraField) row.providerAddedField = 'PRIVATE_UNEXPECTED';
   if (fault.insertTimeoutAfterApply) throw Error('PRIVATE lost insert response');
   const reply = clone(row); if (fault.insertDateString) reply.activityTime = row.activityTime.toISOString(); return reply;
  },
  patch(collection, identity) {
   assert.equal(collection, 'StockProtocolTest'); assert.equal(identity, id); const changed = {}, removed = [];
   const p = { setField: (field, value) => { changed[field] = clone(value); return p; }, removeField: field => { removed.push(field); return p; },
    run: async options => {
     calls.patches.push({ changed: clone(changed), removed: [...removed], options: clone(options) });
     assert.equal(options.condition.company.$eq, 'NCT'); assert.equal(options.condition.stockCommitVersion.$eq, row.stockCommitVersion);
     assert.ok(date(changed.activityTime)); assert.equal(changed.estimatedShipmentDate, null); assert.equal(changed.quantity, 0);
     assert.equal(changed.reviewRequired, true); assert.ok(removed.includes('obsoleteFlag'));
     if (fault.patchReject) throw Error('WDE0193: Update condition not met.');
     row = { ...row, ...clone(changed), _updatedDate: new Date() }; removed.forEach(field => { delete row[field]; });
     if (fault.nullOmitted) delete row.estimatedShipmentDate;
     if (fault.nullString) row.estimatedShipmentDate = 'null';
     if (fault.zeroOmitted) delete row.quantity;
     if (fault.arrayString) row.participantTaskIds = JSON.stringify(row.participantTaskIds);
     if (fault.patchTimeoutAfterApply) throw Error('PRIVATE lost patch response');
     return clone(row);
    } }; return p;
  }
  // No native remove method: the probe itself supplies only a throwing stub.
 };
 return { items, calls, stored: () => clone(row), createSdkConditionalStore };
}
function safeReport(result) {
 assert.equal(result.originalBusinessCollectionsAccepted, false); assert.equal(result.productionCapacityAccepted, false);
 assert.equal(result.activationReady, false); assert.equal(result.replayAllowed, false); assert.equal(result.deletionAttempted, false);
 assert.equal(result.recordRetentionPolicy, 'RETAIN_ANY_CREATED_FIXTURE');
 assert.doesNotMatch(JSON.stringify(result), /SPT-TYPE-|PRIVATE|095500001|000123|Retained isolated|2026-10|stockCommitVersion/);
}
test('exact shared codec/adapter preserves five native dates, date-looking text, nested strings, tags, zero, booleans, null and removals', async () => {
 const f = fixture(), result = await verifyNativeTypedRoundtrip({ ...f, input });
 assert.equal(result.ok, true); safeReport(result); assert.deepEqual(result.operationsAttempted, { queries: 9, inserts: 1, patches: 1 });
 assert.deepEqual(result.checks, ['INSERT_NATIVE_TYPES', 'SHARED_ADAPTER_READ_AND_BATCH', 'CONDITIONAL_NATIVE_PATCH', 'INVALID_DATE_REFUSES_BEFORE_TRANSPORT']);
 const row = f.stored(); assert.equal(row.quantity, 0); assert.equal(row.reviewRequired, true); assert.equal(row.estimatedShipmentDate, null);
 assert.equal(row.stockCommitVersion, 'TYPED-V1'); assert.equal(typeof row.message, 'string'); assert.equal(row.barcode, '095500001');
 assert.equal(row.supplierPoNumber, '000123'); assert.equal(Object.hasOwn(row, 'obsoleteFlag'), false); assert.equal(Object.hasOwn(row, '_version'), false);
 assert.equal(f.calls.inserts.length, 1); assert.equal(f.calls.patches.length, 1);
});
test('existing or previously completed fixed fixture refuses before mutation and never resets/replays', async () => {
 const f = fixture({ occupied: true }), before = f.stored(), blocked = await verifyNativeTypedRoundtrip({ ...f, input });
 assert.equal(blocked.ok, false); assert.equal(blocked.mutationAttempted, false); assert.deepEqual(f.stored(), before); assert.equal(f.calls.inserts.length, 0); safeReport(blocked);
 const g = fixture(); await verifyNativeTypedRoundtrip({ ...g, input }); const result = await verifyNativeTypedRoundtrip({ ...g, input });
 assert.equal(result.ok, false); assert.deepEqual(result.operationsAttempted, { queries: 1, inserts: 0, patches: 0 }); safeReport(result);
});
test('native dates must remain actual Date values even when canonical-looking data could otherwise compare equal', async () => {
 for (const fault of [{ insertDateString: true }, { dateStringAtRead: 2 }, { dateLookingTextAsDate: true }, { nestedDate: true }]) {
  const f = fixture(fault), result = await verifyNativeTypedRoundtrip({ ...f, input });
  assert.equal(result.ok, false, JSON.stringify(fault)); assert.equal(f.calls.patches.length, 0); assert.ok(f.stored()); safeReport(result);
 }
});
test('null/zero omission, stringified arrays/booleans, leading-zero loss and unexpected fields do not become a verified roundtrip', async () => {
 for (const name of ['nullOmitted', 'nullString', 'zeroOmitted', 'arrayString', 'booleanString', 'leadingZeroLoss', 'extraField']) {
  const f = fixture({ [name]: true }), result = await verifyNativeTypedRoundtrip({ ...f, input });
  assert.equal(result.ok, false, name); assert.ok(f.calls.inserts.length <= 1); assert.ok(f.calls.patches.length <= 1); safeReport(result);
 }
});
test('partial/foreign reads and errors retain unknown result without retry, inverse writes or provider-message disclosure', async () => {
 for (const fault of [{ partialReadAt: 1 }, { partialReadAt: 4 }, { foreignReadAt: 2 }, { errorReadAt: 8 },
  { insertTimeoutAfterApply: true }, { patchTimeoutAfterApply: true }, { patchReject: true }]) {
  const f = fixture(fault), result = await verifyNativeTypedRoundtrip({ ...f, input }); assert.equal(result.ok, false, JSON.stringify(fault)); safeReport(result);
  assert.ok(f.calls.inserts.length <= 1); assert.ok(f.calls.patches.length <= 1);
  if (fault.insertTimeoutAfterApply) assert.equal(f.stored().stockCommitVersion, 'TYPED-V0');
  if (fault.patchTimeoutAfterApply) assert.equal(f.stored().stockCommitVersion, 'TYPED-V1');
 }
});
test('only explicit fixed-row confirmation is admitted; caller cannot choose table, company, dates, IDs or reset', async () => {
 for (const invalid of [null, [], {}, { confirmation: 'ALLOW' }, { ...input, company: 'GHR' }, { ...input, collection: 'NCTTasks' },
  { ...input, id: 'BUSINESS' }, { ...input, reset: true }, { ...input, activityTime: '2026-10-23' }]) {
  const f = fixture(); await assert.rejects(verifyNativeTypedRoundtrip({ ...f, input: invalid }), /Explicit bounded/);
  assert.equal(f.calls.queries.length, 0); assert.equal(f.calls.inserts.length, 0);
 }
});
test('actual shared adapter receives a throwing removal stub and bounded fixed collection/record capabilities only', async () => {
 const f = fixture(), result = await verifyNativeTypedRoundtrip({ ...f, input,
  createSdkConditionalStore: config => {
   assert.throws(() => config.items.remove('StockProtocolTest', id), /No deletion authorized/);
   assert.throws(() => config.items.query('NCTTasks'), /Fixed isolated scope/);
   assert.throws(() => config.items.patch('StockProtocolTest', 'BUSINESS'), /Fixed isolated scope/);
   assert.throws(() => config.items.insert('NCTTasks', { _id: id }), /Fixed isolated scope/);
   return createSdkConditionalStore(config);
  } });
 assert.equal(result.ok, true); assert.deepEqual(result.operationsAttempted, { queries: 9, inserts: 1, patches: 1 }); safeReport(result);
});
test('generated new Admin-only wrapper embeds exact current codec/store, has no native deletion and is excluded from installation', async () => {
 assert.match(execFileSync(process.execPath, [path.join(folder, 'build-typed-roundtrip-probe.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
 const source = fs.readFileSync(path.join(folder, 'stockProtocolTypedRoundtrip.web.js'), 'utf8');
 const body = (name, symbol) => fs.readFileSync(path.join(folder, name), 'utf8').replace(/\r\n/g, '\n')
  .replace(/^'use strict';\n/, '').replace(new RegExp('module\\.exports = \\{ ' + symbol + ' \\};\\s*$'), '');
 assert.ok(source.includes(body('sdk-field-codec.cjs', 'createSdkFieldCodec')));
 const adapter = body('sdk-conditional-store.cjs', 'createSdkConditionalStore')
  .replace("const { createSdkFieldCodec } = require('./sdk-field-codec.cjs');", '')
  .replace("const { hash } = require('./commit-proof.cjs');", "const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);");
 assert.ok(source.includes(adapter)); assert.equal((source.match(/webMethod\(Permissions.Admin/g) || []).length, 1);
 assert.doesNotMatch(source, /Permissions\.(Anyone|SiteMember)|suppressAuth|readControl|setMode|while\s*\(/);
 // The unchanged full adapter contains compareAndRemove, but its provider is the
 // throwing bounded stub above, NOT native items. Inspect the invoking probe too.
 assert.doesNotMatch(body('native-typed-roundtrip-probe.cjs', 'verifyNativeTypedRoundtrip'), /items\.remove\(/);
 const f = fixture(); let permission;
 const api = vm.runInNewContext(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';verifyStockTypedRoundtrip;',
  { items: f.items, createHash, Permissions: { Admin: 'ADMIN' }, webMethod: (grant, fn) => { permission = grant; return fn; } });
 assert.equal(permission, 'ADMIN'); assert.equal((await api({})).ok, false); assert.equal(f.calls.queries.length, 0);
 const result = await api(input); assert.equal(result.ok, true); safeReport(result);
 const manifest = require('../prototypes/stock-current-state/current-install-manifest.json');
 assert.equal(manifest.install.some(row => row.target === 'stockProtocolTypedRoundtrip.web.js'), false);
});
