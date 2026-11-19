const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createPlannerAllocationOperations, allocationVersion } = load('plannerAllocation.js');
const { validateOriginalAllocation } = require('../prototypes/stock-current-state/original-allocation-validation.cjs');
const { allocateCumulative, dispatch, approveBorrow } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const { prepareCurrentAllocation } = require('../prototypes/stock-current-state/borrowing-stock-plan.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { currentAllocationContext } = require('../prototypes/stock-current-state/current-allocation-context.cjs');
const { createAllocationAuthority } = require('../prototypes/stock-current-state/allocation-authority.cjs');
const { createBorrowingStockReader } = require('../prototypes/stock-current-state/borrowing-stock-reader.cjs');
const { requirePurchaseStaff } = load('purchaseProjection.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { readAllocations } = load('plannerAllocation.js');
const { readCustomerShipments } = load('customerShipmentLedger.js');
const { readPackingLists } = load('packingListOperations.js');
const { packingHeld } = load('packingListModel.js');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const identity = { company: 'NCT', barcode: '001', packing: '12', ea: 12 };
  const tasks = ['A', 'B'].map(id => ({ ...identity, id, customerId: id, orderId: 'O' + id, sourceLineId: 'L' + id,
    ord: 10, requested: 10, dispatched: 0, po: 'PO-' + id, supplierId: 'SUP',
    lpCtn: 10, lpPc: 10 / 12, disc1: 0, disc2: 0, disc3: 0, history: [],
    procurement: { totalCtn: id === 'A' ? 15 : 10, customerCtn: 10 }, warehouse: { hasPhysicalReceipt: true, accepted: id === 'A' ? 15 : 0 } }));
  const activity = [], workspace = { company: 'NCT', tasks, activity, suppliers: [{ id: 'SUP', name: 'Supplier' }], customers: ['A', 'B'].map(id => ({ id, name: id })) };
  const input = () => ({ action: 'ALLOCATE', sourceTaskId: 'A', version: allocationVersion(workspace, activity),
    targets: [{ taskId: 'A', quantity: 10 }, { taskId: 'B', quantity: 5 }], reason: 'Allocate received stock' });
  const args = { createPlannerAllocationOperations, company: 'NCT', staff: { memberId: 'M', staffId: 'P', staffName: 'LAW' },
    requestId: '11111111-1111-4111-8111-111111111111', workspace, activity, now: () => new Date('2026-10-22T03:00:00Z') };
  const state = { ...identity, complete: true, revision: 0, tasks,
    packingHolds: { company: 'NCT', complete: true, scope: 'TASK_TOTAL', version: 'H0', heldByTask: { A: 0, B: 0 } },
    sources: ['A', 'B'].map(id => ({ ...identity, id, ownerTaskId: id, poId: 'PO-' + id, orderId: 'O' + id, sourceLineId: 'L' + id,
      poValid: true, reviewRequired: false, receiptPolicy: 'OWNER_DEMAND', ownerShare: 10, planned: id === 'A' ? 15 : 10,
      accepted: id === 'A' ? 15 : 0, onHand: id === 'A' ? 15 : 0, isolated: 0, available: id === 'A' ? 5 : 0,
      claims: id === 'A' ? { A: 10 } : {} })), relations: [] };
  return { identity, workspace, activity, input, args, state };
}
function authorityFixture() {
  const f = fixture(), calls = { context: 0, staff: 0 };
  const member = { _id: 'M', loginEmail: 'purchase@example.test', status: 'APPROVED' };
  const employee = { title: 'P', description: 'M', staffName: 'LAW', staffEmail: member.loginEmail, staffStatus: 'ACTIVE', departments: ['PURCHASE'] };
  const deps = { readMember: async () => member, readStaffRecords: async () => { calls.staff++; return [employee]; }, requirePurchaseStaff,
    readContext: async (company, staff) => { calls.context++; assert.equal(staff.memberId, 'M'); return f.workspace; }, readPurchaseRecords: async () => [],
    projectPurchaseOrders, createPlannerAllocationOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld, now: f.args.now };
  return { ...f, deps, calls, member, employee, request: () => ({ company: 'NCT', requestId: f.args.requestId, input: f.input() }) };
}
test('free-stock allocation authority uses original Purchase identity and ignores browser actor', async () => {
  const f = authorityFixture(), request = f.request(); request.input.approvedBy = 'FORGED';
  const result = await createAllocationAuthority(f.deps)(request);
  assert.equal(result.kind, 'ALLOCATE'); assert.equal(result.memberId, 'M'); assert.equal(result.event.initiatedByStaffId, 'P');
  assert.deepEqual(f.calls, { context: 1, staff: 1 });
  const state = result.buildState({ positions: [], claims: [], transfers: [], product: null });
  assert.equal(state.sources[0].accepted, 15); assert.equal(state.sources[0].ownerShare, 10);
  assert.notEqual(state.sources[0].poId, 'PO-A'); assert.equal(f.activity.length, 0);
});
test('allocation authority refuses unauthorized and pending members before business context', async () => {
  for (const department of ['WAREHOUSE', 'SUPPORT', 'PLANNER']) {
    const f = authorityFixture();
    await assert.rejects(createAllocationAuthority({ ...f.deps, readStaffRecords: async () => [{ ...f.employee, departments: [department] }] })(f.request()), /not authorized/);
    assert.equal(f.calls.context, 0);
  }
  const f = authorityFixture();
  await assert.rejects(createAllocationAuthority({ ...f.deps, readMember: async () => ({ ...f.member, status: 'PENDING' }) })(f.request()));
  assert.deepEqual(f.calls, { context: 0, staff: 0 });
});
test('original allocation validator preserves original event and no business mutations', async () => {
  const f = fixture(), before = JSON.stringify(f.workspace);
  const prepared = await validateOriginalAllocation({ ...f.args, input: f.input() });
  assert.equal(prepared.event.action, 'PLANNER_ALLOCATION_SAVED');
  assert.equal(prepared.event.initiatedByStaffId, 'P'); assert.equal(prepared.event.details.targets[1].quantity, 5);
  assert.equal(f.activity.length, 0); assert.equal(JSON.stringify(f.workspace), before);
});
test('original stale/demand/product/invoice/usable quantity guards remain active', async () => {
  for (const mutate of [f => { f.workspace.tasks[0].warehouse.accepted = 14; }, f => { f.workspace.tasks[1].barcode = 'OTHER'; },
    f => { f.workspace.tasks[1].salesInvoiceNumber = 'INV'; }, f => { f.workspace.tasks[1].ord = 4; }]) {
    const f = fixture(); mutate(f); await assert.rejects(validateOriginalAllocation({ ...f.args, input: f.input() }));
  }
  const f = fixture(), input = f.input(); input.version = 'OLD'; await assert.rejects(validateOriginalAllocation({ ...f.args, input }), /changed/);
});
test('cumulative targets subtract dispatched cartons, preserving source provenance and physical balance', () => {
  const f = fixture(), shipped = dispatch(f.state, { expectedRevision: 0, taskId: 'A', sourceId: 'A', quantity: 4 }).after;
  const result = allocateCumulative(shipped, { expectedRevision: 1, sourceId: 'A', reason: 'Allocate free stock',
    targets: [{ taskId: 'A', quantity: 10 }, { taskId: 'B', quantity: 5 }] }).after;
  assert.equal(result.sources[0].claims.A, 6); assert.equal(result.sources[0].claims.B, 5);
  assert.equal(result.sources[0].onHand, 11); assert.equal(result.sources[0].dispatchedByTask.A, 4);
  assert.equal(result.sources[0].available, 0); assert.equal(result.sources[0].receiptPolicy, 'EXPLICIT_ONLY');
  assert.throws(() => allocateCumulative(shipped, { expectedRevision: 1, sourceId: 'A', reason: 'Wrong', targets: [{ taskId: 'A', quantity: 3 }] }), /dispatched/);
});
test('allocation cannot erase active borrowing claims or its promised future replacement', () => {
  const f = fixture(), borrowed = approveBorrow(f.state, { expectedRevision: 0, id: 'R', lenderSourceId: 'A', replacementSourceId: 'B',
    borrowerTaskId: 'B', quantity: 3, approvedBy: 'P', reason: 'Fill container' }).after;
  const before = JSON.stringify(borrowed);
  assert.throws(() => allocateCumulative(borrowed, { expectedRevision: 1, sourceId: 'A', reason: 'Bypass return',
    targets: [{ taskId: 'A', quantity: 10 }] }), /Outstanding borrowing/);
  assert.equal(JSON.stringify(borrowed), before); assert.equal(borrowed.relations[0].repaid, 0);
});

test('original CURRENT-view seam rejects unchanged post-borrow allocation and keeps free-stock assignment usable', async () => {
  assert.match(require('node:child_process').execFileSync(process.execPath, [require('node:path').join(__dirname, '../prototypes/stock-current-state/build-allocation-view-candidate.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const f = fixture(), candidate = load('../prototypes/stock-current-state/plannerAllocation.candidate.js');
  const borrowed = approveBorrow(f.state, { expectedRevision: 0, id: 'R', lenderSourceId: 'A', replacementSourceId: 'B',
    borrowerTaskId: 'B', quantity: 3, approvedBy: 'P', reason: 'Fill container' }).after;
  Object.assign(borrowed, { lifecycleVersion: 2, nextBorrowSequence: 2 });
  for (const s of borrowed.sources) s.borrowRepaidCumulative = 0;
  const workspace = currentAllocationContext({ state: borrowed, context: f.workspace, readAllocations });
  const input = { ...f.input(), version: candidate.allocationVersion(workspace, f.activity), targets: [{ taskId: 'A', quantity: 7 }, { taskId: 'B', quantity: 3 }] };
  // Counterexample: old prepare ignores the supplied current view and accepts no-op.
  assert.equal((await validateOriginalAllocation({ ...f.args, workspace, input })).event.action, 'PLANNER_ALLOCATION_SAVED');
  await assert.rejects(validateOriginalAllocation({ ...f.args, workspace, input,
    createPlannerAllocationOperations: candidate.createPlannerAllocationOperations }), /has not changed/);
  input.targets[1].quantity = 8;
  const validated = await validateOriginalAllocation({ ...f.args, workspace, input, createPlannerAllocationOperations: candidate.createPlannerAllocationOperations });
  const next = allocateCumulative(borrowed, { expectedRevision: borrowed.revision, sourceId: 'A', reason: input.reason, targets: validated.event.details.targets }).after;
  assert.equal(next.sources[0].available, 0); assert.equal(next.sources[0].claims.A, 7); assert.equal(next.sources[0].claims.B, 8);
  assert.equal(next.relations[0].quantity, 3); assert.equal(next.relations[0].repaid, 0);
  const deps = authorityFixture().deps;
  assert.throws(() => createAllocationAuthority({ ...deps, currentPlan: true }), /CURRENT allocation view required/);
  assert.equal(candidate.ALLOCATION_CURRENT_VIEW_VERSION, 2);
});

test('concrete v2 allocation authenticates original Purchase, allocates only free5 and preserves pending borrow3', async () => {
  const f = authorityFixture(), candidate = load('../prototypes/stock-current-state/plannerAllocation.candidate.js');
  const borrowed = approveBorrow(f.state, { expectedRevision: 0, id: 'R', lenderSourceId: 'A', replacementSourceId: 'B', borrowerTaskId: 'B', quantity: 3, approvedBy: 'P', reason: 'Fill' }).after;
  Object.assign(borrowed, { lifecycleVersion: 2, nextBorrowSequence: 2 });
  for (const s of borrowed.sources) s.borrowRepaidCumulative = 0;
  const workspace = currentAllocationContext({ state: borrowed, context: f.workspace, readAllocations });
  const db = new Map(), key = stockKey(f.identity), positionId = hash('NCT', key, 'PURCHASE_SOURCE', 'A');
  const base = { company: 'NCT', stockKey: key, _version: 'V0', revision: 0, status: 'ACTIVE', reviewCodes: [] };
  const put = (c, row) => db.set(c + '/' + row._id, copy(row));
  put('StockPositions', { ...base, _id: positionId, sourceTaskId: 'A', poId: hash('NCT', 'PURCHASE_ORDER', ['A']), receiptAccepted: 15,
    replacementReceived: 0, borrowRepaidCumulative: 0, supplierReturned: 0, dispatched: 0, onHand: 15, isolated: 0, available: 5, reservedUsable: 10 });
  for (const [taskId, qty] of [['A', 7], ['B', 3]]) put('StockClaims', { ...base, _id: hash('NCT', positionId, taskId), positionId, taskId,
    customerId: taskId, orderId: 'O' + taskId, sourceLineId: 'L' + taskId, reservedUsable: qty, isolatedAttributed: 0, dispatchedCumulative: 0 });
  put('StockProducts', { ...base, _id: hash('NCT', key), revision: 1, lifecycleVersion: 2, nextBorrowSequence: 2,
    onHand: 15, isolated: 0, available: 5, reservedUsable: 10, reviewRequired: false });
  put('NCTActivity', { ...base, _id: hash('NCT', 'STOCK_TRANSFER_CURRENT', 'R'), action: 'STOCK_TRANSFER_CURRENT',
    participantTaskIds: ['B', 'A'], lenderSourceId: 'A', replacementSourceId: 'B', repaidQuantity: 0, details: { relation: borrowed.relations[0] } });
  const store = { read: async (c, id) => copy(db.get(c + '/' + id) || null), insert: async (c, row) => {
    if (db.has(c + '/' + row._id)) throw Error('Duplicate'); put(c, row); },
    compareAndSet: async (c, id, version, row) => { if (db.get(c + '/' + id)?._version !== version) throw Error('Conflict'); put(c, row); },
    compareAndRemove: async (c, id, attempt) => { if (db.get(c + '/' + id)?.attempt !== attempt) throw Error('Attempt'); db.delete(c + '/' + id); } };
  const items = { query: c => { const filters = []; let limit;
    const q = { eq: (k, v) => { filters.push(['eq', k, v]); return q; }, gt: (k, v) => { filters.push(['gt', k, v]); return q; }, ascending: () => q,
      limit: n => { limit = n; return q; }, find: async () => { const selected = [...db.entries()].filter(([address, row]) => address.startsWith(c + '/')
        && filters.every(([m, k, v]) => m === 'eq' ? row[k] === v : row[k] > v)).map(([, row]) => copy(row)).sort((a, b) => a._id.localeCompare(b._id));
        return { items: selected.slice(0, limit), totalCount: selected.length }; } }; return q; } };
  const protocol = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs').createSegmentedFencedProof({ store, stepsPerInvocation: 100 });
  await protocol.initialize(); Object.assign(db.get('NCTActivity/' + protocol.ids.controlId), { generation: 1, mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST', transferIndexVersion: 2 });
  f.deps.readCurrentTaskRows = async (company, ids) => ids.map(id => { const task = f.workspace.tasks.find(t => t.id === id); return { _id: id, company,
    _version: 'T0', description: task.orderId, imageAltText: task.sourceLineId, stockCounterSchema: 2, stockCounterGeneration: 0, stockDispatchedCumulative: 0 }; });
  const coverage = Object.fromEntries(require('../prototypes/stock-current-state/stock-admission.cjs').WRITERS.map(name => [name, { verified: true, build: 'TEST' }]));
  const save = require('../prototypes/stock-current-state/current-department-saves.cjs').createCurrentAllocationSave({ company: 'NCT', items, store, protocol, coverage,
    authorityDependencies: { ...f.deps, createPlannerAllocationOperations: candidate.createPlannerAllocationOperations, allocationViewVersion: candidate.ALLOCATION_CURRENT_VIEW_VERSION } });
  const request = { requestId: f.args.requestId, stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 1, input: { action: 'ALLOCATE', sourceTaskId: 'A',
    version: candidate.allocationVersion(workspace, f.activity), targets: [{ taskId: 'A', quantity: 7 }, { taskId: 'B', quantity: 8 }], reason: 'Assign free stock' } };
  const gateway = require('../prototypes/stock-current-state/current-purchase-task-gateway.cjs').createCurrentPurchaseTaskGateway({ company:'NCT',items,store,protocol,coverage,
    authorityDependencies:{...f.deps,createPlannerAllocationOperations:candidate.createPlannerAllocationOperations,allocationViewVersion:candidate.ALLOCATION_CURRENT_VIEW_VERSION} });
  assert.equal((await gateway('NCT',{...request,operation:'ALLOCATE',approvedBy:'FORGED'})).stockGeneration,2);
  assert.equal((await save(request)).stockGeneration, 2); await save(request);
  assert.equal(db.get('StockProducts/' + hash('NCT', key)).onHand, 15); assert.equal(db.get('StockProducts/' + hash('NCT', key)).available, 0);
  assert.equal(db.get('StockClaims/' + hash('NCT', positionId, 'B')).reservedUsable, 8);
  assert.equal(db.get('NCTActivity/' + hash('NCT', 'STOCK_TRANSFER_CURRENT', 'R')).details.relation.repaid, 0);
  assert.equal([...db.values()].filter(row => row.action === 'PLANNER_ALLOCATION_SAVED').length, 1);
  const afterState=allocateCumulative(borrowed,{expectedRevision:1,sourceId:'A',targets:request.input.targets,reason:request.input.reason}).after,
    nextContext=currentAllocationContext({state:afterState,context:f.workspace,readAllocations}),beforeUnauthorized=JSON.stringify([...db].filter(([key])=>key.startsWith('Stock')));
  await assert.rejects(gateway('NCT',{...request,operation:'ALLOCATE',requestId:'22222222-2222-4222-8222-222222222222',stockGeneration:2,
    input:{...request.input,version:candidate.allocationVersion(nextContext,f.activity),targets:[{taskId:'A',quantity:5},{taskId:'B',quantity:10}]}}),/Outstanding borrowing allocation requires dedicated transfer return or repayment/);
  assert.equal(JSON.stringify([...db].filter(([key])=>key.startsWith('Stock'))),beforeUnauthorized);
});
test('packing-held claim reductions and isolated physical quantities cannot be reallocated', () => {
  const f = fixture(); f.state.packingHolds.heldByTask.A = 2;
  assert.throws(() => allocateCumulative(f.state, { expectedRevision: 0, sourceId: 'A', reason: 'Move', targets: [{ taskId: 'A', quantity: 9 }] }), /Packing/);
  f.state.packingHolds.heldByTask.A = 0; f.state.sources[0].available = 3; f.state.sources[0].isolated = 2;
  assert.throws(() => allocateCumulative(f.state, { expectedRevision: 0, sourceId: 'A', reason: 'Move', targets: [{ taskId: 'A', quantity: 10 }, { taskId: 'B', quantity: 5 }] }), /usable/);
});
test('ordinary assignment cannot move reservations directly or first release them to fake free stock', () => {
  const f = fixture(), before = JSON.stringify(f.state);
  for (const targets of [[{ taskId: 'A', quantity: 7 }, { taskId: 'B', quantity: 8 }], [{ taskId: 'A', quantity: 7 }], []]) {
    assert.throws(() => allocateCumulative(f.state, { expectedRevision: 0, sourceId: 'A', reason: 'Bypass', targets }), /reservation release/);
  }
  assert.equal(JSON.stringify(f.state), before);
});
test('validated original allocation maps to same event and exact current claims, never stock receipt', async () => {
  const f = fixture(), validated = await validateOriginalAllocation({ ...f.args, input: f.input() });
  const key = stockKey(f.identity), pid = hash('NCT', key, 'PURCHASE_SOURCE', 'A');
  const base = { _version: 'V0', schemaVersion: 1, company: 'NCT', stockKey: key, revision: 0, checkpointGeneration: 0, status: 'ACTIVE', reviewCodes: [] };
  const rows = { complete: true, transfers: [], positions: [{ ...base, _id: pid, sourceKind: 'PURCHASE_SOURCE', sourceTaskId: 'A', sourceId: 'A', poId: 'PO-A',
    receiptAccepted: 15, replacementReceived: 0, dispatched: 0, onHand: 15, available: 5, isolated: 0, reservedUsable: 10 }],
    claims: [{ ...base, _id: hash('NCT', pid, 'A'), positionId: pid, taskId: 'A', customerId: 'A', orderId: 'OA', sourceLineId: 'LA', reservedUsable: 10, isolatedAttributed: 0 }],
    product: { ...base, _id: hash('NCT', key), onHand: 15, available: 5, isolated: 0, reservedUsable: 10, reviewRequired: false } };
  const result = prepareCurrentAllocation({ state: f.state, rows, event: validated.event, generation: 0 });
  const collections = { StockPositions: rows.positions, StockClaims: rows.claims, StockProducts: [rows.product], NCTActivity: [] };
  let inside = false;
  const items = { query: collection => {
    const filters = [], q = { eq: (k, v) => { filters.push([k, v]); return q; }, ascending: () => q, limit: () => q,
      find: async () => { assert.equal(inside, true); const list = collections[collection].filter(r => filters.every(([k, v]) => r[k] === v)); return { items: list, totalCount: list.length }; } };
    return q;
  } };
  const read = createBorrowingStockReader({ company: 'NCT', items,
    store: { read: async (c, id) => collections[c].find(r => r._id === id) || null },
    protocol: { readSnapshot: async fn => { inside = true; try { return { generation: 0, rows: await fn() }; } finally { inside = false; } } },
    readAuthority: async () => { assert.equal(inside, true); return { kind: 'ALLOCATE', identity: f.identity, event: validated.event,
      buildState: () => f.state }; } });
  assert.deepEqual((await read()).plan, result.plan);
  assert.deepEqual(result.plan.writes[0].after.details, validated.event.details);
  assert.equal(result.plan.writes.some(w => w.after.action === 'WAREHOUSE_RECEIPT_SAVED'), false);
  assert.equal(result.plan.writes.find(w => w.collection === 'StockProducts').after.onHand, 15);
  assert.equal(result.plan.writes.find(w => w.collection === 'StockClaims' && w.after.taskId === 'B').after.reservedUsable, 5);
  const bad = copy(validated.event); bad.details.accepted = 999;
  assert.throws(() => prepareCurrentAllocation({ state: f.state, rows, event: bad, generation: 0 }), /authority/);
});
