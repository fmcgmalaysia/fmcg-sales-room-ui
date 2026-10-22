const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const folder = path.join(__dirname, '../prototypes/stock-current-state'), copy = value => JSON.parse(JSON.stringify(value)), flush = () => new Promise(resolve => setImmediate(resolve));
function helper(filename, name) {
  const file = require.resolve('./' + filename), source = fs.readFileSync(file, 'utf8').replace("const test = require('node:test')", 'const test = () => {}');
  return vm.runInNewContext(source + ';' + name + ';', { require: createRequire(file), __dirname, Buffer, Map, Set, Date, Number, setImmediate });
}
const appHarness = helper('stock-current-purchase-resume.test.cjs', 'originalAppHarness'), recoveryFixture = helper('stock-current-purchase-resume.test.cjs', 'fixture');
const rootFixture = helper('stock-current-purchase-orders-root.test.cjs', 'fixture');
async function fixture({ failStorage = false, metadata, staff = { staffId: 'STAFF', memberId: 'MEMBER', staffName: 'Purchase' }, listed } = {}) {
  const db = new Map(), reads = [], writes = [], key = 'fmcg-purchase-draft-v1/NCT/' + staff.staffId + '/' + staff.memberId;
  const storage = { getItem: id => { reads.push(id); return db.get(id) || null; }, setItem: (id, value) => { if (failStorage) throw Error('Quota'); writes.push(id); db.set(id, value); }, removeItem: id => { if (failStorage) throw Error('Quota'); db.delete(id); } };
  const { h, workspace } = appHarness(storage, null, true), w = workspace(); w.staff = staff; w.stockCurrent = { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0 };
  h.reply(w); h.click({ view: 'po' }); const read = h.messages.at(-1);
  const row = listed?.orders[0] || { id: 'PO', version: 'PV', number: 'PO-1', supplierName: 'SUPPLIER', amount: 1000, taskIds: ['TASK'], state: 'ACTIVE', documents: [], history: [], documentStatus: 'MISSING', termDays: 7, procurementHandoff: { stage: 'LEGACY', submitted: false } };
  const po = listed || { company: 'NCT', orders: [row], stockCurrent: metadata === undefined ? { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 2, stockIdentity: { staffId: staff.staffId, memberId: staff.memberId } } : metadata };
  h.send({ type: 'PURCHASE_ORDERS_RESULT', company: 'NCT', requestId: read.requestId, ok: true, result: po }); await flush();
  const saved = () => h.messages.filter(message => message.type === 'PURCHASE_ORDER_SAVE_REQUEST');
  const start = () => { h.click({ poTerm: row.id }); h.node('#poTermDays').value = '30'; h.click({ controlId: 'savePurchaseOrderMeta' }); };
  const reply = (result, extra = {}) => h.send({ type: 'PURCHASE_SAVE_RESULT', company: 'NCT', requestId: saved().at(-1).requestId, ok: true, result, ...extra });
  const success = request => ({ ok: true, company: 'NCT', requestId: request.requestId, poId: row.id, stockGeneration: request.stockGeneration + 1 });
  return { h, w, row, po, db, key, reads, writes, start, saved, reply, success, setFailStorage: value => failStorage = value };
}

test('original PO dialog uses its own newer server generation/actor and durably retains one full request before network', async () => {
  const f = await fixture(); f.start(); const request = copy(f.saved()[0]);
  assert.equal(request.stockGeneration, 2, 'PO read, not stale general workspace, owns original PO version');
  assert.deepEqual(request.stockIdentity, { staffId: 'STAFF', memberId: 'MEMBER' }); assert.equal(request.input.action, 'TERM'); assert.equal(request.input.version, 'PV');
  assert.deepEqual(JSON.parse(f.db.get(f.key)).savePending, request); assert.ok(f.writes.length); assert.ok(f.reads.includes(f.key));
  f.start(); assert.equal(f.saved().length, 1);
});

test('unconfirmed PO metadata, changed staff/build/generation and current file/retired actions never start a save', async () => {
  for (const metadata of [null, { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: -1 },
    { stockProtocol: 1, stockBuild: 'OLD', stockGeneration: 2, stockIdentity: { staffId: 'STAFF', memberId: 'MEMBER' } },
    { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 2, stockIdentity: { staffId: 'OTHER', memberId: 'MEMBER' } }]) {
    const f = await fixture({ metadata }); f.start(); assert.equal(f.saved().length, 0); assert.equal(f.db.has(f.key), false); assert.match(f.h.node('#liveStatus').textContent, /not started/);
  }
  const f = await fixture(); f.h.click({ poHandoff: f.row.id, handoffAction: 'CHASE' }); f.h.node('#poChangeReason').value = 'Original action'; f.h.click({ controlId: 'savePurchaseOrderMeta' });
  assert.equal(f.saved().length, 0); assert.match(f.h.node('#liveStatus').textContent, /file operations are not connected/);
});

