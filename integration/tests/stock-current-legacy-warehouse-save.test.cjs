const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createLegacyWarehousePreparation } = require('../prototypes/stock-current-state/legacy-warehouse-preparation.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const { requireWarehouseStaff } = load('warehouseReceiving.js'), { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { createPreparationOperations, projectPreparation, readPreparation } = load('warehousePreparation.js');
const { readAllocations } = load('plannerAllocation.js'), { readCustomerShipments } = load('customerShipmentLedger.js');
const { readPackingLists } = load('packingListOperations.js'), { packingHeld } = load('packingListModel.js');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs'), { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 }, key = stockKey(identity);
  const context = { company: 'NCT', activity: [], customers: [{ id: 'C', name: 'Customer' }], suppliers: [{ id: 'SUP', name: 'Supplier' }],
    tasks: [{ ...identity, id: 'T', customerId: 'C', orderId: 'O', sourceLineId: 'L', name: 'Item', ord: 100, requested: 100, inc: 999,
      po: 'PO1', supplierId: 'SUP', lpCtn: 12, lpPc: 1, disc1: 0, disc2: 0, disc3: 0, history: [],
      procurement: { totalCtn: 100, customerCtn: 100 }, warehouse: { hasPhysicalReceipt: true, accepted: 100, stock: { availablePhysical: 999 } } }] };
  const po = projectPurchaseOrders({ company: 'NCT', workspace: context, records: [] })[0], positionId = hash('NCT', key, 'PURCHASE_SOURCE', 'T');
  const base = { company: 'NCT', stockKey: key, _version: 'V0', revision: 0, status: 'ACTIVE', reviewCodes: [] };
  const db = new Map(), put = (c, row) => db.set(c + ':' + row._id, copy(row));
  put('StockPositions', { ...base, _id: positionId, sourceTaskId: 'T', poId: po.id, receiptAccepted: 100, replacementReceived: 0, dispatched: 0,
    onHand: 100, isolated: 0, reservedUsable: 100, available: 0 });
  put('StockClaims', { ...base, _id: hash('NCT', positionId, 'T'), positionId, taskId: 'T', customerId: 'C', reservedUsable: 100, isolatedAttributed: 0 });
  put('StockProducts', { ...base, _id: hash('NCT', key), onHand: 100, isolated: 0, reservedUsable: 100, available: 0, reviewRequired: false });
  const member = { _id: 'M', loginEmail: 'warehouse@example.test', status: 'APPROVED' };
  const employee = { title: 'W', description: 'M', staffName: 'Warehouse', staffEmail: member.loginEmail, staffStatus: 'ACTIVE', departments: ['WAREHOUSE'] };
  let contextReads = 0, staffReads = 0;
  const deps = { company: 'NCT', readMember: async () => member, readStaffRecords: async () => { staffReads++; return [employee]; }, requireWarehouseStaff,
    readContext: async (company, staff) => { contextReads++; assert.equal(company, 'NCT'); assert.equal(staff.memberId, 'M');
      return { ...copy(context), activity: [...db.entries()].filter(([id]) => id.startsWith('NCTActivity:')).map(([, row]) => copy(row)) }; },
    readPurchaseRecords: async () => [], projectPurchaseOrders, createPreparationOperations, projectPreparation, readPreparation,
    readAllocations, readCustomerShipments, readPackingLists, packingHeld, now: () => new Date('2026-10-22T01:00:00Z'),
    protocol: { readSnapshot: async fn => ({ generation: 0, rows: await fn() }) }, store: { read: async (c, id) => copy(db.get(c + ':' + id) || null) },
    items: { query: c => { const filters = [], q = { eq: (k, v) => { filters.push([k, v]); return q; }, ascending: () => q, limit: () => q,
      find: async () => { const items = [...db.entries()].filter(([id, row]) => id.startsWith(c + ':') && filters.every(([k, v]) => row[k] === v)).map(([, row]) => copy(row)); return { items, totalCount: items.length }; } }; return q; } } };
  const request = { company: 'NCT', requestId: '11111111-1111-4111-8111-111111111111', staff: { staffId: 'FORGED', canPrepareWarehouse: true } };
  async function command(service, input, i = 1) {
    const row = (await service.read(request)).rows[0];
    return { ...request, requestId: String(i).padStart(8, '0') + '-1111-4111-8111-111111111111', input: { id: row.id, version: row.version, ...input } };
  }
  return { db, deps, request, context, command, counts: () => ({ contextReads, staffReads }) };
}

