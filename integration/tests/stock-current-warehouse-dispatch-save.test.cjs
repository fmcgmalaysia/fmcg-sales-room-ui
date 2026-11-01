const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module'), load = require('./load-master-module.cjs');
const { createCurrentWarehouseDispatchSave, createCurrentWarehouseShipmentRead } = require('../prototypes/stock-current-state/current-warehouse-dispatch-save.cjs');
const { readCurrentWarehouseShipmentWorkspace } = require('../prototypes/stock-current-state/warehouse-shipment-workspace.cjs');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const filename = require.resolve('./stock-current-packing-preparation.test.cjs');
const baseFixture = vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace("const test = require('node:test')", 'const test = () => {}') + '\nfixture;', { require: createRequire(filename), Map });
const copy = value => JSON.parse(JSON.stringify(value));
function fulfilment() {
  const bindings = {}; let source = fs.readFileSync(path.join(__dirname, '../prototypes/stock-current-state/customerFulfilment.candidate.js'), 'utf8');
  source = source.replace(/^import \{([^}]+)\} from 'backend\/([^']+)';$/gm, (_, names, file) => { const exports = load(file);
    for (const name of names.split(',').map(s => s.trim())) bindings[name] = exports[name]; return ''; }).replace(/^export /gm, '');
  return vm.runInNewContext('(function(){' + source + '\nreturn {createCustomerFulfilmentOperations,shipmentVersion};})()', { ...bindings, JSON, Date, Error, Map, Set });
}
const api = fulfilment();
async function fixture() {
  const f = baseFixture(), staff = { memberId: 'M', staffId: 'W', staffName: 'Warehouse', canDispatchShipment: true };
  for (const [key, row] of f.db) {
    if (key.startsWith('StockProducts:')) Object.assign(row, { lifecycleVersion: 2, nextBorrowSequence: 1 });
    if (key.startsWith('StockPositions:')) row.borrowRepaidCumulative = 0;
    if (key.startsWith('StockClaims:')) row.dispatchedCumulative = 0;
  }
  f.db.set('NCTTasks:T', { _id: 'T', company: 'NCT', _version: 'T0', description: 'O', imageAltText: 'L',
    stockCounterSchema: 2, stockCounterGeneration: 0, stockDispatchedCumulative: 0 });
  const shipment = { id: 'SHIP', company: 'NCT', customerId: 'C', currency: 'USD', status: 'REQUESTED',
    lines: [{ taskId: 'T', orderId: 'O', sourceLineId: 'L', barcode: '1', packing: '12x1', quantity: 20, sources: [{ sourceTaskId: 'T', quantity: 20 }] }] };
  const base = { company: 'NCT', action: 'CUSTOMER_SHIPMENT_CHANGED', description: 'SHIP', image: 'C', result: 'SAVED', activityTime: '2026-10-21T00:00:00.000Z' };
  f.db.set('NCTActivity:REQ', { ...base, _id: 'REQ', title: 'REQ', details: { beforeRevision: '', shipment } });
  f.db.set('NCTActivity:INV', { ...base, _id: 'INV', title: 'INV', details: { beforeRevision: 'REQ', shipment: { ...copy(shipment), status: 'INVOICED',
    invoice: { number: 'EXISTING-INV', amountCents: 100, currency: 'USD', rateToMyr: 4 } } } });
  const store = { read: f.deps.store.read, insert: async (c, row) => { if (f.db.has(c + ':' + row._id)) throw Error('Duplicate'); f.db.set(c + ':' + row._id, copy(row)); return copy(row); },
    compareAndSet: async (c, id, version, row) => { if (f.db.get(c + ':' + id)?._version !== version) throw Error('Conflict'); f.db.set(c + ':' + id, copy(row)); return copy(row); },
    compareAndRemove: async (c, id, attempt) => { if (f.db.get(c + ':' + id)?.attempt !== attempt) throw Error('Attempt'); f.db.delete(c + ':' + id); } };
  const protocol = createSegmentedFencedProof({ store, domainWrites: true, stepsPerInvocation: 100 }); await protocol.initialize();
  Object.assign(f.db.get('NCTActivity:' + protocol.ids.controlId), { mode: 'ACTIVE', schemaVersion: 1, transferIndexVersion: 2, writerBuild: 'TEST' });
  const items = { query: c => { const filters = []; let limit; const q = { eq: (key, value) => { filters.push(row => row[key] === value); return q; },
    gt: (key, value) => { filters.push(row => row[key] > value); return q; }, ascending: () => q, limit: n => { limit = n; return q; }, find: async () => {
      const rows = [...f.db.entries()].filter(([key, row]) => key.startsWith(c + ':') && filters.every(fn => fn(row))).map(([, row]) => copy(row)).sort((a, b) => a._id.localeCompare(b._id));
      return { items: rows.slice(0, limit), totalCount: rows.length }; } }; return q; } };
  const deps = { ...f.deps, company: 'NCT', store, items, protocol, authenticateOriginalWarehouse: async () => staff,
    coverage: Object.fromEntries(WRITERS.map(name => [name, { verified: true, build: 'TEST' }])),
    createCustomerFulfilmentOperations: api.createCustomerFulfilmentOperations, currentAllocationVersion: 2,
    readCurrentTaskRows: async (_company, ids) => ids.map(id => copy(f.db.get('NCTTasks:' + id))) };
  return { ...f, deps, staff, protocol, save: createCurrentWarehouseDispatchSave(deps),
    workspace: async () => (await protocol.readSnapshot(async control => readCurrentWarehouseShipmentWorkspace({ ...deps, staff, control, context: await deps.readContext('NCT', staff) }))).rows };
}
test('actual original Warehouse dispatch subtracts onHand once and updates task cumulative without rewriting prior invoice', async () => {
  const f = await fixture(), beforeInvoice = JSON.stringify(f.db.get('NCTActivity:INV')), before = await f.workspace();
  const request = { requestId: '77777777-1111-4111-8111-111111111111', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0,
    input: { action: 'DISPATCH', id: 'SHIP', version: api.shipmentVersion(before.context), reference: 'CONTAINER', reason: 'Actual exit' } };
  const result = await f.save(request); assert.equal(result.status, 'DISPATCHED'); assert.equal(result.stockGeneration, 1); await f.save(request);
  const after = await f.workspace(), product = [...after.products.values()][0];
  assert.equal(product.state.sources[0].onHand, 30); assert.equal(product.state.sources[0].claims.T, 30);
  assert.equal(product.state.tasks[0].dispatched, 20); assert.equal(f.db.get('NCTTasks:T').stockDispatchedCumulative, 20);
  assert.equal(f.db.get('NCTTasks:T').stockCounterGeneration, 1); assert.equal(f.db.get('NCTTasks:T').archived, undefined);
  assert.equal(JSON.stringify(f.db.get('NCTActivity:INV')), beforeInvoice);
  assert.equal([...f.db.values()].filter(r => r.details?.shipment?.status === 'DISPATCHED').length, 1);
});
test('original missing invoice or revoked Warehouse grant cannot turn loading/Support permission into physical dispatch', async () => {
  const f = await fixture(); f.db.delete('NCTActivity:INV');
  const before = await f.workspace(), request = { requestId: '88888888-1111-4111-8111-111111111111', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0,
    input: { action: 'DISPATCH', id: 'SHIP', version: api.shipmentVersion(before.context), reference: 'CONTAINER', reason: 'Exit' } };
  await assert.rejects(f.save(request), /Invoice is required/); assert.equal((await f.protocol.readControl()).generation, 0);
  f.staff.canDispatchShipment = false; await assert.rejects(f.save(request), /grant/);
  assert.equal(f.db.get('NCTTasks:T').stockDispatchedCumulative, 0);
});

