'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const load = require('./load-master-module.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { createCurrentAllocationSave } = require('../prototypes/stock-current-state/current-department-saves.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function extract(file, expression) {
  const filename = require.resolve('./' + file);
  const source = fs.readFileSync(filename, 'utf8').replace(/const test\s*=\s*require\('node:test'\)/, 'const test = () => {}');
  return vm.runInNewContext(source + '\n' + expression, { require: createRequire(filename), __dirname: require('node:path').dirname(filename), Map, Buffer });
}
const receiptFixture = extract('stock-current-warehouse-receipt-web.test.cjs', 'fixture;');
const allocationFixture = extract('stock-current-allocation.test.cjs', 'authorityFixture;');

for (const company of ['NCT', 'GHR']) for (const action of ['RECEIVE', 'CORRECT']) {
  test(`actual ${company} ${action} root rejects staff drift before context, not after stock commit`, async () => {
    const f = await receiptFixture(company);
    let request = copy(f.initial);
    if (action === 'CORRECT') {
      assert.equal((await f.api.saveWarehouseReceiptCurrent(company, request)).ok, true);
      f.context.activity = [...f.db.values()].filter(row => row.action === 'WAREHOUSE_RECEIPT_SAVED');
      f.context.tasks.forEach(task => { task.warehouse = load('warehouseReceiving.js').readWarehouseTask({ title: task.id,
        description: task.orderId, imageAltText: task.sourceLineId, purchaseQtyInCtn: task.ord }, f.context.activity); });
      const orders = f.deps.projectWarehouseOrders({ company, purchaseOrders: f.deps.projectPurchaseOrders({ company,
        workspace: f.context, records: [] }), tasks: f.context.tasks, activity: f.context.activity });
      request = { ...request, requestId: '22222222-2222-4222-8222-222222222222', stockGeneration: 1,
        input: { ...request.input, action, version: orders[0].version,
          lines: request.input.lines.map(line => ({ ...line, accepted: 90, kind: 'CORRECTION', reason: 'Recount' })) } };
    }
    const employees = copy(await f.deps.readStaffRecords()), before = JSON.stringify([...f.db]);
    let reads = 0;
    f.deps.readStaffRecords = async () => { reads++; return employees.map(row => ({ ...row, title: reads <= 2 ? row.title : 'REISSUED' })); };
    const contextReads = f.calls.filter(call => call === 'CONTEXT').length;
    assert.equal((await f.api.saveWarehouseReceiptCurrent(company, request)).ok, false);
    assert.equal(reads, 3, 'root, admission and preparation use the original grant');
    assert.ok(JSON.stringify([...f.db]) === before, 'A false response after committed receipt is not a safe refusal');
    assert.equal(f.calls.filter(call => call === 'CONTEXT').length, contextReads);
  });
}

