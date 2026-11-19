const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { verifyNativeInitialization } = require('../prototypes/stock-current-state/native-initialization-probe.cjs');
const folder = path.join(__dirname, '../prototypes/stock-current-state');
const input = { confirmation: 'TWO_RETAINED_SYNTHETIC_ROWS_NO_DELETE' };
const fixedIds = ['SPT-INIT-3c82f6a5-58d4-46ef-ae09-1dd52bc460f1', 'SPT-INIT-58eb46cb-1ebf-48bc-b416-936bb23793c0'];
const own = (row, key) => Object.prototype.hasOwnProperty.call(row, key);
function fixture(options = {}) {
 const rows = new Map(), calls = { reads: [], inserts: [], patches: [] };
 let tick = Date.parse('2026-10-23T00:00:00.000Z'), releaseFirstContender;
 const secondContenderApplied = new Promise(resolve => { releaseFirstContender = resolve; });
 const stamp = () => new Date(options.frozenTime ? tick : ++tick);
 if (options.occupied !== undefined) rows.set(fixedIds[options.occupied], { _id: fixedIds[options.occupied], privatePayload: 'RETAIN_EXISTING_PRIVATE' });
 const clone = value => structuredClone(value);
 const matches = (row, predicate) => Object.entries(predicate).every(([key, clause]) => {
  if (own(clause, '$exists')) { assert.equal(clause.$exists, false); return row[key] === null || !own(row, key); }
  if (key === '_updatedDate') { assert.deepEqual(Object.keys(clause.$eq), ['$date']); return row[key].toISOString() === clause.$eq.$date; }
  return row[key] === clause.$eq;
 });
 const items = {
  query(collection) {
   assert.equal(collection, 'StockProtocolTest'); let id;
   const q = { eq: (key, value) => { assert.equal(key, '_id'); assert.ok(fixedIds.includes(value)); id = value; return q; },
    limit: value => { assert.equal(value, 2); return q; }, find: async config => {
     assert.deepEqual(config, { consistentRead: true, returnTotalCount: true }); calls.reads.push(id);
     if (calls.reads.length === options.failReadAt) throw Error('PRIVATE transport details');
     const row = rows.get(id), result = { items: row ? [clone(row)] : [], totalCount: row ? 1 : 0 };
     if (row && options.dateType === 'string') result.items[0]._updatedDate = row._updatedDate?.toISOString();
     if (row && options.dateType === 'null') result.items[0]._updatedDate = null;
     if (row && options.dateType === 'invalid') result.items[0]._updatedDate = new Date(NaN);
     if (calls.reads.length === options.partialReadAt) result.totalCount++;
     if (calls.reads.length === options.foreignReadAt && row) result.items[0]._id = 'FOREIGN_PRIVATE_ID';
     return result;
    } }; return q;
  },
  async insert(collection, value) {
   assert.equal(collection, 'StockProtocolTest'); assert.ok(fixedIds.includes(value._id)); calls.inserts.push(clone(value));
   if (rows.has(value._id) || calls.inserts.length === options.failInsertAt) throw Error('PRIVATE unique insert conflict');
   const row = { ...clone(value), _createdDate: stamp(), _updatedDate: stamp(), _owner: 'PRIVATE_OWNER' };
   if (options.nullVersion) row.stockCommitVersion = null;
   if (options.undefinedVersion) row.stockCommitVersion = undefined;
   if (options.emptyVersion) row.stockCommitVersion = '';
   if (options.nullCompany && value._id === fixedIds[0]) row.company = null;
   if (options.foreignCompany && value._id === fixedIds[1]) row.company = 'GHR';
   if (options.extraInitialCounter) row.stockCounterSchema = 2;
   if (options.extraBusinessDate) row.syntheticBusinessDate = new Date('2026-10-20T10:00:00.000Z');
   rows.set(value._id, row); return clone(row);
  },
  patch(collection, id) {
   assert.equal(collection, 'StockProtocolTest'); assert.ok(fixedIds.includes(id)); const changed = {};
   const p = { setField: (key, value) => { assert.ok(['company', 'stockCommitVersion', 'stockCounterSchema', 'stockDispatchedCumulative', 'stockCounterGeneration', 'quantity'].includes(key)); changed[key] = value; return p; },
    run: async config => {
     calls.patches.push({ id, changed: clone(changed), config: clone(config) }); const number = calls.patches.length;
     assert.deepEqual(Object.keys(config), ['condition']);
     assert.deepEqual(Object.keys(config.condition).sort(), ['_updatedDate', 'company', 'stockCommitVersion']);
     if (options.reverseContenders && number === 6) await secondContenderApplied;
     const before = rows.get(id), conditionMet = matches(before, config.condition);
     if (number === options.errorAt) throw Error('PRIVATE permission and schema details');
     if (options.acceptNoopAt === number) return clone(before);
     if (options.rejectAll || !conditionMet && !(options.ignoreConditions || number === options.acceptInvalidAt || options.bothWin && number >= 6)) {
      if (options.mutateOnReject && number === 1) before.quantity = 999;
      throw Error('WDE0193: Update condition not met.');
     }
     const after = { ...before, ...clone(changed), _updatedDate: stamp() };
     if (number === options.corruptAt) after.quantity = 999;
     if (number === options.extraFieldAt) after.newPrivateField = 'UNEXPECTED_PRIVATE';
     if (number === options.typeChangeAt) after.syntheticBusinessDate = before.syntheticBusinessDate.toISOString();
     rows.set(id, after);
     if (options.reverseContenders && number === 7) releaseFirstContender();
     if (number === options.timeoutAfterApplyAt) throw Error('PRIVATE timeout after applied mutation');
     return clone(after);
    } }; return p;
  }
 };
 return { items, rows, calls };
}
function noLeak(result) {
 assert.doesNotMatch(JSON.stringify(result), /SPT-INIT-|PRIVATE|quantity|stockCommitVersion|INIT-ABSENT|INIT-EXISTING/);
 assert.equal(result.businessInitializationAccepted, false); assert.equal(result.activationReady, false);
 assert.equal(result.deletionAttempted, false); assert.equal(result.replayAllowed, false);
}

