const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const meta = { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 3 };
function fixture() {
  const sent = [], timers = new Map(), sections = [], handlers = new Map(); let ids = 0;
  function element() {
    const nodes = new Map();
    return { nodes, open: false, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; },
      querySelector(selector) { return nodes.get(selector); },
      querySelectorAll(selector) { return selector === '[data-task]' || selector === '[data-plan-task]' || selector === '[data-cancel]'
        ? [...nodes.values()].filter(node => node.kind === selector) : [...nodes.values()]; },
      set innerHTML(html) { nodes.clear(); for (const match of html.matchAll(/data-([a-z-]+)(?:="([^"]*)")?/g)) {
        const key = '[data-' + match[1] + ']';
        if (!nodes.has(key)) nodes.set(key, { kind: key, value: '', checked: false, disabled: false, hidden: true, textContent: '',
          dataset: { task: match[2], planTask: match[2], cancel: match[2] }, querySelector: selector => nodes.get(selector), after: section => sections.push(section) });
      } }
    };
  }
  const dialog = element(), parent = { postMessage: request => sent.push(structuredClone(request)) };
  const window = { parent, addEventListener: (name, handler) => handlers.set(name, handler) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../prototypes/stock-current-state/sales-shipment-ui.candidate.js'), 'utf8'), {
    window, document: { createElement: type => type === 'dialog' ? dialog : element(), body: { appendChild() {} } },
    crypto: { randomUUID: () => String(++ids).padStart(8, '0') + '-1111-4111-8111-111111111111' },
    setTimeout: (fn, ms) => { const id = ++ids; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id)
  });
  function reply(result, extra = {}) { handlers.get('message')({ source: parent, data: { type: 'SALES_ROOM_SHIPMENT_RESULT',
    requestId: sent.at(-1).requestId, company: 'NCT', ok: true, result, ...extra } }); }
  function start(action, stockCurrent = meta) {
    window.masterShipments.open('C');
    reply({ version: 'SHIP-V', planVersion: 'PLAN-V', lines: [{ taskId: 'T', orderId: 'O', barcode: '1', name: 'Item', packing: '12', available: 10, requested: 10 }],
      plans: [], shipments: [{ id: 'SHIP', status: 'REQUESTED', requestedAt: 'Today', requestedBy: 'Sales', lines: [{ quantity: 2 }] }], ...(stockCurrent ? { stockCurrent } : {}) });
    dialog.nodes.get('[data-reason]').value = 'Reason';
    if (action === 'SELECT') { dialog.nodes.get('[data-select]').checked = true; dialog.nodes.get('[data-qty]').value = '5'; dialog.nodes.get('[data-save]').onclick(); }
    if (action === 'CANCEL') dialog.nodes.get('[data-cancel]').onclick();
    if (action === 'PLAN') { const section = sections.at(-1); section.nodes.get('[data-plan-select]').checked = true;
      section.nodes.get('[data-first]').value = '4'; section.nodes.get('[data-second]').value = '6'; section.nodes.get('[data-plan-reason]').value = 'Split';
      section.nodes.get('[data-plan-save]').onclick(); }
  }
  return { sent, timers, dialog, start, reply, handlers, window, retry: () => dialog.nodes.get('[data-retry]').onclick() };
}

test('actual original SELECT/CANCEL/PLAN UI carries current READ metadata and preserves same request across phases', () => {
  for (const action of ['SELECT', 'CANCEL', 'PLAN']) {
    const f = fixture(); f.start(action); const request = structuredClone(f.sent.at(-1));
    assert.equal(request.action, action); assert.deepEqual(request.input.stockCurrent, meta);
    const oldTimeout = [...f.timers.values()].find(t => t.ms === 30000).fn;
    for (const phase of ['BEFORE', 'APPLY', 'VERIFY']) {
      f.reply({ ok: false, pending: true, requestId: request.requestId, phase, completedCount: 1, totalRecords: 3 });
      assert.equal(f.sent.length, phase === 'BEFORE' ? 2 : phase === 'APPLY' ? 3 : 4);
      const continuation = [...f.timers.entries()].find(([, timer]) => timer.ms === 250); assert.ok(continuation);
      f.timers.delete(continuation[0]); continuation[1].fn(); assert.deepEqual(f.sent.at(-1), request);
      oldTimeout(); assert.equal(f.dialog.nodes.get('[data-save]').disabled, true);
    }
    f.reply({ ok: true, requestId: request.requestId, stockGeneration: 4 });
    assert.equal(f.sent.at(-1).action, 'READ'); assert.equal(f.sent.at(-1).input, undefined);
  }
});

test('current unknown/error results and reopen cannot discard unresolved shipment; manual retry is identical', () => {
  const f = fixture(); f.start('PLAN'); const request = structuredClone(f.sent.at(-1));
  for (const result of [{}, { ok: true, requestId: request.requestId, stockGeneration: 3 },
    { ok: true, requestId: 'FOREIGN', stockGeneration: 4 }, { ok: false, pending: true, requestId: request.requestId, phase: 'APPLY', completedCount: 4, totalRecords: 3 }]) {
    f.reply(result); const length = f.sent.length; f.window.masterShipments.open('OTHER'); assert.equal(f.sent.length, length);
    f.retry(); assert.deepEqual(f.sent.at(-1), request);
  }
  f.reply(null, { ok: false, error: 'Inventory changed; keep this original request' }); f.retry(); assert.deepEqual(f.sent.at(-1), request);
  let warned = false; const leave = { preventDefault: () => { warned = true; } }; f.handlers.get('beforeunload')(leave); assert.equal(warned, true);
});

test('legacy shipment response stays legacy and malformed current READ never admits a save', () => {
  const f = fixture(); f.start('CANCEL', null); assert.equal(f.sent.at(-1).input.stockCurrent, undefined); f.reply({ legacy: true });
  assert.equal(f.sent.at(-1).action, 'READ');
  const g = fixture(); g.window.masterShipments.open('C');
  g.reply({ stockCurrent: { ...meta, stockGeneration: -1 } }); assert.equal(g.dialog.nodes.get('[data-retry]').hidden, false);
  assert.match(g.dialog.nodes.get('[data-status]').textContent, /unavailable/);
});