async function allocation(segmented, drift) {
  const f = allocationFixture(), db = new Map(), key = stockKey(f.identity), positionId = hash('NCT', key, 'PURCHASE_SOURCE', 'A');
  const base = { company: 'NCT', stockKey: key, _version: 'V0', revision: 0, status: 'ACTIVE', reviewCodes: [] };
  const put = (c, row) => db.set(c + '/' + row._id, copy(row));
  put('StockPositions', { ...base, _id: positionId, sourceTaskId: 'A', poId: hash('NCT', 'PURCHASE_ORDER', ['A']), receiptAccepted: 15,
    replacementReceived: 0, supplierReturned: 0, dispatched: 0, onHand: 15, isolated: 0, available: 5, reservedUsable: 10,
    ...(segmented ? { borrowRepaidCumulative: 0 } : {}) });
  put('StockClaims', { ...base, _id: hash('NCT', positionId, 'A'), positionId, taskId: 'A', customerId: 'A', orderId: 'OA', sourceLineId: 'LA',
    reservedUsable: 10, isolatedAttributed: 0, ...(segmented ? { dispatchedCumulative: 0 } : {}) });
  put('StockProducts', { ...base, _id: hash('NCT', key), onHand: 15, available: 5, reservedUsable: 10, isolated: 0, reviewRequired: false,
    ...(segmented ? { lifecycleVersion: 2, nextBorrowSequence: 1 } : {}) });
  const store = { read: async (c, id) => copy(db.get(c + '/' + id) || null), insert: async (c, row) => {
    assert.equal(db.has(c + '/' + row._id), false); put(c, row); },
    compareAndSet: async (c, id, version, row) => { assert.equal(db.get(c + '/' + id)?._version, version); put(c, row); },
    compareAndRemove: async (c, id, attempt) => { assert.equal(db.get(c + '/' + id)?.attempt, attempt); db.delete(c + '/' + id); } };
  const items = { query: c => { const filters = []; let limit = 1000; const q = {
    eq: (k, v) => { filters.push(row => row[k] === v); return q; }, gt: (k, v) => { filters.push(row => row[k] > v); return q; },
    ascending: () => q, limit: n => { limit = n; return q; }, find: async () => {
      const rows = [...db].filter(([address, row]) => address.startsWith(c + '/') && filters.every(fn => fn(row))).map(([, row]) => copy(row)).sort((a, b) => a._id.localeCompare(b._id));
      return { items: rows.slice(0, limit), totalCount: rows.length }; } }; return q; } };
  const protocol = segmented ? require('../prototypes/stock-current-state/segmented-fenced-proof.cjs').createSegmentedFencedProof({ store, stepsPerInvocation: 100 })
    : require('../prototypes/stock-current-state/fenced-proof.cjs').createFencedProof({ store });
  await protocol.initialize(); Object.assign(db.get('NCTActivity/' + protocol.ids.controlId), {
    mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST', ...(segmented ? { transferIndexVersion: 2 } : {}) });
  const candidate = load('../prototypes/stock-current-state/plannerAllocation.candidate.js');
  if (segmented) Object.assign(f.deps, { createPlannerAllocationOperations: candidate.createPlannerAllocationOperations,
    allocationViewVersion: candidate.ALLOCATION_CURRENT_VIEW_VERSION, readCurrentTaskRows: async (company, ids) => ids.map(id => {
      const task = f.workspace.tasks.find(t => t.id === id); return { _id: id, company, _version: 'T0', description: task.orderId,
        imageAltText: task.sourceLineId, stockCounterSchema: 2, stockCounterGeneration: 0, stockDispatchedCumulative: 0 }; }) });
  let reads = 0;
  f.deps.readStaffRecords = async () => [{ ...f.employee, title: ++reads === 1 || !drift ? 'P' : 'REISSUED' }];
  const save = createCurrentAllocationSave({ company: 'NCT', items, store, protocol,
    coverage: Object.fromEntries(WRITERS.map(w => [w, { verified: true, build: 'TEST' }])), authorityDependencies: f.deps });
  return { ...f, db, reads: () => reads, save, request: { ...f.request(), stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0,
    stockIdentity: { memberId: 'M', staffId: 'P' } } };
}
for (const segmented of [false, true]) {
  test(`real ${segmented ? 'v2' : 'v1'} allocation remains valid under unchanged original identity`, async () => {
    const f = await allocation(segmented, false), result = await f.save(f.request);
    assert.equal(result.ok, true); assert.equal(result.stockGeneration, 1);
    assert.equal([...f.db.values()].filter(row => row.action === 'PLANNER_ALLOCATION_SAVED').length, 1);
    assert.equal([...f.db.values()].find(row => row.action === 'PLANNER_ALLOCATION_SAVED').initiatedByStaffId, 'P');
  });
  test(`real ${segmented ? 'v2' : 'v1'} allocation rejects same-member staff reissue before business reads/staging`, async () => {
    const f = await allocation(segmented, true), before = JSON.stringify([...f.db]);
    await assert.rejects(f.save(f.request), /Allocation identity changed/);
    assert.equal(f.reads(), 2); assert.equal(f.calls.context, 0);
    assert.ok(JSON.stringify([...f.db]) === before);
  });
}
