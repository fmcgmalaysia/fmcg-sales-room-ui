const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const copy = value => JSON.parse(JSON.stringify(value));
const adapterSource = fs.readFileSync(path.join(__dirname, '../../backend/nctSalesIntake.js'), 'utf8')
  .replace(/^import .+;\r?\n/gm, '').replace('export async function submitNctSalesOrder', 'async function submitNctSalesOrder');
async function setup(destination='NCT') {
  const { createNctSubmissionDelivery } = await require('./load-nct-delivery.cjs')();
  const { createNctReceiver } = await import('../backend/nctReceiver.js');
  const rows = new Map(), master = new Map(), requests = [];
  let fault = '', captures = 0, authorized = 0;
  const initial = { orderId: 'ORDER', customerId: 'CUSTOMER', companyName: 'TEST CUSTOMER', currency: 'MYR',
    status: 'CONFIRMED', isComplete: true, confirmedBy: 'BUYER' };
  rows.set('WixBuyerOrders/ORDER', { _id: 'SOURCE-ORDER', title: 'ORDER', payload: JSON.stringify(initial) });
  rows.set('WixFxRates/MYR', { _id: 'FX', currency: 'MYR', active: true, rateToMyr: 1 });
  rows.set('WixBuyerOrderLines/L001', { _id: 'SOURCE-LINE', title: 'ORDER|L001', payload: JSON.stringify({
    orderId: 'ORDER', customerId: 'CUSTOMER', lineId: 'L001', barcode: '0012345678901', itemName: 'PRODUCT',
    packingSize: '195.5G x16', eaPerCtn: 16, lockedUnitPriceEa: 14.66, quantityCtn: 100,
    effectiveRequestedQtyCtn: 250, currency: 'MYR' }) });
  const wixData = {
    query(collection) {
      const filters = []; return { eq(field, value) { filters.push([field, value]); return this; }, limit() { return this; },
        async find() { return { items: [...rows.entries()].filter(([key, row]) => key.startsWith(collection + '/') &&
          filters.every(([field, value]) => row[field] === value)).map(([, row]) => copy(row)) }; } };
    },
    async insert(collection, row) {
      if ([...rows.entries()].some(([key, current]) => key.startsWith(collection + '/') && current._id === row._id)) throw Error('Duplicate');
      rows.set(collection + '/' + row.title, copy(row)); return copy(row);
    },
    async update(collection, row) { rows.set(collection + '/' + row.title, copy(row)); return copy(row); },
    async remove(collection, id) { for (const [key, row] of rows) if (key.startsWith(collection + '/') && row._id === id) rows.delete(key); }
  };
  const receive = createNctReceiver({ getIntakeSecret: async () => 'LOCAL-TEST-ONLY',
    store: { read: async (collection, id) => copy(master.get(collection + '/' + id) || null),
      insert: async (collection, row) => { const key = collection + '/' + row._id;
        if (master.has(key)) throw Error('Duplicate'); master.set(key, copy(row)); return copy(row); } },
    captureCosts: async barcodes => { captures++; return Object.fromEntries(barcodes.map(barcode => [barcode, {
      unitBarcode: barcode, capturedAt: '2026-10-09T12:00:00Z', costCurrency: 'MYR', costStatus: 'CAPTURED',
      costIssues: [], lpPc: 10, lpCtn: 160, disc1: 0.02, disc2: 0.03, disc3: 5, netCostCtn: 147.10, cbmPerCtn: 0.0123 }])); }
  });
  const fetch = async (url, request) => {
    assert.equal(url, 'https://fmcg999.wixstudio.com/master/_functions/nctIntake');
    requests.push(JSON.parse(request.body));
    const response = await receive({ headers: { Authorization: request.headers.Authorization }, body: { json: async () => JSON.parse(request.body) } });
    if (fault === 'lostReply') throw Error('Response lost AFTER Master commit');
    return { ok: response.status === 200, json: async () => response.body };
  };
  const submit = new Function('wixData', 'fetch', 'getSecret', 'createHash', 'createNctSubmissionDelivery',
    adapterSource + '\nreturn submitNctSalesOrder;')(wixData, fetch,
    async name => { assert.equal(name, 'MASTER_INTAKE_SHARED_SECRET'); return fault === 'wrongKey' ? 'WRONG' : 'LOCAL-TEST-ONLY'; }, createHash, createNctSubmissionDelivery);
  const args = { orderId: 'ORDER', destination, staff: { staffId: 'STAFF', staffName: 'ORIGINAL NAME', loginEmail: 'staff@example.test' },
    authorizeCustomer: async id => { assert.equal(id, 'CUSTOMER'); authorized++; },
    readPayloadRows: async collection => [...rows.entries()].filter(([key]) => key.startsWith(collection + '/'))
      .map(([, record]) => ({ record: copy(record), data: JSON.parse(record.payload) })),
    putPayload: async (collection, title, payload) => {
      if (fault === 'sourceSave') throw Error('Source save failed');
      const record = rows.get(collection + '/' + title); rows.set(collection + '/' + title, { ...record, payload: JSON.stringify(payload) });
    } };
  return { run: () => submit(args), runDestination: destination => submit({ ...args, destination }), reconcile: () => submit({ ...args, reconcileOnly: true }), fault: value => { fault = value; }, master, rows,
    state: () => ({ order: JSON.parse(rows.get('WixBuyerOrders/ORDER').payload), captures, authorized, requests: copy(requests) }) };
}
test('actual source adapter and receiver cores preserve 100->250, MYR, original staff and one complete receipt', async () => {
  const f = await setup(); const receipt = await f.run(), s = f.state();
  assert.equal(receipt.ok, true); assert.equal(s.order.status, 'SUBMITTED TO NCT'); assert.equal(s.captures, 1);
  assert.equal(s.order.submittedBy, 'staff@example.test'); assert.equal(s.order.nctSubmissionBody.lines[0].qtyCtn, 250);
  assert.equal(s.order.nctSubmissionBody.sourceSnapshot.lines[0].quantityCtn, 100);
  assert.equal(f.master.size, 5); assert.equal(f.rows.has('WixOrderAudit/ORDER-LOCK-ORDER'), false);
});
test('reply lost after Master commit replays the exact request with one capture and no duplicate records', async () => {
  const f = await setup(); f.fault('lostReply'); await assert.rejects(f.run(), /receipt is not confirmed/);
  assert.equal(f.master.size, 5); assert.equal(f.state().order.destination, undefined);
  assert.ok(f.rows.has('WixOrderAudit/ORDER-LOCK-ORDER'));
  f.fault(''); await f.run(); const s = f.state(); assert.deepEqual(s.requests[1], s.requests[0]);
  assert.equal(s.captures, 1); assert.equal(f.master.size, 5); assert.equal(s.order.destination, 'NCT');
});
test('wrong cross-site credential cannot write Master or declare the source submitted', async () => {
  const f = await setup(); f.fault('wrongKey'); await assert.rejects(f.run(), /receipt is not confirmed/);
  assert.equal(f.master.size, 0); assert.equal(f.state().captures, 0); assert.equal(f.state().order.destination, undefined);
});
test('failed source save after complete receipt resumes with exactly one final source audit', async () => {
  const f = await setup(); f.fault('sourceSave'); await assert.rejects(f.run(), /Source save failed/);
  f.fault(''); await f.run(); assert.equal(f.state().captures, 1); assert.equal(f.master.size, 5);
  const events = [...f.rows].filter(([key, row]) => key.startsWith('WixOrderAudit/') && JSON.parse(row.payload).action === 'ORDER_SUBMITTED');
  assert.equal(events.length, 1);
});

