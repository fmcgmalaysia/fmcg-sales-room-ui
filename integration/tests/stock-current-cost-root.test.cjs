const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { createRequire } = require('node:module'), { execFileSync } = require('node:child_process'), load = require('./load-master-module.cjs');
const { createCurrentCostReferenceSave } = require('../prototypes/stock-current-state/current-cost-reference-save.cjs');
const { createCurrentCostTables } = require('../prototypes/stock-current-state/current-cost-tables.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { planCollections } = require('../prototypes/stock-current-state/domain-scope.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const file = require.resolve('./stock-current-cost-save.test.cjs');
const base = vm.runInNewContext(fs.readFileSync(file, 'utf8').replace("const test = require('node:test')", 'const test = () => {}') + ';fixture;',
  { require: createRequire(file), Map, Buffer });
const folder = path.join(__dirname, '../prototypes/stock-current-state'), copy = value => JSON.parse(JSON.stringify(value));
async function fixture({ company = 'NCT', coverage = true, generated = false, captureCosts } = {}) {
  const f = await base(company), calls = [], queryCalls = [];
  f.store.normalizeListedRow = (collection, row) => { assert.equal(row.company, company); assert.ok(row._version); return copy(row); };
  const items = { query: collection => {
    const filters = [], query = { eq: (key, value) => { filters.push([key, value]); return query; }, limit: value => { assert.equal(value, 2); return query; },
      find: async options => { assert.equal(options.consistentRead, true); queryCalls.push([collection, copy(filters)]);
        return { items: [...f.db.entries()].filter(([key, row]) => key.startsWith(collection + ':') && filters.every(([field, value]) => row[field] === value)).map(([, row]) => copy(row)).slice(0, 2) }; } }; return query;
  } };
  let save = createCurrentCostReferenceSave, tables = createCurrentCostTables;
  if (generated) {
    const source = fs.readFileSync(path.join(folder, 'stockCurrentCommands.js'), 'utf8');
    const api = vm.runInNewContext(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';({createCurrentCostReferenceSave,createCurrentCostTables});',
      { createHash: crypto.createHash, randomBytes: crypto.randomBytes, StockRuntimeBuffer: Buffer });
    save = api.createCurrentCostReferenceSave; tables = api.createCurrentCostTables;
  }
  let source = fs.readFileSync(path.join(folder, 'stockCurrentCostReference.js'), 'utf8');
  if (coverage) source = source.replace('const writerCoverage = Object.freeze({});', 'const writerCoverage = Object.freeze(' + JSON.stringify(Object.fromEntries(WRITERS.map(writer => [writer, { verified: true, build: 'TEST' }]))) + ');');
  const authorize = async () => { calls.push('AUTH'); return { ...f.deps.requirePurchaseStaff(f.member, [f.employee]), memberId: f.member._id }; };
  const createCurrentCostReference = vm.runInNewContext(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';createCurrentCostReference;', {
    items, currentMember: { getMember: async () => f.member }, getPurchaseStaffContext: authorize,
    requirePurchaseStaff: f.deps.requirePurchaseStaff, createPurchaseCostRetry: load('purchaseCostRetry.js').createPurchaseCostRetry,
    capturePointbaseCosts: captureCosts || f.deps.captureCosts, operationId: hash, planCollections, createCurrentCostReferenceSave: save, createCurrentCostTables: tables,
    fulfilmentStore: { read: async (c, id) => { calls.push('CONTROL'); const row = await f.store.read(c, id); return row ? { ...row, stockCommitVersion: row._version } : null; },
      all: async collection => { assert.equal(collection, 'StaffMasterAccess', 'never scan company journals for one cost task'); return [f.employee]; } },
    createSdkConditionalStore: config => {
      calls.push('SDK'); assert.equal(config.company, company); assert.deepEqual(copy(config.dateTimeFields), { [f.journal]: ['activityTime'],
        [f.tasks]: ['lastCostCaptureTime'], [f.orders]: ['estimatedShipmentDate', 'masterReceivedTime', 'salesSubmissionTime'] }); return f.store;
    }, createSegmentedFencedProof: () => f.protocol
  });
  const web = fs.readFileSync(path.join(folder, 'purchaseCostRetry.web.candidate.js'), 'utf8');
  const retry = vm.runInNewContext(web.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';retryPurchaseTaskCost;', {
    webMethod: (_, fn) => fn, Permissions: { SiteMember: 'SITE' }, wixData: {}, getPurchaseStaffContext: authorize, createCurrentCostReference,
    createPurchaseCostRetry: () => async () => { calls.push('LEGACY'); return { ok: true, legacy: true }; }, capturePointbaseCosts: f.deps.captureCosts
  });
  const metadata = { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0, stockIdentity: { staffId: 'P', memberId: 'M' } };
  const send = (meta = metadata, taskId = f.task._id) => retry(company, taskId, f.request.requestId, meta);
  async function finish() { for (let i = 0; i < 30; i++) { const result = await send(); if (result.ok) return result; assert.equal(result.pending, true); } throw Error('Still pending'); }
  return { ...f, calls, queryCalls, metadata, send, finish, retry, createCurrentCostReference,
    control: () => f.db.get(f.journal + ':' + f.protocol.ids.controlId), items };
}

test('original cost web/root are exact mechanical overlays; original Purchase auth precedes any inventory read', async () => {
  assert.match(execFileSync(process.execPath, [path.join(folder, 'build-current-cost-root.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const f = await fixture(); f.employee.departments = ['WAREHOUSE'];
  await assert.rejects(f.send()); assert.deepEqual(f.calls, ['AUTH']); assert.equal(f.captures(), 0);
});

test('all writer coverage/explicit mode/metadata required; unknown current saves never fall through to old TTL writer', async () => {
  const f = await fixture({ coverage: false }); await assert.rejects(f.send(), /coverage/); assert.equal(f.captures(), 0);
  const g = await fixture(); await assert.rejects(g.send(null), /unconfirmed/);
  for (const mode of ['MAINTENANCE', 'SHADOW']) { g.control().mode = mode; await assert.rejects(g.send(), /unconfirmed/); }
  g.control().mode = 'LEGACY'; await assert.rejects(g.send(), /unconfirmed/);
  assert.equal((await g.retry('NCT', g.task._id, g.request.requestId)).legacy, true);
  assert.equal(g.calls.filter(call => call === 'LEGACY').length, 1); assert.equal(g.captures(), 0);
});

test('actual original cost factory/default root and generated runtime preserve counters, PO, original receipt and manual prices in both companies', async () => {
  for (const company of ['NCT', 'GHR']) {
    const f = await fixture({ company, generated: true }), task = f.db.get(f.tasks + ':' + f.task._id);
    task.lpPc = 9; task.manualCostField = ['lpCtn'];
    const result = await f.finish(); assert.equal(result.ok, true); assert.equal(result.stockGeneration, 1); assert.equal(f.captures(), 1);
    const after = f.db.get(f.tasks + ':' + f.task._id);
    assert.equal(after.lpPc, 9); assert.equal(after.lpCtn, null); assert.equal(after.stockDispatchedCumulative, 30);
    for (const field of ['ourPoNumber', 'supplierId', 'purchaseQtyInCtn', 'receivedQtyInCtn', 'stockCounterGeneration', 'originalCostSnapshot']) assert.deepEqual(after[field], task[field]);
    assert.equal(f.db.get(f.orders + ':' + f.order._id).cbmCtn, 0.1);
    assert.equal([...f.db.keys()].some(key => key.startsWith('Stock')), false);
    assert.equal(f.queryCalls.length, 2); assert.equal(f.queryCalls.every(([collection, filters]) => [f.orders, f.journal].includes(collection) && filters.length >= 2), true);
    assert.equal(f.calls.includes('LEGACY'), false); assert.deepEqual(copy(await f.send()), copy(result)); assert.equal(f.captures(), 1);
  }
});

test('same original request resumes an interrupted cost task and rejects changed or revoked identity', async () => {
  const f = await fixture(); f.interrupt(); let interrupted = false;
  for (let i = 0; i < 30; i++) { try { await f.send(); } catch (error) { assert.match(error.message, /Interrupted reference/); interrupted = true; break; } }
  assert.equal(interrupted, true); assert.equal(f.captures(), 1); assert.ok(f.control().pending);
  const before = JSON.stringify([...f.db]);
  await assert.rejects(f.send({ ...f.metadata, stockIdentity: { staffId: 'ANOTHER', memberId: 'M' } }), /identity/);
  assert.equal(JSON.stringify([...f.db]), before); await f.finish(); assert.equal(f.captures(), 1);
  f.member.status = 'PENDING'; await assert.rejects(f.send()); assert.equal(f.captures(), 1);
});

test('exact bounded cost queries reject duplicate/foreign receipt or order and retain legacy lock without deletion', async () => {
  const f = await fixture(); f.db.set(f.orders + ':DUP', { ...f.order, _id: 'DUP' });
  await assert.rejects(f.send(), /Ambiguous/); assert.equal(f.captures(), 0);
  const g = await fixture(); g.db.get(g.journal + ':RECEIPT').company = 'GHR';
  await assert.rejects(g.send(), /company/); assert.equal(g.captures(), 0);
  const h = await fixture(), id = hash('NCT', h.task._id, 'COST_LOCK');
  h.db.set(h.journal + ':' + id, { _id: id, company: 'NCT', activityTime: '2020-01-01', action: 'COST_RETRY_LOCK' });
  await assert.rejects(h.send(), /no TTL takeover/); assert.equal(h.db.has(h.journal + ':' + id), true); assert.equal(h.captures(), 0);
});

test('original accepted special-purchase evidence and exact parent are included without broad history reads', async () => {
  const f = await fixture(), task = f.db.get(f.tasks + ':' + f.task._id), parentId = 'b'.repeat(32);
  task.specialPurchase = true; f.db.get(f.journal + ':RECEIPT').details.taskIds = [parentId];
  f.db.set(f.tasks + ':' + parentId, { ...task, _id: parentId, title: parentId, specialPurchase: false });
  f.db.set(f.journal + ':SPECIAL', { _id: 'SPECIAL', company: 'NCT', action: 'SPECIAL_PURCHASE_ADDED', result: 'SAVED', imageAltText: task._id, details: { parentTaskId: parentId } });
  const read = createCurrentCostTables({ company: 'NCT', store: f.store, items: f.items });
  const snapshot = await read('NCT', task._id, { staffId: 'P', memberId: 'M' }, f.request.requestId);
  assert.deepEqual(snapshot[f.tasks].map(row => row._id), [task._id, parentId]);
  assert.equal(snapshot[f.journal].some(row => row._id === 'SPECIAL'), true); assert.equal(f.queryCalls.length, 3);
  assert.equal(f.captures(), 0, 'reader only; original special-purchase validator still decides acceptance');
});