test('current Warehouse READ feeds the same original version context and retains outer-gateway redaction responsibility', async () => {
  const f = await fixture(), workspace = await f.workspace();
  const read = createCurrentWarehouseShipmentRead({ ...f.deps, currentFulfilmentVersion: 2,
    readOriginalCustomerFulfilment: async (company, staff, customerId, context) => {
      assert.equal(customerId, ''); assert.equal(staff.canDispatchShipment, true);
      assert.equal(context.stockAllocationView, 'CURRENT_V2'); assert.equal(context.tasks[0].inc, 50);
      return { company, version: api.shipmentVersion(context), marker: 'ORIGINAL_PRIVATE_RESULT' };
    } });
  const result = await read('NCT'); assert.equal(result.version, api.shipmentVersion(workspace.context));
  assert.equal(result.stockCurrent.stockGeneration, 0); assert.equal(result.marker, 'ORIGINAL_PRIVATE_RESULT');
  await assert.rejects(read('GHR'), /company conflict/);
});

test('borrower physically dispatched from another customer source retains unpaid replacement relationship', async () => {
  const f = await fixture(), source = [...f.db.values()].find(r => r.sourceTaskId === 'T' && r.receiptAccepted === 50);
  const owner = f.context.tasks[0];
  f.context.tasks.push({ ...copy(owner), id: 'A', customerId: 'CA', orderId: 'OA', sourceLineId: 'LA', po: 'PO2', warehouse: null });
  f.context.customers.push({ id: 'CA', name: 'Borrower' });
  f.db.set('NCTTasks:A', { _id: 'A', company: 'NCT', _version: 'A0', description: 'OA', imageAltText: 'LA',
    stockCounterSchema: 2, stockCounterGeneration: 0, stockDispatchedCumulative: 0 });
  const ownerClaim = [...f.db.values()].find(r => r.positionId === source._id && r.taskId === 'T'); ownerClaim.reservedUsable = 30;
  const claim = { ...copy(ownerClaim), _id: hash('NCT', source._id, 'A'), taskId: 'A', customerId: 'CA', orderId: 'OA', sourceLineId: 'LA', reservedUsable: 20 };
  f.db.set('StockClaims:' + claim._id, claim);
  const product = [...f.db.values()].find(r => r.lifecycleVersion === 2); product.nextBorrowSequence = 2;
  const relation = { id: 'BORROW', sequence: 1, borrowerTaskId: 'A', lenderTaskId: 'T', lenderSourceId: 'T', replacementSourceId: 'A',
    quantity: 20, repaid: 0, returned: 0, approvedBy: 'PURCHASE', reason: 'Approved before packing' };
  const relationId = hash('NCT', 'STOCK_TRANSFER_CURRENT', 'BORROW');
  f.db.set('NCTActivity:' + relationId, { _id: relationId, company: 'NCT', stockKey: source.stockKey, _version: 'R0', revision: 0, status: 'ACTIVE',
    action: 'STOCK_TRANSFER_CURRENT', participantTaskIds: ['A', 'T'], lenderSourceId: 'T', replacementSourceId: 'A', repaidQuantity: 0, details: { relation } });
  for (const id of ['REQ', 'INV']) {
    const record = f.db.get('NCTActivity:' + id); record.image = 'CA'; record.details.shipment.customerId = 'CA';
    Object.assign(record.details.shipment.lines[0], { taskId: 'A', orderId: 'OA', sourceLineId: 'LA' });
  }
  const before = await f.workspace();
  await f.save({ requestId: '99999999-1111-4111-8111-111111111111', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0,
    input: { action: 'DISPATCH', id: 'SHIP', version: api.shipmentVersion(before.context), reference: 'CONTAINER', reason: 'Borrower leaves first' } });
  const after = await f.workspace(); assert.equal([...after.products.values()][0].state.sources.find(s => s.id === 'T').onHand, 30);
  assert.equal(f.db.get('NCTTasks:A').stockDispatchedCumulative, 20);
  assert.equal(f.db.get('NCTActivity:' + relationId).status, 'ACTIVE');
  assert.equal(f.db.get('NCTActivity:' + relationId).details.relation.repaid, 0);
  assert.equal(f.db.get('NCTActivity:' + relationId).details.relation.quantity, 20);
});
