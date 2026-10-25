const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module'), { execFileSync } = require('node:child_process');
const folder = path.join(__dirname, '../prototypes/stock-current-state'), copy = value => JSON.parse(JSON.stringify(value));
function helper(file, name, transform = value => value, extra = {}) {
  const filename = require.resolve('./' + file);
  const source = transform(fs.readFileSync(filename, 'utf8').replace(/const (?:\{ test \}|test) = require\('node:test'\)/, 'const test = () => {}'));
  return vm.runInNewContext(source + ';' + name + ';', { require: createRequire(filename), __dirname, Buffer, Map, Set, Date, Number, ...extra });
}
const masterFixture = helper('stock-current-intake-root.test.cjs', 'fixture');
const browserFixture = helper('nct-submit-feedback.test.cjs', 'fixture', source => source.replace('../../index.html', '../prototypes/stock-current-state/source-ui/index.html'));
async function backend(company = 'NCT', lines = 1) {
  const master = await masterFixture({ company, steps: 20, generated: true });
  const { buildNctSubmission } = await import('../../backend/nctSubmissionPayload.js');
  const createNctSubmissionDelivery = vm.runInNewContext(fs.readFileSync(path.join(folder, 'nctSubmissionDelivery.candidate.js'), 'utf8').replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';createNctSubmissionDelivery;', { buildNctSubmission });
  const setup = helper('nct-cross-site.test.cjs', 'setup', source => source
    .replace("const { createNctSubmissionDelivery } = await require('./load-nct-delivery.cjs')();", 'const { createNctSubmissionDelivery } = delivery;')
    .replace("const { createNctReceiver } = await import('../backend/nctReceiver.js');", 'const { createNctReceiver } = receiver;')
    .replace('return { run: () => submit(args),', 'return { adapter:submit,args,wixData,run: () => submit(args),'), {
    delivery: { createNctSubmissionDelivery }, receiver: { createNctReceiver: () => async request => {
      assert.equal(request.headers.Authorization, 'Bearer LOCAL-TEST-ONLY'); return master.send(await request.body.json());
    } }
  });
  const source = await setup(company), first = JSON.parse(source.rows.get('WixBuyerOrderLines/L001').payload);
  for (let i = 1; i < lines; i++) { const lineId = 'L' + String(i + 1).padStart(3, '0'); source.rows.set('WixBuyerOrderLines/' + lineId, { _id: 'LINE-' + i, title: 'ORDER|' + lineId, payload: JSON.stringify({ ...first, lineId }) }); }
  const original = fs.readFileSync(path.join(folder, 'source-onboarding.candidate.js'), 'utf8'), start = original.indexOf('async function withSalesOrderMutation('), end = original.indexOf('export const createSalesRoomProforma', start);
  const api = vm.runInNewContext(original.slice(start, end).replace(/^export /gm, '') + ';submitSalesRoomOrder;', {
    webMethod: (_, fn) => fn, Permissions: { SiteMember: 'SITE' }, requireAuthorizedStaffContext: async () => source.args.staff,
    normalize: value => String(value || '').trim(), upper: value => String(value || '').trim().toUpperCase(),
    readAllPayloadRows: source.args.readPayloadRows, putPayload: source.args.putPayload, findAuthorizedCustomer: source.args.authorizeCustomer,
    BUYER_ORDER_COLLECTION: 'WixBuyerOrders', BUYER_ORDER_AUDIT_COLLECTION: 'WixOrderAudit', payloadData: record => JSON.parse(record.payload),
    submitNctSalesOrder: source.adapter, wixData: { ...source.wixData, get: async (collection, id) => {
      const row = [...source.rows.entries()].find(([key, value]) => key.startsWith(collection + '/') && value._id === id)?.[1]; if (!row) throw Error('Not found'); return copy(row);
    } }
  });
  return { master, source, api };
}
const progress = (request, extra = {}) => ({ ok: false, pending: true, orderId: 'ORDER', destination: request.destination, submissionId: request.destination + '-ORDER', phase: 'APPLY', completedCount: 10, totalRecords: 100, ...extra });