test('504 recovery reads MASTER receipt, finalizes Sales and removes management eligibility without re-delivery', async () => {
  const f=await setup();f.fault('lostReply');await assert.rejects(f.run(),/receipt is not confirmed/);
  const before=JSON.stringify([...f.master]);f.fault('');const receipt=await f.reconcile(),s=f.state();
  assert.equal(receipt.ok,true);assert.equal(s.order.status,'SUBMITTED TO NCT');assert.equal(s.order.destination,'NCT');
  assert.equal(s.requests.length,2);assert.equal(s.requests[1].action,'READ_RECEIPT');assert.deepEqual(s.requests[1].submission,s.requests[0]);
  assert.equal(s.captures,1);assert.equal(JSON.stringify([...f.master]),before);assert.equal(f.rows.has('WixOrderAudit/ORDER-LOCK-ORDER'),false);
  const audit=[...f.rows.values()].map(r=>JSON.parse(r.payload||'{}')).filter(d=>d.action==='ORDER_SUBMITTED');assert.equal(audit.length,1);
  await f.reconcile();assert.equal(f.state().requests.length,2);
});

test('receipt check of a never-submitted order creates no locks, requests or MASTER records',async()=>{
  const f=await setup();assert.equal(await f.reconcile(),null);assert.equal(f.state().requests.length,0);assert.equal(f.master.size,0);assert.equal(f.rows.has('WixOrderAudit/ORDER-LOCK-ORDER'),false);
});

