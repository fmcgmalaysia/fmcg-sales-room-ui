const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),load=require('./load-master-module.cjs');
const {createCurrentPurchaseTaskGateway}=require('../prototypes/stock-current-state/current-purchase-task-gateway.cjs');
const {createCurrentPurchaseTables}=require('../prototypes/stock-current-state/current-purchase-tables.cjs');
const {createSdkConditionalStore}=require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const {readCurrentPurchaseProjection}=require('../prototypes/stock-current-state/purchase-current-projection.cjs');
const {planCollections}=require('../prototypes/stock-current-state/domain-scope.cjs'),{WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),fixtureFile=require.resolve('./stock-current-purchase-reorder.test.cjs'),copy=x=>JSON.parse(JSON.stringify(x));
const original=vm.runInNewContext(fs.readFileSync(fixtureFile,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';combinedFixture;',
  {require:createRequire(fixtureFile),__dirname:path.dirname(fixtureFile),Map,Buffer});
async function root(coverage=false,paired=true,decisionFixture=null){
  const f=decisionFixture||await original(),calls=[],wrapped=[];
  for(const [key,row]of f.db)if(key.startsWith('NCTOrders/'))Object.assign(row,{company:'NCT',_version:row._version||'MIGRATED_ORDER'});
  const forbidden=()=>{throw Error('No SDK calls during listed-row normalization');},codec=createSdkConditionalStore({company:'NCT',items:{query:forbidden,insert:forbidden,patch:forbidden,remove:forbidden},
    collections:planCollections('NCT',true),dateTimeFields:{NCTActivity:['activityTime']}});
  const native={Permissions:{SiteMember:'SITE_MEMBER'},webMethod:(permission,fn)=>{wrapped.push(permission);return fn;},currentMember:{getMember:()=>f.deps.readMember()},items:f.deps.items,
    getPurchaseStaffContext:async()=>{calls.push('AUTH');const member=await f.deps.readMember();return{...f.deps.requirePurchaseStaff(member,await f.deps.readStaffRecords()),memberId:member._id};},
    fulfilmentStore:{all:async collection=>{calls.push(collection);if(collection==='StaffMasterAccess')return f.deps.readStaffRecords();
      const listed=f.f?await f.f.store.all(collection):[...f.db].filter(([key])=>key.startsWith(collection+':')).map(([,row])=>row);
      return listed.map(row=>{const raw=copy(row);if(raw._version){raw.stockCommitVersion=raw._version;delete raw._version;}
        if(raw.activityTime)raw.activityTime=new Date(raw.activityTime);raw._updatedDate=new Date('2026-10-22T00:00:00Z');return raw;});}},
    ...Object.fromEntries(['requirePurchaseStaff','projectPurchaseWorkspace','createPurchaseOperations','createPurchaseSourceOperations','taskEditVersion','operationId',
      'projectPurchaseOrders','readAllocations','readCustomerShipments','readPackingLists','packingHeld'].map(k=>[k,f.deps[k]])),
    readPreparation:load('warehousePreparation.js').readPreparation,projectPreparation:load('warehousePreparation.js').projectPreparation,
    PURCHASE_CURRENT_DISPLAY_ORDER_VERSION:paired?2:undefined,planCollections,createCurrentPurchaseTables,createCurrentPurchaseTaskGateway,
    PURCHASE_CURRENT_PROJECTION_VERSION:paired?2:undefined,readCurrentPurchaseProjection,
    projectPurchaseWorkspace:load('../prototypes/stock-current-state/purchaseProjection.candidate.js',{
      'purchaseDisplayOrder.js':load('../prototypes/stock-current-state/purchaseDisplayOrder.candidate.js')}).projectPurchaseWorkspace,
    createPurchaseMarginRefresh:load('purchaseMarginRefresh.js').createPurchaseMarginRefresh,
    readCurrentAdminFx:async currencies=>currencies.map(currency=>({currency,rateToMyr:1,updatedAt:'2026-10-22T08:30:00.000Z'})),
    createPlannerAllocationOperations:load('../prototypes/stock-current-state/plannerAllocation.candidate.js').createPlannerAllocationOperations,
    ALLOCATION_CURRENT_VIEW_VERSION:2,createShortageOperations:load('purchaseShortage.js').createShortageOperations,
    ...load('purchaseQuantityCases.js'),
    readFulfilmentContext:decisionFixture?f.deps.readContext:async()=>{throw Error('Task-only root must use original table preparation, not a second company context scan');},
    createSdkConditionalStore:args=>{assert.equal(args.company,'NCT');calls.push('SDK');return{...f.deps.store,normalizeListedRow:codec.normalizeListedRow};},
    createSegmentedFencedProof:args=>{assert.equal(args.domainWrites,true);return f.protocol||f.deps.protocol;}};
  let source=fs.readFileSync(path.join(folder,'stockCurrentBorrow.web.js'),'utf8');
  if(coverage)source=source.replace('const writerCoverage = Object.freeze({});','const writerCoverage = Object.freeze('+JSON.stringify(Object.fromEntries(WRITERS.map(w=>[w,{verified:true,build:'TEST'}])))+');');
  const api=vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return {savePurchaseTasksCurrent};})()',native);
  return{...f,calls,wrapped,api};
}
test('actual-import task root uses original auth/table reader and same paired current save, never legacy apply',async()=>{
  const f=await root(true,true),result=await f.api.savePurchaseTasksCurrent('NCT',f.request);
  assert.equal(result.ok,true);assert.equal(result.operation,'EDIT');assert.equal(result.stockGeneration,1);assert.equal(f.calls[0],'AUTH');
  assert.equal(f.f.task().lpCtn,20);assert.equal(f.f.task().rowPosition,2);
  assert.deepEqual(await f.api.savePurchaseTasksCurrent('NCT',f.request),result);
  assert.equal([...f.db.values()].filter(r=>r.action==='PURCHASE_DISPLAY_ORDER_SAVED').length,1);
  assert.equal([...f.db.values()].filter(r=>r.action==='PURCHASE_PRICE_SAVED').length,1);
  assert.equal(f.wrapped.length,5);assert.ok(f.wrapped.every(x=>x==='SITE_MEMBER'));
});
test('default root coverage and unpaired original calculator cannot enter business table preparation',async()=>{
  for(const [coverage,paired]of[[false,true],[true,false]]){
    const f=await root(coverage,paired),before=copy(f.f.task()),result=await f.api.savePurchaseTasksCurrent('NCT',f.request);
    assert.equal(result.ok,false);assert.equal(result.requestId,f.request.requestId);assert.deepEqual(copy(f.f.task()),before);
    assert.equal(f.calls.includes('NCTTasks'),false);assert.equal([...f.db.values()].some(r=>r.action==='PURCHASE_PRICE_SAVED'),false);
  }
});
test('invalid envelope, unsupported command, original role failure and foreign company cannot fall back to old task writes',async()=>{
  for(const variant of ['uuid','size','operation','member','company']){
    const f=await root(true);let company='NCT',request=copy(f.request);
    if(variant==='uuid')request.requestId='INVALID';if(variant==='size')request.input.reason='X'.repeat(200001);
    if(variant==='operation')request.operation='SPECIAL';if(variant==='member')f.deps.readMember=async()=>({_id:'M',status:'PENDING'});
    if(variant==='company')company='OTHER';const before=copy(f.f.task());assert.equal((await f.api.savePurchaseTasksCurrent(company,request)).ok,false);
    assert.deepEqual(copy(f.f.task()),before);assert.equal(f.calls.includes('NCTTasks'),false);
  }
});
test('actual-import root routes independent REORDER through paired original display calculator and real current receipt',async()=>{
 const f=await root(true);const request={...f.request,operation:'REORDER'};delete request.input.edits;
 const result=await f.api.savePurchaseTasksCurrent('NCT',request);assert.equal(result.ok,true);assert.equal(result.operation,'REORDER');
 assert.equal(f.f.task().rowPosition,2);assert.equal(f.f.task().lpCtn,16);
 assert.deepEqual(await f.api.savePurchaseTasksCurrent('NCT',request),result);
 assert.equal([...f.db.values()].filter(r=>r.action==='PURCHASE_DISPLAY_ORDER_SAVED').length,1);
});