test('two fixed retained rows prove only modeled conditional initialization, exact preservation and one concurrent winner', async () => {
 const f = fixture(), result = await verifyNativeInitialization({ ...f, input });
 assert.equal(result.ok, true); noLeak(result);
 assert.deepEqual(result.operationsAttempted, { reads: 10, inserts: 2, patches: 7 });
 assert.deepEqual(result.checks, ['WRONG_DATE_REJECTED', 'INITIALIZE_ABSENT_COMPANY', 'LATE_INITIALIZATION_REJECTED',
  'INTERVENING_SYNTHETIC_LEGACY_EDIT', 'STALE_BEFORE_EDIT_REJECTED', 'COMPETING_INITIALIZATIONS']);
 assert.equal(f.rows.size, 2); assert.equal(f.rows.get(fixedIds[0]).quantity, 50); assert.equal(f.rows.get(fixedIds[1]).quantity, 61);
 for (const row of f.rows.values()) { assert.equal(row.company, 'NCT'); assert.equal(row.stockCounterSchema, 2);
  assert.equal(row.stockDispatchedCumulative, 0); assert.equal(row.stockCounterGeneration, 0); }
 const again = await verifyNativeInitialization({ ...f, input }); assert.equal(again.ok, false);
 assert.deepEqual(again.operationsAttempted, { reads: 2, inserts: 0, patches: 0 });
 assert.equal(f.calls.inserts.length, 2); assert.equal(f.calls.patches.length, 7); noLeak(again);
});

test('occupied either ID stops before writes and never adopts or resets existing evidence', async () => {
 for (const occupied of [0, 1]) { const f = fixture({ occupied }), before = structuredClone([...f.rows]);
  const result = await verifyNativeInitialization({ ...f, input }); assert.equal(result.ok, false);
  assert.equal(result.mutationAttempted, false); assert.deepEqual([...f.rows], before);
  assert.equal(f.calls.inserts.length, 0); assert.equal(f.calls.patches.length, 0); noLeak(result); }
});

test('either concurrent contender may win without changing exact original business fields', async () => {
 const f = fixture({ reverseContenders: true, extraBusinessDate: true }), result = await verifyNativeInitialization({ ...f, input });
 assert.equal(result.ok, true); assert.equal(f.rows.get(fixedIds[1]).stockCommitVersion, 'INIT-EXISTING-COMPANY-B');
 assert.equal(f.rows.get(fixedIds[1]).syntheticBusinessDate.toISOString(), '2026-10-20T10:00:00.000Z'); noLeak(result);
});

test('null, undefined, empty versions and ambiguous company/counters are NOT strict absence despite WQL exists:false', async () => {
 for (const flag of ['nullVersion', 'undefinedVersion', 'emptyVersion', 'nullCompany', 'foreignCompany', 'extraInitialCounter']) {
  const f = fixture({ [flag]: true }), result = await verifyNativeInitialization({ ...f, input });
  assert.equal(result.ok, false, flag); assert.equal(f.calls.patches.length, 0); assert.equal(f.rows.size, 2); noLeak(result);
 }
});

