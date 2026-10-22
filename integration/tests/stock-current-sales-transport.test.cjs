const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { dispatchCurrentSalesGateway } = require('../prototypes/stock-current-state/sales-gateway-current.cjs');
const root = path.join(__dirname, '../prototypes/stock-current-state');
const stockCurrent = { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 4 };
const staff = { staffId: 'S', staffName: 'LAW', memberId: 'SOURCE_SALES/S', customerId: 'C', canSelectShipment: true };
const body = { company: 'NCT', action: 'ADJUST', customerId: 'C', customerName: 'Customer', staff,
  requestId: '11111111-1111-4111-8111-111111111111', input: { taskId: 'T', mode: 'SPLIT', quantity: 40, stockCurrent } };
test('transport overlays are exactly reproducible and preserve original bearer authentication before resolver', async () => {
  assert.match(execFileSync(process.execPath, [path.join(root, 'build-sales-transport-candidate.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const original = fs.readFileSync(path.join(__dirname, '../backend/customerFulfilmentGateway.js'), 'utf8');
  const candidate = fs.readFileSync(path.join(root, 'customerFulfilmentGateway.candidate.js'), 'utf8');
  assert.equal(candidate.split(' const secret=')[1].split('\n try{')[0], original.split(' const secret=')[1].split('\n try{')[0]);
  let resolved = 0, legacy = 0, saved;
  const gateway = vm.runInNewContext(candidate.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + '\nhandleSalesFulfilment;', {
    Buffer, timingSafeEqual: require('node:crypto').timingSafeEqual, getSecret: async () => 'SYNTHETIC-TEST-ONLY', dispatchCurrentSalesGateway,
    saveCustomerFulfilment: async () => { legacy++; }, saveCustomerAccountDocument: async () => { legacy++; }, readCustomerFulfilment: async () => { legacy++; }
  });
  const resolve = async (_company, actor) => { resolved++; assert.equal(actor.memberId, staff.memberId);
    return { mode: 'ACTIVE', save: async request => { saved = request; return { ok: false, pending: true, requestId: request.requestId, phase: 'APPLY', completedCount: 1, totalRecords: 3 }; } }; };
  const unauthorized = await gateway({ headers: {}, body: { json: async () => { throw Error('Should not parse'); } } }, resolve);
  assert.equal(unauthorized.status, 401); assert.equal(resolved, 0);
  const result = await gateway({ headers: { Authorization: 'Bearer SYNTHETIC-TEST-ONLY' }, body: { json: async () => body } }, resolve);
  assert.equal(result.status, 200); assert.equal(result.body.ok, true); assert.equal(result.body.result.pending, true);
  assert.equal(saved.stockGeneration, 4); assert.equal(saved.input.stockCurrent, undefined);
  assert.equal(saved.input.customerId, 'C'); assert.equal(saved.input.action, 'ADJUST'); assert.equal(legacy, 0);
});
test('only LEGACY route can invoke original writer; maintenance/unconnected/malformed current never fallback', async () => {
  let legacy = 0, saved = 0;
  const run = (mode, extra = {}, requestBody = body) => dispatchCurrentSalesGateway({ body: requestBody, staff,
    resolveCurrentSales: async () => ({ mode, save: async () => { saved++; }, ...extra }), legacy: async () => ++legacy });
  assert.equal(await run('LEGACY',{}, {...body,input:{taskId:'T'}}), 1);
  await assert.rejects(run('LEGACY'),/mode changed/);
  for (const mode of ['MAINTENANCE', 'SHADOW', undefined]) await assert.rejects(run(mode), /paused/);
  await assert.rejects(run('ACTIVE', {}, { ...body, action: 'DOCUMENT' }), /not connected/);
  await assert.rejects(run('ACTIVE', {}, { ...body, input: {} }), /form changed/);
  await assert.rejects(run('ACTIVE', {}, { ...body, input: { stockCurrent: { ...stockCurrent, stockGeneration: -1 } } }), /form changed/);
  await assert.rejects(dispatchCurrentSalesGateway({ body: { ...body, customerId: 'OTHER' }, staff }), /delegation/);
  assert.equal(await run('ACTIVE', { read: async company => company }, { ...body, action: 'READ' }), 'NCT');
  assert.equal(legacy, 1); assert.equal(saved, 0);
});
test('active source SELECT/CANCEL route uses its connected reservation handler, never the adjustment or legacy writer', async () => {
  let selected = 0;
  for (const action of ['SELECT', 'CANCEL']) {
    const result = await dispatchCurrentSalesGateway({ body: { ...body, action }, staff, legacy: () => { throw Error('Legacy forbidden'); },
      resolveCurrentSales: async () => ({ mode: 'ACTIVE', save: () => { throw Error('Wrong adjustment handler'); }, shipmentSave: async request => {
        selected++; assert.equal(request.input.action, action); assert.equal(request.input.customerId, 'C'); return { selected: true };
      } }) });
    assert.equal(result.selected, true);
  }
  assert.equal(selected, 2);
});
test('active source PLAN/ORDER_DATE route uses only the connected original arrangement handler', async () => {
  for (const action of ['PLAN', 'ORDER_DATE']) {
    const result = await dispatchCurrentSalesGateway({ body: { ...body, action, input: { ...body.input, action: 'INVOICE', customerId: 'FORGED' } }, staff,
      legacy: () => { throw Error('Legacy forbidden'); }, resolveCurrentSales: async () => ({ mode: 'ACTIVE',
        save: () => { throw Error('Wrong adjustment handler'); }, shipmentSave: () => { throw Error('Wrong shipment handler'); },
        arrangementSave: async request => { assert.equal(request.input.action, action); assert.equal(request.input.customerId, 'C');
          assert.equal(request.stockGeneration, 4); assert.equal(request.input.stockCurrent, undefined); return { arrangement: true }; } }) });
    assert.equal(result.arrangement, true);
    await assert.rejects(dispatchCurrentSalesGateway({ body: { ...body, action }, staff, legacy: () => { throw Error('Legacy forbidden'); },
      resolveCurrentSales: async () => ({ mode: 'ACTIVE' }) }), /not connected/);
  }
});
function uiFixture() {
  let onMessage, html = '', closed = 0, refreshed = 0, ids = 0;
  const sent = [], timers = new Map(), nodes = new Map();
  const node = () => ({ disabled: false, hidden: false, value: '', textContent: '', setAttribute() {}, focus() {} });
  const dialog = { className: '', addEventListener() {}, showModal() {}, close() { closed++; },
    querySelector: selector => nodes.get(selector) || null,
    querySelectorAll: selector => selector === 'button,input' ? [...nodes.values()]
      : selector === '[data-mode]' ? ['INCREASE', 'SPLIT', 'REDUCE'].map(mode => nodes.get('[mode-' + mode + ']')).filter(Boolean)
      : selector === '[data-close]' ? [nodes.get(selector)].filter(Boolean) : [],
    set innerHTML(value) { html = value; nodes.clear();
      for (const match of value.matchAll(/data-([a-z]+)(?:="([^"]*)")?/g)) {
        const key = match[1] === 'mode' ? '[mode-' + match[2] + ']' : '[data-' + match[1] + ']';
        if (!nodes.has(key)) nodes.set(key, { ...node(), dataset: { mode: match[2] } });
      }
    }, get innerHTML() { return html; } };
  const parent = { postMessage: value => sent.push(JSON.parse(JSON.stringify(value))) };
  const window = { addEventListener: (name, fn) => { if (name === 'message') onMessage = fn; },
    customerShipmentBatches: { notify: () => refreshed++ }, dispatchEvent() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sales-order-adjustment.candidate.js'), 'utf8'), {
    window, parent, document: { createElement: () => dialog, body: { appendChild() {} } },
    crypto: { randomUUID: () => String(++ids).padStart(8, '0') + '-1111-4111-8111-111111111111' },
    setTimeout: (fn, ms) => { const id = ++ids; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    CustomEvent: function () {}, alert: message => { throw Error(message); }
  });
  function reply(result, extra = {}) { const request = sent.at(-1);
    onMessage({ source: parent, data: { type: 'SALES_ROOM_SHIPMENT_RESULT', company: 'NCT', requestId: request.requestId, ok: true, result, ...extra } }); }
  function start(current = stockCurrent) {
    window.salesOrderAdjustment.open({ company: 'NCT', customerId: 'C', orderId: 'O', lineId: 'L', quantity: 100, name: 'Item' });
    reply({ lines: [{ orderId: 'O', sourceLineId: 'L', taskId: 'T', requested: 100 }], plans: [], adjustmentVersion: 'ADJUST-V1', ...(current ? { stockCurrent: current } : {}) });
    nodes.get('[mode-SPLIT]').onclick(); nodes.get('[data-first]').value = '40'; nodes.get('[data-first]').oninput(); nodes.get('[data-save]').onclick();
  }
  return { start, reply, sent, timers, nodes, closed: () => closed, refreshed: () => refreshed,
    retry: () => nodes.get('[data-retry]').onclick() };
}
test('actual adjustment UI retains same immutable request across bounded phases and closes only on confirmed generation', () => {
  const f = uiFixture(); f.start(); const request = structuredClone(f.sent.at(-1));
  assert.equal(request.action, 'ADJUST'); assert.deepEqual(request.input.stockCurrent, stockCurrent);
  for (const phase of ['BEFORE', 'APPLY', 'VERIFY']) {
    f.reply({ ok: false, pending: true, requestId: request.requestId, phase, completedCount: 1, totalRecords: 3 });
    assert.equal(f.closed(), 0); assert.equal(f.refreshed(), 0);
    const continuation = [...f.timers.entries()].find(([, value]) => value.ms === 250); assert.ok(continuation);
    f.timers.delete(continuation[0]); continuation[1].fn(); assert.deepEqual(f.sent.at(-1), request);
  }
  f.reply({ ok: true, requestId: request.requestId, stockGeneration: 5 });
  assert.equal(f.closed(), 1); assert.equal(f.refreshed(), 1);
});
test('malformed/current errors never close or discard pending request on error-text guesses', () => {
  const f = uiFixture(); f.start(); const request = structuredClone(f.sent.at(-1));
  for (const bad of [{}, { ok: true, requestId: 'FOREIGN', stockGeneration: 5 },
    { ok: true, requestId: request.requestId, stockGeneration: 4 },
    { ok: false, pending: true, requestId: request.requestId, phase: 'APPLY', completedCount: 4, totalRecords: 3 }]) {
    f.reply(bad); assert.equal(f.closed(), 0); f.retry(); assert.deepEqual(f.sent.at(-1), request);
  }
  f.reply(null, { ok: false, error: 'Inventory changed; preserve the same request' });
  f.retry(); assert.deepEqual(f.sent.at(-1), request); assert.equal(f.closed(), 0);
});
test('original non-current adjustment successful response remains unchanged', () => {
  const f = uiFixture(); f.start(null); assert.equal(f.sent.at(-1).input.stockCurrent, undefined);
  f.reply({ legacy: true }); assert.equal(f.closed(), 1); assert.equal(f.refreshed(), 1);
});