test('actual-import task root composes ORIGINAL GP refresh with authenticated CURRENT projection and same-request receipt',async()=>{
  const f=await root(true),request={...f.request,operation:'MARGIN_REFRESH',input:{taskId:f.f.id}},before=JSON.stringify(f.f.task());
  let result,attempts=0;do{result=await f.api.savePurchaseTasksCurrent('NCT',request);assert.ok(attempts++<30);}while(result.pending);
  assert.equal(result.ok,true);assert.equal(result.marginReceipt.taskId,f.f.id);assert.equal(result.stockGeneration,1);
  assert.equal(JSON.stringify(f.f.task()),before,'reference refresh must not change procurement, receipt or current task counters');
  assert.deepEqual(await f.api.savePurchaseTasksCurrent('NCT',request),result);
  assert.equal([...f.db.values()].filter(row=>row.action==='MARGIN_REFERENCE_RESULT').length,1);
  assert.equal(f.calls[0],'AUTH');assert.equal(JSON.stringify(result).includes('sellingPrice'),false);
});

test('current margin root refuses empty coverage or unpaired projection without legacy workspace/cache side effects',async()=>{
  for(const[coverage,paired]of[[false,true],[true,false]]){
    const f=await root(coverage,paired),request={...f.request,operation:'MARGIN_REFRESH',input:{taskId:f.f.id}};
    const result=await f.api.savePurchaseTasksCurrent('NCT',request);assert.equal(result.ok,false);
    assert.equal([...f.db.values()].some(row=>row.action==='GP_RECALCULATED'||row.action==='MARGIN_REFERENCE_RESULT'),false);
    assert.equal(f.calls.includes('NCTOrders'),false);
  }
});
for(const operation of ['QUANTITY_CASE','SHORTAGE'])test(`actual-import root routes original ${operation} decision without releasing physical reservations or borrowing debt`,async()=>{
  const filename=require.resolve(operation==='QUANTITY_CASE'?'./stock-current-quantity-case.test.cjs':'./stock-current-shortage-save.test.cjs'),
    name=operation==='QUANTITY_CASE'?'currentFixture':'fixture',
    build=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';'+name+';',
      {require:createRequire(filename),Map,Buffer}),f=await build(true);
  for(const task of f.context.tasks)f.db.set('NCTTasks:'+task.id,{_id:task.id,title:task.id,company:'NCT',_version:'TASK0',description:task.orderId,imageAltText:task.sourceLineId,
    stockCounterSchema:2,stockCounterGeneration:0,stockDispatchedCumulative:0});
  const api=await root(true,true,f),request={...(operation==='QUANTITY_CASE'?f.request('RECEIPT'):f.request),operation},
    balances=JSON.stringify([...f.db].filter(([key,row])=>key.startsWith('StockPositions:')||key.startsWith('StockClaims:')||row.action==='STOCK_TRANSFER_CURRENT'));
  let result,attempts=0;do{result=await api.api.savePurchaseTasksCurrent('NCT',request);assert.ok(attempts++<20);}while(result.pending);
  assert.equal(result.ok,true);assert.equal(result.stockGeneration,1);assert.equal(JSON.stringify([...f.db].filter(([key,row])=>key.startsWith('StockPositions:')||key.startsWith('StockClaims:')||row.action==='STOCK_TRANSFER_CURRENT')),balances);
  assert.deepEqual(await api.api.savePurchaseTasksCurrent('NCT',request),result);
  assert.equal(api.calls[0],'AUTH');assert.equal(api.calls.includes('NCTOrders'),false);
});
