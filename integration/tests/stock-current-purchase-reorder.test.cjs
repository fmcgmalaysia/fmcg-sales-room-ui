const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module'), { execFileSync } = require('node:child_process');
const load = require('./load-master-module.cjs');
const { createCurrentPurchaseReorderSave } = require('../prototypes/stock-current-state/current-purchase-reorder-save.cjs');
const folder = path.join(__dirname,'../prototypes/stock-current-state'), copy = x => JSON.parse(JSON.stringify(x));
const displaySource = fs.readFileSync(path.join(folder,'purchaseDisplayOrder.candidate.js'),'utf8');
const display = vm.runInNewContext('(function(){'+displaySource.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+
  '\nreturn {projectPurchaseDisplayOrder,preparePurchaseDisplayOrder,purchaseRowKey};})()', { operationId: load('purchaseOperationJournal.js').operationId });
const cache = { 'purchaseDisplayOrder.js': display }, { projectPurchaseWorkspace } = load('purchaseProjection.js',cache);
const { createPurchaseOperations } = load('purchaseOperations.js',cache);
const fixtureFile = require.resolve('./stock-current-purchase-save-v2.test.cjs');
const originalFixture = vm.runInNewContext(fs.readFileSync(fixtureFile,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';fixture;',
  { require: createRequire(fixtureFile),Map,Buffer });
async function fixture() {
  const f = await originalFixture();
  for (const [key,row] of f.db) if (key.startsWith('NCTTasks/')) Object.assign(row,{ company: 'NCT', _version: row._version || 'T0' });
  const deps = { ...f.deps, createPurchaseOperations };
  const workspace = async () => { const tables = await deps.readTables('NCT',{memberId:'M'}); return { ...projectPurchaseWorkspace({ company:'NCT',staff:{},
    orders:tables.NCTOrders,tasks:tables.NCTTasks,activity:tables.NCTActivity,suppliers:tables.SharedSuppliers }),activity:tables.NCTActivity }; };
  const row = await workspace(), taskIds = [f.f.second,f.f.id];
  const request = { requestId:f.request.requestId,operation:'REORDER',stockProtocol:1,stockBuild:'TEST',stockGeneration:0,
    input:{customerId:'C',taskIds,versions:Object.fromEntries(row.tasks.map(t=>[t.id,t.editVersion])),displayRows:[...row.purchaseDisplayOrder.C.rows].reverse(),
      displayOrderVersion:row.purchaseDisplayOrder.C.version} };
  const save = createCurrentPurchaseReorderSave({company:'NCT',protocol:f.protocol,store:deps.store,coverage:f.coverage,currentDisplayOrderVersion:2,authorityDependencies:deps});
  return {...f,deps,workspace,request,save};
}
test('current display candidate preserves original identities and legacy receipt path exactly, with a narrow versioned event seam', () => {
  assert.match(execFileSync(process.execPath,[path.join(folder,'build-purchase-display-order-candidate.cjs'),'--check'],{encoding:'utf8'}),/verified/);
  const original = load('purchaseDisplayOrder.js'), tasks = [{id:'A',customerId:'C',orderId:'O',ord:50},{id:'B',customerId:'C',orderId:'O',ord:10}],
    rows = [original.purchaseRowKey('B'),original.purchaseRowKey('A')], id = 'OLD', op = load('purchaseOperationJournal.js').operationId,
    activity = [{title:id,action:'PURCHASE_OPERATION_PREPARED',details:{requestId:id,plan:{displayOrder:{customerId:'C',beforeRevision:'',rows}}}},
      {title:op(id,'RESULT'),action:'PURCHASE_OPERATION_RESULT',result:'SAVED',details:{outcome:{ok:true,company:'NCT',requestId:id}}}];
  assert.deepEqual(copy(display.projectPurchaseDisplayOrder('NCT',tasks,[],activity)),copy(original.projectPurchaseDisplayOrder('NCT',tasks,[],activity)));
  assert.throws(()=>createCurrentPurchaseReorderSave({company:'NCT',protocol:{planFormat:'SEGMENTED_V2'},currentDisplayOrderVersion:1}),/dependencies/);
});
test('whole-task reorder is fenced once and never overwrites stock counters, PO, demand or physical current records', async () => {
  const f = await fixture(), before = copy(f.f.task());
  f.f.task().stockDispatchedCumulative = 4;
  const stock = JSON.stringify([...f.db].filter(([k])=>k.startsWith('Stock'))), saved = await f.save(f.request);
  assert.equal(saved.stockGeneration,1); assert.equal(saved.operation,'REORDER'); assert.deepEqual(copy(saved.taskIds),f.request.input.taskIds);
  assert.equal(f.f.task().rowPosition,2); assert.equal(f.f.task().stockDispatchedCumulative,4);
  assert.deepEqual(copy({...f.f.task(),rowPosition:before.rowPosition,_version:before._version,stockDispatchedCumulative:before.stockDispatchedCumulative}),before);
  assert.equal(JSON.stringify([...f.db].filter(([k])=>k.startsWith('Stock'))),stock);
  assert.deepEqual(copy((await f.workspace()).purchaseDisplayOrder.C.rows),f.request.input.displayRows);
  assert.deepEqual(await f.save(f.request),saved);
  assert.equal([...f.db.values()].filter(r=>r.action==='PURCHASE_DISPLAY_ORDER_SAVED').length,1);
});
test('split shipment rows order independently with one original task, no copied demand, supplier PO or receipt', async () => {
  const f = await fixture(), {createSalesOrderAdjustmentOperations,salesAdjustmentVersion} = load('salesOrderAdjustment.js'),
    {readShipmentPlans,shipmentPlanVersion}=load('customerShipmentPlan.js');
  const adjust = createSalesOrderAdjustmentOperations({store:f.f.store,names:{NCT:{activity:'NCTActivity'}},readContext:f.workspace,readPlans:readShipmentPlans,planVersion:shipmentPlanVersion});
  await adjust({...f.f.base,requestId:'22222222-2222-4222-8222-222222222222',staff:{...f.f.base.staff,customerId:'C',canSelectShipment:true},
    input:{action:'ADJUST',customerId:'C',orderId:'ORDER',taskId:f.f.id,batchId:'',mode:'SPLIT',quantity:150,version:salesAdjustmentVersion(await f.workspace(),shipmentPlanVersion)}});
  const current = await f.workspace(), entries = current.purchaseDisplayOrder.C.rows;
  assert.equal(entries.length,3);
  f.request.input.displayRows = [entries[1],entries[2],entries[0]]; f.request.input.displayOrderVersion = current.purchaseDisplayOrder.C.version;
  f.request.input.versions = Object.fromEntries(current.tasks.map(t=>[t.id,t.editVersion]));
  const taskCount=[...f.db.keys()].filter(k=>k.startsWith('NCTTasks/')).length;
  await f.save(f.request); const after = await f.workspace();
  assert.deepEqual(copy(after.purchaseDisplayOrder.C.rows),f.request.input.displayRows);
  assert.equal([...f.db.keys()].filter(k=>k.startsWith('NCTTasks/')).length,taskCount);
  assert.equal(after.tasks.find(t=>t.id===f.f.id).requested,250); assert.equal(after.shipmentPlans[0].batches.length,2);
});
test('stale display/task versions, incomplete/foreign/duplicate rows and lost original rights refuse without ordering mutation', async () => {
  for(const variant of ['display','task','missing','duplicate','foreign','invoice','role','counter','costLock']) {
    const f=await fixture();
    if(variant==='display')f.request.input.displayOrderVersion='OLD';
    if(variant==='task')f.request.input.versions[f.f.id]='OLD';
    if(variant==='missing')f.request.input.displayRows.pop();
    if(variant==='duplicate')f.request.input.displayRows[0]=f.request.input.displayRows[1];
    if(variant==='foreign')f.request.input.customerId='OTHER';
    if(variant==='invoice')f.db.get('NCTOrders/O0').salesInvoiceNumber='INV';
    if(variant==='role')f.deps.readStaffRecords=async()=>[];
    if(variant==='counter')delete f.f.task().stockCounterSchema;
    if(variant==='costLock'){const id=f.deps.operationId('NCT',f.f.id,'COST_LOCK');f.db.set('NCTActivity/'+id,{_id:id});}
    const before=copy(f.f.task()); await assert.rejects(f.save(f.request),undefined,variant);
    assert.deepEqual(copy(f.f.task()),before);assert.equal([...f.db.values()].some(r=>r.action==='PURCHASE_DISPLAY_ORDER_SAVED'),false);
  }
});
test('interrupted reordered task images remain unconfirmed and exact same request resumes before another ordering revision', async()=>{
  const f=await fixture(), insert=f.deps.store.insert;let interrupted=false;
  f.deps.store.insert=async(c,row)=>{if(!interrupted&&row.action==='PURCHASE_DISPLAY_ORDER_SAVED'){interrupted=true;throw Error('Ordering event interruption');}return insert(c,row);};
  await assert.rejects(f.save(f.request),/Ordering event interruption/); assert.equal(f.f.task().rowPosition,2);
  await assert.rejects(f.protocol.readSnapshot(()=>f.workspace()),/pending/i);
  await f.save(f.request); const one=await f.workspace();
  f.request={...f.request,requestId:'33333333-3333-4333-8333-333333333333',stockGeneration:1,input:{...f.request.input,
    taskIds:[...f.request.input.taskIds].reverse(),displayRows:[...f.request.input.displayRows].reverse(),displayOrderVersion:one.purchaseDisplayOrder.C.version,
    versions:Object.fromEntries(one.tasks.map(t=>[t.id,t.editVersion]))}};
  await f.save(f.request); assert.deepEqual(copy((await f.workspace()).purchaseDisplayOrder.C.rows),f.request.input.displayRows);
});
test('malformed or foreign current display receipt cannot silently revert to old ordering',()=>{
  const tasks=[{id:'A',customerId:'C',orderId:'O',ord:1}],base={_id:'R',title:'R',company:'NCT',action:'PURCHASE_DISPLAY_ORDER_SAVED',result:'SAVED',
    initiatedByStaffId:'P',activityTime:'2026-10-22T00:00:00Z',details:{schema:2,displayOrder:{customerId:'C',beforeRevision:'',beforeVersion:'V',rows:[display.purchaseRowKey('A')]}}};
  for(const row of [{...base,company:'GHR'},{...base,details:{...base.details,schema:1}}, {...base,title:'OTHER'}])
    assert.throws(()=>display.projectPurchaseDisplayOrder('NCT',tasks,[],[row]),/requires review/);
});

test('existing accepted legacy display order chains into current event without duplicating its protocol root or result',async()=>{
  const f=await fixture();
  await f.f.operate({...f.f.base,requestId:'22222222-2222-4222-8222-222222222222',operation:'REORDER',input:f.request.input});
  const old=await f.workspace(),oldRevision=old.purchaseDisplayOrder.C.revision;
  assert.ok(oldRevision);const originals=copy([...f.db].filter(([,r])=>['PURCHASE_OPERATION_PREPARED','PURCHASE_OPERATION_RESULT'].includes(r.action)));
  f.request.input={...f.request.input,taskIds:[...f.request.input.taskIds].reverse(),displayRows:[...f.request.input.displayRows].reverse(),
    displayOrderVersion:old.purchaseDisplayOrder.C.version,versions:Object.fromEntries(old.tasks.map(t=>[t.id,t.editVersion]))};
  await f.save(f.request);const current=await f.workspace(),event=[...f.db.values()].find(r=>r.action==='PURCHASE_DISPLAY_ORDER_SAVED');
  assert.equal(event.details.displayOrder.beforeRevision,oldRevision);assert.equal(current.purchaseDisplayOrder.C.revision,event.title);
  assert.deepEqual(copy([...f.db].filter(([,r])=>['PURCHASE_OPERATION_PREPARED','PURCHASE_OPERATION_RESULT'].includes(r.action))),originals);
  assert.deepEqual(copy(current.purchaseDisplayOrder.C.rows),f.request.input.displayRows);
});

test('GHR display save and projection cannot change equal-ID NCT task rows or relation/stock data',async()=>{
  const f=await fixture(),db=f.db;
  for(const [key,row] of [...db])if(/^NCT(Orders|Tasks)\//.test(key)||key==='NCTActivity/R')
    db.set(key.replace(/^NCT(Orders|Tasks)\//,'NCT$11/').replace('NCTActivity/R','NCTActivity1/R'),{...copy(row),company:'GHR'});
  const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs'),
    protocol=createSegmentedFencedProof({company:'GHR',store:f.deps.store,domainWrites:true,stepsPerInvocation:100});
  await protocol.initialize();Object.assign(db.get('NCTActivity1/'+protocol.ids.controlId),{mode:'ACTIVE',schemaVersion:1,writerBuild:'TEST',transferIndexVersion:2});
  const deps={...f.deps,readTables:async company=>{assert.equal(company,'GHR');return Object.fromEntries(
    ['NCTOrders1','NCTTasks1','NCTActivity1','PurchaseOrders','SharedSuppliers'].map(c=>[c,[...db].filter(([k])=>k.startsWith(c+'/')).map(([,r])=>copy(r))]));}};
  const tables=await deps.readTables('GHR'),workspace=projectPurchaseWorkspace({company:'GHR',staff:{},orders:tables.NCTOrders1,tasks:tables.NCTTasks1,activity:tables.NCTActivity1,suppliers:tables.SharedSuppliers});
  const request={...f.request,input:{...f.request.input,displayOrderVersion:workspace.purchaseDisplayOrder.C.version}},
    nct=copy([...db].filter(([k])=>k.startsWith('NCTTasks/')||k.startsWith('Stock'))),
    save=createCurrentPurchaseReorderSave({company:'GHR',store:deps.store,protocol,coverage:f.coverage,currentDisplayOrderVersion:2,authorityDependencies:deps});
  const result=await save(request);assert.equal(result.company,'GHR');assert.equal(db.get('NCTTasks1/'+f.f.id).rowPosition,2);
  assert.deepEqual(copy([...db].filter(([k])=>k.startsWith('NCTTasks/')||k.startsWith('Stock'))),nct);
  const after=await deps.readTables('GHR');assert.deepEqual(copy(projectPurchaseWorkspace({company:'GHR',staff:{},orders:after.NCTOrders1,
    tasks:after.NCTTasks1,activity:after.NCTActivity1,suppliers:after.SharedSuppliers}).purchaseDisplayOrder.C.rows),request.input.displayRows);
});
