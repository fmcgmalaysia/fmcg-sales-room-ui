const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),load=require('./load-master-module.cjs');
const {readCurrentPurchaseProjection,prepareCurrentPurchaseProjection}=require('../prototypes/stock-current-state/purchase-current-projection.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value));
const paired=load('../prototypes/stock-current-state/purchaseProjection.candidate.js');
const filename=require.resolve('./stock-current-borrow-gateway.test.cjs');
const original=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';fixture;',
  {require:createRequire(filename),Map,Buffer});
async function fixture(){
  const f=await original(),staff={staffId:'P1',memberId:'M1',staffName:'Purchase'};
  const originalArguments={company:'NCT',staff,suppliers:[],orders:['A','B'].map(id=>({title:'O-'+id,sourceLineId:'L-'+id,submissionId:'SUB-'+id,
    customerId:'C-'+id,customerCompanyName:'Customer '+id,description:'1',image:'Product',imageAltText:'24x1',orderId:24,orderQtyInCtn:100,
    sellingPricePc:999,adminFxSource:999,transactionCurrency:'MYR'})),
    tasks:['A','B'].map(id=>({title:id,description:'O-'+id,imageAltText:'L-'+id,purchaseQtyInCtn:100,ourPoNumber:'PO-'+id,
      lpPc:1,lpCtn:24,disc1:0,disc2:0,disc3:0,receivedQtyInCtn:null})),
    activity:['A','B'].map(id=>({title:'INTAKE-'+id,description:'O-'+id,action:'ORDER_RECEIVED',result:'ACCEPTED',
      details:{submissionId:'SUB-'+id,taskIds:[id]}}))};
  for(const id of ['A','B'])originalArguments.activity.push({title:'PLAN-'+id,description:'O-'+id,image:'L-'+id,imageAltText:id,
    action:'PURCHASE_PLAN_SAVED',result:'SAVED',activityTime:'2026-10-22T00:00:00.000Z',details:{beforeRevision:'',totalCtn:100,extraCtn:0}});
  originalArguments.activity.push({title:'RECEIPT-B',description:hash('NCT','PURCHASE_ORDER',['B']),action:'WAREHOUSE_RECEIPT_SAVED',result:'SAVED',activityTime:'2026-10-22T00:00:00.000Z',
    details:{beforeRevision:'',lines:[{taskId:'B',orderId:'O-B',sourceLineId:'L-B',beforeAccepted:0,beforeRejected:0,accepted:100,rejected:0,issue:false}]}},
    {title:'ALLOC-B',imageAltText:'B',action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',activityTime:'2026-10-22T00:00:00.000Z',
      details:{beforeRevision:'',targets:[{taskId:'B',quantity:100}]}});
  f.context.activity=originalArguments.activity;
  const args={...f.deps,company:'NCT',context:f.context,staff,items:f.items,store:f.store,originalArguments,
    projectPurchaseWorkspace:paired.projectPurchaseWorkspace,currentProjectionVersion:paired.PURCHASE_CURRENT_PROJECTION_VERSION};
  const read=()=>f.protocol.readSnapshot(control=>readCurrentPurchaseProjection({...args,control}));
  const borrow=async()=>{const quote=await f.gateway.readOptions('NCT',{borrowerTaskId:'A'});f.request.input.expectedRevision=quote.expectedRevision;
    let result,count=0;do{result=await f.gateway.save('NCT',f.request);assert.ok(count++<40);}while(result.pending);return result;};
  return{...f,staff,originalArguments,args,read,borrow};
}

test('paired original projector defaults to exact original behavior, redaction, source keys and locks',()=>{
  assert.match(execFileSync(process.execPath,[path.join(folder,'build-purchase-projection-candidate.cjs'),'--check'],{encoding:'utf8'}),/verified/);
  const file=require.resolve('./purchase-projection.test.cjs'),input=vm.runInNewContext(fs.readFileSync(file,'utf8')
    .replace("const test = require('node:test');",'const test = () => {};')+';fixture();',{require:createRequire(file),Promise});
  const before=load('purchaseProjection.js').projectPurchaseWorkspace(input),after=paired.projectPurchaseWorkspace(input);
  delete before.fetchedAt;delete after.fetchedAt;assert.deepEqual(copy(after),copy(before));
  assert.equal(/sellingPrice|adminFx|sourceSnapshot|secret/.test(JSON.stringify(after)),false);
});

test('same-generation current reader uses actual borrowing ownership before original Purchase calculations, not old task/receipt sums',async()=>{
  const f=await fixture();await f.borrow();
  const before=JSON.stringify([...f.db]),legacy=load('purchaseProjection.js').projectPurchaseWorkspace(f.originalArguments),result=(await f.read()).rows;
  assert.deepEqual(copy(legacy.tasks.map(row=>[row.id,row.inc])),[['A',null],['B',100]]);
  assert.deepEqual(copy(result.workspace.tasks.map(row=>[row.id,row.inc])),[['A',30],['B',70]]);
  assert.deepEqual(copy(result.workspace.tasks.map(row=>[row.id,row.stockActualReceived,row.stockHasReceipt])),[['A',0,false],['B',100,true]]);
  assert.deepEqual(copy(result.workspace.tasks.find(row=>row.id==='A').stockAllocationFacts),{usable:30,held:0,dispatched:0,availableToArrange:30,review:false});
  assert.deepEqual(copy(result.workspace.tasks.find(row=>row.id==='B').stockAllocationFacts),{usable:70,held:0,dispatched:0,availableToArrange:70,review:false});
  assert.equal(result.workspace.tasks.find(row=>row.id==='B').warehouse.accepted,100);
  assert.equal(result.workspace.tasks.find(row=>row.id==='B').warehouse.stock.availablePhysical,100);
  assert.equal(result.workspace.tasks.find(row=>row.id==='B').procurement.availableCtn,0);
  assert.equal(result.workspace.tasks.find(row=>row.id==='B').procurement.allocationEnabled,false);
  assert.equal(result.workspace.stockAllocationView,'CURRENT_V2');assert.equal(result.products.size,1);
  assert.equal(JSON.stringify([...f.db]),before,'workspace read must not mutate stock, GP or original receipts');
  assert.deepEqual(copy(result.workspace.allocations.find(row=>row.sourceTaskId==='B').targets.map(row=>[row.taskId,row.quantity])),[['A',30],['B',70]]);
  assert.equal(/sellingPrice|adminFx/.test(JSON.stringify(result.workspace)),false);
});

