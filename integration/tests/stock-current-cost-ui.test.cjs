const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module'), { execFileSync } = require('node:child_process');
const folder = path.join(__dirname, '../prototypes/stock-current-state'), copy = value => JSON.parse(JSON.stringify(value));
function helper(filename, name) {
  const file = require.resolve('./' + filename), source = fs.readFileSync(file, 'utf8').replace("const test = require('node:test')", 'const test = () => {}');
  return vm.runInNewContext(source + ';' + name + ';', { require: createRequire(file), __dirname, Buffer, Map, Set, Date, Number, setImmediate });
}
const appHarness = helper('stock-current-purchase-resume.test.cjs', 'originalAppHarness');
const resumeFixture = helper('stock-current-purchase-resume.test.cjs', 'fixture');
const rootFixture = helper('stock-current-cost-root.test.cjs', 'fixture');
const ID = 'a'.repeat(32), key = 'fmcg-purchase-draft-v1/NCT/STAFF/MEMBER';
function fixture({ db = new Map(), failStorage = false, resume } = {}) {
  const reads = [], writes = [];
  const storage = { getItem: id => { reads.push(id); return db.get(id) || null; }, setItem: (id, value) => { if (failStorage) throw Error('Quota'); writes.push(id); db.set(id, value); }, removeItem: id => { if (failStorage) throw Error('Quota'); db.delete(id); } };
  const { h, workspace } = appHarness(storage, resume, true), w = workspace();
  w.tasks[0].id = ID; w.stockCurrent = { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0 };
  h.reply(w);
  const start = () => h.click({ controlId: 'retryTaskCost', taskId: ID });
  const saved = () => h.messages.filter(row => row.type === 'PURCHASE_SAVE_REQUEST' && row.operation === 'COST_REFERENCE');
  const reply = (result, extra = {}) => { const request = saved().at(-1); h.send({ type: 'PURCHASE_SAVE_RESULT', company: 'NCT', requestId: request.requestId, ok: true, result, ...extra }); };
  const success = request => ({ ok: true, requestId: request.requestId, company: 'NCT', taskId: ID, stockGeneration: 1, costStatus: 'CAPTURED' });
  return { h, w, db, reads, writes, storage, start, saved, reply, success, setFailStorage: value => failStorage = value };
}

