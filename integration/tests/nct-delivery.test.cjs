const { test } = require('node:test');
const assert = require('node:assert/strict');
const copy = value => JSON.parse(JSON.stringify(value));
const delivery = require('./load-nct-delivery.cjs')();
async function fixture() {
  const { createNctSubmissionDelivery } = await delivery;
  let order = { orderId: 'ORDER', customerId: 'CUSTOMER', companyName: 'TEST CUSTOMER', currency: 'MYR', status: 'CONFIRMED', isComplete: true };
  let lock = null, fail = '', deliveries = [], audits = new Map(), snapshotReads = 0, authorized = 0;
  const store = {
    readOrder: async () => ({ data: copy(order) }), readLock: async () => copy(lock),
    insertLock: async (_id, value) => { if (lock) throw Error('Duplicate lock'); lock = copy(value); return copy(lock); },
    savePrepared: async (_id, value) => { if (fail === 'prepare') throw Error('Snapshot write failed'); lock = copy(value); },
    releaseOwnLock: async () => { if (lock?.source === 'NCT MASTER INTAKE') lock = null; },
    writeAcceptedAuditOnce: async (body, receipt) => {
      if (fail === 'audit') throw Error('Audit write failed');
      audits.set(body.submissionId, copy(receipt));
    },
    saveTransferred: async (_id, body, receipt) => {
      if (fail === 'finalize') throw Error('Source write failed');
      order = { ...order, status: 'SUBMITTED TO NCT', destination: 'NCT', submittedAt: body.submittedAt,
        nctSubmissionBody: copy(body), masterReceipt: copy(receipt) };
    }
  };
  const submit = createNctSubmissionDelivery({ store, now: () => new Date('2026-10-09T12:00:00Z'),
    loadSnapshot: async () => { snapshotReads++; return {
      lines: [{ orderId: 'ORDER', customerId: 'CUSTOMER', lineId: 'L001', barcode: '0012345678901',
        itemName: 'PRODUCT', packingSize: '100G x16', eaPerCtn: 16, lockedUnitPriceEa: 14.66,
        quantityCtn: 100, effectiveRequestedQtyCtn: 250, currency: 'MYR' }],
      currentAdminRate: { currency: 'MYR', rateToMyr: 1, active: true }, history: [{ from: 100, to: 250 }]
    }; }, deliver: async body => {
      deliveries.push(copy(body)); if (fail === 'network') throw Error('Timeout after Master may have committed');
      const receipt = { ok: true, destination: 'NCT', orderId: body.orderId, submissionId: body.submissionId,
        receiptId: 'MASTER-RECEIPT', masterReceivedAt: '2026-10-09T12:00:02Z', taskIds: ['TASK'], costErrorTaskCount: 0 };
      if (fail === 'partial') receipt.taskIds = [];
      return receipt;
    }
  });
  const args = { orderId: 'ORDER', staff: { staffId: 'STAFF', staffName: 'NAME' },
    authorizeCustomer: async () => { authorized++; if (fail === 'auth') throw Error('Not authorized'); } };
  return { run: () => submit(args), fail: value => { fail = value; }, setLock: value => { lock = value; },
    state: () => ({ order: copy(order), lock: copy(lock), deliveries: copy(deliveries), audits: audits.size, snapshotReads, authorized }) };
}
test('source becomes submitted only after complete Master acknowledgement and audit', async () => {
  const f = await fixture(); const receipt = await f.run(), s = f.state();
  assert.equal(receipt.ok, true); assert.equal(s.order.destination, 'NCT'); assert.equal(s.lock, null);
  assert.equal(s.audits, 1); assert.equal(s.deliveries[0].lines[0].qtyCtn, 250);
  assert.equal(s.deliveries[0].sourceSnapshot.lines[0].quantityCtn, 100);
});
test('ambiguous network failure preserves the lock and EXACT request for retry', async () => {
  const f = await fixture(); f.fail('network'); await assert.rejects(f.run(), /receipt is not confirmed/);
  let s = f.state(); assert.equal(s.order.submittedAt, undefined); assert.equal(s.audits, 0);
  assert.equal(s.lock.preparedBody.lines[0].qtyCtn, 250);
  f.fail(''); await f.run(); s = f.state(); assert.deepEqual(s.deliveries[1], s.deliveries[0]);
  assert.equal(s.snapshotReads, 1); assert.equal(s.audits, 1);
});
test('partial or wrong Master receipt cannot produce source success', async () => {
  const f = await fixture(); f.fail('partial'); await assert.rejects(f.run(), /receipt is not confirmed/);
  assert.equal(f.state().order.destination, undefined); assert.ok(f.state().lock);
});
test('failed source finalization resumes using receipt replay without re-preparing costs or quantities', async () => {
  const f = await fixture(); f.fail('finalize'); await assert.rejects(f.run(), /Source write failed/);
  assert.equal(f.state().order.destination, undefined); assert.equal(f.state().audits, 1);
  f.fail(''); await f.run(); const s = f.state(); assert.equal(s.audits, 1);
  assert.equal(s.snapshotReads, 1); assert.deepEqual(s.deliveries[0], s.deliveries[1]);
});
test('completed replay returns saved receipt without sending again, but rechecks authorization', async () => {
  const f = await fixture(); const first = await f.run(); assert.deepEqual(await f.run(), first);
  assert.equal(f.state().deliveries.length, 1); assert.equal(f.state().authorized, 2);
  f.fail('auth'); await assert.rejects(f.run(), /Not authorized/); assert.equal(f.state().deliveries.length, 1);
});
test('preparation failure makes no network request and releases only its own lock', async () => {
  const f = await fixture(); f.fail('prepare'); await assert.rejects(f.run(), /Snapshot write failed/);
  assert.equal(f.state().deliveries.length, 0); assert.equal(f.state().lock, null);
});
test('existing Buyer addition or Sales mutation locks cannot be stolen or released', async () => {
  const f = await fixture(); const existing = { source: 'BUYER ADDITION', orderId: 'ORDER', customerId: 'CUSTOMER' };
  f.setLock(existing); await assert.rejects(f.run(), /being updated/);
  assert.deepEqual(f.state().lock, existing); assert.equal(f.state().deliveries.length, 0);
});
test('unauthorized customer cannot acquire a lock or access cost delivery', async () => {
  const f = await fixture(); f.fail('auth'); await assert.rejects(f.run(), /Not authorized/);
  assert.equal(f.state().lock, null); assert.equal(f.state().snapshotReads, 0); assert.equal(f.state().deliveries.length, 0);
});