test('original split-row receipt metrics use current customer ownership, while PO/physical receipt remain unchanged',async()=>{
  const f=await fixture();await f.borrow();
  const {validateOriginalSales}=require('../prototypes/stock-current-state/original-sales-validation.cjs'),sales=load('salesOrderAdjustment.js'),plans=load('customerShipmentPlan.js');
  const context={...paired.projectPurchaseWorkspace(f.originalArguments),activity:f.originalArguments.activity};
  const event=await validateOriginalSales({createSalesOrderAdjustmentOperations:sales.createSalesOrderAdjustmentOperations,company:'NCT',
    staff:{...f.staff,customerId:'C-A',canSelectShipment:true},requestId:'22222222-2222-4222-8222-222222222222',context,
    readPlans:plans.readShipmentPlans,planVersion:plans.shipmentPlanVersion,now:()=>new Date('2026-10-22T08:00:00.000Z'),
    input:{action:'ADJUST',customerId:'C-A',orderId:'O-A',taskId:'A',batchId:'',mode:'SPLIT',quantity:50,version:sales.salesAdjustmentVersion(context,plans.shipmentPlanVersion)}});
  f.originalArguments.activity.push(event.event);
  const result=(await f.read()).rows.workspace,a=result.tasks.find(row=>row.id==='A');
  assert.equal(a.inc,30);assert.equal(a.po,'PO-A');assert.equal(a.requested,100);
  assert.deepEqual(copy(a.batchEntitlements.map(row=>row.metrics.received)),[30,0]);
  assert.deepEqual(copy(a.stockReceiptBatches.map(row=>row.received)),[0,0]);
  assert.equal(a.stockAllocatedCumulative,30);
  assert.deepEqual(copy(a.stockAllocatedBatches),a.batchEntitlements.map(row=>({id:row.id,demand:row.quantity,allocated:row.metrics.received})));
  assert.deepEqual(copy(a.stockBatchAllocationFacts.map(row=>[row.allocated,row.held,row.availableToArrange])),[[30,0,30],[0,0,0]]);
  assert.deepEqual(copy(a.batchEntitlements.map(row=>row.metrics.committed)),[50,50]);
  assert.equal(result.tasks.find(row=>row.id==='B').warehouse.accepted,100);
  assert.equal(f.originalArguments.tasks.length,2);assert.equal([...f.db.values()].filter(row=>row.action==='STOCK_TRANSFER_CURRENT').length,1);
});

test('missing coverage/checkpoint/counter, pending control and unpaired projector stop instead of history fallback',async()=>{
  for(const kind of ['product','counter','pending','pair']){
    const f=await fixture(),before=JSON.stringify([...f.db]);
    if(kind==='product')f.db.delete([...f.db.keys()].find(key=>key.startsWith('StockProducts:')));
    if(kind==='counter')f.args.readCurrentTaskRows=async()=>[];
    if(kind==='pending')f.db.get(f.protocol.ids.journal+':'+f.protocol.ids.controlId).pending={key:'OTHER',digest:'UNKNOWN'};
    if(kind==='pair')f.args.currentProjectionVersion=1;
    await assert.rejects(f.read(),/checkpoint|task reads|pending|snapshot/);
    if(kind==='pair')assert.equal(JSON.stringify([...f.db]),before);
  }
  const f=await fixture();assert.throws(()=>prepareCurrentPurchaseProjection({context:f.context,states:[],generation:0,readAllocations:f.deps.readAllocations}),/coverage/);
});

test('invalid current view, foreign demand identity and receipt-provenance mismatch fail closed',async()=>{
  const f=await fixture(),base={schema:'PURCHASE_CURRENT_PROJECTION_V2',company:'NCT',generation:0,taskReceived:[{taskId:'A',quantity:30}],sourceAvailable:[],allocations:[]};
  for(const patch of [{company:'GHR'},{generation:-1},{taskReceived:[{taskId:'UNKNOWN',quantity:1}]},{taskReceived:[{taskId:'A',quantity:null}]},
    {sourceAvailable:[{taskId:'B',accepted:99,availableCtn:0,availablePhysical:99}]},{taskReceived:[{taskId:'A',quantity:1},{taskId:'A',quantity:2}]}])
    assert.throws(()=>paired.projectPurchaseWorkspace({...f.originalArguments,currentStock:{...base,...patch}}),/current|Current|Unique|Known/);
});

test('raw original projection and stock authority must still describe exactly the same demand, PO and product',async()=>{
  for(const variant of ['demand','po','product']){
    const f=await fixture();
    if(variant==='demand')f.originalArguments.orders[0].orderQtyInCtn=90;
    if(variant==='po')f.originalArguments.tasks[0].ourPoNumber='PO-OTHER';
    if(variant==='product')f.originalArguments.orders[0].description='OTHER';
    await assert.rejects(f.read(),/authority changed/);
  }
});
