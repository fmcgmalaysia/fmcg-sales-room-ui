const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { createRequire } = require('node:module'), { execFileSync } = require('node:child_process'), load = require('./load-master-module.cjs');
const { createCurrentPurchaseOrderRecordSave } = require('../prototypes/stock-current-state/current-order-record-save.cjs');
const { createCurrentPurchaseTables } = require('../prototypes/stock-current-state/current-purchase-tables.cjs');
const {createCurrentOrderFileSave}=require('../prototypes/stock-current-state/current-order-file-save.cjs'),{createOrderFileFencedStore}=require('../prototypes/stock-current-state/order-file-fenced-store.cjs');
const {createPurchaseDeleteProtocol}=require('../prototypes/stock-current-state/purchase-delete-protocol.cjs'),{createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { planCollections } = require('../prototypes/stock-current-state/domain-scope.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const file = require.resolve('./stock-current-order-record-save.test.cjs');
const original = vm.runInNewContext(fs.readFileSync(file, 'utf8').replace("const test = require('node:test')", 'const test = () => {}') + ';fixture;', { require: createRequire(file), Map, Buffer });
const folder = path.join(__dirname, '../prototypes/stock-current-state'), copy = value => JSON.parse(JSON.stringify(value));
async function fixture({ company = 'NCT', saved = true, coverage = true, generated = false } = {}) {
  const f = await original(company, 'PURCHASE', saved), calls = [],fileCommands=[];let slots=0;
  const requestPurchaseDocument=async command=>{fileCommands.push(copy(command));return command.action==='ALLOCATE'?{ok:true,fileId:'Root_File_Slot_'+String(++slots).padStart(4,'0')}:{ok:true,...command,...(command.action==='TRASH'?{trashed:true}:{})};};
  const orders = company === 'NCT' ? 'NCTOrders' : 'NCTOrders1', tasks = company === 'NCT' ? 'NCTTasks' : 'NCTTasks1', journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  f.db.set(tasks + ':T', { _id: 'T', company, _version: 'T0', title: 'T', stockCounterSchema: 2, stockDispatchedCumulative: 30, stockCounterGeneration: 0, ourPoNumber: 'PO1' });
  const tables = { [orders]: [{ _id: 'O', company, _version: 'O0', title: 'O' }], [tasks]: [await f.store.read(tasks, 'T')], SharedSuppliers: [] };
  f.store.normalizeListedRow = (collection, row) => {
    assert.equal(row.company, company);
    const companyLock = collection === journal && row._id === hash(company + '/PURCHASE', 'LOCK')
      && typeof row.owner === 'string' && row.owner && typeof row.attempt === 'string' && row.attempt
      && !row.action && !row.details && !Object.hasOwn(row, 'stockCommitVersion');
    if (!companyLock) assert.ok(row._version);
    return copy(row);
  };
  const authorize = async () => { calls.push('AUTH'); return { ...f.deps.requirePurchaseStaff(f.member, [f.employee]), memberId: f.member._id }; };
  let createSave = createCurrentPurchaseOrderRecordSave, createTables = createCurrentPurchaseTables;
  let files={createCurrentOrderFileSave,createOrderFileFencedStore,createPurchaseDeleteProtocol};
  if (generated) {
    const source = fs.readFileSync(path.join(folder, 'stockCurrentCommands.js'), 'utf8');
    const api = vm.runInNewContext(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';({createCurrentPurchaseOrderRecordSave,createCurrentPurchaseTables,createCurrentOrderFileSave,createOrderFileFencedStore,createPurchaseDeleteProtocol});',
      { createHash: crypto.createHash, randomBytes: crypto.randomBytes, StockRuntimeBuffer: Buffer });
    createSave = api.createCurrentPurchaseOrderRecordSave; createTables = api.createCurrentPurchaseTables;
    files={createCurrentOrderFileSave:api.createCurrentOrderFileSave,createOrderFileFencedStore:api.createOrderFileFencedStore,createPurchaseDeleteProtocol:api.createPurchaseDeleteProtocol};
  }
  let native = fs.readFileSync(path.join(folder, 'stockCurrentPurchaseOrders.js'), 'utf8');
  if (coverage) native = native.replace('const writerCoverage = Object.freeze({});', 'const writerCoverage = Object.freeze(' + JSON.stringify(Object.fromEntries(WRITERS.map(writer => [writer, { verified: true, build: 'TEST' }]))) + ');');
  const modules = Object.assign({}, ...['purchaseOrderWorkflow.js','plannerAllocation.js','customerShipmentLedger.js','packingListOperations.js','packingListModel.js','warehousePreparation.js'].map(name => load(name)));
  const createCurrentPurchaseOrders = vm.runInNewContext(native.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';createCurrentPurchaseOrders;', {
    ...modules,...files,requestPurchaseDocument, items: {}, currentMember: { getMember: async () => f.member }, getPurchaseStaffContext: authorize,
    requirePurchaseStaff: f.deps.requirePurchaseStaff, PURCHASE_CURRENT_PROJECTION_VERSION: 2,
    projectPurchaseWorkspace: args => { calls.push('ORIGINAL_CONTEXT'); assert.equal(args.company, company); assert.equal(args.staff.memberId, 'M'); return { ...copy(f.context), staff: args.staff }; },
    // Projection mathematics has its independent actual-projector/borrow/split
    // integration suite. This fixture isolates the new original web/root wiring.
    readCurrentPurchaseProjection: async args => {
      calls.push('CURRENT_PROJECTION'); assert.equal(args.currentProjectionVersion, 2); assert.equal(args.control.mode, 'ACTIVE');
      assert.ok(args.originalArguments.orders.length); assert.deepEqual(copy(await args.readCurrentTaskRows(company, ['T'])), copy([await f.store.read(tasks, 'T')]));
      return { workspace: { ...copy(f.context), staff: args.staff, stockAllocationView: 'CURRENT_V2' } };
    },
    fulfilmentStore: { read: async (collection, id) => { calls.push('CONTROL'); const row = await f.store.read(collection, id); return row ? { ...row, stockCommitVersion: row._version } : null; },
      all: async collection => { calls.push(collection); if (collection === 'StaffMasterAccess') return [f.employee];
        if (Object.hasOwn(tables, collection)) return copy(tables[collection]);
        if ([journal, 'PurchaseOrders'].includes(collection)) return [...f.db].filter(([key]) => key.startsWith(collection + ':')).map(([, row]) => copy(row));
        throw Error('Unexpected root table'); } }, operationId: hash, planCollections, createCurrentPurchaseOrderRecordSave: createSave, createCurrentPurchaseTables: createTables,
    createSdkConditionalStore: config => { assert.equal(config.company, company); assert.deepEqual(copy(config.dateTimeFields), { [journal]: ['activityTime'],
      [orders]: ['estimatedShipmentDate','masterReceivedTime','salesSubmissionTime'], [tasks]: ['lastCostCaptureTime'] }); return f.store; },
    createSegmentedFencedProof: config => config.store===f.store?f.protocol:createSegmentedFencedProof({...config,stepsPerInvocation:1})
  });
  let privateError;
  const web = fs.readFileSync(path.join(folder, 'purchaseOrders.web.candidate.js'), 'utf8');
  const api = vm.runInNewContext(web.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';({getPurchaseOrders,savePurchaseOrder});', {
    createCurrentPurchaseOrders: async selected => { const current = await createCurrentPurchaseOrders(selected); return current.save ? { ...current, save: async request => { try { return await current.save(request); } catch (error) { privateError = error; throw error; } } } : current; },
    webMethod: (_, fn) => fn, Permissions: { SiteMember: 'SITE' }, wixData: {},
    getPurchaseStaffContext: authorize, PURCHASE_COLLECTIONS: { [company]: { orders, tasks, activity: journal } }, projectPurchaseWorkspace: () => { throw Error('Legacy projection'); },
    PURCHASE_DOCUMENT_TYPES: ['PO','PI','DO','INV','CN'], requestPurchaseDocument: () => { throw Error('No file operations in this candidate'); },
    createPurchaseOrderOperations: () => ({ list: async () => { calls.push('LEGACY_LIST'); return []; }, save: async () => { calls.push('LEGACY_SAVE'); return { ok: true }; } }),
    readCustomerShortNames: async () => [{ customerId: 'C', shortName: 'SHORT' }]
  });
  const metadata = { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0, stockIdentity: { staffId: 'P', memberId: 'M' } };
  const send = (input = f.request.input, meta = metadata,requestId=f.request.requestId) => api.savePurchaseOrder(company,requestId,input,meta);
  async function finish(input=f.request.input,meta=metadata,requestId=f.request.requestId) { for (let i = 0; i < 20; i++) { const result = await send(input,meta,requestId); if (!result.pending) { assert.equal(result.ok, true, privateError?.stack || result.error); return result; } } throw Error('Still pending'); }
  return { ...f, api, send, finish, metadata, createCurrentPurchaseOrders, calls, tables, tasks, orders, journal,fileCommands,
    control: () => f.db.get(journal + ':' + f.protocol.ids.controlId) };
}

test('original PO web/private root reproducible; original Purchase auth precedes all control/stock reads', async () => {
  assert.match(execFileSync(process.execPath, [path.join(folder, 'build-current-purchase-orders.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const f = await fixture(); f.employee.departments = ['WAREHOUSE'];
  await assert.rejects(f.api.getPurchaseOrders('NCT')); await assert.rejects(f.send());
  assert.deepEqual(f.calls, ['AUTH','AUTH']);
});

test('both original companies preserve original PO documents/read flags/audit and counters through current web/save/default root/generated runtime', async () => {
  for (const company of ['NCT', 'GHR']) {
    const f = await fixture({ company, generated: true }), before = JSON.stringify([...f.db].filter(([key]) => /^(Stock|NCTTasks|NCTOrders)/.test(key)));
    const listed = await f.api.getPurchaseOrders(company), row = listed.orders[0];
    assert.equal(row.customerName, 'SHORT'); assert.equal(row.documents.length, 2); assert.equal(typeof row.documents[0].deleteAllowed, 'boolean');
    assert.equal(listed.documentDeletionConnected, true); assert.equal(listed.paymentRequestsConnected, true);
    assert.deepEqual(copy(listed.stockCurrent), f.metadata);
    f.request.input.version = row.version;
    const result = await f.finish(); assert.equal(result.stockGeneration, 1); assert.equal(result.company, company);
    const saved = f.db.get('PurchaseOrders:' + result.poId); assert.equal(saved.details.termDays, 30); assert.equal(saved.details.audit.length, 1);
    assert.equal(saved.details.audit[0].actorStaffId, 'P'); assert.equal(saved.details.documents.length, 2);
    assert.deepEqual(copy(await f.send()), copy(result));
    assert.equal(JSON.stringify([...f.db].filter(([key]) => /^(Stock|NCTTasks|NCTOrders)/.test(key))), before);
    assert.equal(f.calls.includes('LEGACY_SAVE'), false); assert.equal(f.calls.includes('LEGACY_LIST'), false);
    const next = await f.api.getPurchaseOrders(company); assert.equal(next.stockCurrent.stockGeneration, 1); assert.equal(next.orders[0].termDays, 30);
    assert.ok(f.calls.includes('CURRENT_PROJECTION'));
  }
});

test('missing metadata/coverage, stale version, wrong identity, closed modes and invalid file actions do not call old save', async () => {
  const f = await fixture(); for (const mode of ['MAINTENANCE','SHADOW']) { f.control().mode = mode; assert.equal((await f.send()).ok, false); await assert.rejects(f.api.getPurchaseOrders('NCT')); }
  f.control().mode = 'ACTIVE'; assert.equal((await f.send(f.request.input, null)).ok, false);
  assert.equal((await f.send(f.request.input, { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0 })).ok, false);
  assert.equal((await f.send(f.request.input, { ...f.metadata, stockIdentity: { staffId: 'OTHER', memberId: 'M' } })).ok, false);
  for (const action of ['DOCUMENT','DELETE_DOCUMENT','CHASE']) assert.equal((await f.send({ ...f.request.input, action })).ok, false);
  assert.equal((await f.send({ ...f.request.input, version: 'OLD' })).ok, false);
  assert.equal(f.calls.includes('LEGACY_SAVE'), false); assert.equal(f.db.get('PurchaseOrders:' + f.request.input.id).details.audit.length, 0);
  const g = await fixture({ coverage: false }); assert.equal((await g.send()).ok, false); await assert.rejects(g.api.getPurchaseOrders('NCT'), /co-writers/);
  assert.equal(g.calls.includes('CURRENT_PROJECTION'), false);
});

test('shared PO APPLY interruption retains same request and original versions/audit until confirmed; revoked replay refuses', async () => {
  const f = await fixture(); f.interrupt(); let stopped = false;
  for (let i = 0; i < 10; i++) { const result = await f.send(); if (!result.pending) { assert.equal(result.ok, false); stopped = true; break; } }
  assert.equal(stopped, true); assert.ok(f.control().pending); await assert.rejects(f.api.getPurchaseOrders('NCT'), /pending/);
  const result = await f.finish(); assert.equal(result.ok, true); assert.equal(f.db.get('PurchaseOrders:' + result.poId).details.audit.length, 1);
  f.member.status = 'PENDING'; await assert.rejects(f.send());
});

test('original new metadata record inserted once, pending-deletion policy kept and explicit LEGACY is the only old path', async () => {
  const f = await fixture({ saved: false }), listed = await f.api.getPurchaseOrders('NCT'); f.request.input.version = listed.orders[0].version;
  const result = await f.finish(); assert.equal([...f.db.keys()].filter(key => key.startsWith('PurchaseOrders:')).length, 1);
  assert.deepEqual(copy(await f.send()), copy(result));
  const g = await fixture(); g.db.get('PurchaseOrders:' + g.request.input.id).details.documentDeletion = { requestId: 'ORIGINAL' };
  const listedG = await g.api.getPurchaseOrders('NCT'); g.request.input.version = listedG.orders[0].version;
  assert.equal((await g.send()).ok, false); assert.equal(g.db.get('PurchaseOrders:' + g.request.input.id).details.documentDeletion.requestId, 'ORIGINAL');
  g.control().mode = 'LEGACY'; assert.equal((await g.send()).ok, false);
  assert.equal((await g.api.savePurchaseOrder('NCT', g.request.requestId, g.request.input)).ok, true);
  assert.equal(g.calls.filter(call => call === 'LEGACY_SAVE').length, 1); assert.deepEqual(copy((await g.api.getPurchaseOrders('NCT')).orders), []);
});

test('actual original Purchase web/private root routes PDF above non-file cap and original staged deletion with no legacy or stock mutation',async()=>{
 for(const company of ['NCT','GHR']){
  const f=await fixture({company,generated:true}),listed=await f.api.getPurchaseOrders(company),before=JSON.stringify([...f.db].filter(([key])=>/^(Stock|NCTTasks|NCTOrders)/.test(key)));
  const input={id:listed.orders[0].id,version:listed.orders[0].version,action:'DOCUMENT',type:'PI',date:'2026-10-22',number:'PI-NEW',reason:'Original supplier file',base64:Buffer.from('%PDF-1.4\n'+'X'.repeat(210000)).toString('base64')};
  const upload=await f.finish(input,listed.stockCurrent);assert.equal(upload.stockGeneration,1);assert.equal(f.fileCommands.filter(command=>command.action==='ALLOCATE').length,1);
  const fresh=await f.api.getPurchaseOrders(company),row=fresh.orders[0],doc=row.documents.find(doc=>doc.number==='PI-NEW');assert.ok(doc);assert.equal(doc.deleteAllowed,true);
  const deletion={id:row.id,version:row.version,action:'DELETE_DOCUMENT',fileId:doc.fileId,reason:'Supplier replaced file'},requestId='22222222-2222-4222-8222-222222222222';
  const done=await f.finish(deletion,fresh.stockCurrent,requestId);assert.equal(done.stockGeneration,2);assert.equal(f.fileCommands.filter(command=>command.action==='TRASH').length,1);
  assert.equal((await f.send(deletion,fresh.stockCurrent,requestId)).stockGeneration,2);assert.equal(f.fileCommands.filter(command=>command.action==='TRASH').length,1);
  const record=f.db.get('PurchaseOrders:'+row.id);assert.equal(record.details.audit.length,2);assert.equal(record.details.documentDeletion,null);assert.equal(record.details.documents.find(doc=>doc.number==='PI-NEW').deletion.state,'DELETED');
  assert.equal(JSON.stringify([...f.db].filter(([key])=>/^(Stock|NCTTasks|NCTOrders)/.test(key))),before);assert.equal(f.calls.some(call=>call.startsWith('LEGACY_')),false);
 }
});
