const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createCurrentPurchaseBorrowGateway } = require('../prototypes/stock-current-state/current-purchase-borrow-gateway.cjs');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs'), { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const filename = require.resolve('./stock-current-borrow-authority.test.cjs');
const fixtureSource = fs.readFileSync(filename, 'utf8').replace("const test = require('node:test')", 'const test = () => {}');
const original = vm.runInNewContext(fixtureSource+'\n({fixture,request});', { require: createRequire(filename), Map, Buffer });
const copy = value => JSON.parse(JSON.stringify(value));
async function fixture(department = 'PURCHASE') {
  const f = original.fixture(), db = new Map(), key = stockKey({ company: 'NCT', barcode: '1', packing: '24x1', ea: 24 });
  const employee = { ...copy((await f.deps.readStaffRecords())[0]), departments: [department] };
  f.deps.readStaffRecords = async () => [employee];
  const position = hash('NCT', key, 'PURCHASE_SOURCE', 'B'), base = { company: 'NCT', stockKey: key, revision: 0, status: 'ACTIVE', _version: 'V0', reviewCodes: [] };
  const seed = (c, row) => db.set(c+':'+row._id, copy(row));
  seed('StockPositions', { ...base, _id: position, sourceTaskId: 'B', poId: hash('NCT', 'PURCHASE_ORDER', ['B']), receiptAccepted: 100,
    replacementReceived: 0, dispatched: 0, onHand: 100, isolated: 0, available: 0, reservedUsable: 100, borrowRepaidCumulative: 0 });
  seed('StockClaims', { ...base, _id: hash('NCT', position, 'B'), positionId: position, taskId: 'B', customerId: 'C-B', reservedUsable: 100, isolatedAttributed: 0, dispatchedCumulative: 0 });
  seed('StockProducts', { ...base, _id: hash('NCT', key), onHand: 100, isolated: 0, available: 0, reservedUsable: 100, lifecycleVersion: 2, nextBorrowSequence: 51 });
  const store = { read: async (c, id) => copy(db.get(c+':'+id) || null), insert: async (c, row) => { if (db.has(c+':'+row._id)) throw Error('Duplicate'); seed(c, row); },
    compareAndSet: async (c, id, version, row) => { if (db.get(c+':'+id)?._version !== version) throw Error('Conflict'); seed(c, row); },
    compareAndRemove: async (c, id, attempt) => { if (db.get(c+':'+id)?.attempt !== attempt) throw Error('Attempt'); db.delete(c+':'+id); } };
  const items = { query: c => { const filters = []; let limit = 1000; const q = {
    eq: (k,v) => { filters.push(row => row[k] === v); return q; }, gt: (k,v) => { filters.push(row => row[k] > v); return q; },
    ascending: () => q, limit: n => { limit = n; return q; }, find: async () => { const rows = [...db].filter(([a,r]) => a.startsWith(c+':') && filters.every(fn => fn(r)))
      .map(([,r]) => copy(r)).sort((a,b) => a._id.localeCompare(b._id)); return { items: rows.slice(0,limit), totalCount: rows.length }; } }; return q; } };
  const protocol = createSegmentedFencedProof({ store, stepsPerInvocation: 1 }); await protocol.initialize();
  Object.assign(db.get(protocol.ids.journal+':'+protocol.ids.controlId), { mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST', transferIndexVersion: 2 });
  f.deps.readCurrentTaskRows = async (_c, ids) => ids.map(id => { const task = f.context.tasks.find(t => t.id === id); return { _id: id, company: 'NCT', _version: 'T0',
    description: task.orderId, imageAltText: task.sourceLineId, stockCounterSchema: 2, stockCounterGeneration: 0, stockDispatchedCumulative: 0 }; });
  const gateway = createCurrentPurchaseBorrowGateway({ company: 'NCT', items, store, protocol,
    coverage: Object.fromEntries(WRITERS.map(w => [w, { verified: true, build: 'TEST' }])), authorityDependencies: f.deps });
  return { ...f, db, items, store, protocol, gateway, request: { ...copy(original.request), operation: 'BORROW_APPROVE', kind: 'FORGED', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0 } };
}

test('private dialog gateway quotes real PO pair, approves once through bounded progress and preserves physical/PO identities', async () => {
  const f = await fixture(), before = JSON.stringify([...f.db]), quote = await f.gateway.readOptions('NCT', { borrowerTaskId: 'A', approvedBy: 'FAKE' });
  assert.equal(quote.ok, true); assert.equal(quote.options[0].lenderSourceId, 'B'); assert.equal(quote.options[0].maximumQuantity, 100);
  assert.equal(JSON.stringify([...f.db]), before); f.request.input.expectedRevision = quote.expectedRevision;
  let result, attempts = 0; do { result = await f.gateway.save('NCT', f.request); assert.ok(attempts++ < 40); } while (result.pending);
  assert.equal(result.stockGeneration, 1); assert.equal((await f.gateway.save('NCT', f.request)).stockGeneration, 1);
  const relations = [...f.db.values()].filter(r => r.action === 'STOCK_TRANSFER_CURRENT'); assert.equal(relations.length, 1);
  assert.equal(relations[0].details.relation.approvedBy, 'P1'); assert.equal(relations[0].details.relation.quantity, 30);
  assert.equal([...f.db.values()].find(r => r.onHand !== undefined && r.lifecycleVersion === 2).onHand, 100);
  assert.deepEqual(copy(f.context.tasks.map(t => t.po)), ['PO-A','PO-B']);
});

test('foreign/unsupported browser route cannot reach authority; Warehouse or forged staff cannot quote or approve', async () => {
  const f = await fixture(); await assert.rejects(f.gateway.readOptions('GHR', { borrowerTaskId: 'A' }), /request/);
  await assert.rejects(f.gateway.save('NCT', { ...f.request, company: 'GHR' }), /company/);
  await assert.rejects(f.gateway.save('NCT', { ...f.request, operation: 'EDIT' }), /action/); assert.equal(f.calls.length, 0);
  const h = await fixture('WAREHOUSE'); await assert.rejects(h.gateway.readOptions('NCT', { borrowerTaskId: 'A' }), /authorized/);
  await assert.rejects(h.gateway.save('NCT', h.request), /authorized/); assert.equal(h.calls.length, 0);
  const g = await fixture(); g.context.tasks[0].po = ''; assert.equal((await g.gateway.readOptions('NCT', { borrowerTaskId: 'A' })).options.length, 0);
  await assert.rejects(g.gateway.save('NCT', { ...g.request, input: { ...g.request.input, approvedBy: 'FORGED' } }));
  assert.equal([...g.db.values()].some(r => r.action === 'STOCK_TRANSFER_CURRENT'), false);
});
