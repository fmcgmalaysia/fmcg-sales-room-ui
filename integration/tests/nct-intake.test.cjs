const { test } = require('node:test');
const assert = require('node:assert/strict');
const copy = value => JSON.parse(JSON.stringify(value));
const core = import('../backend/nctIntake.js');
const body = () => ({
  sourceSiteId: '5292b63a-30e5-4c0e-8762-a1b127bbc651', destination: 'NCT',
  orderId: 'ORDER-TEST', customerId: 'CUSTOMER-TEST', customerCompanyName: 'TEST CUSTOMER',
  submissionId: 'SUBMISSION-TEST', submittedByStaffId: 'STAFF-TEST', submittedByStaffName: 'STAFF',
  submittedAt: '2026-10-09T12:00:00.000Z', transactionCurrency: 'SGD', fxRate: 3.25,
  customerPoNumber: 'CUSTOMER-PO', estimatedShipmentDate: '2026-11-12', buyerReceivedBy: 'BUYER',
  lines: [{ sourceLineId: 'LINE-A', unitBarcode: '0012345678901', itemName: 'PRODUCT',
    packingSize: '100G x16', eaPerCtn: 16, qtyCtn: 80, sellingPricePc: 2.5 }]
});
async function harness() {
  const { createNctIntake } = await core;
  const rows = new Map(); let captureCount = 0, failCollection = '';
  const store = {
    async read(collection, id) { return copy(rows.get(collection + '/' + id) || null); },
    async insert(collection, row) {
      if (collection === failCollection) throw new Error('Database write failed');
      const key = collection + '/' + row._id;
      if (rows.has(key)) throw new Error('Already exists');
      rows.set(key, copy(row)); return copy(row);
    }
  };
  const captureCosts = async barcodes => {
    captureCount++;
    return Object.fromEntries(barcodes.map(barcode => [barcode, {
      unitBarcode: barcode, capturedAt: '2026-10-09T12:00:01.000Z', costCurrency: 'MYR',
      costStatus: 'CAPTURED', costIssues: [], lpPc: 10, lpCtn: 160,
      disc1: 0.02, disc2: 0.03, disc3: 5, netCostCtn: 147.10, cbmPerCtn: 0.0123
    }]));
  };
  return { rows, store, receive: createNctIntake({ store, captureCosts }), captureCosts,
    count: () => captureCount, fail: collection => { failCollection = collection; } };
}
function collection(h, name) { return [...h.rows].filter(([key]) => key.startsWith(name + '/')).map(([, row]) => row); }

