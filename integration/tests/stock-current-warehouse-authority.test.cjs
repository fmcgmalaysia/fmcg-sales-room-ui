const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createWarehouseAuthority } = require('../prototypes/stock-current-state/warehouse-authority.cjs');
const { prepareWarehouseReceipt } = require('../prototypes/stock-current-state/warehouse-receipt-plan.cjs');
const { createWarehouseStockReader } = require('../prototypes/stock-current-state/warehouse-stock-reader.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const { createCurrentWarehouseReceiptSave } = require('../prototypes/stock-current-state/current-department-saves.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { requireWarehouseStaff, projectWarehouseOrders, createWarehouseOperations } = load('warehouseReceiving.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { readAllocations } = load('plannerAllocation.js');
const { readCustomerShipments } = load('customerShipmentLedger.js');
const { readPackingLists } = load('packingListOperations.js');
const { packingHeld } = load('packingListModel.js');
const member = { _id: 'M', status: 'APPROVED', loginEmail: 'warehouse@example.test' };
const employee = { title: 'W', description: 'M', staffEmail: member.loginEmail, staffName: 'LAW', staffStatus: 'ACTIVE', departments: ['WAREHOUSE'] };
function fixture() {
  const context = { company: 'NCT', activity: [], suppliers: [{ id: 'SUP', name: 'Supplier' }], customers: [{ id: 'C', name: 'Customer' }],
    tasks: ['A', 'B'].map(id => ({ id, company: 'NCT', customerId: 'C', orderId: 'O', sourceLineId: 'L-' + id,
      barcode: id, name: 'Product ' + id, packing: '12', ea: 12, requested: 100, ord: 100, po: 'PO-001', supplierId: 'SUP',
      lpCtn: 10, lpPc: 10 / 12, disc1: 0, disc2: 0, disc3: 0, history: [], procurement: { totalCtn: 100, customerCtn: 100 }, warehouse: null })) };
  let contextReads = 0, staffReads = 0, recordReads = 0;
  const deps = { readMember: async () => member, readStaffRecords: async () => { staffReads++; return [employee]; }, requireWarehouseStaff,
    readContext: async (company, staff) => { contextReads++; assert.equal(staff.memberId, member._id); assert.equal(staff.staffId, 'W'); return context; },
    readPurchaseRecords: async () => { recordReads++; return []; }, projectPurchaseOrders, projectWarehouseOrders, createWarehouseOperations,
    readAllocations, readCustomerShipments, readPackingLists, packingHeld, now: () => new Date('2026-10-22T03:00:00Z') };
  const orders = () => projectWarehouseOrders({ company: 'NCT', purchaseOrders: projectPurchaseOrders({ company: 'NCT', workspace: context, records: [] }), tasks: context.tasks, activity: context.activity });
  const request = () => ({ company: 'NCT', requestId: '11111111-1111-4111-8111-111111111111',
    input: { id: orders()[0].id, version: orders()[0].version, action: 'RECEIVE',
      lines: context.tasks.map(t => ({ taskId: t.id, accepted: 100, rejected: 0, kind: 'DELIVERY', reason: '' })) } });
  return { context, deps, request, counts: () => ({ contextReads, staffReads, recordReads }) };
}
test('original Warehouse authority resolves both products once; browser actor cannot forge receipt', async () => {
  const f = fixture(), request = f.request(); request.input.staff = { staffId: 'FORGED' };
  const result = await createWarehouseAuthority(f.deps)(request);
  assert.equal(result.memberId, 'M'); assert.equal(result.validated.event.initiatedByStaffId, 'W');
  assert.deepEqual(f.counts(), { contextReads: 1, staffReads: 1, recordReads: 1 });
  const products = result.products.map(p => ({ state: p.buildState({ positions: [], claims: [], transfers: [], product: null }),
    rows: { complete: true, positions: [], claims: [], transfers: [], product: null } }));
  const saved = prepareWarehouseReceipt({ validated: result.validated, products, generation: 0 });
  assert.equal(saved.plan.writes.filter(w => w.after.action === 'WAREHOUSE_RECEIPT_SAVED').length, 1);
  assert.equal(saved.states.reduce((n, s) => n + s.sources[0].onHand, 0), 200);
  assert.deepEqual(saved.plan.writes.filter(w => w.collection === 'StockProducts').map(w => w.after.name).sort(), ['Product A', 'Product B']);
  assert.deepEqual(saved.plan.writes.filter(w => w.collection === 'StockPositions').map(w => w.after.name).sort(), ['Product A', 'Product B']);
  assert.deepEqual(saved.plan.writes.filter(w => w.collection === 'StockPositions').map(w => w.after.poNumber), ['PO-001', 'PO-001']);
  assert.equal(f.context.activity.length, 0);
});
test('Purchase/Support cannot receive; pending member does not cause private reads', async () => {
  for (const department of ['PURCHASE', 'SUPPORT', 'PLANNER']) {
    const f = fixture();
    await assert.rejects(createWarehouseAuthority({ ...f.deps, readStaffRecords: async () => [{ ...employee, departments: [department] }] })(f.request()), /not authorized/);
    assert.equal(f.counts().contextReads, 0);
  }
  const f = fixture();
  await assert.rejects(createWarehouseAuthority({ ...f.deps, readMember: async () => ({ ...member, status: 'PENDING' }) })(f.request()));
  assert.deepEqual(f.counts(), { contextReads: 0, staffReads: 0, recordReads: 0 });
});
test('foreign company and duplicate task contexts stop before receipt stock preparation', async () => {
  const foreign = fixture(), request = foreign.request(); foreign.context.company = 'GHR';
  await assert.rejects(createWarehouseAuthority(foreign.deps)(request), /context/);
  const duplicate = fixture(), next = duplicate.request(); duplicate.context.tasks.push(duplicate.context.tasks[0]);
  await assert.rejects(createWarehouseAuthority(duplicate.deps)(next), /context/);
});
test('original stale PO and over-approved receipt remain blocked by authority composition', async () => {
  const f = fixture(), stale = f.request(); stale.input.version = 'OLD';
  await assert.rejects(createWarehouseAuthority(f.deps)(stale), /changed/);
  const over = f.request(); over.input.lines[0].accepted = 101;
  await assert.rejects(createWarehouseAuthority(f.deps)(over), /exceed/);
  assert.equal(f.context.activity.length, 0);
});
test('unknown customer share and inconsistent original accepted facts refuse rather than guessing stock', async () => {
  const f = fixture(), request = f.request(); f.context.tasks[0].procurement.customerCtn = null;
  await assert.rejects(createWarehouseAuthority(f.deps)(request), /customer share/);
  const g = fixture(), first = await createWarehouseAuthority(g.deps)(g.request());
  g.context.activity.push(first.validated.event);
  const correction = g.request(); correction.input.action = 'CORRECT'; correction.input.lines.forEach(l => { l.accepted = 90; l.reason = 'Recount'; });
  // Deliberately stale context warehouse metadata: original receipt says100, context says0.
  await assert.rejects(createWarehouseAuthority(g.deps)(correction), /authority differ/);
});

test('ordinary original projected expected-extra gives exact customer share without requiring a fixed-share record; explicit unknown remains blocked',async()=>{
  const f=fixture(),task=f.context.tasks[0];delete task.procurement.customerCtn;
  task.procurement.totalCtn=150;task.procurement.expectedExtra=50;
  const request=f.request();request.input.lines[0].accepted=150;
  const authority=await createWarehouseAuthority(f.deps)(request),products=authority.products.map(product=>{
    const rows={complete:true,positions:[],claims:[],transfers:[],product:null};return{rows,state:product.buildState(rows)};
  });
  const prepared=prepareWarehouseReceipt({validated:authority.validated,products,generation:0});
  const state=prepared.states.find(state=>state.barcode==='A');
  assert.equal(state.sources[0].ownerShare,100);assert.equal(state.sources[0].onHand,150);assert.equal(state.sources[0].available,50);
  assert.equal(state.sources[0].claims.A,100);assert.equal(Object.hasOwn(task.procurement,'customerCtn'),false,'read mapping must not rewrite original facts');
  for(const patch of [{customerCtn:null,expectedExtra:0},{customerCtn:undefined,expectedExtra:0},{expectedExtra:undefined},{expectedExtra:101},{expectedExtra:-1},{expectedExtra:0.5}]){
    const next=fixture();delete next.context.tasks[0].procurement.customerCtn;Object.assign(next.context.tasks[0].procurement,patch);
    await assert.rejects(createWarehouseAuthority(next.deps)(next.request()),/customer share/);
  }
});
test('authenticated current save composes original PO authority and fenced two-product receipt; replay reauthorizes without duplicate reads/events', async () => {
  const f = fixture(), request = f.request(), db = new Map(), copy = value => JSON.parse(JSON.stringify(value));
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null),
    insert: async (c, row) => { if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); return copy(row); },
    compareAndSet: async (c, id, version, row) => {
      if (db.get(c + ':' + id)?._version !== version) throw Error('Conditional conflict'); db.set(c + ':' + id, copy(row)); return copy(row);
    }, compareAndRemove: async (c, id, attempt) => {
      if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong attempt'); db.delete(c + ':' + id);
    } };
  const items = { query: collection => {
    const filters = [];
    const query = { eq: (k, v) => { filters.push([k, v]); return query; }, ascending: () => query, limit: () => query,
      find: async options => {
        assert.deepEqual(options, { consistentRead: true, returnTotalCount: true });
        const rows = [...db.entries()].filter(([k, r]) => k.startsWith(collection + ':') && filters.every(([key, value]) => r[key] === value)).map(([, r]) => r);
        return { items: copy(rows), totalCount: rows.length };
      } }; return query;
  } };
  const protocol = createFencedProof({ store }); await protocol.initialize();
  Object.assign(db.get(protocol.ids.journal + ':' + protocol.ids.controlId), { mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST' });
  const save = createCurrentWarehouseReceiptSave({ company: 'NCT', items, store, protocol,
    coverage: Object.fromEntries(WRITERS.map(name => [name, { verified: true, build: 'TEST' }])), authorityDependencies: f.deps });
  const command = { requestId: request.requestId, input: request.input, stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0 };
  await save(command); await save(command);
  assert.deepEqual(f.counts(), { contextReads: 1, staffReads: 3, recordReads: 1 });
  const rows = [...db.values()];
  assert.equal(rows.filter(r => r.action === 'WAREHOUSE_RECEIPT_SAVED').length, 1);
  assert.equal(rows.filter(r => r.sourceKind === 'PURCHASE_SOURCE').reduce((n, r) => n + r.onHand, 0), 200);
  assert.ok(rows.filter(r => r.sourceKind === 'PURCHASE_SOURCE').every(r => r.poNumber === 'PO-001'));
  assert.equal((await protocol.readControl()).generation, 1);
  // In-memory composition, not a real Wix webMethod or verified production coverage.
});
test('pending barrier prevents even authority/context reads', async () => {
  const f = fixture(); let authorities = 0;
  const reader = createWarehouseStockReader({ company: 'NCT', items: { query() { throw Error('Unexpected query'); } }, store: { read() {} },
    protocol: { readSnapshot: async () => { throw Error('Inventory pending'); } },
    readAuthority: async () => { authorities++; return createWarehouseAuthority(f.deps)(f.request()); } });
  await assert.rejects(reader(), /pending/); assert.equal(authorities, 0); assert.equal(f.counts().contextReads, 0);
});
