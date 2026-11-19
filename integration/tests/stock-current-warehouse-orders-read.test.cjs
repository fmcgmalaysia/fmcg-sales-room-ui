const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),load=require('./load-master-module.cjs');
const {createCurrentWarehouseOrdersRead}=require('../prototypes/stock-current-state/current-warehouse-orders-read.cjs');
const {readCurrentPurchaseProjection}=require('../prototypes/stock-current-state/purchase-current-projection.cjs');
const file=require.resolve('./stock-current-purchase-projection.test.cjs'),copy=value=>JSON.parse(JSON.stringify(value));
const original=vm.runInNewContext(fs.readFileSync(file,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',
  {require:createRequire(file),__dirname:path.dirname(file),Map,Buffer});
async function fixture(){
  const f=await original(),paired=load('../prototypes/stock-current-state/warehousePreparation.candidate.js');
  const deps={company:'NCT',protocol:f.protocol,authenticate:async()=>({...f.staff,staffName:'Warehouse'}),
    readCurrentContext:async(company,staff,control)=>{const current=await readCurrentPurchaseProjection({...f.args,company,staff,control});
      return{workspace:current.workspace,states:[...current.products.values()].map(product=>product.state),originalContext:f.context,tables:{PurchaseOrders:[]}};},
    projectPurchaseOrders:load('purchaseOrderWorkflow.js').projectPurchaseOrders,projectWarehouseOrders:load('warehouseReceiving.js').projectWarehouseOrders,
    projectWarehouseCustomerReadiness:load('warehouseCustomerReadiness.js').projectWarehouseCustomerReadiness,
    projectPreparation:paired.projectPreparation,currentReadyVersion:paired.WAREHOUSE_CURRENT_READY_VERSION,
    readAllocations:f.deps.readAllocations,readCustomerShipments:f.deps.readCustomerShipments,readPreparation:paired.readPreparation,
    warehouseCbm:()=>null,readCustomerShortNames:async()=>[{customerId:'C-A',shortName:'SHORT A'}],now:()=>new Date('2026-10-22T08:00:00Z')};
  return{...f,deps,read:()=>createCurrentWarehouseOrdersRead(deps)('NCT')};
}
test('same current barrier gives Warehouse A30/B70 Ready and customer ownership, while original PO receipt quantities/version remain unchanged',async()=>{
  const f=await fixture(),before=await f.read(),snapshot=JSON.stringify([...f.db]);
  assert.equal(JSON.stringify([...f.db]),snapshot,'orders read cannot create cache/stock writes');
  await f.borrow();const after=await f.read();
  assert.equal(after.customerLines.find(row=>row.id==='A').allocatedQty,30);assert.equal(after.customerLines.find(row=>row.id==='B').allocatedQty,70);
  assert.equal(after.deliveryTasks.find(row=>row.taskId==='A').readyStock,30);assert.equal(after.deliveryTasks.find(row=>row.taskId==='B').readyStock,70);
  assert.deepEqual(copy(after.orders),copy(before.orders),'borrowing must not alter physical PO receipt identity/version');
  assert.equal(after.orders.flatMap(row=>row.lines).find(row=>row.taskId==='B').accepted,100);
  assert.equal(after.customerLines.find(row=>row.id==='A').customerName,'SHORT A');
  assert.equal(after.customerLines.find(row=>row.id==='A').fullCustomerName,'Customer A');
  assert.equal(after.stockCurrent.stockGeneration,1);assert.equal(after.stockCurrent.schema,'CURRENT_WAREHOUSE_V2');
  assert.equal(after.staff.memberId,f.staff.memberId);assert.equal(after.deliveryTasks.every(row=>row.cbmPerCtn===null),true);
});
test('pending, changed generation, missing current coverage, unpaired Ready and lost Warehouse identity never return old actionable stock',async()=>{
  const f=await fixture();assert.throws(()=>createCurrentWarehouseOrdersRead({...f.deps,currentReadyVersion:undefined}),/Paired/);
  await assert.rejects(createCurrentWarehouseOrdersRead({...f.deps,authenticate:async()=>({staffId:'W'})})('NCT'),/identity/);
  let calls=0;const blocked=createCurrentWarehouseOrdersRead({...f.deps,protocol:{readSnapshot:async()=>{throw Error('Inventory pending');}},readCurrentContext:async()=>{calls++;}});
  await assert.rejects(blocked('NCT'),/pending/);assert.equal(calls,0);
  const missing=createCurrentWarehouseOrdersRead({...f.deps,readCurrentContext:async(...args)=>({...await f.deps.readCurrentContext(...args),states:[]})});
  await assert.rejects(missing('NCT'),/coverage/);
  const changed=createCurrentWarehouseOrdersRead({...f.deps,protocol:{readSnapshot:async fn=>{await fn(await f.protocol.readControl());throw Error('Inventory changed during read');}}});
  await assert.rejects(changed('NCT'),/changed/);
});
test('missing loaded task fails for review rather than dropping it; short name outage retains original customer identity',async()=>{
  const f=await fixture(),missing=createCurrentWarehouseOrdersRead({...f.deps,readPreparation:()=>new Map([['GONE',{loaded:10,taskId:'GONE'}]])});
  await assert.rejects(missing('NCT'),/Loaded Warehouse task/);
  const read=createCurrentWarehouseOrdersRead({...f.deps,readCustomerShortNames:async()=>{throw Error('Names offline');}});
  const result=await read('NCT');assert.equal(result.customerLines.find(row=>row.id==='A').customerName,'Customer A');
  assert.equal(result.customerLines.find(row=>row.id==='A').allocatedQty,0);
});
test('server-retained archived task scope reads exact current checkpoint without changing original Sales request or archive rule',async()=>{
  const f=await fixture();f.context.tasks.find(task=>task.id==='A').archived=true;
  const current=await f.protocol.readSnapshot(control=>readCurrentPurchaseProjection({...f.args,control,retainedTaskIds:['A']}));
  assert.equal([...current.rows.products.values()][0].state.tasks.some(task=>task.id==='A'),true);
  assert.equal(f.context.tasks.find(task=>task.id==='A').archived,true);assert.equal(f.context.tasks.find(task=>task.id==='A').requested,100);
  for(const retainedTaskIds of [['GONE'],['A','A'],null])await assert.rejects(f.protocol.readSnapshot(control=>readCurrentPurchaseProjection({...f.args,control,retainedTaskIds})),/snapshot/);
});