test('native timestamp must be a valid Date; an unchanged intervening timestamp cannot prove stale safety', async () => {
 for (const dateType of ['string', 'null', 'invalid']) {
  const f = fixture({ dateType }), result = await verifyNativeInitialization({ ...f, input });
  assert.equal(result.ok, false, dateType); assert.equal(f.calls.patches.length, 0); noLeak(result);
 }
 const f = fixture({ frozenTime: true }), result = await verifyNativeInitialization({ ...f, input });
 assert.equal(result.ok, false); assert.equal(result.stage, 'INTERVENING_SYNTHETIC_LEGACY_EDIT');
 assert.equal(f.calls.patches.length, 4); noLeak(result);
});

test('false acceptance, refused success, stale write, two winners and mutation despite rejection cannot pass', async () => {
 for (const fault of [{ ignoreConditions: true }, { acceptNoopAt: 1 }, { rejectAll: true },
  { acceptInvalidAt: 5 }, { bothWin: true }, { mutateOnReject: true }]) {
  const f = fixture(fault), result = await verifyNativeInitialization({ ...f, input });
  assert.equal(result.ok, false, JSON.stringify(fault)); assert.ok(f.calls.patches.length <= 7); noLeak(result);
 }
});

test('accepted initialization must preserve all business fields and native business value types', async () => {
 for (const fault of [{ corruptAt: 2 }, { extraFieldAt: 2 }, { extraBusinessDate: true, typeChangeAt: 2 }]) {
  const f = fixture(fault), result = await verifyNativeInitialization({ ...f, input });
  assert.equal(result.ok, false); assert.equal(f.calls.patches.length, 2); noLeak(result);
 }
});

test('transport/schema/permission errors and unknown post-apply outcomes never count as conditional refusal or trigger retry', async () => {
 for (const fault of [{ errorAt: 1 }, { timeoutAfterApplyAt: 2 }, { failReadAt: 6 }, { failInsertAt: 2 }]) {
  const f = fixture(fault), result = await verifyNativeInitialization({ ...f, input });
  assert.equal(result.ok, false); assert.ok(f.calls.patches.length <= 2); assert.ok(f.calls.inserts.length <= 2); noLeak(result);
  if (fault.timeoutAfterApplyAt) assert.equal(f.rows.get(fixedIds[0]).stockCommitVersion, 'INIT-ABSENT-COMPANY');
  if (fault.failInsertAt) assert.equal(f.rows.size, 1);
 }
});

test('partial, duplicate-count or foreign exact reads fail closed without interpreting missing', async () => {
 for (const fault of [{ partialReadAt: 1 }, { partialReadAt: 5 }, { foreignReadAt: 3 }]) {
  const f = fixture(fault), result = await verifyNativeInitialization({ ...f, input });
  assert.equal(result.ok, false); assert.ok(f.calls.patches.length <= 1); noLeak(result);
 }
});

test('browser cannot select collection, IDs, company, condition, reset, missing confirmation or arbitrary input', async () => {
 for (const invalid of [null, [], {}, { ...input, company: 'GHR' }, { ...input, ids: ['BUSINESS'] },
  { ...input, collection: 'NCTTasks' }, { ...input, reset: true }, { confirmation: 'ALLOW' }, { ...input, condition: {} }]) {
  const f = fixture(); await assert.rejects(verifyNativeInitialization({ ...f, input: invalid }), /Explicit bounded/);
  assert.equal(f.calls.reads.length, 0); assert.equal(f.calls.inserts.length, 0); assert.equal(f.calls.patches.length, 0);
 }
});

test('generated candidate is exact Admin-only, excluded from production packet and cannot delete or activate', async () => {
 assert.match(execFileSync(process.execPath, [path.join(folder, 'build-initialization-probe.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
 const source = fs.readFileSync(path.join(folder, 'stockProtocolInitialization.web.js'), 'utf8');
 assert.equal((source.match(/webMethod\(Permissions.Admin/g) || []).length, 1);
 assert.doesNotMatch(source, /items\.(remove|bulkRemove)|Permissions\.(Anyone|SiteMember)|suppressAuth|NCTTasks|readControl|setMode|while\s*\(/);
 let permission; const f = fixture();
 const api = vm.runInNewContext(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';verifyStockInitialization;',
  { items: f.items, Permissions: { Admin: 'ADMIN' }, webMethod: (grant, fn) => { permission = grant; return fn; } });
 assert.equal(permission, 'ADMIN'); assert.equal((await api({ ...input, reset: true })).ok, false); assert.equal(f.calls.reads.length, 0);
 // Native wrapper execution is NOT performed by this VM test. Only its invalid
 // input refusal is exercised; the pure behavior test above is mock evidence.
 const manifest = require('../prototypes/stock-current-state/current-install-manifest.json');
 assert.equal(manifest.install.some(row => row.target === 'stockProtocolInitialization.web.js'), false);
});