test('pending MASTER receipt retains original source lock and never completes or inserts intake',async()=>{
  const f=await setup();f.fault('wrongKey');await assert.rejects(f.run(),/receipt is not confirmed/);f.fault('');const before=JSON.stringify([...f.rows]);assert.equal(await f.reconcile(),null);assert.equal(JSON.stringify([...f.rows]),before);assert.equal(f.master.size,0);assert.equal(f.state().captures,0);
});

test('failed recovery source save can be retried with one audit and no MASTER changes',async()=>{
  const f=await setup();f.fault('lostReply');await assert.rejects(f.run());const before=JSON.stringify([...f.master]);f.fault('sourceSave');await assert.rejects(f.reconcile(),/Source save failed/);f.fault('');await f.reconcile();assert.equal(JSON.stringify([...f.master]),before);assert.equal(f.state().order.destination,'NCT');assert.equal([...f.rows.values()].map(r=>JSON.parse(r.payload||'{}')).filter(d=>d.action==='ORDER_SUBMITTED').length,1);
});

test('GHR receipt recovery preserves receiving company and its original tasks',async()=>{
  const f=await setup('GHR');f.fault('lostReply');await assert.rejects(f.run());const before=JSON.stringify([...f.master]);f.fault('');const receipt=await f.reconcile();assert.equal(receipt.destination,'GHR');assert.equal(f.state().order.destination,'GHR');assert.equal(JSON.stringify([...f.master]),before);assert.ok([...f.master.keys()].every(k=>/^NCT(?:Orders1|Tasks1|Activity1)\//.test(k)));
});

test('original source order lock admits only one simultaneous receiving company before any delivery', async () => {
  const f = await setup();
  const results = await Promise.allSettled([f.runDestination('NCT'), f.runDestination('GHR')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const state = f.state(); assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].destination, state.order.destination); assert.equal(state.captures, 1);
  const prefixes = new Set([...f.master.keys()].map(key => key.split('/')[0]));
  assert.equal(prefixes.has('NCTTasks') && prefixes.has('NCTTasks1'), false);
  assert.equal(f.master.size, 5);
});

test('unconfirmed source snapshot cannot be retried to another receiving company', async () => {
  for (const first of ['NCT', 'GHR']) {
    const f = await setup(first); f.fault('lostReply'); await assert.rejects(f.run());
    const before = JSON.stringify([...f.master]); f.fault('');
    await assert.rejects(f.runDestination(first === 'NCT' ? 'GHR' : 'NCT'), /Prepared submission identity conflict/);
    assert.equal(f.state().requests.length, 1); assert.equal(JSON.stringify([...f.master]), before);
    await f.run(); assert.equal(f.state().requests[1].destination, first); assert.equal(f.state().captures, 1);
  }
});
