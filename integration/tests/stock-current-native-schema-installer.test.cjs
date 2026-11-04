'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createNativeSchemaInstaller, wireType } = require('../prototypes/stock-current-state/native-schema-installer.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(id = 'StockPositions') {
 const state = { collection: { _id: id, revision: '1', displayName: id, displayField: 'title', collectionType: 'NATIVE',
  permissions: { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' },
  capabilities: { indexLimits: { regular: 3, unique: 1, total: 4 } }, fields: [{ key: 'title', type: 'TEXT', displayName: 'Title', validation: { retain: true } }] }, indexes: [] };
 const calls = [], hooks = {};
 const collections = {
  async getDataCollection(...args) { calls.push(['get', ...args]); return clone(state.collection); },
  async updateDataCollectionField(id, options) { calls.push(['field', id, options]); if (hooks.field) await hooks.field();
   state.collection.fields.push(clone(options.field)); state.collection.revision = String(+state.collection.revision + 1); }
 };
 const indexes = {
  async listIndexes(...args) { calls.push(['list', ...args]); return { indexes: clone(state.indexes), pagingMetadata: { total: state.indexes.length, hasNext: false } }; },
  async createIndex(id, index) { calls.push(['index', id, index]); if (hooks.index) await hooks.index();
   state.indexes.push({ ...clone(index), _id: 'new-index', source: 'USER', status: 'BUILDING' }); }
 };
 return { state, calls, hooks, collections, indexes, api: createNativeSchemaInstaller({ collections, indexes }) };
}
test('maps semantic date to timestamp and string arrays to native enums', () => {
 assert.equal(wireType('DATE'), 'DATETIME'); assert.equal(wireType('DATE_ONLY'), 'DATE'); assert.equal(wireType('TEXT_ARRAY'), 'ARRAY_STRING'); assert.equal(wireType('OBJECT_OR_NULL'), 'OBJECT');
});

test('original date-only order field is retained and missing date-only field uses DATE, never DATETIME', async () => {
 for (const collection of ['NCTOrders', 'NCTOrders1']) {
  const f = fixture(collection);
  await f.api.addField({ collection, key: 'estimatedShipmentDate', revision: '1' });
  assert.equal(f.state.collection.fields[1].type, 'DATE');
  assert.equal((await f.api.inspect({ collection })).missingFields.some(row => row.key === 'estimatedShipmentDate'), false);
  const before = clone(f.state.collection.fields);
  await f.api.addField({ collection, key: 'company', revision: '2' });
  assert.deepEqual(f.state.collection.fields.slice(0, 2), before);
  f.state.collection.fields[1].type = 'DATETIME';
  await assert.rejects(f.api.inspect({ collection }), /Existing field type conflict/);
 }
});
test('inspection is metadata-only and returns exact missing field scope', async () => {
 const f = fixture(), result = await f.api.inspect({ collection: 'StockPositions' });
 assert.equal(result.activationAllowed, false); assert(result.missingFields.some(field => field.key === 'reviewCodes' && field.type === 'ARRAY_STRING'));
 assert.deepEqual(f.calls.map(row => row[0]), ['get', 'list']);
 assert.deepEqual(f.calls[0], ['get', 'StockPositions', { consistentRead: true }]);
});
test('one missing field is added without touching original fields, ACL or indexes', async () => {
 const f = fixture(), original = clone(f.state.collection), result = await f.api.addField({ collection: 'StockPositions', key: 'company', revision: '1' });
 assert.equal(result.changed, true); assert.deepEqual(f.state.collection.permissions, original.permissions);
 assert.deepEqual(f.state.collection.fields[0], original.fields[0]);
 assert.deepEqual(f.calls.filter(row => row[0] === 'field'), [['field', 'StockPositions', { field: { key: 'company', displayName: 'company', type: 'TEXT' } }]]);
 assert.equal((await f.api.addField({ collection: 'StockPositions', key: 'company', revision: '2' })).changed, false);
 assert.equal(f.calls.filter(row => row[0] === 'field').length, 1);
});
test('rejects unlisted collection, field, caller-controlled type and stale revision before writes', async () => {
 const f = fixture();
 for (const request of [{ collection: 'Employees', key: 'company', revision: '1' }, { collection: 'StockPositions', key: 'anything', revision: '1' },
  { collection: 'StockPositions', key: 'company', revision: '1', type: 'NUMBER' }, { collection: 'StockPositions', key: 'company', revision: '0' }]) {
  await assert.rejects(f.api.addField(request));
 }
 assert.equal(f.calls.filter(row => row[0] === 'field').length, 0);
});
test('does not repair permissions or overwrite existing field type', async () => {
 const f = fixture(); f.state.collection.permissions.read = 'ANYONE';
 await assert.rejects(f.api.addField({ collection: 'StockPositions', key: 'company', revision: '1' }), /Admin-only/);
 f.state.collection.permissions.read = 'ADMIN'; f.state.collection.fields.push({ key: 'company', type: 'NUMBER' });
 await assert.rejects(f.api.addField({ collection: 'StockPositions', key: 'company', revision: '1' }), /type conflict/);
 assert.equal(f.calls.filter(row => row[0] === 'field').length, 0);
});
test('original collection permissions remain unchanged, date field uses DATETIME', async () => {
 const f = fixture('NCTOrders'); f.state.collection.permissions.read = 'SITE_MEMBER';
 await f.api.addField({ collection: 'NCTOrders', key: 'salesSubmissionTime', revision: '1' });
 assert.equal(f.state.collection.permissions.read, 'SITE_MEMBER'); assert.equal(f.state.collection.fields[1].type, 'DATETIME');
});
test('unknown native write propagates with no automatic retry or second write', async () => {
 const f = fixture(); f.hooks.field = () => { throw Error('native timeout unknown'); };
 await assert.rejects(f.api.addField({ collection: 'StockPositions', key: 'company', revision: '1' }), /timeout unknown/);
 assert.equal(f.calls.filter(row => row[0] === 'field').length, 1);
});
test('post-write unrelated metadata change fails acceptance, never attempts rollback overwrite', async () => {
 const f = fixture(); f.hooks.field = () => { f.state.collection.fields[0].displayName = 'unexpected'; };
 await assert.rejects(f.api.addField({ collection: 'StockPositions', key: 'company', revision: '1' }), /Existing field/);
 assert.equal(f.calls.filter(row => row[0] === 'field').length, 1);
});
test('adds exact regular index and reports BUILDING without claiming active', async () => {
 const f = fixture(); for (const key of ['company', 'stockKey', 'status']) f.state.collection.fields.push({ key, type: 'TEXT' });
 const result = await f.api.addIndex({ collection: 'StockPositions', name: 'SC_ACTIVE_PRODUCT', revision: '1' });
 assert.equal(result.changed, true); assert.equal(result.indexes[0].status, 'BUILDING'); assert.equal(result.activationAllowed, false);
 assert.equal((await f.api.addIndex({ collection: 'StockPositions', name: 'SC_ACTIVE_PRODUCT', revision: '1' })).changed, false);
 assert.equal(f.calls.filter(row => row[0] === 'index').length, 1);
});
test('index fields, quota, name collision and full paging required before create', async () => {
 const f = fixture(); await assert.rejects(f.api.addIndex({ collection: 'StockPositions', name: 'SC_ACTIVE_PRODUCT', revision: '1' }), /fields first/);
 for (const key of ['company', 'stockKey', 'status']) f.state.collection.fields.push({ key, type: 'TEXT' });
 f.state.collection.capabilities.indexLimits.regular = 0;
 await assert.rejects(f.api.addIndex({ collection: 'StockPositions', name: 'SC_ACTIVE_PRODUCT', revision: '1' }), /quota/);
 f.state.collection.capabilities.indexLimits.regular = 3; f.state.indexes.push({ name: 'SC_ACTIVE_PRODUCT', fields: [{ path: 'title', order: 'ASC' }], unique: false, caseInsensitive: false });
 await assert.rejects(f.api.addIndex({ collection: 'StockPositions', name: 'SC_ACTIVE_PRODUCT', revision: '1' }), /name conflict/);
 f.indexes.listIndexes = async () => ({ indexes: [], pagingMetadata: { hasNext: true } });
 await assert.rejects(f.api.inspect({ collection: 'StockPositions' }), /Complete native index/);
 assert.equal(f.calls.filter(row => row[0] === 'index').length, 0);
});
test('generated endpoint is Admin-only, metadata-only, mechanically executable and grants no elevation', () => {
 const source = fs.readFileSync(path.join(__dirname, '../prototypes/stock-current-state/stockSchemaAdmin.web.js'), 'utf8');
 assert.equal((source.match(/webMethod\(Permissions\.Admin/g) || []).length, 3);
 assert(!/suppressAuth|elevate\(|wixData|(?:collections|indexes)\.(?:delete|drop|remove)|updateDataCollection\(/.test(source));
 new vm.Script(source.replace(/^import .*;\n/gm, '').replace(/^export const /gm, 'const '));
});
function nativeModule(collections, indexes) {
 const source = fs.readFileSync(path.join(__dirname, '../prototypes/stock-current-state/stockSchemaAdmin.web.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export const /gm, 'const ');
 const logs = [], context = vm.createContext({ collections, indexes, Permissions: { Admin: 'ADMIN' },
  webMethod: (permission, method) => { assert.equal(permission, 'ADMIN'); return method; }, console: { info: (...args) => logs.push(args) } });
 return { logs, api: new vm.Script(source + '\n;({inspectStockSchema,addStockSchemaField,addStockSchemaIndex});').runInContext(context) };
}
test('native read reports stage of denied SDK read without changing permissions or retrying', async () => {
 const f = fixture(); f.collections.getDataCollection = async () => { throw Object.assign(Error('Metadata read permission denied'), { code: 'PERMISSION_DENIED' }); };
 const native = nativeModule(f.collections, f.indexes), result = await native.api.inspectStockSchema({ collection: 'StockPositions' });
 assert.equal(result.ok, false); assert.equal(result.stage, 'READ_COLLECTION'); assert.equal(result.code, 'PERMISSION_DENIED');
 assert.deepEqual(native.logs.map(row => row[1]), ['INITIALIZE', 'READ_COLLECTION']); assert.deepEqual(f.calls, []);
});
test('unsupported SDK methods produce an observable initialization failure, not a module-load crash', async () => {
 const native = nativeModule({}, {}), result = await native.api.inspectStockSchema({ collection: 'StockPositions' });
 assert.equal(result.ok, false); assert.equal(result.stage, 'INITIALIZE'); assert.match(result.message, /Native metadata SDK/);
});
test('native read stage distinguishes index failure; native mutation errors remain errors', async () => {
 const f = fixture(); f.indexes.listIndexes = async () => { throw Error('Index reader unavailable'); };
 const native = nativeModule(f.collections, f.indexes), result = await native.api.inspectStockSchema({ collection: 'StockPositions' });
 assert.equal(result.ok, false); assert.equal(result.stage, 'READ_INDEXES');
 await assert.rejects(native.api.addStockSchemaField({ collection: 'StockPositions', key: 'company', revision: '1' }), /Index reader unavailable/);
 assert.equal(f.calls.filter(row => row[0] === 'field').length, 0);
});
