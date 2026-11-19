const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../prototypes/stock-current-state/purchase-ui/stock-control.js'), 'utf8');
const id = '77777777-1111-4111-8111-111111111111', origin = 'https://fmcgmalaysia.github.io';
function fixture() {
  let handler; const frames = [], calls = [], login = [], resolvers = [];
  const document = { createElement: () => { const replies = [], frame = { isConnected: true, style: {}, replies,
    contentWindow: { postMessage: (value, target) => replies.push({ value, target }) } }; frames.push(frame); return frame; } };
  const window = { addEventListener: (type, fn) => { assert.equal(type, 'message'); handler = fn; } };
  vm.runInNewContext(source, { window, document, location: { origin }, parent: { postMessage: value => login.push(value) }, Number, Set, JSON, Math });
  const mount = company => window.purchaseStockControl.mount({ company, container: { replaceChildren: () => {} },
    read: (type, args) => { calls.push({ type, args }); return new Promise((resolve, reject) => resolvers.push({ resolve, reject })); } });
  const send = (frame, message, extra = {}) => handler({ source: frame.contentWindow, origin, data: { company: 'NCT', requestId: id,
    type: 'STOCK_CONTROL_READ_REQUEST', input: { pageSize: 50 }, ...message }, ...extra });
  return { frames, calls, login, resolvers, mount, send };
}
test('Purchase pane relays list and source reads to its own authenticated route, using the existing Warehouse renderer', async () => {
  const f = fixture(); f.mount('NCT'); const frame = f.frames[0];
  assert.match(frame.src, /^\.\.\/warehouse-room\/stock-control.html\?/); assert.match(frame.title, /Purchase/);
  const pending = f.send(frame, {}); assert.equal(f.calls[0].type, 'PURCHASE_STOCK_CONTROL_REQUEST');
  f.resolvers[0].resolve({ ok: true, company: 'NCT', items: [] }); await pending;
  assert.equal(frame.replies[0].value.type, 'STOCK_CONTROL_READ_RESULT'); assert.equal(frame.replies[0].target, origin);
  const next = f.send(frame, { type: 'STOCK_CONTROL_SOURCE_READ_REQUEST', input: { kind: 'positions' } });
  assert.equal(f.calls[1].type, 'PURCHASE_STOCK_SOURCES_REQUEST'); f.resolvers[1].reject(Error('Failed')); await next;
  assert.equal(frame.replies[1].value.ok, false);
});
test('wrong source/origin/company, save messages and duplicate reads cannot cross the pane', async () => {
  const f = fixture(); f.mount('NCT'); const frame = f.frames[0];
  await f.send(frame, {}, { origin: 'https://elsewhere.test' }); await f.send(frame, {}, { source: {} });
  await f.send(frame, { company: 'GHR' }); await f.send(frame, { type: 'STOCK_SAVE_REQUEST' }); assert.equal(f.calls.length, 0);
  const pending = f.send(frame, {}); await f.send(frame, {}); assert.equal(f.calls.length, 1);
  f.resolvers[0].resolve({ ok: false }); await pending; assert.equal(frame.replies[0].value.ok, false);
});
test('late response cannot enter a different company or replaced view; login uses original Purchase login', async () => {
  const f = fixture(); f.mount('NCT'); const frame = f.frames[0], pending = f.send(frame, {});
  await f.send(frame, { type: 'WAREHOUSE_LOGIN_REQUEST' }); assert.equal(f.login[0].type, 'PURCHASE_LOGIN_REQUEST');
  f.mount('GHR'); f.resolvers[0].resolve({ ok: true }); await pending; assert.equal(frame.replies.length, 0);
  await f.send(frame, {}); assert.equal(f.calls.length, 1);
});

test('actual Wix Purchase relay selects only the corresponding stock read, retaining company and request identity', async () => {
  const bridge = fs.readFileSync(require.resolve('../prototypes/stock-current-state/purchase-room-page.candidate.js'), 'utf8');
  const calls = [], replies = []; let receive;
  const room = { onMessage: fn => { receive = fn; }, postMessage: value => replies.push(value) };
  const $w = () => room; $w.onReady = fn => fn();
  vm.runInNewContext(bridge.replace(/^import[^\n]+\n/gm, ''), { $w,
    getPurchaseStockControlCurrent: async (company, input) => { calls.push(['LIST', company, input]); return { ok: true, company }; },
    getPurchaseStockSourcesCurrent: async (company, input) => { calls.push(['DETAIL', company, input]); return { ok: true, company }; } });
  await receive({ data: { type: 'PURCHASE_STOCK_CONTROL_REQUEST', company: 'NCT', requestId: id, input: { pageSize: 50 } } });
  assert.equal(calls[0][0], 'LIST'); assert.equal(replies[0].requestId, id); assert.equal(replies[0].type, 'PURCHASE_STOCK_CONTROL_RESULT');
  await receive({ data: { type: 'PURCHASE_STOCK_SOURCES_REQUEST', company: 'GHR', requestId: id, input: { kind: 'claims' } } });
  assert.equal(calls[1][0], 'DETAIL'); assert.equal(calls[1][1], 'GHR'); assert.equal(replies[1].type, 'PURCHASE_STOCK_SOURCES_RESULT');
  for (const data of [{ company: 'OTHER', requestId: id }, { company: 'NCT', requestId: 'BAD' }, { company: 'NCT', requestId: id, input: { text: 'x'.repeat(6001) } }]) {
    await receive({ data: { type: 'PURCHASE_STOCK_CONTROL_REQUEST', ...data } });
  }
  assert.equal(calls.length, 2); assert.ok(replies.slice(2).every(reply => reply.ok === false));
});
