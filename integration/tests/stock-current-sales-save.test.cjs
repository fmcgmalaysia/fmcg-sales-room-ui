const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs'), fs = require('node:fs'), vm = require('node:vm');
const { createCurrentSalesDemandSave } = require('../prototypes/stock-current-state/current-sales-save.cjs');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs'), { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { createSalesOrderAdjustmentOperations, salesAdjustmentVersion, readSalesDemand } = load('salesOrderAdjustment.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js'), { readAllocations } = load('plannerAllocation.js');
const { readCustomerShipments } = load('customerShipmentLedger.js'), { readPackingLists } = load('packingListOperations.js');
const { packingHeld } = load('packingListModel.js'), { readShipmentPlans, shipmentPlanVersion } = load('customerShipmentPlan.js');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const copy = x => JSON.parse(JSON.stringify(x));
async function fixture(secondProduct = false) {
  const db = new Map(), identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 }, key = stockKey(identity);
  const put = (c, row) => db.set(c + '/' + row._id, copy(row));
  const store = { read: async (c, id) => copy(db.get(c + '/' + id) || null), insert: async (c, row) => { if (db.has(c + '/' + row._id)) throw Error('Duplicate'); put(c, row); },
    compareAndSet: async (c, id, version, row) => { if (db.get(c + '/' + id)?._version !== version) throw Error('Conflict'); put(c, row); },
    compareAndRemove: async (c, id, attempt) => { if (db.get(c + '/' + id)?.attempt !== attempt) throw Error('Attempt'); db.delete(c + '/' + id); } };
  const protocol = createSegmentedFencedProof({ store, stepsPerInvocation: 100 }); await protocol.initialize();
  Object.assign(db.get('NCTActivity/' + protocol.ids.controlId), { generation: 1, mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST', transferIndexVersion: 2 });
  put('StockProducts', { ...identity, _id: hash('NCT', key), stockKey: key, _version: 'P0', revision: 0, checkpointGeneration: 1,
    lifecycleVersion: 2, nextBorrowSequence: 1, onHand: 0, reservedUsable: 0, available: 0, isolated: 0, reviewRequired: false, reviewCodes: [], status: 'CLOSED' });
  if (secondProduct) {
    const other = { ...identity, barcode: '2' }, otherKey = stockKey(other), positionId = hash('NCT', otherKey, 'PURCHASE_SOURCE', 'U');
    const base = { company: 'NCT', stockKey: otherKey, _version: 'V0', revision: 0, status: 'ACTIVE', reviewCodes: [] };
    put('StockProducts', { ...base, ...other, _id: hash('NCT', otherKey), lifecycleVersion: 2, nextBorrowSequence: 1,
      onHand: 10, reservedUsable: 10, available: 0, isolated: 0, reviewRequired: false });
    put('StockPositions', { ...base, _id: positionId, sourceTaskId: 'U', poId: hash('NCT', 'PURCHASE_ORDER', ['U']), receiptAccepted: 10,
      replacementReceived: 0, supplierReturned: 0, dispatched: 0, borrowRepaidCumulative: 0, onHand: 10, reservedUsable: 10, available: 0, isolated: 0 });
    put('StockClaims', { ...base, _id: hash('NCT', positionId, 'U'), positionId, taskId: 'U', customerId: 'C', orderId: 'O-U', sourceLineId: 'L-U',
      reservedUsable: 10, isolatedAttributed: 0, dispatchedCumulative: 0 });
  }
  let staff = { memberId: 'SOURCE_SALES/S', staffId: 'S', staffName: 'Sales', customerId: 'C', customerName: 'Customer', canSelectShipment: true }, reads = 0, authentications = 0;
  const context = () => {
    const activity = [...db.entries()].filter(([id]) => id.startsWith('NCTActivity/')).map(([, row]) => copy(row));
    const requested = readSalesDemand('T', 100, activity).requested;
    return { company: 'NCT', activity, suppliers: [{ id: 'SUP', name: 'Supplier' }], customers: [{ id: 'C', name: 'Customer' }], tasks: [{ ...identity,
      id: 'T', name: 'Item', customerId: 'C', orderId: 'O', sourceLineId: 'L', ord: requested, requested, salesCommittedQty: 100, inc: 0,
      sellingPricePc: 2, po: '', supplierId: '', procurement: { totalCtn: 100, customerCtn: 100 }, warehouse: null, history: [] },
      ...(secondProduct ? [{ ...identity, barcode: '2', id: 'U', name: 'Other item', customerId: 'C', orderId: 'O-U', sourceLineId: 'L-U',
        ord: 10, requested: 10, salesCommittedQty: 10, inc: 0, sellingPricePc: 2, po: 'PO-U', supplierId: 'SUP',
        lpPc: 1, lpCtn: 12, disc1: 0, disc2: 0, disc3: 0, procurement: { totalCtn: 10, customerCtn: 10 }, warehouse: { hasPhysicalReceipt: true, accepted: 10 }, history: [] }] : [])] };
  };
  const items = { query: c => { const filters = []; let limit; const q = { eq: (k, v) => { filters.push(['eq', k, v]); return q; },
    gt: (k, v) => { filters.push(['gt', k, v]); return q; }, ascending: () => q, limit: n => { limit = n; return q; }, find: async () => {
      const rows = [...db.entries()].filter(([address, row]) => address.startsWith(c + '/') && filters.every(([m, k, v]) => m === 'eq' ? row[k] === v : row[k] > v))
        .map(([, row]) => copy(row)).sort((a, b) => a._id.localeCompare(b._id)); return { items: rows.slice(0, limit), totalCount: rows.length }; } }; return q; } };
  const deps = { company: 'NCT', items, store, protocol,
    coverage: Object.fromEntries(WRITERS.map(name => [name, { verified: true, build: 'TEST' }])),
    authenticateOriginalDelegation: async () => { authentications++; return copy(staff); },
    readContext: async (company, actor) => { reads++; assert.equal(actor.memberId, staff.memberId); return context(); },
    readCurrentTaskRows: async (company, ids) => ids.map(id => ({ _id: id, company, _version: 'T0', description: id === 'T' ? 'O' : 'O-U', imageAltText: id === 'T' ? 'L' : 'L-U', stockCounterSchema: 2, stockCounterGeneration: 1, stockDispatchedCumulative: 0 })),
    readPurchaseRecords: async () => [], projectPurchaseOrders, createSalesOrderAdjustmentOperations, readAllocations, readCustomerShipments,
    readPackingLists, packingHeld, readPlans: readShipmentPlans, planVersion: shipmentPlanVersion, now: () => new Date('2026-10-22T12:00:00Z') };
  const request = (serial, mode, quantity, stockGeneration, batchId = '') => ({ requestId: String(serial).padStart(8, '0') + '-1111-4111-8111-111111111111',
    stockProtocol: 1, stockBuild: 'TEST', stockGeneration, input: { action: 'ADJUST', customerId: 'C', orderId: 'O', taskId: 'T', mode, quantity, batchId,
      version: salesAdjustmentVersion({ ...context(), allocations: [] }, shipmentPlanVersion) } });
  return { deps, db, context, request, save: createCurrentSalesDemandSave(deps), counts: () => ({ reads, authentications }), setStaff: value => { staff = value; } };
}
test('trusted source Sales increases quantity and splits customer shipment under same fence without Buyer/PO/receipt rewrites', async () => {
  const f = await fixture(), increase = f.request(1, 'INCREASE', 50, 1);
  assert.equal((await f.save({ ...increase, staff: { memberId: 'FORGED', canSelectShipment: true } })).stockGeneration, 2);
  await f.save(increase); assert.equal(f.context().tasks[0].requested, 150); assert.equal(f.counts().reads, 1); assert.equal(f.counts().authentications, 2);
  const plan = readShipmentPlans(f.context().activity)[0], split = f.request(2, 'SPLIT', 70, 2, plan.id + '|1');
  assert.equal((await f.save(split)).stockGeneration, 3); await f.save(split);
  assert.deepEqual([...readShipmentPlans(f.context().activity)[0].batches.map(b => b.lines[0].quantity)], [70, 80]);
  assert.equal(f.context().tasks[0].requested, 150); assert.equal(f.context().tasks[0].po, '');
  assert.equal([...f.db.values()].filter(r => r.action === 'SALES_ORDER_ADJUSTMENT_SAVED').length, 2);
  assert.equal([...f.db.keys()].some(k => /^(NCTOrders|NCTTasks|PurchaseOrders|StockPositions|StockClaims)\//.test(k)), false);
});
test('fake Master identity, revoked source permission or cross-customer delegation rejects before company data reads', async () => {
  for (const staff of [{ memberId: 'MASTER/M', staffId: 'S', customerId: 'C', canSelectShipment: true },
    { memberId: 'SOURCE_SALES/S', staffId: 'S', customerId: 'C', canSelectShipment: false },
    { memberId: 'SOURCE_SALES/S', staffId: 'S', customerId: 'OTHER', canSelectShipment: true }]) {
    const f = await fixture(), request = f.request(1, 'INCREASE', 20, 1); f.setStaff(staff);
    await assert.rejects(f.save(request), /delegation required/); assert.equal(f.counts().reads, 0);
  }
});

test('original current READ and SAVE share full customer-product version, while original filtering/account shape stays intact', async () => {
  const folder = require('node:path').join(__dirname, '../prototypes/stock-current-state');
  assert.match(require('node:child_process').execFileSync(process.execPath, [require('node:path').join(folder, 'build-sales-fulfilment-candidate.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const source = fs.readFileSync(require('node:path').join(folder, 'customerFulfilmentService.candidate.js'), 'utf8');
  const body = source.slice(source.indexOf('export async function readCustomerFulfilment(')).replace(/^export /, '');
  const readOriginal = vm.runInNewContext(body + '\nreadCustomerFulfilment;', { Date, Math,
    readFulfilmentContext: async () => { throw Error('Current read must use verified private context, not recapture legacy'); },
    readCustomerShipments, readShipmentPlans, shipmentPlanVersion, salesAdjustmentVersion,
    reservedCartons: load('customerShipmentLedger.js').reservedCartons,
    projectCustomerAccount: () => ({ entries: [], balances: [] }), projectCustomerDebtors: () => [],
    customerAccountVersion: () => 'ACCOUNT_UNCHANGED', shipmentVersion: () => 'SHIPMENT_UNCHANGED' });
  const f = await fixture(true), read = require('../prototypes/stock-current-state/current-sales-read.cjs').createCurrentSalesRead({ ...f.deps,
    currentFulfilmentVersion: 2, readOriginalCustomerFulfilment: readOriginal });
  const first = await read('NCT'); assert.equal(first.lines.find(l => l.taskId === 'U').allocated, 10);
  assert.equal(first.lines.find(l => l.taskId === 'U').available, 10); assert.equal(first.stockCurrent.stockGeneration, 1);
  assert.equal(first.accountVersion, 'ACCOUNT_UNCHANGED'); assert.equal(first.lines.every(l => l.customerId === 'C'), true);
  const increase = f.request(1, 'INCREASE', 20, 1); increase.input.version = first.adjustmentVersion;
  assert.equal((await f.save(increase)).stockGeneration, 2);
  const next = await read('NCT'); assert.equal(next.lines.find(l => l.taskId === 'T').originalRequested, 120);
  assert.equal(next.lines.find(l => l.taskId === 'U').allocated, 10); assert.equal(next.stockCurrent.stockGeneration, 2);
  await assert.rejects(readOriginal('NCT', { customerId: 'OTHER' }, 'C', { company: 'NCT', stockAllocationView: 'CURRENT_V2' }), /verified current customer/i);
});
