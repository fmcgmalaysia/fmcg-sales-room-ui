const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { createNctIntake } = load('nctIntake.js');
const { createPurchaseOperations } = load('purchaseOperations.js');
const { projectPurchaseWorkspace, PURCHASE_COLLECTIONS } = load('purchaseProjection.js');
const { createPurchaseOrderOperations } = load('purchaseOrderWorkflow.js');
const { createWarehouseOperations, projectWarehouseOrders } = load('warehouseReceiving.js');
const { createPlannerAllocationOperations, allocationVersion } = load('plannerAllocation.js');
const { createShortageOperations, shortageVersion } = load('purchaseShortage.js');
const { createAccountSettlementOperations } = load('accountSettlement.js');
const { createCustomerFulfilmentOperations, shipmentVersion } = load('customerFulfilment.js');
const { customerCompletion } = load('customerCompletionProjection.js');
const { projectCustomerAccount } = load('customerDebtor.js');

async function scenario(company = 'NCT') {
  const rows = new Map(), clone = value => JSON.parse(JSON.stringify(value));
  const store = {
    all: async c => [...rows].filter(([key]) => key.startsWith(c + '/')).map(([, row]) => clone(row)),
    read: async (c, id) => clone(rows.get(c + '/' + id) || null),
    one: async (c, criteria) => (await store.all(c)).find(row => Object.entries(criteria).every(([k,v]) => row[k] === v)) || null,
    insert: async (c, row) => { if (rows.has(c + '/' + row._id)) throw Error('duplicate'); rows.set(c + '/' + row._id, clone(row)); return clone(row); },
    update: async (c, row) => { rows.set(c + '/' + row._id, clone(row)); return clone(row); },
    remove: async (c, id) => rows.delete(c + '/' + id)
  };
  const names = PURCHASE_COLLECTIONS, n = names[company], now = () => new Date('2026-10-12T03:00:00Z');
  let sequence = 0, fileSequence = 0;
  const staff = name => ({ memberId: name, staffId: name, staffName: name, role: name === 'ADMIN' ? 'SUPER ADMIN' : name });
  const request = (who, input) => ({ company, staff: staff(who), requestId: String(++sequence).padStart(8,'0') + '-1111-4111-8111-111111111111', input });
  const documents = async input => input.action === 'ALLOCATE' ? { fileId: 'test-file-' + ++fileSequence } : { ...input, ok: true };
  const pdf = label => Buffer.from('%PDF-1.4\nTEST ONLY ' + label).toString('base64');
  await store.insert('SharedSuppliers', { _id: 'S', title: 'S', companyName: 'TEST SUPPLIER', shortName: 'TEST', supplierStatus: 'ACTIVE' });
  const receive = createNctIntake({ store, now, captureCosts: async barcodes => Object.fromEntries(barcodes.map(unitBarcode => [unitBarcode, { unitBarcode, capturedAt: now().toISOString(), costCurrency: 'MYR', costStatus: 'CAPTURED', costIssues: [], lpPc: 10, lpCtn: 100, disc1: 0, disc2: 0, disc3: 0, netCostCtn: 100, cbmPerCtn: .01 }])) });
  const receipt = await receive({ sourceSiteId: '5292b63a-30e5-4c0e-8762-a1b127bbc651', destination: company, orderId: 'SCENARIO-' + company, customerId: 'C', customerCompanyName: 'TEST CUSTOMER', submissionId: 'SUB-' + company, submittedByStaffId: 'SALES', submittedByStaffName: 'SALES', submittedAt: now().toISOString(), transactionCurrency: 'MYR', fxRate: 1, lines: [{ sourceLineId: 'L', unitBarcode: '001', itemName: 'TEST PRODUCT', packingSize: '10 x 1', eaPerCtn: 10, qtyCtn: 100, sellingPricePc: 15 }] });
  const id = receipt.taskIds[0];
  const workspace = async () => projectPurchaseWorkspace({ company, orders: await store.all(n.orders), tasks: await store.all(n.tasks), activity: await store.all(n.activity), suppliers: await store.all('SharedSuppliers'), staff: staff('PURCHASE') });
  const task = async () => (await workspace()).tasks[0];
  const purchase = createPurchaseOperations({ store, now });
  await purchase({ ...request('PURCHASE', { edits: [{ taskId: id, version: (await task()).editVersion, changes: { supplierId: 'S' } }] }), operation: 'EDIT' });
  await purchase({ ...request('PURCHASE', { taskIds: [id], versions: { [id]: (await task()).editVersion }, poNumber: company + '-PO-TEST' }), operation: 'PO' });
  const poOps = createPurchaseOrderOperations({ store, readWorkspace: workspace, names, documentService: documents, now });
  const po = async () => (await poOps.list(company, staff('PURCHASE')))[0];
  const upload = async (type, cents) => poOps.save(request('PURCHASE', { id: (await po()).id, version: (await po()).version, action: 'DOCUMENT', type, date: '2026-10-12', number: type + '-TEST', reason: 'Scenario document', base64: pdf(type), ...(cents ? { declaredCents: cents } : {}) }));
  const financeOps = createAccountSettlementOperations({ store, names, listOrders: poOps.list, documentService: documents, now });
  const finance = async input => financeOps.save(request('ACCOUNT', { id: (await po()).id, version: (await po()).version, reason: 'Scenario reconciliation', ...input }));
  const pay = async (cents, number, direction = 'PAYMENT') => finance({ action: 'DOCUMENT_UPLOAD', type: 'PAYMENT', date: '2026-10-12', number, cents, direction, base64: pdf(number) });
  const warehouseOrders = async () => projectWarehouseOrders({ company, purchaseOrders: await poOps.list(company, staff('WAREHOUSE')), tasks: (await workspace()).tasks, activity: await store.all(n.activity) });
  const warehouseOps = createWarehouseOperations({ store, names, readOrders: warehouseOrders, now });
  const delivery = async (accepted, kind, resolveIssue = false) => warehouseOps.save(request('WAREHOUSE', { action: 'RECEIVE', id: (await po()).id, version: (await warehouseOrders())[0].version, lines: [{ taskId: id, accepted, rejected: 0, kind, resolveIssue, reason: 'Scenario delivery' }] }));
  const allocator = createPlannerAllocationOperations({ store, names, readWorkspace: workspace, now });
  const allocate = async quantity => allocator(request('PURCHASE', { action: 'ALLOCATE', sourceTaskId: id, version: allocationVersion(await workspace(), await store.all(n.activity)), targets: [{ taskId: id, quantity }], reason: 'Allocate actual cartons' }));
  const shortageOps = createShortageOperations({ store, names, readWorkspace: workspace, now });
  const shortage = async (customerDecision, supplierDecision) => shortageOps(request('PURCHASE', { action: 'SHORTAGE', taskId: id, version: shortageVersion(await task(), await store.all(n.activity)), customerDecision, supplierDecision, expectedDate: '2026-10-15', reason: 'Supplier decision', customerMessage: 'Customer informed', financeRequired: true }));
  const context = async () => ({ ...await workspace(), activity: await store.all(n.activity), tasks: (await workspace()).tasks.map(row => ({ ...row, sellingPricePc: 15 })) });
  const fulfilment = createCustomerFulfilmentOperations({ store, names, readContext: context, readRates: async () => [{ currency: 'MYR', rateToMyr: 1 }], now });
  const shipAction = async (who, input) => { const r = request(who, { version: shipmentVersion(await context()), reason: 'Scenario shipment', ...input }); r.staff = { ...r.staff, canSelectShipment: who === 'SALES', canInvoiceShipment: who === 'SUPPORT', canDispatchShipment: who === 'WAREHOUSE' }; return fulfilment(r); };
  const invoice = async quantity => { const selected = await shipAction('SALES', { action: 'SELECT', customerId: 'C', lines: [{ taskId: id, quantity }] }); await shipAction('SUPPORT', { action: 'INVOICE', id: selected.shipmentId, number: 'SI-' + sequence, date: '2026-10-12', amountCents: quantity * 15000 }); return selected.shipmentId; };
  const dispatch = async shipmentId => shipAction('WAREHOUSE', { action: 'DISPATCH', id: shipmentId, reference: 'TEST-CONTAINER' });
  const amounts = async () => finance({ action: 'AMOUNTS', amounts: (await po()).documents.filter(doc => ['INV','CN'].includes(doc.type)).map(doc => ({ fileId: doc.fileId, cents: doc.declaredCents, ...(doc.type === 'CN' ? { treatment: 'DEDUCT' } : {}) })) });
  const completion = async () => customerCompletion(id, await store.all(n.activity), await poOps.list(company, staff('ACCOUNT')));
  return { store, names: n, company, id, task, po, upload, finance, pay, delivery, allocate, shortage, invoice, dispatch, amounts, completion, context };
}