test('one source line creates one order row, one task and complete immutable receipt history', async () => {
  const h = await harness(); const receipt = await h.receive(body());
  assert.equal(receipt.ok, true); assert.equal(receipt.taskIds.length, 1);
  assert.equal(collection(h, 'NCTOrders').length, 1); assert.equal(collection(h, 'NCTTasks').length, 1);
  assert.deepEqual(collection(h, 'NCTActivity').map(row => row.action), ['INTAKE_PREPARED', 'COST_CAPTURE', 'ORDER_RECEIVED']);
  const order = collection(h, 'NCTOrders')[0];
  assert.equal(order.orderId, 16); assert.equal(order.title, 'ORDER-TEST'); // actual EA/Order ID field keys
  assert.equal(order.sellingPricePc, 2.5); assert.equal(order.adminFxSource, 3.25);
  assert.equal(order.description, '0012345678901'); assert.equal(order.cbmCtn, 0.0123);
  assert.equal(Object.hasOwn(order, 'sellingPriceCtn'), false);
  assert.equal(collection(h, 'NCTTasks')[0].receivedQtyInCtn, null);
});
test('duplicate delivery uses accepted cost and never duplicates rows or history', async () => {
  const h = await harness(); const first = await h.receive(body()); const second = await h.receive(body());
  assert.deepEqual(second, first); assert.equal(h.count(), 1); assert.equal(h.rows.size, 5);
});
test('task write failure cannot acknowledge success; retry resumes from saved capture', async () => {
  const h = await harness(); h.fail('NCTTasks');
  await assert.rejects(h.receive(body()), /Database write failed/);
  assert.equal(collection(h, 'NCTActivity').some(row => row.action === 'ORDER_RECEIVED'), false);
  h.fail(''); const receipt = await h.receive(body());
  assert.equal(receipt.ok, true); assert.equal(h.count(), 1); assert.equal(h.rows.size, 5);
});
test('cost history persistence is required before acknowledging a complete receipt', async () => {
  const h = await harness(); const insert = h.store.insert;
  h.store.insert = async (collection, row) => {
    if (row.action === 'COST_CAPTURE') throw new Error('History write failed');
    return insert(collection, row);
  };
  await assert.rejects(h.receive(body()), /History write failed/);
  assert.equal(collection(h, 'NCTActivity').some(row => row.action === 'ORDER_RECEIVED'), false);
  h.store.insert = insert; await h.receive(body()); assert.equal(h.count(), 1);
});
test('replayed intake preserves procurement manual prices, supplier and row ordering', async () => {
  const h = await harness(); await h.receive(body());
  const [key, task] = [...h.rows].find(([key]) => key.startsWith('NCTTasks/'));
  task.lpCtn = 150; task.disc3 = 8; task.supplierId = 'SUPPLIER'; task.rowPosition = 58;
  task.manualCostField = ['lpCtn', 'disc3'];
  h.rows.set(key, task); await h.receive(body());
  assert.equal(h.rows.get(key).lpCtn, 150); assert.equal(h.rows.get(key).disc3, 8);
  assert.equal(h.rows.get(key).supplierId, 'SUPPLIER'); assert.equal(h.rows.get(key).rowPosition, 58);
  assert.equal(h.rows.get(key).originalCostSnapshot.lpCtn, 160);
});
test('different quantity or receiving company cannot overwrite accepted intake', async () => {
  const h = await harness(); await h.receive(body());
  const changed = body(); changed.lines[0].qtyCtn = 100;
  await assert.rejects(h.receive(changed), /different submission/);
  await assert.rejects(h.receive({ ...body(), destination: 'GHR' }), /receiving company/);
  assert.equal(collection(h, 'NCTOrders')[0].orderQtyInCtn, 80);
});
test('cost-service outage still accepts the order with unavailable costs and durable failure history', async () => {
  const h = await harness(); const { createNctIntake } = await core;
  const receive = createNctIntake({ store: h.store, captureCosts: async () => { throw new Error('timeout'); } });
  const receipt = await receive(body()); assert.equal(receipt.costErrorTaskCount, 1);
  const task = collection(h, 'NCTTasks')[0]; assert.equal(task.lpCtn, null); assert.equal(task.disc3, null);
  assert.equal(task.costStatus, 'ERROR'); assert.equal(task.costErrorReason, 'POINTBASE_SERVICE_UNAVAILABLE');
  assert.equal(collection(h, 'NCTActivity').find(row => row.action === 'COST_CAPTURE').result, 'ERROR');
});
test('missing or malformed per-barcode result accepts the line with explicit cost failure, never zero cost', async () => {
  for (const result of [{}, null, { '0012345678901': { costStatus: 'CAPTURED', costCurrency: 'USD' } }]) {
    const h = await harness(); const { createNctIntake } = await core;
    const receive = createNctIntake({ store: h.store, captureCosts: async () => result });
    const receipt = await receive(body()); assert.equal(receipt.ok, true); assert.equal(receipt.costErrorTaskCount, 1);
    const task = collection(h, 'NCTTasks')[0]; assert.equal(task.lpCtn, null);
    assert.equal(task.costErrorReason, 'POINTBASE_RESULT_INCOMPLETE');
    assert.equal(collection(h, 'NCTActivity').find(row => row.action === 'COST_CAPTURE').result, 'ERROR');
  }
});
test('same barcode in distinct source lines remains two independent tasks', async () => {
  const h = await harness(); const input = body(); input.lines.push({ ...input.lines[0], sourceLineId: 'LINE-B', qtyCtn: 20 });
  const receipt = await h.receive(input); assert.equal(new Set(receipt.taskIds).size, 2);
  assert.equal(collection(h, 'NCTTasks').length, 2); assert.equal(h.count(), 1);
});
test('duplicate source line or invalid date is rejected before any data or cost access', async () => {
  const h = await harness(); const input = body(); input.lines.push(copy(input.lines[0]));
  await assert.rejects(h.receive(input), /Duplicate source line/);
  await assert.rejects(h.receive({ ...body(), estimatedShipmentDate: '2026-02-30' }), /shipment date/);
  assert.equal(h.rows.size, 0); assert.equal(h.count(), 0);
});
