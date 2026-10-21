const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { createBorrowingAuthority } = require('../prototypes/stock-current-state/borrowing-authority.cjs');
const { requirePurchaseStaff } = load('purchaseProjection.js');
const { readAllocations } = load('plannerAllocation.js');
const { readCustomerShipments } = load('customerShipmentLedger.js');
const { readPackingLists } = load('packingListOperations.js');
const { packingHeld } = load('packingListModel.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { operationId } = load('purchaseOperationJournal.js');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { transferId } = require('../prototypes/stock-current-state/borrowing-stock-plan.cjs');
const { createBorrowingStockReader } = require('../prototypes/stock-current-state/borrowing-stock-reader.cjs');
const member = { _id: 'M1', loginEmail: 'purchase@example.test', status: 'APPROVED' };
const staff = { title: 'P1', description: 'M1', staffEmail: member.loginEmail, staffName: 'DEMO', staffStatus: 'ACTIVE', role: 'STAFF', departments: ['PURCHASE'] };
const request = { company: 'NCT', requestId: '11111111-2222-4333-8444-555555555555', kind: 'APPROVE',
  input: { expectedRevision: 0, borrowerTaskId: 'A', lenderSourceId: 'B', replacementSourceId: 'A', quantity: 30, reason: 'Customer A shipment' } };
function fixture() {
  const context = { company: 'NCT', activity: [], suppliers: [{ id: 'SUP', name: 'Demo Supplier' }], customers: ['A', 'B'].map(id => ({ id: 'C-' + id, name: id })),
    tasks: ['A', 'B'].map(id => ({ id, customerId: 'C-' + id, orderId: 'O-' + id, sourceLineId: 'L-' + id,
      barcode: '1', name: 'Demo', packing: '24x1', ea: 24, requested: 100, ord: 100, po: 'PO-' + id, supplierId: 'SUP',
      lpCtn: 10, lpPc: 10 / 24, disc1: 0, disc2: 0, disc3: 0, history: [], procurement: { totalCtn: 100, customerCtn: 100 },
      warehouse: id === 'B' ? { hasPhysicalReceipt: true, accepted: 100 } : null })) };
  const calls = [];
  const deps = { readMember: async () => member, readStaffRecords: async () => [staff], requirePurchaseStaff,
    readContext: async (company, verified) => { calls.push({ company, verified }); return context; },
    readPurchaseRecords: async () => [], projectPurchaseOrders, readAllocations, readCustomerShipments, readPackingLists, packingHeld,
    readTransfer: async () => null, now: () => new Date('2026-10-22T01:00:00Z') };
  return { context, calls, deps };
}
test('uses original Purchase auth and PO projector; ignores forged browser actor and permission flags', async () => {
  const f = fixture();
  const result = await createBorrowingAuthority(f.deps)({ ...request, input: { ...request.input, approvedBy: 'FORGED', poValid: true, complete: true } });
  assert.equal(result.input.approvedBy, 'P1'); assert.equal(result.event.initiatedByStaffId, 'P1');
  assert.equal(result.memberId, 'M1'); assert.equal(result.identity.company, 'NCT');
  assert.equal(Object.hasOwn(result.input, 'poValid'), false);
  assert.equal(f.calls[0].verified.memberId, 'M1');
  const state = result.buildState({ positions: [], claims: [], product: null, transfers: [] });
  assert.equal(state.sources.find(s => s.id === 'B').accepted, 100);
  assert.equal(state.sources.find(s => s.id === 'A').poId, operationId('NCT', 'PURCHASE_ORDER', ['A']));
});
test('Warehouse/Support only staff cannot approve borrowing and no context is read', async () => {
  for (const department of ['WAREHOUSE', 'SUPPORT', 'PLANNER']) {
    const f = fixture();
    await assert.rejects(createBorrowingAuthority({ ...f.deps, readStaffRecords: async () => [{ ...staff, departments: [department] }] })(request), /not authorized/);
    assert.equal(f.calls.length, 0);
  }
});
test('unapproved member rejects before reading private staff records', async () => {
  const f = fixture(); let staffReads = 0;
  await assert.rejects(createBorrowingAuthority({ ...f.deps, readMember: async () => ({ ...member, status: 'PENDING' }),
    readStaffRecords: async () => { staffReads++; return [staff]; } })(request), /approved Master staff/);
  assert.equal(staffReads, 0); assert.equal(f.calls.length, 0);
});
test('missing PO, draft plan, invoice lock, foreign context and unknown customer share reject', async () => {
  for (const mutate of [f => { f.context.tasks[0].po = ''; }, f => { f.context.tasks[0].procurement.draftPlan = true; },
    f => { f.context.tasks[1].salesInvoiceNumber = 'INV'; }, f => { f.context.company = 'GHR'; },
    f => { f.context.tasks[0].procurement.customerCtn = null; }]) {
    const f = fixture(); mutate(f); await assert.rejects(createBorrowingAuthority(f.deps)(request));
  }
});
test('state assembler uses exact current claims instead of copying legacy task inc', async () => {
  const f = fixture(); f.context.tasks[0].inc = 9999;
  const authority = await createBorrowingAuthority(f.deps)(request), key = stockKey(authority.identity), positionId = operationId('NCT', key, 'PURCHASE_SOURCE', 'B');
  const state = authority.buildState({ positions: [{ sourceTaskId: 'B', onHand: 100, isolated: 0, available: 0 }],
    claims: [{ positionId, taskId: 'B', reservedUsable: 100 }], transfers: [], product: { revision: 0 } });
  assert.equal(state.sources[0].claims.A, undefined);
  assert.equal(state.sources[1].claims.B, 100);
  assert.equal(state.tasks[0].dispatched, 0);
});
test('return authority resolves stable server relationship and does not trust browser borrower IDs', async () => {
  const f = fixture(), relation = { id: 'R1', borrowerTaskId: 'A', lenderTaskId: 'B', lenderSourceId: 'B', replacementSourceId: 'A', quantity: 30, repaid: 0 };
  const result = await createBorrowingAuthority({ ...f.deps, readTransfer: async () => ({ _id: transferId('NCT', 'R1'), company: 'NCT', stockKey: stockKey({ company: 'NCT', barcode: '1', packing: '24x1', ea: 24 }), action: 'STOCK_TRANSFER_CURRENT', details: { relation } }) })({
    ...request, kind: 'RETURN', input: { ...request.input, relationId: 'R1', borrowerTaskId: 'WRONG' } });
  assert.equal(result.input.relationId, 'R1'); assert.equal(result.input.approvedBy, 'P1');
  assert.equal(Object.hasOwn(result.input, 'borrowerTaskId'), false);
});
test('reader invokes server state assembler inside snapshot barrier after current-row reads', async () => {
  let assembled = false, barrier = false;
  const f = fixture(), original = createBorrowingAuthority(f.deps);
  const authority = await original(request), raw = authority.buildState;
  authority.buildState = rows => { assert.equal(barrier, true); assembled = true; return raw(rows); };
  const q = {}; for (const method of ['eq', 'ascending', 'limit']) q[method] = () => q;
  q.find = async () => ({ items: [], totalCount: 0 });
  await assert.rejects(createBorrowingStockReader({ company: 'NCT', items: { query: () => q }, store: { read: async () => null },
    protocol: { readSnapshot: async fn => { barrier = true; const rows = await fn(); barrier = false; return { generation: 0, rows }; } },
    readAuthority: async () => authority })(), /Physical balance|provenance conflict|snapshot missing/);
  assert.equal(assembled, true);
});
test('real auth/PO parsers plus current snapshot produce a single approved borrowing save plan', async () => {
  const f = fixture(), authority = createBorrowingAuthority(f.deps);
  const key = stockKey({ company: 'NCT', barcode: '1', packing: '24x1', ea: 24 });
  const positionId = operationId('NCT', key, 'PURCHASE_SOURCE', 'B');
  const base = { company: 'NCT', stockKey: key, revision: 0, status: 'ACTIVE', _version: 'V0', reviewCodes: [] };
  const position = { ...base, _id: positionId, sourceTaskId: 'B', poId: operationId('NCT', 'PURCHASE_ORDER', ['B']), receiptAccepted: 100,
    replacementReceived: 0, dispatched: 0, onHand: 100, isolated: 0, available: 0, reservedUsable: 100 };
  const claim = { ...base, _id: operationId('NCT', positionId, 'B'), positionId, taskId: 'B', customerId: 'C-B',
    reservedUsable: 100, isolatedAttributed: 0 };
  const product = { ...base, _id: operationId('NCT', key), onHand: 100, isolated: 0, available: 0, reservedUsable: 100 };
  const all = { StockPositions: [position], StockClaims: [claim], StockProducts: [product], NCTActivity: [] };
  const deps = { company: 'NCT', readAuthority: () => authority(request),
    store: { read: async (collection, id) => all[collection].find(row => row._id === id) || null },
    protocol: { readSnapshot: async fn => ({ generation: 0, rows: await fn() }) }, items: { query: collection => {
      const filters = {}; const q = { eq: (k, v) => { filters[k] = v; return q; }, ascending: () => q, limit: () => q,
        find: async () => { const selected = all[collection].filter(row => Object.entries(filters).every(([k, v]) => row[k] === v)); return { items: selected, totalCount: selected.length }; } }; return q;
    } } };
  const result = await createBorrowingStockReader(deps)();
  assert.equal(result.plan.writes[0].after.initiatedByStaffId, 'P1');
  assert.equal(result.plan.writes.find(w => w.collection === 'StockClaims' && w.after.taskId === 'A').after.reservedUsable, 30);
  assert.equal(result.state.sources.find(s => s.id === 'B').claims.B, 70);
  // Existing legacy shipment reservation is part of the same task hold protection.
  f.context.activity.push({ _id: 'SE', title: 'SE', description: 'SHIP', action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED',
    activityTime: '2026-10-22T00:00:00Z', details: { beforeRevision: '', shipment: { id: 'SHIP', company: 'NCT', customerId: 'C-B', currency: 'USD', status: 'REQUESTED',
      lines: [{ taskId: 'B', quantity: 10, sources: [{ sourceTaskId: 'B', quantity: 10 }] }] } } });
  await assert.rejects(createBorrowingStockReader(deps)(), /Packing task holds lender/);
});
