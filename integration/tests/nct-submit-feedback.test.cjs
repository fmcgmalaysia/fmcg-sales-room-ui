const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('let pendingNctSubmit=null;'), end = html.indexOf('function renderOrderDetail(o){', start);
assert.ok(start > 0 && end > start);
function fixture(destination = 'NCT') {
  const requests = [], timers = [], busy = [], renders = [], controls = [{ disabled: false }, { disabled: false }];
  const status = { textContent: '' }, area = { dataset: { nctOrderId: 'ORDER' }, innerHTML: 'KEEP ORDER AND QUANTITIES' };
  const attrs = {}; const dialog = { style: {}, setAttribute(k,v){attrs[k]=v;}, open: false, innerHTML: '', querySelector: () => dialog.innerHTML.includes('data-close-nct-feedback') ? {} : null, showModal() { this.open = true; }, close() { this.open = false; } };
  let mounted = false;
  let handler, unload, count = 0;
  const parent = { postMessage: value => requests.push(value) }, window = { parent, addEventListener: (type, callback) => { if(type==='message')handler=callback;else if(type==='beforeunload')unload=callback; } };
  const ctx = vm.createContext({ window, crypto: { randomUUID: () => 'REQUEST-' + ++count },
    document: { getElementById: id => id === 'nctSubmissionFeedback' ? (mounted ? dialog : null) : id === 'salesQtyStatus' ? status : area,
      createElement: () => dialog, body: { appendChild: () => { mounted = true; } },
      querySelectorAll: selector => selector.startsWith('#submit') ? controls : [] },
    esc: value => String(value ?? '').replace(/[<>&]/g, char => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;' }[char])),
    salesQtyBusy: value => busy.push(value), renderOrderDetail: order => renders.push(order),
    setTimeout: callback => timers.push(callback) });
  vm.runInContext(html.slice(start, end), ctx);
  const order = { orderId: 'ORDER', companyName: 'TEST CUSTOMER', lines: [{ quantityCtn: 250 }] };
  return { start: () => ctx.submitOrderToNct(order, destination), requests, timers, busy, renders, status, area, dialog, attrs, unload:()=>{const event={blocked:false,preventDefault(){this.blocked=true;}};unload(event);return event;},
    respond: (message, source = parent) => { const event = { source, data: { type: 'SALES_ROOM_ORDER_ACTION_RESULT',
      action: 'SUBMIT_' + destination, orderId: 'ORDER', requestId: 'REQUEST-1', ...message }, stopped: false,
      stopImmediatePropagation() { this.stopped = true; } }; handler(event); return event; } };
}

test('GHR feedback requires a GHR receipt and retains quantities', () => {
  const f = fixture('GHR'); f.start(); assert.equal(f.requests[0].destination, 'GHR');
  f.respond({ ok: true, receiptId: 'GHR-RECEIPT', destination: 'GHR', masterReceivedAt: '2026-10-12T03:00:00Z' });
  assert.equal(f.renders[0].destination, 'GHR'); assert.equal(f.renders[0].lines[0].quantityCtn, 250);
  assert.match(f.dialog.innerHTML, /Submitted to GHR/);
  const wrong = fixture('GHR'); wrong.start(); wrong.respond({ ok: true, receiptId: 'NCT-RECEIPT', destination: 'NCT', masterReceivedAt: '2026-10-12T03:00:00Z' });
  assert.equal(wrong.renders.length, 0);
});
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
test('timeout checks the saved receipt without resubmitting, then leaves explicit uncertainty if no response arrives', () => {
  const f = fixture(); f.start(); f.timers[0](); assert.match(f.status.textContent, /Checking Master receipt/);
  assert.equal(f.requests[1].type,'SALES_ROOM_NCT_RECEIPT_REQUEST');
  for(let attempt=0;attempt<3;attempt++)f.timers.at(-1)();
  assert.match(f.status.textContent,/Receipt is not confirmed yet/);assert.equal(f.renders.length,0);
  assert.equal(f.requests.filter(message=>message.type==='SALES_ROOM_SUBMIT_ORDER').length,1);
  f.start();assert.equal(f.requests.filter(message=>message.type==='SALES_ROOM_SUBMIT_ORDER').length,2);
});
test('a 504 followed by a stored complete receipt displays success without a second write request',()=>{
  const f=fixture();f.start();f.respond({ok:false,error:'Request failed with status code 504'});
  const check=f.requests.at(-1);assert.equal(check.type,'SALES_ROOM_NCT_RECEIPT_REQUEST');
  f.respond({type:'SALES_ROOM_NCT_RECEIPT_RESULT',requestId:check.requestId,ok:true,receipt:{ok:true,orderId:'ORDER',destination:'NCT',receiptId:'RECEIPT',masterReceivedAt:'2026-10-10T03:00:00Z',costErrorTaskCount:1}});
  assert.equal(f.renders.length,1);assert.match(f.dialog.innerHTML,/交单成功/);
  assert.equal(f.requests.filter(message=>message.type==='SALES_ROOM_SUBMIT_ORDER').length,1);
});
test('stale response or another opened order cannot replace the current review', () => {
  const f = fixture(); f.start(); f.respond({ ok: true, requestId: 'OTHER', receiptId: 'RECEIPT', destination: 'NCT' });
  assert.equal(f.renders.length, 0); f.area.dataset.nctOrderId = 'OTHER ORDER';
  f.respond({ ok: true, receiptId: 'RECEIPT', destination: 'NCT' }); assert.equal(f.renders.length, 0);
});

test('waiting modal immediately blocks dismissal and unload, terminal result releases it',()=>{
  const f=fixture();f.start();assert.equal(f.dialog.open,true);assert.equal(f.attrs['aria-busy'],'true');assert.match(f.dialog.innerHTML,/正在交单/);assert.doesNotMatch(f.dialog.innerHTML,/data-close-nct-feedback/);assert.equal(f.unload().blocked,true);
  const cancel={blocked:false,preventDefault(){this.blocked=true;}};f.dialog.oncancel(cancel);assert.equal(cancel.blocked,true);
  f.respond({ok:false,error:'Validation failed'});assert.equal(f.attrs['aria-busy'],'false');assert.match(f.dialog.innerHTML,/data-close-nct-feedback/);assert.equal(f.unload().blocked,false);
});
test('receipt lookup retains the modal and cannot create a second submission',()=>{
  const f=fixture('GHR');f.start();f.respond({ok:false,error:'network timeout'});assert.equal(f.dialog.open,true);assert.equal(f.attrs['aria-busy'],'true');assert.match(f.dialog.innerHTML,/正在核对交单回执/);f.start();assert.equal(f.requests.filter(m=>m.type==='SALES_ROOM_SUBMIT_ORDER').length,1);
  const check=f.requests.at(-1);f.respond({type:'SALES_ROOM_NCT_RECEIPT_RESULT',requestId:check.requestId,ok:true,receipt:{ok:true,orderId:'ORDER',destination:'GHR',receiptId:'R',masterReceivedAt:'2026-10-14T03:00:00Z'}});assert.equal(f.attrs['aria-busy'],'false');assert.match(f.dialog.innerHTML,/交单成功/);assert.equal(f.unload().blocked,false);
});