test('failed initial storage sends nothing; unknown/wrong PO receipts retain the exact request and cleanup is read-confirmed', async () => {
  const blocked = await fixture({ failStorage: true }); blocked.start(); assert.equal(blocked.saved().length, 0);
  const f = await fixture(); f.start(); const request = copy(f.saved()[0]);
  for (const patch of [{ poId: 'OTHER' }, { company: 'GHR' }, { stockGeneration: 2 }, { pending: true }]) {
    f.reply({ ...f.success(request), ...patch }); assert.deepEqual(JSON.parse(f.db.get(f.key)).savePending, request);
    f.h.click({ controlId: 'retryPendingSave' }); assert.deepEqual(copy(f.saved().at(-1)), request);
  }
  f.reply(null, { ok: false, error: 'Version changed after network timeout' }); assert.deepEqual(JSON.parse(f.db.get(f.key)).savePending, request);
  f.h.click({ controlId: 'retryPendingSave' }); f.setFailStorage(true); f.reply(f.success(request)); assert.deepEqual(JSON.parse(f.db.get(f.key)).savePending, request);
  f.h.click({ controlId: 'retryPendingSave' }); assert.deepEqual(copy(f.saved().at(-1)), request, 'identical previously durable request remains retryable');
  f.setFailStorage(false); f.reply(f.success(request)); assert.equal(f.db.has(f.key), false); assert.match(f.h.node('#liveStatus').textContent, /Payment term saved/);
});

test('late pending after timeout cannot auto-send; normal phase continuation is exact and finite', async () => {
  const f = await fixture(); f.start(); const request = copy(f.saved()[0]); f.h.timers.at(-1)(); const count = f.h.timers.length;
  const pending = { ok: false, pending: true, requestId: request.requestId, phase: 'APPLY', completedCount: 1, totalRecords: 5 };
  f.reply(pending); assert.equal(f.h.timers.length, count); assert.equal(f.saved().length, 1);
  f.h.click({ controlId: 'retryPendingSave' }); const manualCount = f.saved().length;
  for (let i = 0; i < 70; i++) { const before = f.h.timers.length; f.reply(pending); if (f.h.timers.length > before) f.h.timers.at(-1)(); }
  assert.ok(f.saved().length <= manualCount + 64); assert.ok(f.saved().every(row => JSON.stringify(row) === JSON.stringify(request)));
  assert.match(f.h.node('#liveStatus').textContent, /paused/); assert.deepEqual(JSON.parse(f.db.get(f.key)).savePending, request);
});

test('PO recovery requires original actor, allowed non-file action, strict final receipt and explicit first retry', async () => {
  const req = { type: 'PURCHASE_ORDER_SAVE_REQUEST', company: 'NCT', requestId: '11111111-2222-4333-8444-555555555555', input: { id: 'PO', version: 'PV', action: 'TERM', termDays: 30, reason: 'Original' },
    stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 2, stockIdentity: { staffId: 'STAFF', memberId: 'MEMBER' } };
  const key = 'fmcg-purchase-draft-v1/NCT/STAFF/MEMBER';
  for (const patch of [{ input: { ...req.input, action: 'DOCUMENT' } }, { stockIdentity: { staffId: 'OTHER', memberId: 'MEMBER' } }, { operation: 'EDIT' }, { input: { ...req.input, version: '' } }]) {
    const f = recoveryFixture(); f.db.set(key, JSON.stringify({ savePending: { ...req, ...patch } })); await f.authorize(); assert.equal(f.host.children.length, 0);
  }
  const f = recoveryFixture(); f.db.set(key, JSON.stringify({ savePending: req })); await f.authorize(); assert.equal(f.sent.length, 0); f.section().button.click(); assert.deepEqual(copy(f.sent[0]), req);
  const result = { ok: true, company: 'NCT', poId: 'PO', requestId: req.requestId, stockGeneration: 3 };
  f.reply({ ...result, poId: 'OTHER' }); assert.equal(f.receipts.length, 0); f.section().button.click(); f.reply(result); assert.equal(f.receipts.length, 1);
  assert.ok(JSON.parse(f.db.get(key)).savePending, 'receipt alone cannot clear original cache before workspace reconciliation');
});

