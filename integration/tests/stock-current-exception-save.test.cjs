const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createCurrentStockExceptionSave } = require('../prototypes/stock-current-state/current-stock-exception-save.cjs');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs'), { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { requireStockStaff } = load('stockExceptionWorkspace.js'), { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { createStockExceptionOperations, stockExceptionVersion, readStockExceptions } = load('inventoryExceptions.js');
const { readAllocations } = load('plannerAllocation.js'), { readCustomerShipments } = load('customerShipmentLedger.js');
const { readPackingLists } = load('packingListOperations.js'), { packingHeld } = load('packingListModel.js');
const copy = v => JSON.parse(JSON.stringify(v));
async function fixture(company = 'NCT', reserved = false, kind = 'SHORT_EXPIRY') {
  const db = new Map(), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const identity = { company, barcode: '1', packing: '12', ea: 12 }, key = stockKey(identity);
  const task = { ...identity, id: 'T', orderId: 'O', sourceLineId: 'L', customerId: 'C', name: 'Approved extra stock',
    specialPurchase: !reserved, po: 'PO', supplierId: 'SUP', ord: 20, requested: 20, lpPc: 1, lpCtn: 12, netCostCtn: 12,
    disc1: 0, disc2: 0, disc3: 0, history: [], procurement: { totalCtn: 20, customerCtn: reserved ? 20 : 0 },
    warehouse: { hasPhysicalReceipt: true, accepted: 20 } };
  const baseContext = { company, tasks: [task], activity: [], customers: [{ id: 'C', name: 'Customer' }], suppliers: [{ id: 'SUP', name: 'Supplier' }] };
  const po = projectPurchaseOrders({ company, workspace: baseContext, records: [] })[0], positionId = hash(company, key, 'PURCHASE_SOURCE', task.id);
  const stock = { company, stockKey: key, _version: 'V0', revision: 0, status: 'ACTIVE', reviewCodes: [], checkpointGeneration: 0,
    onHand: 20, isolated: 0, available: reserved ? 0 : 20, reservedUsable: reserved ? 20 : 0 };
  db.set('StockProducts:' + hash(company, key), { ...stock, _id: hash(company, key), ...identity, lifecycleVersion: 2,
    nextBorrowSequence: 1, reviewRequired: false });
  db.set('StockPositions:' + positionId, { ...stock, _id: positionId, sourceTaskId: 'T', poId: po.id, receiptAccepted: 20,
    replacementReceived: 0, supplierReturned: 0, dispatched: 0, borrowRepaidCumulative: 0 });
  if (reserved) db.set('StockClaims:' + hash(company, positionId, 'T'), { ...stock, _id: hash(company, positionId, 'T'),
    positionId, taskId: 'T', customerId: 'C', orderId: 'O', sourceLineId: 'L', dispatchedCumulative: 0, isolatedAttributed: 0 });
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null), insert: async (c, row) => {
    if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); },
    compareAndSet: async (c, id, version, row) => { if (db.get(c + ':' + id)?._version !== version) throw Error('Conflict'); db.set(c + ':' + id, copy(row)); },
    compareAndRemove: async (c, id, attempt) => { if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Attempt'); db.delete(c + ':' + id); } };
  const protocol = createSegmentedFencedProof({ store, company, stepsPerInvocation: 1 }); await protocol.initialize();
  Object.assign(db.get(journal + ':' + protocol.ids.controlId), { mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST', transferIndexVersion: 2 });
  const items = { query: c => { const filters = []; let limit = 50; const q = { eq: (k, v) => { filters.push(row => row[k] === v); return q; },
    gt: (k, v) => { filters.push(row => row[k] > v); return q; }, ascending: () => q, limit: n => { limit = n; return q; },
    find: async () => { const rows = [...db].filter(([id, row]) => id.startsWith(c + ':') && filters.every(fn => fn(row)))
      .map(([, row]) => copy(row)).sort((a, b) => a._id.localeCompare(b._id)); return { items: rows.slice(0, limit), totalCount: rows.length }; } }; return q; } };
  const member = { _id: 'M', status: 'APPROVED', loginEmail: 'warehouse@example.test' }, employee = { title: 'W', description: 'M', staffEmail: member.loginEmail,
    staffName: 'Warehouse', staffStatus: 'ACTIVE', departments: ['WAREHOUSE'] }; let reads = 0;
  const context = () => ({ ...copy(baseContext), activity: [...db].filter(([id]) => id.startsWith(journal + ':')).map(([, row]) => copy(row)) });
  const deps = { readMember: async () => member, readStaffRecords: async () => [employee], requireStockStaff, readContext: async () => { reads++; return context(); },
    readPurchaseRecords: async () => [], projectPurchaseOrders, createStockExceptionOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld,
    readCurrentTaskRows: async (_company, ids) => ids.map(id => ({ _id: id, company, _version: 'TASK0', description: 'O', imageAltText: 'L',
      stockCounterSchema: 2, stockCounterGeneration: 0, stockDispatchedCumulative: 0 })), now: () => new Date('2026-10-22T06:00:00Z') };
  const save = createCurrentStockExceptionSave({ company, store, protocol, items, authorityDependencies: deps,
    coverage: Object.fromEntries(WRITERS.map(w => [w, { verified: true, build: 'TEST' }])) });
  const request = { requestId: '11111111-1111-4111-8111-111111111111', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0,
    staff: { canReportStockException: true }, input: { action: 'QUARANTINE', sourceTaskId: 'T', quantity: 10, kind, reason: 'Inspection', version: stockExceptionVersion(context()) } };
  return { company, db, context, task, member, employee, deps, protocol, store, items, request, save, reads: () => reads };
}

test('actual Warehouse free-stock isolation commits original exception and current stock once for both companies', async () => {
  for (const company of ['NCT', 'GHR']) {
    const f = await fixture(company), before = JSON.stringify(f.task); let result = await f.save(f.request), attempts = 1;
    assert.equal(result.pending, true); while (result.pending && attempts++ < 20) result = await f.save(f.request);
    assert.equal(result.ok, true); assert.equal(result.stockGeneration, 1); assert.ok(result.caseId);
    assert.equal((await f.save(f.request)).caseId, result.caseId); assert.equal(f.reads(), 1);
    const product = [...f.db.values()].find(row => row.lifecycleVersion === 2), position = [...f.db.values()].find(row => row.sourceTaskId === 'T');
    for (const row of [product, position]) assert.deepEqual([row.onHand, row.available, row.reservedUsable, row.isolated], [20, 10, 0, 10]);
    assert.equal(position.receiptAccepted, 20); assert.equal(position.supplierReturned, 0); assert.equal(JSON.stringify(f.task), before);
    assert.equal(readStockExceptions(f.context().activity).length, 1);
    const event = f.context().activity.find(row => row.action === 'STOCK_EXCEPTION_REPORTED');
    assert.equal(event.stockAttribution, 'FREE'); assert.equal(event.initiatedByStaffId, 'W'); assert.equal(event.details.referenceCostCents, 12000);
    assert.equal([...f.db.keys()].some(key => key.startsWith('StockClaims:')), false);
  }
});

test('reserved stock is not silently assigned customer losses and cannot be quarantined through this free-only path', async () => {
  const f = await fixture('NCT', true), before = JSON.stringify([...f.db].filter(([id]) => id.startsWith('Stock')));
  await assert.rejects(f.save(f.request), /attribution review/);
  assert.equal(JSON.stringify([...f.db].filter(([id]) => id.startsWith('Stock'))), before);
  assert.equal(readStockExceptions(f.context().activity).length, 0); assert.equal((await f.protocol.readControl()).pending, null);
});

test('free isolation preserves original version/physical/quantity checks and exact staff permissions on replay', async () => {
  for (const patch of [{ version: 'OLD' }, { quantity: 21 }, { quantity: 0 }, { kind: 'OTHER' }, { reason: '' }, { sourceTaskId: 'OTHER' }]) {
    const f = await fixture(); await assert.rejects(f.save({ ...f.request, input: { ...f.request.input, ...patch } }));
    assert.equal(readStockExceptions(f.context().activity).length, 0);
  }
  const f = await fixture(); f.employee.departments = ['PURCHASE']; await assert.rejects(f.save(f.request), /permission/); assert.equal(f.reads(), 0);
  const g = await fixture(); let result; do { result = await g.save(g.request); } while (result.pending);
  g.member.status = 'PENDING'; await assert.rejects(g.save(g.request), /access/);
  assert.equal(readStockExceptions(g.context().activity).length, 1);
});
