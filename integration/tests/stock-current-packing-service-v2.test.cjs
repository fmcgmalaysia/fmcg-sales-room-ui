const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createCurrentPackingService } = require('../prototypes/stock-current-state/current-packing-service.cjs');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { projectPackingWorkroom } = require('./load-master-module.cjs')('packingListOperations.js');
const filename = require.resolve('./stock-current-packing-preparation.test.cjs');
const baseFixture = vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace("const test = require('node:test')", 'const test = () => {}') + '\nfixture;', { require: createRequire(filename), Map });
const copy = value => JSON.parse(JSON.stringify(value));
async function fixture() {
  const f = baseFixture();
  for (const [key, row] of f.db) {
    if (key.startsWith('StockProducts:')) Object.assign(row, { lifecycleVersion: 2, nextBorrowSequence: 1 });
    if (key.startsWith('StockPositions:')) row.borrowRepaidCumulative = 0;
    if (key.startsWith('StockClaims:')) row.dispatchedCumulative = 0;
  }
  const store = { read: f.deps.store.read, insert: async (c, row) => { if (f.db.has(c + ':' + row._id)) throw Error('Duplicate'); f.db.set(c + ':' + row._id, copy(row)); return copy(row); },
    compareAndSet: async (c, id, version, row) => { if (f.db.get(c + ':' + id)?._version !== version) throw Error('Conflict'); f.db.set(c + ':' + id, copy(row)); return copy(row); },
    compareAndRemove: async (c, id, attempt) => { if (f.db.get(c + ':' + id)?.attempt !== attempt) throw Error('Attempt'); f.db.delete(c + ':' + id); } };
  const protocol = createSegmentedFencedProof({ store, stepsPerInvocation: 100 }); await protocol.initialize();
  Object.assign(f.db.get('NCTActivity:' + protocol.ids.controlId), { mode: 'ACTIVE', schemaVersion: 1, transferIndexVersion: 2, writerBuild: 'TEST' });
  const items = { query: c => { const filters = []; let limit; const q = { eq: (key, value) => { filters.push(row => row[key] === value); return q; },
    gt: (key, value) => { filters.push(row => row[key] > value); return q; }, ascending: () => q, limit: n => { limit = n; return q; }, find: async () => {
      const rows = [...f.db.entries()].filter(([key, row]) => key.startsWith(c + ':') && filters.every(fn => fn(row))).map(([, row]) => copy(row)).sort((a, b) => a._id.localeCompare(b._id));
      return { items: rows.slice(0, limit), totalCount: rows.length }; } }; return q; } };
  const deps = { ...f.deps, items, projectPackingWorkroom, readCurrentTaskRows: async (_company, ids) => ids.map(id => ({ _id: id, company: 'NCT', _version: 'T0',
    description: 'O', imageAltText: 'L', stockCounterSchema: 2, stockDispatchedCumulative: 0, stockCounterGeneration: 0 })) };
  const service = createCurrentPackingService({ company: 'NCT', store, items: deps.items, protocol, authorityDependencies: deps,
    coverage: Object.fromEntries(WRITERS.map(name => [name, { verified: true, build: 'TEST' }])) });
  return { ...f, deps, store, protocol, service };
}
test('Support sends and Warehouse accepts the same current packing task without touching physical balances', async () => {
  const f = await fixture(), beforePhysical = [...f.db.entries()].filter(([key]) => key.startsWith('StockPositions:')).map(([, row]) => JSON.stringify(row));
  const read = await f.service.read({ department: 'SUPPORT' }); assert.equal(read.tasks[0].ready, 50);
  assert.equal(read.stockCurrent.stockGeneration, 0);
  assert.equal(read.staff.staffId,'S');assert.equal(read.staff.memberId,'M');assert.equal(read.department,'SUPPORT');
  const request = { department: 'SUPPORT', requestId: f.request.requestId, stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0,
    input: { action: 'SEND', id: 'LIST', revision: 'REV0', version: read.version } };
  assert.equal((await f.service.save(request)).stockGeneration, 1); await f.service.save(request);
  const outgoing = await f.service.read({ department: 'WAREHOUSE' }); assert.equal(outgoing.lists[0].status, 'SENT');
  assert.equal(outgoing.lists[0].lines[0].quantity, 50); assert.equal(outgoing.stockCurrent.stockGeneration, 1);
  assert.equal(outgoing.tasks.length, 0, 'original Warehouse visibility excludes Support draft task pool');
  const started = await f.service.save({ department: 'WAREHOUSE', requestId: '22222222-1111-4111-8111-111111111111',
    stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 1,
    input: { action: 'START', id: 'LIST', revision: outgoing.lists[0].revision, version: outgoing.version } });
  assert.equal(started.id, 'LIST'); assert.equal(started.stockGeneration, 2);
  assert.equal((await f.service.read({ department: 'WAREHOUSE' })).lists[0].status, 'PROCESSING');
  assert.deepEqual([...f.db.entries()].filter(([key]) => key.startsWith('StockPositions:')).map(([, row]) => JSON.stringify(row)), beforePhysical);
  assert.equal([...f.db.values()].find(row => row.action === 'SUPPORT_PACKING_LIST_CURRENT').details.list.invoiceId, undefined);
});
test('packing expected staff/member is bound to immutable request, not just the authenticated member',async()=>{
 const f=await fixture(),read=await f.service.read({department:'SUPPORT'}),request={department:'SUPPORT',requestId:f.request.requestId,stockProtocol:1,stockBuild:'TEST',stockGeneration:0,
  stockIdentity:{staffId:'S',memberId:'M'},input:{action:'SEND',id:'LIST',revision:'REV0',version:read.version}};
 assert.equal((await f.service.save(request)).ok,true);
 f.deps.readStaffRecords=async()=>[{title:'S2',description:'M',staffEmail:'support@example.test',staffName:'Replacement',staffStatus:'ACTIVE',departments:['SUPPORT','WAREHOUSE']}];
 await assert.rejects(f.service.save(request),/identity/);
 await assert.rejects(f.service.save({...request,stockIdentity:{staffId:'S2',memberId:'M'}}),/identity/);
 assert.equal((await f.protocol.readControl()).generation,1);
});
test('wrong department, file operations and missing current checkpoints cannot invoke legacy packing writer', async () => {
  const f = await fixture(); await assert.rejects(f.service.read({ department: 'PURCHASE' }), /department/);
  assert.equal((await f.service.read({ department: 'WAREHOUSE' })).lists.length, 0, 'unsent Support DRAFT must stay invisible');
  const read = await f.service.read({ department: 'SUPPORT' });
  await assert.rejects(f.service.save({ department: 'SUPPORT', requestId: f.request.requestId, stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0,
    input: { action: 'PHOTOS', id: 'LIST', revision: 'REV0', version: read.version } }), /non-photo/);
  assert.equal((await f.protocol.readControl()).generation, 0);
  for (const [key] of f.db) if (key.startsWith('StockProducts:')) f.db.delete(key);
  await assert.rejects(f.service.read({ department: 'SUPPORT' }), /checkpoint missing/);
});
