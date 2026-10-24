'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = require.resolve('./nct-cross-site.test.cjs');
// Execute the actual R2 source adapter against the existing synthetic Source/Master
// fixture. Only names/route and returned fixture handles change in the harness.
let source = fs.readFileSync(filename, 'utf8').replace("const { test } = require('node:test');", 'const test=()=>{};')
  .replace('../../backend/nctSalesIntake.js', '../prototypes/stock-current-state/isolated-cohort/FMCGMALAYSIA/r2nctSalesIntake.js')
  .replaceAll('WixBuyerOrders', 'R2WixBuyerOrders').replaceAll('WixBuyerOrderLines', 'R2WixBuyerOrderLines')
  .replaceAll('WixOrderAudit', 'R2WixOrderAudit').replace('/_functions/nctIntake', '/_functions/r2NctIntake')
  .replace("await import('../backend/nctReceiver.js')", 'receiver')
  .replace("new Function('wixData',", "new Function('r2Auth', 'r2Items', 'r2RandomBytes', 'wixData',")
  .replace(')(wixData, fetch,', ")({elevate:fn=>fn}, r2Items, require('node:crypto').randomBytes, wixData, fetch,")
  .replace('  const receive = createNctReceiver(', `  let r2Hook = async () => {};
  const locate = (collection, id) => [...rows].find(([key, row]) => key.startsWith(collection + '/') && row._id === id);
  const r2Items = {
    patch(collection, id) { const fields = {}; return {
      setField(key, value) { fields[key] = value; return this; },
      async run(options) { await r2Hook({ kind: 'patch', collection, id, fields });
        const entry = locate(collection, id);
        if (!entry || entry[1].payload !== options.condition.payload.$eq) throw Error('SOURCE_CAS_CONFLICT');
        const after = { ...entry[1], ...fields }; rows.set(entry[0], copy(after)); return copy(after);
      }
    }; },
    async remove(collection, id, options) { await r2Hook({ kind: 'remove', collection, id });
      const entry = locate(collection, id);
      if (!entry || entry[1].payload !== options.condition.payload.$eq) throw Error('SOURCE_REMOVE_CONFLICT');
      rows.delete(entry[0]); return copy(entry[1]);
    }
  };
  const receive = createNctReceiver(`)
  .replace('return { run: () => submit(args),', 'return { args, r2Items, wixData, hook: fn => r2Hook = fn, runLocked: lockedOrderEntry => submit({ ...args, lockedOrderEntry }), run: () => submit(args),');