for (const company of ['NCT','GHR']) test(company + ': prepay in two instalments, receive in two deliveries, allocate, invoice, dispatch and close', async () => {
  const f = await scenario(company);
  await f.upload('PI'); await f.pay(300000, 'PAY-1');
  assert.equal((await f.po()).creditorActive, true); assert.equal((await f.po()).prepaymentPending, true);
  await f.pay(700000, 'PAY-2'); await f.delivery(60, 'PARTIAL');
  assert.equal((await f.task()).inc, 0, 'warehouse receipt waits for planner allocation');
  await f.allocate(60); assert.equal((await f.task()).inc, 60); assert.equal((await f.task()).ord, 100);
  await f.delivery(40, 'DELIVERY'); await f.allocate(100);
  await f.upload('INV', 1000000); await f.upload('DO'); await f.amounts();
  assert.notEqual((await f.po()).documentStatus, 'COMPLETE');
  await f.finance({ action: 'CN_NOT_APPLICABLE', enabled: true }); await f.finance({ action: 'CHECK', enabled: true });
  assert.equal((await f.po()).documentStatus, 'COMPLETE'); assert.equal((await f.po()).state, 'ACTIVE');
  const shipment = await f.invoice(100); assert.equal((await f.completion()).completedQty, 0);
  await f.dispatch(shipment); assert.equal((await f.completion()).completedQty, 100);
  assert.equal((await f.po()).state, 'HISTORY'); assert.equal((await f.po()).creditorActive, false);
  assert.equal(projectCustomerAccount(await f.context()).balances[0].balanceCents, 1500000);
});

