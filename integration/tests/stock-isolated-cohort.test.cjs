'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { buildIsolatedCohort } = require('../prototypes/stock-current-state/build-isolated-cohort.cjs');
const { COHORT, COLLECTIONS, collectionTokens, imports, moduleName } = require('../prototypes/stock-current-state/isolated-cohort.cjs');
const root = path.resolve(__dirname, '../..'), packet = buildIsolatedCohort();
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
function runtime() {
  return vm.runInNewContext(packet.output.get('MASTER/r2stockCurrentCommands.js').replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '')
    + ';({planCollections,createSegmentedFencedProof,createSdkConditionalStore,createCurrentPurchaseTables});',
  { createHash: crypto.createHash, randomBytes: crypto.randomBytes, StockRuntimeBuffer: Buffer });
}
test('whole actual dependency closure is versioned; no legacy business literal/property survives and originals are untouched', () => {
  assert.equal(packet.report.backend.length, 105); assert.equal(packet.report.relays.length, 8);
  assert.equal(packet.report.publicModules.length, 2); assert.equal(packet.report.staticResources.length, 43);
  assert.equal(packet.report.bootstrapModules.length, 2);
  assert.equal(packet.output.has('relays/integration/wix/packingListBridge.js'), false);
  assert.deepEqual(packet.report.retiredLocalOutputs, ['relays/integration/wix/packingListBridge.js',
    'FMCGMALAYSIA/r2catalogueSelection.web.js', 'FMCGMALAYSIA/r2fxRates.web.js']);
  assert.equal(packet.report.activationAllowed, false);
  const identities = new Set(packet.report.backend.map(row => row.system + '/' + row.target));
  for (const row of packet.report.retainedDependencies) identities.add(row.system + '/' + row.target);
  for (const row of packet.report.backend) {
    const source = packet.output.get(row.system + '/' + row.target);
    assert.equal(crypto.createHash('sha256').update(read(row.source)).digest('hex'), row.sourceSha256);
    for (const name of Object.keys(COLLECTIONS[row.system])) assert.doesNotMatch(source, new RegExp('\\b' + name + '\\b'), row.target + ' leaked ' + name);
    for (const dependency of row.dependencies) assert.ok(identities.has(dependency), 'Unpaired dependency: ' + dependency);
    assert.doesNotMatch(source, /verified:\s*true\s*,\s*build:/, 'Compiler must not mint coverage');
  }
  assert.deepEqual(packet.report.retainedDependencies.map(row => row.target).sort(), ['catalogueSelection.web.js', 'fxRates.web.js', 'staffAuth.web.js']);
  assert.ok(packet.report.retainedDependencies.every(row => !row.nativeVerified && !row.businessIsolationVerified));
  assert.ok(read('integration/backend/nctIntake.js').includes("orders: 'NCTOrders'"));
  assert.ok(read('backend/nctSalesIntake.js').includes('/_functions/nctIntake'));
  assert.ok(packet.output.get('relays/buyer-room/wix/buyer-room-page.js').includes("from 'backend/r2catalogueAuth.web.js'"));
  for (const name of ['support-department-page.js', 'warehouse-department-page.js', 'purchase-room-page.js', 'account-department-page.js']) {
    assert.match(packet.output.get('relays/integration/wix/' + name), /public\/r2taskChatBridge\.js/);
    assert.doesNotMatch(packet.output.get('relays/integration/wix/' + name), /['"]public\/(?:taskChatBridge|packingListBridge)\.js/);
  }
  assert.match(packet.output.get('MASTER/public/r2taskChatBridge.js'), /backend\/r2taskChat.web.js/);
  assert.match(packet.output.get('MASTER/public/r2packingListBridge.js'), /backend\/r2packingLists.web.js/);
  assert.match(packet.output.get('relays/integration/wix/account-department-page.js'), /\?v=20261024-r2/);
});
test('generated native bootstrap roots are Admin-only, independent of the old migration path and cannot grant ACTIVE', () => {
  for (const system of ['MASTER', 'FMCGMALAYSIA']) {
    const source = packet.output.get(system + '/r2cohortBootstrap.web.js');
    assert.match(source, /inspectFreshCohort=webMethod\(Permissions\.Admin/);
    assert.doesNotMatch(source, /Permissions\.SiteMember|verifyLegacyDrain|mode:\s*'ACTIVE'|\.remove\(|\.patch\(/);
    assert.equal(source.includes('export const initializeFreshCohort='), system === 'MASTER');
    assert.match(source, /createFreshCohortBootstrap/);
  }
});

test('R2 database roots opt in explicitly while file/photo/delete fences and original/default coordination remain unchanged', () => {
  const policy = packet.report.coordinationPolicy;
  assert.equal(policy.nativeAccepted, false); assert.equal(policy.databaseRoots.length, 11);
  for (const target of policy.databaseRoots) {
    const row = packet.report.backend.find(row => row.system === 'MASTER' && row.originalTarget === target);
    const source = packet.output.get('MASTER/' + row.target);
    assert.equal(source.split("coordination:'CONTROL_CAS_CANDIDATE',batchApplyReads:true").length, 2, target);
    assert.doesNotMatch(read(row.source), /coordination:'CONTROL_CAS_CANDIDATE'/, 'Generic root must not change');
    // A caller/browser must not be able to override these server-owned options.
    assert.doesNotMatch(source, /coordination:\s*(?:request|input)\./);
  }
  for (const target of ['stockCurrentAccountPurchase.js', 'stockCurrentPurchaseOrders.js', 'stockCurrentSourceSales.js']) {
    const source = packet.output.get('MASTER/' + moduleName(target));
    assert.match(source, /createSegmentedFencedProof\(\{company,store:create(?:OrderFile|CustomerDocument)FencedStore/);
  }
  for (const target of ['stockCurrentPacking.js', 'stockCurrentWarehouse.web.js']) {
    assert.match(packet.output.get('MASTER/' + moduleName(target)), /createPhotoProtocol:[\s\S]*createSegmentedFencedProof\(\{company,domainWrites:true,stepsPerInvocation:1,/);
  }
  const commands = packet.output.get('MASTER/r2stockCurrentCommands.js');
  assert.match(commands, /coordination = 'EXCLUSIVE_LOCK', batchApplyReads = false/);
  for (const message of ['Durable pending packing photo operation required', 'Durable pending']) assert.ok(commands.includes(message));
  assert.doesNotMatch(packet.output.get('MASTER/r2stockMaintenanceAdmin.web.js'), /CONTROL_CAS_CANDIDATE/);
});
test('one token pass pairs storage names with projection keys without changing partial function names or shared identity', () => {
  assert.equal(collectionTokens("tables.PurchaseOrders; 'StockClaims/id'; const getPurchaseOrders=1; 'StaffMasterAccess'; 'SharedSuppliers'; 'R2StockClaims'", 'MASTER'),
    "tables.R2PurchaseOrders; 'R2StockClaims/id'; const getPurchaseOrders=1; 'StaffMasterAccess'; 'SharedSuppliers'; 'R2StockClaims'");
  assert.equal(imports("import {a as b} from './nctIntake.js';", moduleName), "import {a as b} from 'backend/r2nctIntake.js';");
  assert.throws(() => imports("await import('backend/hidden.js')", moduleName), /Unreviewed/);
  assert.throws(() => imports("export { a } from 'backend/hidden.js'", moduleName), /Unreviewed/);
  assert.throws(() => moduleName('http-functions.js'), /Explicit/);
});
test('generated runtime itself binds protocol scopes, lock/control and current Purchase readers to new tables only', async () => {
  const api = runtime(), rows = new Map(), calls = [];
  assert.deepEqual(plain(api.planCollections('NCT', true)), ['R2NCTActivity', 'R2StockPositions', 'R2StockClaims', 'R2StockProducts', 'R2NCTOrders', 'R2NCTTasks', 'R2PurchaseOrders']);
  const store = { read: async (c, id) => rows.get(c + '/' + id) || null,
    insert: async (c, row) => { calls.push(c); rows.set(c + '/' + row._id, plain(row)); return plain(row); },
    compareAndSet: async () => { throw Error('Not used'); }, compareAndRemove: async () => { throw Error('Not used'); } };
  const protocol = api.createSegmentedFencedProof({ company: 'NCT', store, domainWrites: true });
  await protocol.initialize(); assert.equal(protocol.ids.journal, 'R2NCTActivity'); assert.deepEqual(calls, ['R2NCTActivity']);
  const listed = [], readTables = api.createCurrentPurchaseTables({ company: 'NCT', readOriginalTable: async c => { listed.push(c); return []; }, store: { normalizeListedRow: (_, row) => row } });
  const tables = await readTables('NCT', { memberId: 'M', staffId: 'S' });
  assert.deepEqual(listed, ['R2NCTOrders', 'R2NCTTasks', 'R2NCTActivity', 'SharedSuppliers', 'R2PurchaseOrders']);
  assert.ok(Object.hasOwn(tables, 'R2PurchaseOrders')); assert.equal(Object.hasOwn(tables, 'PurchaseOrders'), false);
});
test('old cross-site or missing/ambiguous cohort headers cannot invoke any new intake, quantity or Sales handler', async () => {
  const source = packet.output.get('MASTER/http-functions.additions.js').replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '');
  let calls = 0;
  const handler = async () => { calls++; return { status: 200, body: { ok: true } }; };
  const api = vm.runInNewContext(source + ';({post_r2NctIntake,post_r2SalesFulfilment,post_r2PurchaseQuantities});', {
    createR2NctReceiver: () => handler, handleR2SalesFulfilment: handler, readR2PurchaseQuantities: handler,
    store: {}, getSecret: () => { throw Error('Not used'); }, capturePointbaseCosts: () => {}, response: input => input
  });
  for (const send of Object.values(api)) {
    for (const headers of [{}, { 'X-FMCG-Cohort': 'OLD' }, { 'X-FMCG-Cohort': COHORT, 'x-fmcg-cohort': COHORT }]) {
      assert.equal((await send({ headers })).status, 409);
    }
  }
  assert.equal(calls, 0);
  for (const send of Object.values(api)) assert.equal((await send({ headers: { 'x-fmcg-cohort': COHORT } })).status, 200);
  assert.equal(calls, 3);
  for (const [name, route] of [['nctSalesIntake.js', 'r2NctIntake'], ['masterFulfilmentClient.js', 'r2SalesFulfilment'], ['masterQuantityClient.js', 'r2PurchaseQuantities']]) {
    const source = packet.output.get('FMCGMALAYSIA/r2' + name);
    assert.ok(source.includes('/_functions/' + route)); assert.ok(source.includes("'X-FMCG-Cohort': '" + COHORT + "'"));
  }
});
test('actual generated SDK reader refuses legacy/unmarked controls instead of routing new tables through old writers', async () => {
  const api = runtime(); let value;
  const controlId = crypto.createHash('sha256').update(JSON.stringify(['NCT', 'STOCK_CONTROL'])).digest('hex').slice(0, 32);
  const query = { eq: () => query, limit: () => query, find: async () => ({ items: value ? [value] : [] }) };
  const store = api.createSdkConditionalStore({ company: 'NCT', collections: api.planCollections('NCT', true),
    items: { query: () => query, insert: () => {}, patch: () => {}, remove: () => {} } });
  for (const extra of [{}, { cohort: COHORT, mode: 'LEGACY' }, { cohort: 'OTHER', mode: 'ACTIVE' }]) {
    value = { _id: controlId, company: 'NCT', stockCommitVersion: 'V', ...extra };
    await assert.rejects(store.read('R2NCTActivity', controlId), /legacy fallback forbidden/);
  }
  value = { _id: controlId, company: 'NCT', stockCommitVersion: 'V', cohort: COHORT, mode: 'MAINTENANCE' };
  assert.equal((await store.read('R2NCTActivity', controlId)).mode, 'MAINTENANCE');
  await assert.rejects(store.read('NCTActivity', controlId), /scope/);
  assert.ok(packet.output.get('MASTER/r2stockMaintenanceAdmin.web.js').includes('STOCK_MAINTENANCE_BLOCKED'));
});
test('a genuinely delayed ORIGINAL cost retry may delete an old replacement lock but cannot touch same-ID new task/lock', async () => {
  const load = require('./load-master-module.cjs'), { createPurchaseCostRetry } = load('purchaseCostRetry.js');
  const taskId = 'a'.repeat(32), requestId = '12345678-1234-1234-1234-123456789abc', rows = new Map(), writes = [];
  const task = { _id: taskId, title: taskId, description: 'ORDER', imageAltText: 'LINE' };
  rows.set('NCTTasks/' + taskId, task);
  rows.set('NCTOrders/O', { _id: 'O', title: 'ORDER', sourceLineId: 'LINE', submissionId: 'SUB', description: '00123', cbmCtn: 1 });
  rows.set('NCTActivity/RECEIPT', { _id: 'RECEIPT', description: 'ORDER', action: 'ORDER_RECEIVED', result: 'ACCEPTED', details: { submissionId: 'SUB', taskIds: [taskId] } });
  const lockId = crypto.createHash('sha256').update(JSON.stringify(['NCT', taskId, 'COST_LOCK'])).digest('hex').slice(0, 32);
  const originalNewTask = { ...task, company: 'NCT', lpPc: 999, stockCommitVersion: 'CURRENT' };
  const originalNewLock = { _id: lockId, owner: 'NEW', attempt: 'OWNED' };
  rows.set('R2NCTTasks/' + taskId, plain(originalNewTask)); rows.set('R2NCTActivity/' + lockId, plain(originalNewLock));
  let captured, resume;
  const paused = new Promise(resolve => { captured = resolve; }), gate = new Promise(resolve => { resume = resolve; });
  const store = {
    read: async (c, id) => plain(rows.get(c + '/' + id) || null),
    one: async (c, criteria) => plain([...rows].find(([key, row]) => key.startsWith(c + '/') && Object.entries(criteria).every(([k, v]) => row[k] === v))?.[1] || null),
    insert: async (c, row) => { if (rows.has(c + '/' + row._id)) throw Error('Duplicate'); rows.set(c + '/' + row._id, plain(row)); writes.push(c); return plain(row); },
    update: async (c, row) => { rows.set(c + '/' + row._id, plain(row)); writes.push(c); return plain(row); },
    remove: async (c, id) => { rows.delete(c + '/' + id); writes.push(c); }
  };
  const save = createPurchaseCostRetry({ store, captureCosts: async () => { captured(); await gate; return { '00123': { unitBarcode: '00123', costCurrency: 'MYR', costStatus: 'CAPTURED', costIssues: [], capturedAt: '2026-10-24T01:00:00Z', lpPc: 7 } }; } });
  const pending = save({ company: 'NCT', taskId, requestId, staff: { staffId: 'S', staffName: 'Staff', memberId: 'M' } });
  await paused;
  rows.set('NCTActivity/' + lockId, { _id: lockId, owner: 'ANOTHER_OLD_WRITER' });
  resume(); assert.equal((await pending).ok, true);
  assert.equal(rows.has('NCTActivity/' + lockId), false, 'Original unsafe late deletion remains demonstrable');
  assert.equal(rows.get('NCTTasks/' + taskId).lpPc, 7);
  assert.deepEqual(rows.get('R2NCTTasks/' + taskId), originalNewTask);
  assert.deepEqual(rows.get('R2NCTActivity/' + lockId), originalNewLock);
  assert.ok(writes.every(c => !c.startsWith('R2')));
});