test('old preparation uses current Ready and original event; checkpoint/guard only, no stock movement', async () => {
  const f = fixture(), service = createLegacyWarehousePreparation(f.deps), before = JSON.stringify([...f.db]);
  const read = await service.read(f.request); assert.equal(read.rows[0].readyStock, 100); assert.equal(read.rows[0].allocated, 100);
  const result = await service.prepare(await f.command(service, { action: 'PACK' }));
  assert.equal(result.plan.writes.length, 2); assert.equal(result.plan.writes[0].after.initiatedByStaffId, 'W');
  assert.equal(result.plan.writes[0].after.details.state.prepared, true); assert.equal(result.state.packingHolds.legacyBlockedByTask.T, true);
  assert.equal(result.state.packingHolds.heldByTask.T, 0); assert.equal(result.state.sources[0].onHand, 100);
  assert.deepEqual(result.state.sources[0].claims, { T: 100 }); assert.equal(JSON.stringify([...f.db]), before);
});

test('PACK LOAD unload UNPACK preserve original rules, versions and one event on fenced replay', async () => {
  const f = fixture(), store = { ...f.deps.store };
  store.insert = async (c, row) => { const id = c + ':' + row._id; if (f.db.has(id)) throw Error('Duplicate'); f.db.set(id, copy(row)); return copy(row); };
  store.compareAndSet = async (c, id, version, row) => { if (f.db.get(c + ':' + id)?._version !== version) throw Error('Conditional conflict'); f.db.set(c + ':' + id, copy(row)); return copy(row); };
  store.compareAndRemove = async (c, id, attempt) => { if (f.db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong execution'); f.db.delete(c + ':' + id); };
  const protocol = createFencedProof({ store }); await protocol.initialize(); f.deps.protocol = protocol; f.deps.store = store;
  const service = createLegacyWarehousePreparation(f.deps);
  const actions = [{ action: 'PACK' }, { action: 'LOAD', loaded: 40, note: 'Container full' }, { action: 'LOAD', loaded: 0, note: 'Unload correction' }, { action: 'UNPACK', note: 'Reverse preparation' }];
  for (const [i, input] of actions.entries()) {
    const request = await f.command(service, input, i + 1);
    const command = { requestId: request.requestId, memberId: 'M', input: request, prepare: async () => (await service.prepare(request)).plan };
    await protocol.commit(command); await protocol.commit(command);
    const read = await service.read(f.request); assert.equal(read.generation, i + 1); assert.equal(read.rows[0].loaded, input.loaded || 0);
    if (input.action === 'PACK') await assert.rejects(service.prepare(await f.command(service, { action: 'LOAD', loaded: 40 }, 9)), /explain partial/);
    if (input.action === 'LOAD' && input.loaded) await assert.rejects(service.prepare(await f.command(service, { action: 'UNPACK', note: 'No' }, 9)), /unload first/);
  }
  const result = await service.prepare(await f.command(service, { action: 'PACK' }, 10));
  assert.equal(result.state.packingHolds.legacyBlockedByTask.T, true);
  assert.equal((await service.read(f.request)).rows[0].prepared, false);
  assert.equal([...f.db.values()].filter(row => row.action === 'WAREHOUSE_PREPARATION_SAVED').length, 4);
  assert.equal([...f.db.entries()].find(([id]) => id.startsWith('StockProducts:'))[1].onHand, 100);
  assert.equal([...f.db.values()].some(row => row.action === 'CUSTOMER_SHIPMENT_CHANGED'), false);
});

test('permission, photos and wrong company refuse before private context; no document side effects', async () => {
  for (const input of [{ action: 'PHOTOS' }, { action: 'PACK', photos: [{ base64: 'x' }] }, { action: 'PACK', photos: null }]) {
    const f = fixture(); await assert.rejects(createLegacyWarehousePreparation(f.deps).prepare({ ...f.request, input }), /non-photo/);
    assert.deepEqual(f.counts(), { contextReads: 0, staffReads: 0 });
  }
  const f = fixture(); f.deps.readMember = async () => ({ _id: 'M', status: 'PENDING' });
  await assert.rejects(createLegacyWarehousePreparation(f.deps).read(f.request)); assert.deepEqual(f.counts(), { contextReads: 0, staffReads: 0 });
  const g = fixture(); g.deps.readStaffRecords = async () => [{ title: 'P', description: 'M', staffName: 'P', staffEmail: 'warehouse@example.test', staffStatus: 'ACTIVE', departments: ['PURCHASE'] }];
  await assert.rejects(createLegacyWarehousePreparation(g.deps).read(g.request)); assert.equal(g.counts().contextReads, 0);
  const h = fixture(); await assert.rejects(createLegacyWarehousePreparation(h.deps).read({ company: 'GHR' })); assert.equal(h.counts().contextReads, 0);
});

test('original stale version, insufficient allocation, missing partial reason and new packing mutual guard remain', async () => {
  const f = fixture(), service = createLegacyWarehousePreparation(f.deps);
  await assert.rejects(service.prepare(await f.command(service, { action: 'PACK', version: 'STALE' })), /changed/);
  await assert.rejects(service.prepare(await f.command(service, { action: 'LOAD', loaded: 100 })), /prepare this batch/);
  const claim = [...f.db.entries()].find(([id]) => id.startsWith('StockClaims:'))[1]; claim.reservedUsable = 80;
  const position = [...f.db.entries()].find(([id]) => id.startsWith('StockPositions:'))[1], product = [...f.db.entries()].find(([id]) => id.startsWith('StockProducts:'))[1];
  position.reservedUsable = product.reservedUsable = 80; position.available = product.available = 20;
  await assert.rejects(service.prepare(await f.command(service, { action: 'PACK' })), /insufficient/);
  const g = fixture(); g.db.set('NCTActivity:LIST', { _id: hash('NCT', 'LIST', 'PACKING_CURRENT'), description: 'LIST', company: 'NCT', action: 'SUPPORT_PACKING_LIST_CURRENT', result: 'SAVED',
    details: { list: { id: 'LIST', company: 'NCT', customerId: 'C', currency: 'USD', revision: 'R0', status: 'SENT',
      lines: [{ taskId: 'T', quantity: 100, packed: 0, loaded: 0, reason: '', photos: [] }] } } });
  const gs = createLegacyWarehousePreparation(g.deps); await assert.rejects(gs.prepare(await g.command(gs, { action: 'PACK' })), /packing|Packing/);
});

test('pending barrier and unflagged unknown current rows refuse, never trust old inc999', async () => {
  const f = fixture(); f.deps.protocol.readSnapshot = async () => { throw Error('Pending'); };
  await assert.rejects(createLegacyWarehousePreparation(f.deps).read(f.request), /Pending/); assert.equal(f.counts().contextReads, 0);
  const g = fixture(); [...g.db.entries()].find(([id]) => id.startsWith('StockProducts:'))[1].onHand = null;
  await assert.rejects(createLegacyWarehousePreparation(g.deps).read(g.request), /review/);
});

test('event saved but checkpoint interrupted hides partial state and resumes exact prepared images once', async () => {
  const f = fixture(), store = { ...f.deps.store }; let interrupt = true;
  store.insert = async (c, row) => { const id = c + ':' + row._id; if (f.db.has(id)) throw Error('Duplicate'); f.db.set(id, copy(row)); return copy(row); };
  store.compareAndSet = async (c, id, version, row) => {
    if (c === 'StockProducts' && interrupt) { interrupt = false; throw Error('Checkpoint interrupted'); }
    if (f.db.get(c + ':' + id)?._version !== version) throw Error('Conditional conflict'); f.db.set(c + ':' + id, copy(row)); return copy(row);
  };
  store.compareAndRemove = async (c, id, attempt) => { if (f.db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong execution'); f.db.delete(c + ':' + id); };
  const protocol = createFencedProof({ store }); await protocol.initialize(); f.deps.protocol = protocol; f.deps.store = store;
  const service = createLegacyWarehousePreparation(f.deps), request = await f.command(service, { action: 'PACK' }); let prepares = 0;
  const command = { requestId: request.requestId, memberId: 'M', input: request, prepare: async () => { prepares++; return (await service.prepare(request)).plan; } };
  await assert.rejects(protocol.commit(command), /Checkpoint interrupted/);
  await assert.rejects(service.read(f.request), /pending|progress|Incomplete/i);
  await protocol.commit(command); await protocol.commit(command);
  assert.equal(prepares, 1); assert.equal((await service.read(f.request)).generation, 1);
  assert.equal([...f.db.values()].filter(row => row.action === 'WAREHOUSE_PREPARATION_SAVED').length, 1);
  assert.equal([...f.db.entries()].find(([id]) => id.startsWith('StockProducts:'))[1].onHand, 100);
});
