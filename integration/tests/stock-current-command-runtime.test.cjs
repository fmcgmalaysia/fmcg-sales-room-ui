const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const folder = path.join(__dirname, '../prototypes/stock-current-state');
function runtime() {
  const source = fs.readFileSync(path.join(folder, 'stockCurrentCommands.js'), 'utf8');
  return vm.runInNewContext('(function(){' + source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '')
    + '\nreturn {createCurrentStockSave,createCurrentWarehouseReceiptSave,createCurrentBorrowingSave,createCurrentAllocationSave,createCurrentPurchaseSave,createCurrentPurchaseReorderSave,createCurrentPurchaseTables,createCurrentPurchaseTaskGateway,createCurrentPurchaseSaveRouter,createCurrentQuantityCaseSave,createCurrentShortageSave,createCurrentStockExceptionSave,createCurrentStockResolutionSave,createCurrentCostReferenceSave,createCurrentPurchaseOrderRecordSave,createCurrentAccountOrderRecordSave,createSdkConditionalStore,createFencedProof,createSegmentedFencedProof,planCollections,createPurchaseTransferWorkspace,createBorrowCurrentQuery,createPurchaseBorrowOptions,createCurrentPurchaseBorrowGateway,createCurrentPackingService,projectCurrentWarehouseReady,createCurrentSalesDemandSave,createCurrentSalesRead,createCurrentSalesShipmentSave,createCurrentSalesArrangementSave,createCurrentWarehouseDispatchSave,createCurrentWarehouseShipmentRead,dispatchCurrentSalesGateway};})()',
  { createHash: crypto.createHash, randomBytes: crypto.randomBytes, Buffer });
}
test('Wix-compatible command runtime is exact scoped source, without second protocol or public route', () => {
  assert.match(execFileSync(process.execPath, [path.join(folder, 'build-current-command-runtime.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const source = fs.readFileSync(path.join(folder, 'stockCurrentCommands.js'), 'utf8'), api = runtime();
  assert.equal(Object.keys(api).length, 33); assert.equal(/require\(|webMethod\(|Permissions\.|from ['"]wix-auth|from ['"]@wix\/data/.test(source), false);
  assert.equal(source.includes('function createCommitProof'), false); assert.equal(source.includes('function createFencedProof'), true);
  assert.deepEqual([...api.planCollections('NCT')], ['NCTActivity', 'StockPositions', 'StockClaims', 'StockProducts']);
  for (const name of ['createCurrentStockSave', 'createCurrentWarehouseReceiptSave', 'createCurrentBorrowingSave', 'createSdkConditionalStore']) assert.throws(() => api[name]({}), /required|scope/);
});

test('generated SDK store accepts an exact cross-realm schema and preserves typed Date write', async () => {
  const api = runtime(), stamp = '2026-10-22T01:23:45.678Z';
  let stored;
  const items = { query: () => { throw Error('Not used'); }, patch: () => { throw Error('Not used'); }, remove: () => { throw Error('Not used'); },
    insert: async (collection, row) => {
      assert.equal(collection, 'NCTActivity');
      assert.equal(Object.prototype.toString.call(row.activityTime), '[object Date]'); stored = row; return row;
    } };
  const store = api.createSdkConditionalStore({ items, company: 'NCT', collections: ['NCTActivity'], dateTimeFields: { NCTActivity: ['activityTime'] } });
  const result = await store.insert('NCTActivity', { _id: 'D', company: 'NCT', activityTime: stamp });
  assert.equal(stored.activityTime.toISOString(), stamp); assert.equal(result.activityTime, stamp);
});

test('new current Purchase read and original margin co-writer exports are executable private capabilities, not public routes',async()=>{
  const source=fs.readFileSync(path.join(folder,'stockCurrentCommands.js'),'utf8');
  const api=vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')
    +'\nreturn {readCurrentPurchaseProjection,createCurrentMarginReferenceSave,createCurrentWarehousePreparationSave,createCurrentWarehouseCbmSave,createPackingPhotoFencedStore};})()',
    {createHash:crypto.createHash,randomBytes:crypto.randomBytes,Buffer});
  assert.throws(()=>api.createCurrentMarginReferenceSave({}),/dependencies/);
  assert.throws(()=>api.createCurrentWarehousePreparationSave({}),/dependencies/);
  assert.throws(()=>api.createCurrentWarehouseCbmSave({}),/dependencies/);
  assert.throws(()=>api.createPackingPhotoFencedStore({}),/dependencies/);
  await assert.rejects(api.readCurrentPurchaseProjection({}),/snapshot/);
  assert.equal([...source.matchAll(/^export const /gm)].length,45);
});
for (const protocolName of ['createFencedProof', 'createSegmentedFencedProof']) test(`generated ${protocolName} coordinator replays once, reauthorizes and cannot bypass default writer coverage`, async () => {
  const api = runtime(), rows = new Map(), copy = x => JSON.parse(JSON.stringify(x)); let prepared = 0, authorized = 0;
  const store = { read: async (c, id) => copy(rows.get(c + ':' + id) || null), insert: async (c, row) => {
    if (rows.has(c + ':' + row._id)) throw Error('Duplicate'); rows.set(c + ':' + row._id, copy(row)); return copy(row);
  }, compareAndSet: async (c, id, version, row) => { if (rows.get(c + ':' + id)?._version !== version) throw Error('Conflict'); rows.set(c + ':' + id, copy(row)); return copy(row); },
  compareAndRemove: async (c, id, attempt) => { if (rows.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong attempt'); rows.delete(c + ':' + id); } };
  const protocol = api[protocolName]({ store }); await protocol.initialize();
  const control = rows.get(protocol.ids.journal + ':' + protocol.ids.controlId); Object.assign(control, { mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST' });
  const coverage = Object.fromEntries(require('../prototypes/stock-current-state/stock-admission.cjs').WRITERS.map(name => [name, { verified: true, build: 'TEST' }]));
  const deps = { company: 'NCT', writer: 'RECEIPT', protocol, coverage, authenticate: async () => { authorized++; return { memberId: 'M' }; }, prepare: async () => {
    prepared++; return { memberId: 'M', generation: 0, plan: { writes: [{ collection: 'StockProducts', before: null, after: { _id: 'P', company: 'NCT', onHand: 20 } }] } }; } };
  const save = api.createCurrentStockSave(deps), request = { requestId: '11111111-1111-4111-8111-111111111111', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0, input: { accepted: 20 } };
  assert.equal((await save(request)).stockGeneration, 1); assert.equal((await save(request)).stockGeneration, 1);
  assert.equal(prepared, 1); assert.equal(authorized, 2); assert.equal(rows.get('StockProducts:P').onHand, 20);
  delete deps.coverage;
  await assert.rejects(api.createCurrentStockSave(deps)({ ...request, requestId: '22222222-1111-4111-8111-111111111111', stockGeneration: 1 }), /coverage incomplete/);
  assert.equal(prepared, 1);
});
