const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '../prototypes/stock-current-state');
const stockCurrent = { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 3 };
test('packing transport is exactly generated from original official-origin parent bridge', () => {
  assert.match(execFileSync(process.execPath, [path.join(root, 'build-packing-transport-candidate.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const source = fs.readFileSync(path.join(root, 'packing-transport.current.js'), 'utf8');
  assert.ok(source.includes("if(event.source!==parent||event.origin!==parentOrigin)return;"));
  assert.equal(/sessionStorage|localStorage|fetch\(/.test(source), false);
});
function fixture() {
  let receive, serial = 0, company = 'NCT', busy = false;
  const sent = [], timers = new Map(), origin = 'https://fmcg999.wixstudio.com';
  const parent = { postMessage: (message, target) => { assert.equal(target, origin); sent.push(JSON.parse(JSON.stringify(message))); } };
  const window = { addEventListener: (type, fn) => { if (type === 'message') receive = fn; } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'packing-transport.current.js'), 'utf8'), {
    window, parent, URL, document: { referrer: origin + '/master/support-department' }, crypto: { randomUUID: () => 'ID-' + ++serial },
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id)
  });
  const transport = window.createPackingTransport({ company: () => company, onBusy: value => { busy = value; } });
  return { transport, sent, timers, busy: () => busy, company: value => { company = value; },
    reply: (result, extra = {}) => { const request = sent.at(-1); receive({ source: parent, origin, data: {
      type: request.type.replace('_REQUEST', '_RESULT'), requestId: request.requestId, company: request.company, ok: true, result, ...extra } }); } };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
async function read(f, current = true) { const promise = f.transport.read(); f.reply({ version: 'PACK-V', ...(current ? { stockCurrent } : {}) }); return promise; }
test('same packing request/input survives progress and finishes only with matching committed identity', async () => {
  const f = fixture(); await read(f);
  const input = { action: 'PROGRESS', id: 'LIST', lines: [{ taskId: 'T', loaded: 40 }] }, promise = f.transport.save(input);
  const request = structuredClone(f.sent.at(-1)); input.lines[0].loaded = 999;
  f.reply({ ok: false, pending: true, requestId: request.requestId, phase: 'APPLY', completedCount: 2, totalRecords: 5 }); await flush();
  assert.equal(f.transport.hasPending(), true); assert.equal(f.busy(), true);
  await assert.rejects(f.transport.retry(), /still processing/);
  const continuation = [...f.timers.entries()].find(([, timer]) => timer.ms === 250); assert.ok(continuation);
  f.timers.delete(continuation[0]); continuation[1].fn(); await flush(); assert.deepEqual(f.sent.at(-1), request);
  f.reply({ ok: true, requestId: request.requestId, stockGeneration: 4, id: 'LIST' });
  assert.equal((await promise).id, 'LIST'); assert.equal(f.transport.hasPending(), false); assert.equal(f.busy(), false);
});
test('unknown result/timeout retains exact request; retry never allocates a fresh ID or accepts old generation', async () => {
  const f = fixture(); await read(f); let promise = f.transport.save({ action: 'SEND', id: 'LIST' });
  const request = structuredClone(f.sent.at(-1));
  const timeout = [...f.timers.entries()].find(([, timer]) => timer.ms === 30000); timeout[1].fn();
  await assert.rejects(promise, /unconfirmed/); assert.equal(f.transport.hasPending(), true); assert.equal(f.busy(), false);
  promise = f.transport.retry(); assert.deepEqual(f.sent.at(-1), request);
  f.reply({ ok: true, requestId: request.requestId, stockGeneration: 3, id: 'LIST' });
  await assert.rejects(promise, /unconfirmed/); assert.equal(f.transport.hasPending(), true);
  promise = f.transport.retry(); f.reply({ ok: true, requestId: request.requestId, stockGeneration: 4, id: 'LIST' }); await promise;
});
test('original legacy receipt still succeeds and current metadata cannot silently cross company', async () => {
  const f = fixture(); await read(f, false); const promise = f.transport.save({ action: 'SEND', id: 'LIST' });
  assert.equal(f.sent.at(-1).stockProtocol, undefined); f.reply({ ok: true, id: 'LIST' }); await promise;
  await read(f); f.company('GHR'); assert.throws(() => f.transport.save({ action: 'SEND', id: 'LIST' }), /Company changed/);
});
