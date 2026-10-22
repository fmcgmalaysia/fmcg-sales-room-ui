const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '../..'), folder = 'integration/prototypes/stock-current-state/warehouse-ui/';
const read = name => fs.readFileSync(path.join(root, folder, name), 'utf8');
function ui() {
  const nodes = new Map(), listeners = [], sent = [], timers = new Map(); let sequence = 0;
  function node(id) {
    if (!nodes.has(id)) { const events = {}; nodes.set(id, { value: id === 'filter' ? 'ON_HAND' : '', open: false, innerHTML: '', textContent: '', hidden: false,
      classList: { toggle() {}, add() {} }, addEventListener: (type, fn) => (events[type] ||= []).push(fn),
      showModal() { this.open = true; }, close() { this.open = false; for (const fn of events.close || []) fn(); } }); }
    return nodes.get(id);
  }
  const parent = { postMessage: message => sent.push(message) }, emit = (message, source = parent) => listeners.forEach(fn => fn({ source, data: message }));
  vm.runInNewContext(read('stock-control-app.js'), { document: { getElementById: node, querySelectorAll: () => [] }, location: { search: '?company=NCT' },
    URLSearchParams, parent, window: { addEventListener: (type, fn) => listeners.push(fn) }, crypto: { randomUUID: () => 'R' + ++sequence },
    setTimeout: fn => { const key = ++sequence; timers.set(key, fn); return key; }, clearTimeout: key => timers.delete(key) });
  const product = { key: 'SKU', name: 'Chocolate <cookie>', barcode: '123', packing: '12 × 1', sourceDetails: 'PAGED', onHand: 2000, reservedUsable: 1800, available: 100, isolated: 100 };
  const reply = (result, message = sent.at(-1), extra = {}) => emit({ type: message.type.replace('_REQUEST', '_RESULT'), company: message.company,
    requestId: message.requestId, ok: true, result, ...extra });
  const list = (extra = {}) => reply({ schema: 'CURRENT_STOCK_V1', company: 'NCT', generation: 8, items: [product], total: 1, offset: 0, counts: {}, permissions: { read: true }, ...extra });
  const detail = (extra = {}) => ({ schema: 'CURRENT_STOCK_DETAIL_V1', company: 'NCT', generation: 8, product, total: 2000, offset: 0,
    items: Array.from({ length: 25 }, (_, index) => ({ _id: index ? 'POS' + index : 'POS', poNumber: 'PO <1>', sourceTaskId: 'ROW1', onHand: 1, reservedUsable: 1, available: 0, isolated: 0 })), nextCursor: 'PAGE2', ...extra });
  const open = () => node('stock-rows').onclick({ target: { closest: () => ({ dataset: { key: 'SKU' } }) } });
  return { node, sent, timers, emit, reply, list, detail, product, open };
}
test('current UI opens paged sources without replacing full product totals by page subtotals', () => {
  const f = ui(); f.list(); f.open(); assert.equal(f.sent.at(-1).type, 'STOCK_CONTROL_SOURCE_READ_REQUEST');
  assert.equal(f.sent.at(-1).input.pageSize, 25); assert.equal(f.sent.at(-1).input.kind, 'positions');
  f.reply(f.detail()); assert.match(f.node('source-summary').innerHTML, /2,000/); assert.match(f.node('sources').innerHTML, /PO &lt;1&gt;/);
  f.node('source-next').onclick(); assert.equal(f.sent.at(-1).input.cursor, 'PAGE2');
  f.reply(f.detail({ offset: 25, total: 50, nextCursor: null })); assert.equal(f.node('source-next').disabled, true);
  f.node('source-previous').onclick(); assert.equal(f.sent.at(-1).input.cursor, null);
});
test('reservations drill down in the same dialog and return to the previous source page', () => {
  const f = ui(); f.list(); f.open(); f.reply(f.detail()); f.node('source-next').onclick(); f.reply(f.detail({ offset: 25 }));
  f.node('sources').onclick({ target: { closest: () => ({ dataset: { position: 'POS' } }) } });
  assert.equal(f.sent.at(-1).input.kind, 'claims'); assert.equal(f.sent.at(-1).input.positionId, 'POS');
  f.reply(f.detail({ total: 1, nextCursor: null, items: [{ customerName: '<A>', taskId: 'ROW1', reservedUsable: null, isolatedAttributed: 0 }] }));
  assert.match(f.node('sources').innerHTML, /&lt;A&gt;/); assert.match(f.node('sources').innerHTML, /Review Required/);
  assert.equal(f.node('source-back').hidden, false); f.node('source-back').onclick();
  assert.equal(f.sent.at(-1).input.kind, 'positions'); assert.equal(f.sent.at(-1).input.cursor, 'PAGE2');
  assert.equal(f.sent.at(-1).input.positionId, undefined);
});
test('stock generation or summary changes reject mixed-version details and cannot silently become zero', () => {
  for (const change of [{ generation: 9 }, { product: { onHand: 0, key: 'SKU' } }]) {
    const f = ui(); f.list(); f.open(); f.reply(f.detail(change));
    assert.equal(f.node('sources').innerHTML, ''); assert.match(f.node('source-review').textContent, /Stock changed/);
    assert.match(f.node('source-summary').innerHTML, /2,000/); assert.equal(f.node('source-next').disabled, true);
  }
});
test('closed dialogs, wrong parents and stale IDs cannot overwrite current details; no automatic retries', () => {
  const f = ui(); f.list(); f.open(); const request = f.sent.at(-1), count = f.sent.length;
  f.emit({ type: 'STOCK_CONTROL_SOURCE_READ_RESULT', company: 'NCT', requestId: request.requestId, ok: true, result: f.detail() }, {});
  assert.match(f.node('sources').innerHTML, /Reading stock sources/); f.node('done-source').onclick();
  f.reply(f.detail(), request); assert.equal(f.node('source-dialog').open, false); assert.equal(f.sent.length, count);
  f.open(); const timeout = [...f.timers.values()].at(-1); timeout(); assert.match(f.node('source-review').textContent, /unconfirmed/);
  assert.equal(f.sent.length, count + 1); f.reply(f.detail()); assert.match(f.node('source-review').textContent, /unconfirmed/);
});
test('old list schemas and malformed detail payloads are refused, not consumed as current stock', () => {
  const f = ui(); f.list({ schema: undefined }); f.open(); assert.equal(f.sent.length, 1);
  assert.match(f.node('notice').textContent, /requires review/); f.node('refresh').onclick(); f.list(); f.open();
  f.reply(f.detail({ items: Array(26).fill({}) })); assert.match(f.node('source-review').textContent, /requires review/);
});
test('candidate relay binds result type, request, company, frame and origin and never relays writes', () => {
  const sent = [], received = [], parent = { postMessage: x => sent.push(x) }, window = { addEventListener: (_, fn) => window.receive = fn }; let frame;
  const origin = 'https://example.test';
  vm.runInNewContext(read('stock-control-link.js'), { window, parent, location: { origin }, document: { createElement: () => ({ style: {}, contentWindow: { postMessage: x => received.push(x) } }) } });
  window.warehouseStockTab.render({ replaceChildren: f => { frame = f; frame.isConnected = true; } }, 'NCT');
  const emit = (data, source = frame.contentWindow, from = origin) => window.receive({ data, source, origin: from });
  const request = { type: 'STOCK_CONTROL_SOURCE_READ_REQUEST', company: 'NCT', requestId: 'DETAIL', input: { kind: 'positions' } };
  emit(request, frame.contentWindow, 'https://foreign.test'); emit({ ...request, type: 'STOCK_SAVE_REQUEST' }); assert.equal(sent.length, 0);
  emit(request); assert.equal(sent.length, 1);
  emit({ ...request, type: 'STOCK_CONTROL_READ_RESULT' }, parent); assert.equal(received.length, 0);
  emit({ ...request, type: 'STOCK_CONTROL_SOURCE_READ_RESULT' }, parent); assert.equal(received.length, 1);
  emit({ ...request, type: 'STOCK_CONTROL_SOURCE_READ_RESULT' }, parent); assert.equal(received.length, 1);
});
test('paired Wix routes use current read services while original orders remain unchanged', async () => {
  let handler; const calls = [], sent = [], room = { onMessage: fn => handler = fn, postMessage: m => sent.push(m) }, $w = () => room; $w.onReady = fn => fn();
  vm.runInNewContext(read('warehouse-department-page.js').replace(/^import .*;\r?$/gm, ''), { $w, handlePackingList: async () => false,
    getWarehouseStockControlCurrent: async (...args) => { calls.push(['list', ...args]); return { ok: true }; },
    getWarehouseStockSourcesCurrent: async (...args) => { calls.push(['details', ...args]); return { ok: true }; }, getWarehouseOrders: async company => ({ company, orders: [] }) });
  for (const type of ['STOCK_CONTROL_READ_REQUEST', 'STOCK_CONTROL_SOURCE_READ_REQUEST']) await handler({ data: { type, company: 'NCT', requestId: 'R', input: {} } });
  assert.equal(calls.length, 2); assert.equal(calls[1][0], 'details'); assert.equal(sent[1].type, 'STOCK_CONTROL_SOURCE_READ_RESULT');
  await handler({ data: { type: 'STOCK_CONTROL_SOURCE_READ_REQUEST', company: 'OTHER', requestId: 'R' } }); assert.equal(calls.length, 2);
  await handler({ data: { type: 'WAREHOUSE_ORDERS_REQUEST', company: 'NCT', requestId: 'ORDER' } }); assert.equal(sent.at(-1).type, 'WAREHOUSE_ORDERS_RESULT');
});