test('Source pending overlays are reproducible and retain complete original adapter/auth/order mutation wrapper', () => {
  for (const file of ['build-source-intake-delivery.cjs','build-source-date-transport.cjs','build-source-sales-ui.cjs']) assert.match(execFileSync(process.execPath, [path.join(folder, file), '--check'], { encoding: 'utf8' }), /verified/);
  const original = fs.readFileSync(path.join(__dirname, '../../sales-room/wix/onboarding.web.js'), 'utf8').replace(/\r\n/g, '\n');
  const candidate = fs.readFileSync(path.join(folder, 'source-onboarding.candidate.js'), 'utf8').replace(/\r\n/g, '\n');
  const block = value => value.slice(value.indexOf('async function withSalesOrderMutation('), value.indexOf('\n}\n', value.indexOf('async function withSalesOrderMutation(')) + 3);
  assert.equal(block(candidate), block(original), 'existing lock ownership/finally behavior unchanged');
});

test('actual Source wrapper/adapter preserves lock and immutable100line body through bounded Master phases; no early submitted state', async () => {
  for (const company of ['NCT','GHR']) {
    const f = await backend(company, 100); let result, count = 0, firstBody;
    do {
      result = await f.api('ORDER', company); count++; const state = f.source.state(); firstBody ||= state.requests[0];
      assert.ok(state.requests.every(body => JSON.stringify(body) === JSON.stringify(firstBody)));
      if (result.pending) {
        assert.equal(result.ok, false); assert.equal(result.destination, company); assert.equal(result.submissionId, company + '-ORDER'); assert.equal(result.status, undefined);
        assert.ok(f.source.rows.has('WixOrderAudit/ORDER-LOCK-ORDER')); assert.equal(state.order.destination, undefined); assert.equal(state.order.masterReceipt, undefined);
        assert.equal([...f.source.rows.values()].filter(row => JSON.parse(row.payload || '{}').action === 'ORDER_SUBMITTED').length, 0);
        const calls = state.requests.length; await assert.rejects(f.api('ORDER', company === 'NCT' ? 'GHR' : 'NCT'), /original receiving company/); assert.equal(f.source.state().requests.length, calls);
      }
      assert.ok(count < 64);
    } while (result.pending);
    assert.ok(count > 1); assert.equal(result.ok, true); assert.equal(result.taskIds.length, 100); assert.equal(f.master.captures(), 1);
    assert.equal(f.source.rows.has('WixOrderAudit/ORDER-LOCK-ORDER'), false); assert.equal(f.source.state().order.status, 'SUBMITTED TO ' + company);
    assert.equal([...f.source.rows.values()].filter(row => JSON.parse(row.payload || '{}').action === 'ORDER_SUBMITTED').length, 1);
  }
});

test('original waiting dialog displays current phases and only continues the same order/destination with isolated transport correlation', () => {
  const f = browserFixture('GHR'); f.start(); const initial = f.requests[0]; f.respond(progress(initial));
  assert.equal(f.renders.length, 0); assert.equal(f.attrs['aria-busy'], 'true'); assert.match(f.status.textContent, /10 \/ 100/);
  const continuation = f.timers.at(-1); f.respond(progress(initial)); continuation(); const next = f.requests.at(-1);
  assert.equal(next.type, 'SALES_ROOM_SUBMIT_ORDER'); assert.equal(next.orderId, initial.orderId); assert.equal(next.destination, 'GHR'); assert.notEqual(next.requestId, initial.requestId);
  const count = f.timers.length; f.respond(progress(initial), undefined); assert.equal(f.timers.length, count, 'stale first transport reply ignored');
  f.respond({ ...progress(next), requestId: next.requestId }); f.timers.at(-1)(); const last = f.requests.at(-1);
  f.respond({ ok: true, requestId: last.requestId, receiptId: 'R', destination: 'GHR', masterReceivedAt: '2026-10-22T03:00:00Z' }); assert.equal(f.renders.length, 1);
  const writes = f.requests.filter(request => request.type === 'SALES_ROOM_SUBMIT_ORDER').length; for (const timer of f.timers) timer(); assert.equal(f.requests.filter(request => request.type === 'SALES_ROOM_SUBMIT_ORDER').length, writes);
});

test('malformed or foreign Master progress remains an uncertain error and never releases the Source prepared lock', async () => {
  for (const patch of [{ submissionId: 'OTHER' }, { destination: 'GHR' }, { totalRecords: 0 }, { phase: 'DONE' }]) {
    const f = await backend(); f.master.send = async () => ({ status: 200, body: progress({ destination: 'NCT' }, patch) });
    await assert.rejects(f.api('ORDER', 'NCT'), /receipt is not confirmed/);
    assert.ok(f.source.rows.has('WixOrderAudit/ORDER-LOCK-ORDER')); assert.equal(f.source.state().order.destination, undefined);
    assert.equal(f.source.state().order.masterReceipt, undefined); assert.equal(f.master.captures(), 0);
  }
});

