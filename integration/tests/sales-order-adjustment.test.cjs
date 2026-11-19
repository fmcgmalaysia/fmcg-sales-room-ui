const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createSalesOrderAdjustmentOperations,readSalesDemand,salesAdjustmentVersion}=load('salesOrderAdjustment.js');
const {readShipmentPlans,shipmentPlanVersion}=load('customerShipmentPlan.js');
const {resolveBatchEntitlements}=load('shipmentBatchAllocation.js');
const {readAllocations}=load('plannerAllocation.js');
const plain=v=>JSON.parse(JSON.stringify(v));
function fixture(company='NCT'){
 const records=new Map(),raw={id:'T',orderId:'O',sourceLineId:'L',customerId:'C',ord:500,requested:500,inc:500,procurement:{revision:'POV',totalCtn:500,expectedExtra:0}},names={NCT:{activity:'N'},GHR:{activity:'G'}};let lost=false,serial=0;
 const activity=()=>[...records.values()];
 const context=async()=>{const demand=readSalesDemand('T',500,activity()),allocations=readAllocations(activity());return {company,tasks:[{...raw,...(allocations.length?{inc:allocations.reduce((sum,row)=>sum+(row.targets.find(target=>target.taskId==='T')?.quantity||0),0)}:{}),ord:demand.revision?demand.requested:500,requested:demand.requested,salesCommittedQty:Math.min(500,demand.requested)}],allocations,activity:activity()};};
 const store={read:async(c,id)=>records.get(id)||null,insert:async(c,row)=>{if(records.has(row._id))throw Error('duplicate');records.set(row._id,row);if(lost&&row.action==='SALES_ORDER_ADJUSTMENT_SAVED'){lost=false;throw Error('lost acknowledgement');}return row;},remove:async(c,id)=>records.delete(id)};
 const save=createSalesOrderAdjustmentOperations({store,names,readContext:context,readPlans:readShipmentPlans,planVersion:shipmentPlanVersion,now:()=>new Date('2026-10-20T02:00:00Z')}),staff={memberId:'SOURCE/S',staffId:'S',staffName:'LAW',customerId:'C',canSelectShipment:true};
 const request=async(mode,quantity,batchId='')=>({company,staff,requestId:String(++serial).padStart(8,'0')+'-1111-4111-8111-111111111111',input:{action:'ADJUST',customerId:'C',orderId:'O',taskId:'T',batchId,mode,quantity,version:salesAdjustmentVersion(await context(),shipmentPlanVersion)}});
 return {save,request,context,records,raw,lose:()=>lost=true,plan:()=>readShipmentPlans(activity())[0]};
}
test('split, first-row increase and cancel preserve second batch entitlement and original P.O./receipt',async()=>{
 for(const company of ['NCT','GHR']){const f=fixture(company),before=JSON.stringify(f.raw);await f.save(await f.request('SPLIT',300));let p=f.plan();assert.deepEqual(plain(p.batches.map(b=>b.lines[0].quantity)),[300,200]);
 await f.save(await f.request('INCREASE',50,p.id+'|1'));p=f.plan();assert.deepEqual(plain(p.batches.map(b=>b.lines[0].quantity)),[350,200]);
 let rows=resolveBatchEntitlements(p,'T',{committed:500,received:500},[{id:'T',quantity:500}]);assert.deepEqual(plain(rows.map(row=>[row.metrics.committed,row.metrics.received])),[[300,300],[200,200]]);
 await f.save(await f.request('REDUCE',50,p.id+'|1'));p=f.plan();assert.deepEqual(plain(p.batches.map(b=>b.lines[0].quantity)),[300,200]);assert.equal(JSON.stringify(f.raw),before);}
});
test('another split keeps unchanged batch ID and original entitlement',async()=>{
 const f=fixture();await f.save(await f.request('SPLIT',300));const p=f.plan();await f.save(await f.request('SPLIT',100,p.id+'|1'));const rows=resolveBatchEntitlements(f.plan(),'T',{committed:500,received:500});assert.deepEqual(plain(rows.map(r=>[r.sequence,r.quantity,r.metrics.received])),[[1,100,100],[3,200,200],[2,200,200]]);
});
test('same-request retry after lost acknowledgement does not add demand twice',async()=>{
 const f=fixture(),r=await f.request('INCREASE',50);f.lose();await assert.rejects(f.save(r),/lost/);await f.save(r);await f.save(r);assert.equal((await f.context()).tasks[0].requested,550);assert.equal([...f.records.values()].filter(e=>e.action==='SALES_ORDER_ADJUSTMENT_SAVED').length,1);
});
test('invalid/stale/foreign-customer changes are rejected',async()=>{
 const f=fixture(),r=await f.request('INCREASE',50);await assert.rejects(f.save({...r,staff:{...r.staff,customerId:'OTHER'}}),/authorized/);await f.save(r);await assert.rejects(f.save({...await f.request('INCREASE',50),input:r.input}),/changed/);await assert.rejects(f.save(await f.request('REDUCE',550,f.plan().id+'|1')),/smaller/);
});
test('cancel first batch releases only its actual stock sources and preserves second batch supplier stock',async()=>{
 const f=fixture();for(const [id,quantity] of [['A',300],['B',200]])f.records.set(id,{_id:id,title:id,imageAltText:id,action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',activityTime:'2026-10-20T00:00:00Z',details:{beforeRevision:'',targets:[{taskId:'T',quantity}]}});
 await f.save(await f.request('SPLIT',300));const p=f.plan();await f.save(await f.request('REDUCE',50,p.id+'|1'));
 const allocations=(await f.context()).allocations;assert.equal(allocations.find(row=>row.sourceTaskId==='A').targets[0].quantity,250);assert.equal(allocations.find(row=>row.sourceTaskId==='B').targets[0].quantity,200);assert.equal(f.records.get('A').details.targets[0].quantity,300);
});
test('warehouse cannot pack first-row new demand using second-row stock',async()=>{
 const f=fixture();f.raw.warehouse={hasPhysicalReceipt:true,accepted:500,stock:{availablePhysical:500}};await f.save(await f.request('SPLIT',300));const p=f.plan();await f.save(await f.request('INCREASE',50,p.id+'|1'));
 const {projectPreparation,createPreparationOperations}=load('warehousePreparation.js'),context=async()=>({...await f.context(),customers:[]}),rows=projectPreparation(await context());assert.deepEqual(plain(rows.map(row=>[row.quantity,row.readyStock,row.batchAllocated])),[[350,300,300],[200,200,200]]);
 const save=createPreparationOperations({store:{read:async()=>null,insert:async(c,row)=>row,remove:async()=>{}},names:{NCT:{activity:'N'}},readContext:context});await assert.rejects(save({company:'NCT',requestId:'dddddddd-1111-4111-8111-111111111111',staff:{memberId:'WH',staffId:'W',staffName:'WH',canPrepareWarehouse:true},input:{action:'PACK',id:rows[0].id,version:rows[0].version}}),/insufficient/);
});

test('legacy PLAN retains unchanged batch entitlements and cannot erase them by resizing',async()=>{
 const f=fixture();await f.save(await f.request('SPLIT',300));let p=f.plan();await f.save(await f.request('INCREASE',50,p.id+'|1'));p=f.plan();
 const {createShipmentPlanOperations}=load('customerShipmentPlan.js'),context=f.context,store={read:async(c,id)=>f.records.get(id)||null,insert:async(c,row)=>{f.records.set(row._id,row);return row;},remove:async(c,id)=>f.records.delete(id)};
 const save=createShipmentPlanOperations({store,names:{NCT:{activity:'N'}},readContext:context}),r=await f.request('INCREASE',1,p.id+'|1');
 const input={action:'PLAN',customerId:'C',orderId:'O',reason:'Keep existing batches',version:shipmentPlanVersion(await context()),batches:p.batches.map(batch=>({label:batch.label,date:batch.date,lines:batch.lines.map(line=>({taskId:line.taskId,quantity:line.quantity}))}))};
 await save({...r,input});assert.deepEqual(plain(f.plan().batches.map(batch=>batch.lines[0].coverage)),plain(p.batches.map(batch=>batch.lines[0].coverage)));
 input.version=shipmentPlanVersion(await context());input.batches[0].lines[0].quantity-=1;input.batches[1].lines[0].quantity+=1;
 await assert.rejects(save({...r,requestId:'ffffffff-1111-4111-8111-111111111111',input}),/Order Adjustment/);
});