test('original current cost button uses one full original cached request before network, retains legacy handler and reproducible overlays', () => {
  assert.match(execFileSync(process.execPath, [path.join(folder, 'build-purchase-current-ui.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  assert.match(execFileSync(process.execPath, [path.join(folder, 'build-purchase-borrow-panel.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const f = fixture(); f.start(); const request = f.saved()[0]; assert.ok(request); assert.ok(f.writes.length);
  assert.deepEqual(JSON.parse(f.db.get(key)).savePending, copy(request));
  assert.deepEqual(copy(request.stockIdentity), { staffId: 'STAFF', memberId: 'MEMBER' }); assert.equal(request.input.taskId, ID);
  f.start(); assert.equal(f.saved().length, 1);
  const source = fs.readFileSync(path.join(folder, 'purchase-ui/app.js'), 'utf8');
  assert.ok(source.includes("window.parent.postMessage({type:'PURCHASE_COST_RETRY_REQUEST',...costRetry},'*');"), 'original non-current workflow retained');
  assert.equal(f.h.messages.some(row => row.type === 'PURCHASE_COST_RETRY_REQUEST'), false);
});

test('quota failures never send current reference save; malformed or unknown finals preserve exact UUID and do not start new cost request', () => {
  const quota = fixture({ failStorage: true }); quota.start(); assert.equal(quota.saved().length, 0);
  const f = fixture(); f.start(); const request = copy(f.saved()[0]), before = f.db.get(key);
  for (const patch of [{ taskId: 'OTHER' }, { company: 'GHR' }, { stockGeneration: 0 }, { stockGeneration: undefined }]) {
    f.reply({ ...f.success(request), ...patch }); assert.equal(JSON.parse(f.db.get(key)).savePending.requestId, request.requestId);
    f.h.click({ controlId: 'retryPendingSave' }); assert.deepEqual(copy(f.saved().at(-1)), request);
  }
  f.reply(null, { ok: false, error: 'changed after timeout' }); assert.equal(f.saved().length, 5);
  assert.deepEqual(JSON.parse(f.db.get(key)).savePending, request); assert.ok(before);
  f.h.click({ controlId: 'retryPendingSave' }); assert.deepEqual(copy(f.saved().at(-1)), request);
});

test('known cost failure is not a success; confirmed failure cleanup preserves unrelated drafts and rejects fake terminal replies', () => {
  const f = fixture(); f.start(); const request = copy(f.saved()[0]);
  const failure = { ok: false, stockFinal: true, company: 'NCT', taskId: ID, requestId: request.requestId, stockGeneration: 1, error: 'POINTBASE_SERVICE_UNAVAILABLE' };
  for (const patch of [{ stockFinal: false }, { taskId: 'OTHER' }, { stockGeneration: 0 }, { error: 'PRIVATE UNKNOWN' }]) {
    f.reply({ ...failure, ...patch }); assert.deepEqual(JSON.parse(f.db.get(key)).savePending, request);
  }
  const cached = JSON.parse(f.db.get(key)); cached.unrelatedDraft = 'KEEP'; cached.drafts = [['OTHER', { version: 'V', changes: { lpCtn: 23 } }]];
  f.db.set(key, JSON.stringify(cached)); f.reply(failure);
  const after = JSON.parse(f.db.get(key)); assert.equal(after.savePending, null); assert.equal(after.unrelatedDraft, 'KEEP'); assert.deepEqual(after.drafts, cached.drafts);
  assert.match(f.h.node('#liveStatus').textContent, /failure recorded/); assert.doesNotMatch(f.h.node('#liveStatus').textContent, /refreshed|已更新/);
  for (const timer of [...f.h.timers]) timer(); assert.equal(f.saved().length, 1);
});

test('success requires matching cache cleanup and late pending after an unknown outcome never auto-resends', () => {
  const f = fixture(); f.start(); const request = copy(f.saved()[0]);
  f.h.timers.at(-1)(); const count = f.h.timers.length;
  f.reply({ ok: false, pending: true, requestId: request.requestId, phase: 'APPLY', completedCount: 1, totalRecords: 5 });
  assert.equal(f.h.timers.length, count); assert.equal(f.saved().length, 1);
  f.h.click({ controlId: 'retryPendingSave' });
  f.reply({ ok: false, pending: true, requestId: request.requestId, phase: 'APPLY', completedCount: 2, totalRecords: 5 });
  f.h.timers.at(-1)(); assert.equal(f.saved().length, 3); assert.deepEqual(copy(f.saved().at(-1)), request);
  const next = JSON.parse(f.db.get(key)); next.savePending.input.taskId = 'OTHER'; f.db.set(key, JSON.stringify(next));
  f.reply(f.success(request)); assert.ok(JSON.parse(f.db.get(key)).savePending); assert.match(f.h.node('#liveStatus').textContent, /unconfirmed/);
  next.savePending = request; f.db.set(key, JSON.stringify(next)); f.h.click({ controlId: 'retryPendingSave' }); f.reply(f.success(request));
  assert.equal(f.db.has(key), false); assert.match(f.h.node('#liveStatus').textContent, /Reference cost refreshed/);
});

test('confirmed result with unavailable cache cleanup retains same request, and repeated unchanged progress has a finite automatic budget', () => {
  for (const failed of [false, true]) {
    const f = fixture(); f.start(); const request = copy(f.saved()[0]); f.setFailStorage(true);
    const result = failed ? { ok: false, stockFinal: true, company: 'NCT', taskId: ID, requestId: request.requestId, stockGeneration: 1, error: 'POINTBASE_RESULT_INVALID' } : f.success(request);
    f.reply(result); assert.deepEqual(JSON.parse(f.db.get(key)).savePending, request);
    const count = f.saved().length; f.h.click({ controlId: 'retryPendingSave' });
    assert.equal(f.saved().length, count + 1, 'already read-confirmed identical request remains safely retryable even when a new cache write fails');
    assert.deepEqual(copy(f.saved().at(-1)), request);
    f.setFailStorage(false); f.h.click({ controlId: 'retryPendingSave' }); assert.deepEqual(copy(f.saved().at(-1)), request); f.reply(result);
    assert.equal(f.db.has(key) && JSON.parse(f.db.get(key)).savePending != null, false);
  }
  const f = fixture(); f.start(); const request = copy(f.saved()[0]);
  for (let i = 0; i < 70; i++) {
    const before = f.h.timers.length;
    f.reply({ ok: false, pending: true, requestId: request.requestId, phase: 'APPLY', completedCount: 1, totalRecords: 5 });
    if (f.h.timers.length > before) f.h.timers.at(-1)();
  }
  assert.ok(f.saved().length <= 65); assert.deepEqual(JSON.parse(f.db.get(key)).savePending, request);
  assert.match(f.h.node('#liveStatus').textContent, /paused/);
});

test('reload uses original Purchase authorization/own cache, explicit first retry, known failed receipt and fresh same-staff workspace before cleanup', async () => {
  const req = { type: 'PURCHASE_SAVE_REQUEST', company: 'NCT', requestId: '11111111-2222-4333-8444-555555555555', operation: 'COST_REFERENCE', input: { taskId: ID },
    stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0, stockIdentity: { staffId: 'STAFF', memberId: 'MEMBER' } };
  const recovery = resumeFixture(); recovery.db.set(key, JSON.stringify({ savePending: req, drafts: [] })); await recovery.authorize();
  assert.equal(recovery.sent.length, 0); recovery.section().button.click(); assert.deepEqual(copy(recovery.sent[0]), req);
  const failed = { ok: false, stockFinal: true, company: 'NCT', taskId: ID, requestId: req.requestId, stockGeneration: 1, error: 'POINTBASE_RESULT_INVALID' };
  recovery.reply(failed); assert.equal(recovery.receipts.length, 1); assert.ok(JSON.parse(recovery.db.get(key)).savePending);
  const foreign = resumeFixture(); foreign.db.set(key, JSON.stringify({ savePending: { ...req, stockIdentity: { staffId: 'OTHER', memberId: 'MEMBER' } } })); await foreign.authorize(); assert.equal(foreign.host.children.length, 0);
  let mount;
  const otherDrafts = [['OTHER', { version: 'OTHER-V1', changes: { lpCtn: 23 } }]];
  const db = new Map([[key, JSON.stringify({ savePending: req, drafts: otherDrafts })]]), storage = { getItem: id => db.get(id) || null, setItem: (id, value) => db.set(id, value), removeItem: id => db.delete(id) };
  const { h, workspace } = appHarness(storage, { mount: args => { mount = args; return () => {}; } });
  h.reply(null, h.messages[0], { ok: false, error: 'Inventory pending' }); mount.receipt({ request: req, result: failed, staff: { staffId: 'STAFF', memberId: 'MEMBER', staffName: 'Purchase' } });
  assert.ok(JSON.parse(db.get(key)).savePending); const w = workspace(); w.stockCurrent = { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 1 }; h.reply(w);
  h.timers.at(-1)(); assert.equal(JSON.parse(db.get(key)).savePending, null); assert.deepEqual(JSON.parse(db.get(key)).drafts, otherDrafts);
  assert.match(h.node('#liveStatus').textContent, /failure recorded/); assert.equal(h.messages.some(row => row.type === 'PURCHASE_SAVE_CHECK_REQUEST'), false);
});

test('actual original UI/parent/web/private root completes a segmented cost save or failed attempt without stock or legacy fallback', async () => {
  for (const fail of [false, true]) {
    let providerCalls = 0;
    const backend = await rootFixture({ generated: true, ...(fail ? { captureCosts: async () => { providerCalls++; throw Object.assign(Error('Provider down'), { code: 'POINTBASE_SERVICE_UNAVAILABLE' }); } } : {}) });
    const f = fixture(); f.w.staff = { staffId: 'P', memberId: 'M', staffName: 'Purchase' }; f.h.reply(f.w);
    let receive;
    const room = { onMessage: fn => receive = fn, postMessage: message => f.h.send(message) }, $w = () => room; $w.onReady = fn => fn();
    const source = fs.readFileSync(path.join(folder, 'purchase-room-page.candidate.js'), 'utf8');
    vm.runInNewContext(source.replace(/^import[^\n]+\n/gm, ''), { $w, retryPurchaseTaskCost: backend.retry,
      savePurchaseTasksCurrent: () => { throw Error('Wrong legacy/current general writer'); }, authentication: {} });
    f.start(); const request = copy(f.saved()[0]); assert.ok(request); let processed = 0;
    for (let i = 0; i < 30; i++) {
      const current = f.saved()[processed++]; assert.ok(current); await receive({ data: current });
      if (f.h.messages.at(-1).type === 'PURCHASE_WORKSPACE_REQUEST') break;
      f.h.timers.at(-1)();
    }
    assert.equal(f.h.messages.at(-1).type, 'PURCHASE_WORKSPACE_REQUEST'); assert.equal(backend.calls.includes('LEGACY'), false);
    assert.equal(backend.control().generation, 1); assert.equal([...backend.db.values()].filter(row => row.action === 'COST_RETRY_RESULT').length, 1);
    assert.equal([...backend.db.keys()].some(address => address.startsWith('Stock')), false);
    assert.ok(f.saved().every(row => JSON.stringify(row) === JSON.stringify(request)));
    if (fail) { assert.equal(providerCalls, 1); assert.match(f.h.node('#liveStatus').textContent, /failure recorded/); }
    else { assert.equal(backend.captures(), 1); assert.match(f.h.node('#liveStatus').textContent, /Reference cost refreshed/); }
  }
});