test('malformed progress/timeout/obsolete timers never auto-submit; endless known progress has a finite continuation budget', () => {
  for (const patch of [{ destination: 'GHR' }, { submissionId: 'OTHER' }, { totalRecords: 0 }, { completedCount: 101 }, { phase: 'DONE' }]) {
    const f = browserFixture(); f.start(); f.respond(progress(f.requests[0], patch)); assert.equal(f.requests.at(-1).type, 'SALES_ROOM_NCT_RECEIPT_REQUEST'); assert.equal(f.renders.length, 0);
  }
  const f = browserFixture(); f.start(); f.timers[0](); const count = f.timers.length; f.respond(progress(f.requests[0])); assert.equal(f.timers.length, count); assert.equal(f.requests.filter(request => request.type === 'SALES_ROOM_SUBMIT_ORDER').length, 1);
  const g = browserFixture(); g.start();
  for (let i = 0; i < 70; i++) { const request = g.requests.at(-1), before = g.timers.length; g.respond({ ...progress(request), requestId: request.requestId }); if (g.timers.length > before) g.timers.at(-1)(); }
  assert.ok(g.requests.filter(request => request.type === 'SALES_ROOM_SUBMIT_ORDER').length <= 65); assert.match(g.dialog.innerHTML, /Automatic progress paused/); assert.equal(g.renders.length, 0);
});

test('actual Source browser/parent/wrapper/adapter/generated Master intake completes100lines once', async () => {
  const f = await backend('NCT', 100), ui = browserFixture();
  const page = fs.readFileSync(path.join(folder, 'source-sales-room-page.candidate.js'), 'utf8'), start = page.indexOf("    if (message.type === 'SALES_ROOM_SUBMIT_ORDER') {"), end = page.indexOf("    if (message.type === 'SALES_ROOM_CREATE_PROFORMA')", start);
  const receive = new Function('submitSalesRoomOrder', 'salesRoom', 'return async message=>{' + page.slice(start, end) + '}')(f.api, { postMessage: message => ui.respond(message) });
  ui.start(); let i = 0;
  while (!ui.renders.length && i < 64) { const request = ui.requests.filter(request => request.type === 'SALES_ROOM_SUBMIT_ORDER')[i++]; assert.ok(request); await receive(request); if (!ui.renders.length) ui.timers.at(-1)(); }
  assert.equal(ui.renders.length, 1); assert.equal(f.master.captures(), 1); assert.equal(f.source.state().order.masterReceipt.taskIds.length, 100); assert.equal(f.source.rows.has('WixOrderAudit/ORDER-LOCK-ORDER'), false);
  assert.match(ui.dialog.innerHTML, /交单成功/); assert.equal(f.master.control().generation, 1);
});

test('healthy 1202-image progress passes 64 continuations; duplicate progress, regressions and changed totals remain bounded', () => {
  const f = browserFixture(); f.start(); let continuations = 0;
  for (const phase of ['BEFORE', 'APPLY', 'VERIFY']) for (let cursor = 20; cursor <= 1220; cursor += 20) {
    const request = f.requests.at(-1), before = f.requests.length;
    f.respond({ ...progress(request), requestId: request.requestId, phase, totalRecords: 1202, completedCount: Math.min(cursor, 1202) });
    f.timers.at(-1)(); assert.equal(f.requests.length, before + 1);
    assert.equal(f.requests.at(-1).type, 'SALES_ROOM_SUBMIT_ORDER'); continuations++;
  }
  assert.equal(continuations, 183); assert.equal(f.renders.length, 0);
  f.respond({ ok: true, requestId: f.requests.at(-1).requestId, receiptId: 'R', destination: 'NCT', masterReceivedAt: '2026-10-24T03:00:00Z' });
  assert.equal(f.renders.length, 1);
  for (const extra of [{ completedCount: 5 }, { totalRecords: 101 }, { totalRecords: 10001 }]) {
    const g = browserFixture(); g.start(); g.respond(progress(g.requests.at(-1))); g.timers.at(-1)();
    const request = g.requests.at(-1);
    g.respond({ ...progress(request, extra), requestId: request.requestId });
    assert.equal(g.requests.at(-1).type, 'SALES_ROOM_NCT_RECEIPT_REQUEST'); assert.equal(g.renders.length, 0);
  }
});