test('actual original PO UI/parent/web/private save finishes once without stock mutations or old-writer fallback', async () => {
  const backend = await rootFixture({ generated: true }), listed = await backend.api.getPurchaseOrders('NCT');
  const f = await fixture({ listed: copy(listed), staff: { staffId: 'P', memberId: 'M', staffName: 'Purchase' } });
  let receive; const room = { onMessage: fn => receive = fn, postMessage: message => f.h.send(message) }, $w = () => room; $w.onReady = fn => fn();
  vm.runInNewContext(fs.readFileSync(path.join(folder, 'purchase-room-page.candidate.js'), 'utf8').replace(/^import[^\n]+\n/gm, ''), { $w, savePurchaseOrder: backend.api.savePurchaseOrder, authentication: {} });
  const before = JSON.stringify([...backend.db].filter(([address]) => /^(Stock|NCTTasks|NCTOrders)/.test(address)));
  f.start(); const request = copy(f.saved()[0]); assert.ok(request); let index = 0;
  for (let i = 0; i < 30; i++) { const current = f.saved()[index++]; assert.ok(current); await receive({ data: current }); if (f.h.messages.at(-1).type === 'PURCHASE_WORKSPACE_REQUEST') break; f.h.timers.at(-1)(); }
  assert.equal(f.h.messages.at(-1).type, 'PURCHASE_WORKSPACE_REQUEST'); assert.equal(f.db.has(f.key), false);
  assert.equal(backend.control().generation, 1); assert.equal(backend.db.get('PurchaseOrders:' + request.input.id).details.audit.length, 1);
  assert.equal(backend.calls.includes('LEGACY_SAVE'), false); assert.ok(f.saved().every(row => JSON.stringify(row) === JSON.stringify(request)));
  assert.equal(JSON.stringify([...backend.db].filter(([address]) => /^(Stock|NCTTasks|NCTOrders)/.test(address))), before);
});

test('reloaded PO result clears only after fresh matching original workspace; unrelated price drafts remain intact', () => {
  const req = { type: 'PURCHASE_ORDER_SAVE_REQUEST', company: 'NCT', requestId: '11111111-2222-4333-8444-555555555555', input: { id: 'PO', version: 'PV', action: 'TERM', termDays: 30, reason: 'Original' },
    stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 2, stockIdentity: { staffId: 'STAFF', memberId: 'MEMBER' } };
  const key = 'fmcg-purchase-draft-v1/NCT/STAFF/MEMBER', drafts = [['OTHER', { version: 'V', changes: { lpCtn: 23 } }]];
  for (const variant of ['STAFF','BUILD','GENERATION','MATCH']) {
    const db = new Map([[key, JSON.stringify({ savePending: req, drafts })]]), storage = { getItem: id => db.get(id) || null, setItem: (id, value) => db.set(id, value), removeItem: id => db.delete(id) };
    let mounted; const { h, workspace } = appHarness(storage, { mount: args => { mounted = args; return () => {}; } });
    h.reply(null, h.messages[0], { ok: false, error: 'Inventory pending' });
    mounted.receipt({ request: req, result: { ok: true, company: 'NCT', poId: 'PO', requestId: req.requestId, stockGeneration: 3 }, staff: { staffId: 'STAFF', memberId: 'MEMBER' } });
    assert.ok(JSON.parse(db.get(key)).savePending); const w = workspace();
    w.stockCurrent = { stockProtocol: 1, stockBuild: variant === 'BUILD' ? 'OTHER' : 'TEST', stockGeneration: variant === 'GENERATION' ? 2 : 3 };
    if (variant === 'STAFF') w.staff.memberId = 'OTHER'; h.reply(w); h.timers.at(-1)();
    if (variant === 'MATCH') { assert.equal(JSON.parse(db.get(key)).savePending, null); assert.deepEqual(JSON.parse(db.get(key)).drafts, drafts); }
    else assert.deepEqual(JSON.parse(db.get(key)).savePending, req);
    assert.equal(h.messages.some(message => message.type === 'PURCHASE_SAVE_CHECK_REQUEST'), false);
    assert.equal(h.messages.some(message => message.type === 'PURCHASE_ORDER_SAVE_REQUEST'), false);
  }
});