async function setup(...args) {
  const receiver = await import('../backend/nctReceiver.js');
  return vm.runInNewContext(source + ';setup;', { require: createRequire(filename), __dirname, receiver })(...args);
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function mutationWrapper(f) {
  const native = fs.readFileSync(require.resolve('../prototypes/stock-current-state/isolated-cohort/FMCGMALAYSIA/r2onboarding.web.js'), 'utf8');
  const start = native.indexOf('async function withSalesOrderMutation('), end = native.indexOf('function originalIntakeProgress(', start);
  return vm.runInNewContext(native.slice(start, end) + ';withSalesOrderMutation;', {
    normalize: value => String(value || '').trim(), readAllPayloadRows: f.args.readPayloadRows,
    BUYER_ORDER_COLLECTION: 'R2WixBuyerOrders', BUYER_ORDER_AUDIT_COLLECTION: 'R2WixOrderAudit',
    findAuthorizedCustomer: f.args.authorizeCustomer, payloadData: row => JSON.parse(row.payload),
    r2RandomBytes: require('node:crypto').randomBytes, r2Items: f.r2Items, r2Auth: {elevate:fn=>fn},
    wixData: { ...f.wixData, get: async (collection, id) => {
      const result = await f.wixData.query(collection).eq('_id', id).limit(2).find();
      if (result.items.length !== 1) throw Error('Missing exact source record'); return result.items[0];
    } }
  });
}
test('delayed R2 source finalization cannot overwrite a newer source date after another retry completed', async () => {
  const f = await setup(), entered = deferred(), release = deferred();
  let held = false;
  f.hook(async event => { if (!held && event.kind === 'patch' && event.collection === 'R2WixBuyerOrders') { held = true; entered.resolve(); await release.promise; } });
  const old = f.run().then(value => ({ value }), error => ({ error })); await entered.promise;
  const retry = await f.run(); assert.equal(retry.ok, true);
  const key = 'R2WixBuyerOrders/ORDER', row = f.rows.get(key), newer = JSON.parse(row.payload);
  newer.estimatedShipmentDate = '2026-12-12'; newer.shipmentDateRevision = 2;
  f.rows.set(key, { ...row, payload: JSON.stringify(newer) });
  release.resolve(); assert.match((await old).error.message, /SOURCE_CAS_CONFLICT/);
  assert.equal(f.state().order.estimatedShipmentDate, '2026-12-12');
  assert.equal(f.state().order.shipmentDateRevision, 2);
  assert.equal(f.state().order.masterReceipt.receiptId, retry.receiptId);
});

test('delayed submission lock removal cannot remove the next operation lock at the same ID', async () => {
  const f = await setup(), entered = deferred(), release = deferred(); let held = false;
  f.hook(async event => { if (!held && event.kind === 'remove') { held = true; entered.resolve(); await release.promise; } });
  const old = f.run().then(value => ({ value }), error => ({ error })); await entered.promise;
  assert.equal((await f.run()).ok, true);
  const key = 'R2WixOrderAudit/ORDER-LOCK-ORDER', next = { _id: 'ORDER-LOCK-ORDER', title: 'ORDER-LOCK-ORDER',
    payload: JSON.stringify({ action: 'ORDER_MUTATION_LOCK', orderId: 'ORDER', customerId: 'CUSTOMER', r2Owner: 'NEW_OWNER' }) };
  f.rows.set(key, next); release.resolve(); assert.match((await old).error.message, /SOURCE_REMOVE_CONFLICT/);
  assert.equal(JSON.stringify(f.rows.get(key)), JSON.stringify(next));
});

test('normal NCT/GHR submission and replay retain original receipt with no duplicate audit', async () => {
  for (const company of ['NCT', 'GHR']) {
    const f = await setup(company), first = await f.run(), second = await f.run();
    assert.deepEqual(first, second); assert.equal(f.state().captures, 1);
    assert.equal(f.state().order.destination, company);
    const row = f.rows.get('R2WixBuyerOrders/ORDER'), payload = JSON.parse(row.payload);
    assert.equal(row.title, 'ORDER');
    assert.equal(row.customerId, payload.customerId);
    assert.equal(row.orderId, payload.orderId);
    assert.equal(row.orderSortKey, String(payload.confirmedAt || '').trim() + '|' + payload.orderId);
    assert.equal(row.status, 'SUBMITTED TO ' + company);
    assert.equal(row.isComplete, Boolean(payload.isComplete));
    assert.equal([...f.rows.values()].filter(row => JSON.parse(row.payload || '{}').action === 'ORDER_SUBMITTED').length, 1);
    assert.equal(f.rows.has('R2WixOrderAudit/ORDER-LOCK-ORDER'), false);
  }
});

test('actual R2 Sales wrapper hands its owner through submission and releases only its own transformed lock', async () => {
  const f = await setup(), mutate = mutationWrapper(f);
  assert.equal((await mutate('ORDER', f.args.staff, entry => f.runLocked(entry))).ok, true);
  assert.equal(f.state().order.destination, 'NCT');
  assert.equal(f.rows.has('R2WixOrderAudit/ORDER-LOCK-ORDER'), false);
});

test('late original Sales finally cannot release a new ordinary edit after another submission retry completed', async () => {
  const f = await setup(), mutate = mutationWrapper(f), entered = deferred(), release = deferred(), editEntered = deferred(), editRelease = deferred();
  let held = false;
  f.hook(async event => { if (!held && event.kind === 'patch' && event.collection === 'R2WixBuyerOrders') { held = true; entered.resolve(); await release.promise; } });
  const old = mutate('ORDER', f.args.staff, entry => f.runLocked(entry)).then(value => ({ value }), error => ({ error }));
  await entered.promise; assert.equal((await f.run()).ok, true);
  const edit = mutate('ORDER', f.args.staff, async () => { editEntered.resolve(); await editRelease.promise; return 'EDIT'; });
  await editEntered.promise;
  const key = 'R2WixOrderAudit/ORDER-LOCK-ORDER', next = structuredClone(f.rows.get(key));
  release.resolve(); assert.match((await old).error.message, /SOURCE_CAS_CONFLICT/);
  assert.equal(JSON.stringify(f.rows.get(key)), JSON.stringify(next));
  editRelease.resolve(); assert.equal(await edit, 'EDIT'); assert.equal(f.rows.has(key), false);
});
