const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const copy = value => JSON.parse(JSON.stringify(value));
const adapterSource = fs.readFileSync(path.join(__dirname, '../../backend/nctSalesIntake.js'), 'utf8')
  .replace(/^import .+;\r?\n/gm, '').replace('export async function submitNctSalesOrder', 'async function submitNctSalesOrder');
async function setup() {
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
  const args = { orderId: 'ORDER', staff: { staffId: 'STAFF', staffName: 'ORIGINAL NAME', loginEmail: 'staff@example.test' },
    authorizeCustomer: async id => { assert.equal(id, 'CUSTOMER'); authorized++; },
    readPayloadRows: async collection => [...rows.entries()].filter(([key]) => key.startsWith(collection + '/'))
      .map(([, record]) => ({ record: copy(record), data: JSON.parse(record.payload) })),
    putPayload: async (collection, title, payload) => {
      if (fault === 'sourceSave') throw Error('Source save failed');
      const record = rows.get(collection + '/' + title); rows.set(collection + '/' + title, { ...record, payload: JSON.stringify(payload) });
    } };
  return { run: () => submit(args), fault: value => { fault = value; }, master, rows,
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