test('100 prepaid / 90 received: stop waiting never clears liability; CN and actual refund need Finance Checked', async () => {
  const f = await scenario(); await f.upload('PI'); await f.pay(1000000, 'PREPAY');
  await f.delivery(90, 'SHORT'); await f.allocate(90); await f.shortage('STOP', 'REFUND');
  assert.equal((await f.task()).ord, 100); assert.equal((await f.po()).financialRisk, true);
  await f.upload('INV', 1000000); await f.upload('DO'); await f.upload('CN', 100000); await f.amounts();
  await assert.rejects(f.finance({ action: 'CHECK', enabled: true }), /overpayment|shortage/);
  const shipment = await f.invoice(90); await f.dispatch(shipment);
  assert.equal((await f.completion()).completedQty, 0, 'dispatch does not hide unresolved supplier loss');
  await f.pay(100000, 'REFUND', 'REFUND'); assert.equal((await f.po()).financialRisk, true);
  await f.finance({ action: 'CHECK', enabled: true });
  assert.equal((await f.po()).financialRisk, false); assert.equal((await f.po()).state, 'HISTORY');
  assert.equal((await f.completion()).completedQty, 90); assert.equal((await f.task()).ord, 100);
});

test('short first delivery and later replacement preserve the first partial invoice and clear risk only after reconciliation', async () => {
  const f = await scenario(); await f.pay(1000000, 'PREPAY');
  await f.delivery(90, 'SHORT'); await f.allocate(90); await f.shortage('WAIT', 'REPLENISH');
  const first = await f.invoice(90); await f.dispatch(first);
  assert.equal((await f.po()).financialRisk, true); assert.equal((await f.task()).ord, 100);
  await f.delivery(10, 'DELIVERY', true); await f.allocate(100);
  assert.equal((await f.task()).inc, 100); assert.equal((await f.po()).financialRisk, true);
  const second = await f.invoice(10); await f.dispatch(second);
  await f.upload('INV', 1000000); await f.upload('DO'); await f.amounts();
  await f.finance({ action: 'CN_NOT_APPLICABLE', enabled: true }); await f.finance({ action: 'CHECK', enabled: true });
  assert.equal((await f.completion()).completedQty, 100); assert.equal((await f.completion()).invoices.length, 2);
  assert.equal((await f.po()).state, 'HISTORY'); assert.equal((await f.po()).financialRisk, false);
});

test('credit-term supplier does not block customer dispatch but remains active until final payment', async () => {
  const f = await scenario(); await f.delivery(100, 'DELIVERY'); await f.allocate(100);
  await f.upload('INV', 1000000); await f.upload('DO'); await f.amounts();
  await f.finance({ action: 'CN_NOT_APPLICABLE', enabled: true }); await f.finance({ action: 'CHECK', enabled: true });
  const shipment = await f.invoice(100); await f.dispatch(shipment);
  assert.equal((await f.completion()).dispatchedQty, 100); assert.equal((await f.completion()).completedQty, 0);
  assert.equal((await f.po()).state, 'ACTIVE'); assert.equal((await f.po()).creditorActive, true);
  await f.pay(1000000, 'TERM-PAYMENT');
  assert.equal((await f.po()).invoiceChecked, false, 'changed financial record requires final recheck');
  await f.finance({ action: 'CHECK', enabled: true });
  assert.equal((await f.completion()).completedQty, 100); assert.equal((await f.po()).state, 'HISTORY');
});

test('CN kept for next purchase remains a supplier credit and never becomes customer Debtor credit', async () => {
  const f = await scenario(); await f.pay(1000000, 'PREPAY'); await f.delivery(90, 'SHORT');
  await f.allocate(90); await f.shortage('STOP', 'CREDIT');
  await f.upload('INV', 1000000); await f.upload('DO'); await f.upload('CN', 100000); await f.amounts();
  await f.finance({ action: 'RECOGNIZE_CREDIT', cents: 100000 }); assert.equal((await f.po()).financialRisk, true);
  await f.finance({ action: 'CHECK', enabled: true });
  assert.equal((await f.po()).finance.supplierCreditCents, 100000);
  assert.equal(projectCustomerAccount(await f.context()).entries.length, 0);
  const shipment = await f.invoice(90); await f.dispatch(shipment);
  assert.equal((await f.po()).state, 'HISTORY'); assert.equal((await f.po()).finance.supplierCreditCents, 100000);
  assert.equal(projectCustomerAccount(await f.context()).balances[0].balanceCents, 1350000);
});
