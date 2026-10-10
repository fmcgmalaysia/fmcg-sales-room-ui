const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('let pendingNctSubmit=null;'), end = html.indexOf('function renderOrderDetail(o){', start);
assert.ok(start > 0 && end > start);
function fixture() {
  const requests = [], timers = [], busy = [], renders = [], controls = [{ disabled: false }, { disabled: false }];
  const status = { textContent: '' }, area = { dataset: { nctOrderId: 'ORDER' }, innerHTML: 'KEEP ORDER AND QUANTITIES' };
  const dialog = { style: {}, open: false, innerHTML: '', querySelector: () => ({}), showModal() { this.open = true; }, close() { this.open = false; } };
  let mounted = false;
  let handler, count = 0;
  const parent = { postMessage: value => requests.push(value) }, window = { parent, addEventListener: (_type, callback) => { handler = callback; } };
  const ctx = vm.createContext({ window, crypto: { randomUUID: () => 'REQUEST-' + ++count },
    document: { getElementById: id => id === 'nctSubmissionFeedback' ? (mounted ? dialog : null) : id === 'salesQtyStatus' ? status : area,
      createElement: () => dialog, body: { appendChild: () => { mounted = true; } },
      querySelectorAll: selector => selector.startsWith('#submit') ? controls : [] },
    esc: value => String(value ?? '').replace(/[<>&]/g, char => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;' }[char])),
    salesQtyBusy: value => busy.push(value), renderOrderDetail: order => renders.push(order),
    setTimeout: callback => timers.push(callback) });
  vm.runInContext(html.slice(start, end), ctx);
  const order = { orderId: 'ORDER', companyName: 'TEST CUSTOMER', lines: [{ quantityCtn: 250 }] };
  return { start: () => ctx.submitOrderToNct(order), requests, timers, busy, renders, status, area, dialog,
    respond: (message, source = parent) => { const event = { source, data: { type: 'SALES_ROOM_ORDER_ACTION_RESULT',
      action: 'SUBMIT_NCT', orderId: 'ORDER', requestId: 'REQUEST-1', ...message }, stopped: false,
      stopImmediatePropagation() { this.stopped = true; } }; handler(event); return event; } };
}
test('one click starts one correlated NCT request and gives immediate waiting feedback', () => {
  const f = fixture(); f.start(); f.start(); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].type, 'SALES_ROOM_SUBMIT_ORDER'); assert.equal(f.requests[0].destination, 'NCT');
  assert.match(f.status.textContent, /Submitting to NCT/); assert.deepEqual(f.busy, [true]);
});
test('submit failure keeps the order, quantities and visible actionable error', () => {
  const f = fixture(); f.start(); const event = f.respond({ ok: false, error: 'Retry this same order.' });
  assert.equal(event.stopped, true); assert.equal(f.area.innerHTML, 'KEEP ORDER AND QUANTITIES');
  assert.equal(f.status.textContent, 'Retry this same order.'); assert.equal(f.renders.length, 0);
  f.start(); assert.equal(f.requests[1].requestId, 'REQUEST-2');
});
test('success requires the Master receipt and preserves cost-error feedback for Purchase', () => {
  const f = fixture(); f.start(); f.respond({ ok: true, receiptId: 'RECEIPT', destination: 'NCT', masterReceivedAt:'2026-10-10T03:00:00Z', costErrorTaskCount: 1 });
  assert.equal(f.renders[0].destination, 'NCT'); assert.equal(f.renders[0].lines[0].quantityCtn, 250);
  assert.match(f.status.textContent, /Master receipt confirmed/); assert.match(f.status.textContent, /1 product line/);
  assert.equal(f.dialog.open, true); assert.match(f.dialog.innerHTML, /交单成功/); assert.match(f.dialog.innerHTML, /Master received:/);
});
test('an ok flag without a complete receipt cannot display success', () => {
  const f = fixture(); f.start(); f.respond({ ok: true, destination: 'NCT' });
  assert.equal(f.renders.length, 0); assert.match(f.status.textContent, /receipt is not confirmed/);
});
test('timeout gives uncertainty and enables retry, never falsely reports failure or success', () => {
  const f = fixture(); f.start(); f.timers[0](); assert.match(f.status.textContent, /Receipt is not confirmed yet/);
  assert.equal(f.renders.length, 0); f.start(); assert.equal(f.requests.length, 2);
});
test('stale response or another opened order cannot replace the current review', () => {
  const f = fixture(); f.start(); f.respond({ ok: true, requestId: 'OTHER', receiptId: 'RECEIPT', destination: 'NCT' });
  assert.equal(f.renders.length, 0); f.area.dataset.nctOrderId = 'OTHER ORDER';
  f.respond({ ok: true, receiptId: 'RECEIPT', destination: 'NCT' }); assert.equal(f.renders.length, 0);
});
