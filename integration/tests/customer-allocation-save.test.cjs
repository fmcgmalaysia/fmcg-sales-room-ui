const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const cache={}, {createPlannerAllocationOperations,allocationVersion,allocatedTo,readAllocations}=load('plannerAllocation.js',cache),{readAllocationLoans,customerAllocationContext}=load('customerAllocationContext.js',cache),{quoteCustomerAllocation}=load('customerAllocationPlan.js',cache);
function fixture(){
 const records=new Map(),product={barcode:'SKU',packing:'72G x48',ea:48},task=(id,ord,accepted)=>({...product,id,customerId:'C'+id,orderId:'O'+id,sourceLineId:'L'+id,ord,po:'PO'+id,supplierId:'S',procurement:{totalCtn:accepted,customerCtn:Math.min(ord,accepted),expectedExtra:Math.max(0,accepted-ord)},warehouse:{hasPhysicalReceipt:true,accepted}});
 const tasks=[task('A',250,200),task('B',280,280),{...task('FREE',0,20),procurementSource:true,customerDemandTaskId:'A'}],workspace={company:'NCT',tasks},staff={memberId:'M',staffId:'P',staffName:'LAW'};
 let failAfterCommit=false;const store={all:async()=>[...records.values()],read:async(c,id)=>records.get(id)||null,insert:async(c,row)=>{if(records.has(row._id))throw Error('duplicate');records.set(row._id,row);if(failAfterCommit&&row.action==='PLANNER_ALLOCATION_SAVED'){failAfterCommit=false;throw Error('Connection lost after commit');}return row;},remove:async(c,id)=>records.delete(id)};
 const save=createPlannerAllocationOperations({store,names:{NCT:{activity:'Activity'}},readWorkspace:async()=>workspace}),activity=()=>[...records.values()],version=()=>allocationVersion(workspace,activity());
 const base={company:'NCT',staff,requestId:'11111111-1111-4111-8111-111111111111'},input=()=>({action:'ALLOCATE',planMode:'CUSTOMER',version:version(),taskId:'A',batchId:'WHOLE',borrow:true,donorTaskId:'B'});
 return {records,tasks,workspace,store,staff,save,activity,version,base,input,failAfterCommit:()=>{failAfterCommit=true;}};
}
test('one original journal event atomically commits own200 + free20 + borrowed30 and debt, once',async()=>{
 const f=fixture(),input=f.input(),before=JSON.stringify(f.tasks);await f.save({...f.base,input});await f.save({...f.base,input});assert.equal(allocatedTo('A',f.activity()).quantity,250);assert.equal(allocatedTo('B',f.activity()).quantity,250);assert.equal(readAllocations(f.activity()).length,3);assert.equal(readAllocationLoans(f.activity())[0].outstanding,30);assert.equal(f.activity().filter(row=>row.action==='PLANNER_ALLOCATION_SAVED').length,1);assert.equal(JSON.stringify(f.tasks),before);
});
test('failure after allocation commit but before result resumes same identity without another transfer',async()=>{
 const f=fixture(),input=f.input();f.failAfterCommit();await assert.rejects(f.save({...f.base,input}),/Connection lost/);await f.save({...f.base,input});assert.equal(allocatedTo('A',f.activity()).quantity,250);assert.equal(readAllocationLoans(f.activity()).length,1);assert.equal(f.activity().filter(row=>row.action==='PLANNER_ALLOCATION_SAVED').length,1);await assert.rejects(f.save({...f.base,input:{...input,borrow:false}}),/identity/);
});
test('two concurrent requests cannot consume the same free stock or borrow twice',async()=>{
 const f=fixture(),input=f.input(),results=await Promise.allSettled([f.save({...f.base,input}),f.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input})]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(allocatedTo('A',f.activity()).quantity,250);assert.equal(readAllocationLoans(f.activity())[0].outstanding,30);
});
test('stale stock and missing donor reject before any grouped event or partial free allocation',async()=>{
 const f=fixture(),input=f.input();f.tasks[1].warehouse.accepted=10;await assert.rejects(f.save({...f.base,input}),/changed/);assert.equal(readAllocations(f.activity()).length,0);
 const g=fixture();await assert.rejects(g.save({...g.base,input:{...g.input(),donorTaskId:'MISSING'}}),/insufficient/);assert.equal(readAllocations(g.activity()).length,0);
});
test('actual free receipt repayment changes same ledger, clears same debt and cannot repeat',async()=>{
 const f=fixture();await f.save({...f.base,input:f.input()});const loan=readAllocationLoans(f.activity())[0];f.tasks.push({...f.tasks[2],id:'NEW',warehouse:{hasPhysicalReceipt:true,accepted:30},procurement:{totalCtn:30,customerCtn:0,expectedExtra:30}});
 const input={action:'ALLOCATE',planMode:'REPAY',version:f.version(),loanId:loan.id,quantity:30};await f.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input});assert.equal(allocatedTo('B',f.activity()).quantity,280);assert.equal(readAllocationLoans(f.activity())[0].outstanding,0);assert.equal(f.tasks.reduce((n,row)=>n+row.warehouse.accepted,0),530);
 await assert.rejects(f.save({...f.base,requestId:'33333333-3333-4333-8333-333333333333',input:{...input,version:f.version()}}),/repayment/);
});
test('quote preserves pre-purchase customer earmarks instead of advertising500 free cartons',()=>{const f=fixture(),context=customerAllocationContext(f.workspace,f.activity(),[],f.version()),q=quoteCustomerAllocation(context,f.input());assert.equal(q.assigned,200);assert.equal(q.freeQuantity,20);assert.equal(q.donors[0].quantity,280);});
test('unstarted borrowing can return its original30 before cancellation, without a receipt or stock movement',async()=>{
 const f=fixture();await f.save({...f.base,input:f.input()});const loan=readAllocationLoans(f.activity())[0];await f.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input:{action:'ALLOCATE',planMode:'RETURN',version:f.version(),loanId:loan.id,quantity:30}});assert.equal(allocatedTo('A',f.activity()).quantity,220);assert.equal(allocatedTo('B',f.activity()).quantity,280);assert.equal(readAllocationLoans(f.activity())[0].outstanding,0);assert.equal(f.tasks.reduce((n,row)=>n+row.warehouse.accepted,0),500);
});
test('A250 uses borrowed source30 through the existing Loaded writer; partial240 and retry250 deduct once and retain debt30',async()=>{
 const f=fixture();f.tasks[0].salesCommittedQty=200;await f.save({...f.base,input:f.input()});
 const {stockPosition}=load('inventoryExceptions.js',cache),{projectPreparation,createPreparationOperations}=load('warehousePreparation.js',cache);
 const context=()=>({...f.workspace,activity:f.activity(),allocations:readAllocations(f.activity()),tasks:f.tasks.map(row=>({...row,inc:allocatedTo(row.id,f.activity()).quantity,warehouse:{...row.warehouse,stock:stockPosition(row.id,row.warehouse.accepted,f.activity())}}))});
 const save=createPreparationOperations({store:f.store,names:{NCT:{activity:'Activity'}},readContext:async()=>context(),documentService:async()=>{throw Error('External writes forbidden');}});let serial=3;
 const request=values=>{const item=projectPreparation(context()).find(row=>row.taskId==='A');return {...f.base,staff:{...f.staff,canPrepareWarehouse:true},requestId:String(++serial).padStart(8,'0')+'-3333-4333-8333-333333333333',input:{id:item.id,version:item.version,...values}};};
 assert.equal(projectPreparation(context()).find(row=>row.taskId==='A').readyStock,250);
 await save(request({action:'PACK'}));await save(request({action:'LOAD',loaded:240,note:'Actual partial loading'}));
 assert.equal(context().tasks.reduce((n,row)=>n+row.warehouse.stock.availablePhysical,0),260);assert.equal(readAllocationLoans(f.activity())[0].outstanding,30);
 const final=request({action:'LOAD',loaded:250});await save(final);await save(final);assert.equal(context().tasks.reduce((n,row)=>n+row.warehouse.stock.availablePhysical,0),250);assert.equal(readAllocationLoans(f.activity())[0].outstanding,30);
 const loan=readAllocationLoans(f.activity())[0];await assert.rejects(f.save({...f.base,requestId:'99999999-9999-4999-8999-999999999999',input:{action:'ALLOCATE',planMode:'RETURN',version:f.version(),loanId:loan.id,quantity:30}}),/Loaded|Desk/);
});
test('late original A supplier goods become free after A is covered and can repay B; B earmarked replacement is explicitly reconciled',async()=>{
 for(const owner of ['A','B']){
  const f=fixture();await f.save({...f.base,input:f.input()});const loan=readAllocationLoans(f.activity())[0];f.tasks.push({...f.tasks[2],id:'LATE',customerDemandTaskId:owner,warehouse:{hasPhysicalReceipt:true,accepted:30},procurement:{totalCtn:30,customerCtn:30,expectedExtra:0}});
  await f.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input:{action:'ALLOCATE',planMode:'REPAY',version:f.version(),loanId:loan.id,quantity:30}});assert.equal(allocatedTo('A',f.activity()).quantity,250);assert.equal(allocatedTo('B',f.activity()).quantity,280);assert.equal(readAllocationLoans(f.activity())[0].outstanding,0);
 }
});
test('lender gap must use repayment, and an open responsibility excludes another loan from that lender',async()=>{
 const f=fixture();await f.save({...f.base,input:f.input()});f.tasks.push({...f.tasks[2],id:'NEW',warehouse:{hasPhysicalReceipt:true,accepted:30},procurement:{totalCtn:30,customerCtn:0,expectedExtra:30}});
 await assert.rejects(f.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input:{...f.input(),taskId:'B',borrow:false}}),/Repay/);assert.equal(allocatedTo('B',f.activity()).quantity,250);assert.equal(readAllocationLoans(f.activity())[0].outstanding,30);
 const c=customerAllocationContext(f.workspace,f.activity(),readAllocations(f.activity()),f.version());assert.equal(quoteCustomerAllocation(c,{taskId:'A',batchId:'WHOLE'}).donors.some(row=>row.taskId==='B'),false);
});
test('closed borrowing permits a later split while keeping explicit stock on correct batches, including zero former claims',async()=>{
 const f=fixture();await f.save({...f.base,input:f.input()});const loan=readAllocationLoans(f.activity())[0];await f.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input:{action:'ALLOCATE',planMode:'RETURN',version:f.version(),loanId:loan.id,quantity:30}});
 const {createSalesOrderAdjustmentOperations,salesAdjustmentVersion}=load('salesOrderAdjustment.js',cache),{readShipmentPlans,shipmentPlanVersion}=load('customerShipmentPlan.js',cache),context=async()=>({...f.workspace,activity:f.activity(),allocations:readAllocations(f.activity())}),save=createSalesOrderAdjustmentOperations({store:f.store,names:{NCT:{activity:'Activity'}},readContext:context,readPlans:readShipmentPlans,planVersion:shipmentPlanVersion});
 await save({...f.base,requestId:'33333333-3333-4333-8333-333333333333',staff:{...f.staff,customerId:'CA',canSelectShipment:true},input:{action:'ADJUST',mode:'SPLIT',quantity:200,taskId:'A',customerId:'CA',orderId:'OA',batchId:'',version:salesAdjustmentVersion(await context(),shipmentPlanVersion)}});
 const c=customerAllocationContext(f.workspace,f.activity(),readAllocations(f.activity()),f.version()),batches=c.tasks.find(row=>row.id==='A').batches;
 assert.equal(quoteCustomerAllocation(c,{taskId:'A',batchId:batches[0].id}).assigned,200);assert.equal(quoteCustomerAllocation(c,{taskId:'A',batchId:batches[1].id}).assigned,20);assert.equal(readAllocationLoans(f.activity())[0].outstanding,0);
});
test('new own receipts fill first pending batch without stealing a later explicit200 reservation',async()=>{
 const f=fixture();f.tasks[0].ord=300;f.tasks.push({...f.tasks[2],id:'EXTRA',warehouse:{hasPhysicalReceipt:true,accepted:100},procurement:{totalCtn:100,customerCtn:100,expectedExtra:0}});
 f.records.set('PLAN',{_id:'PLAN',title:'PLAN',description:'SPLIT',action:'CUSTOMER_SHIPMENT_PLAN_SAVED',result:'SAVED',activityTime:'2026-10-29T00:00:00Z',initiatedByStaffId:'P',details:{beforeRevision:'',plan:{id:'SPLIT',company:'NCT',customerId:'CA',orderId:'OA',batches:[{sequence:1,lines:[{taskId:'A',quantity:100}]},{sequence:2,lines:[{taskId:'A',quantity:200}]}]}}});
 f.records.set('OLD',{_id:'OLD',title:'OLD',imageAltText:'A',action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',activityTime:'2026-10-29T00:00:00Z',initiatedByStaffId:'P',details:{beforeRevision:'',targets:[{taskId:'A',quantity:200,batches:[{id:'SPLIT|2',quantity:200}]}]}});
 await f.save({...f.base,input:{...f.input(),batchId:'SPLIT|1',borrow:false}});const allocations=readAllocations(f.activity());assert.equal(allocations.find(row=>row.sourceTaskId==='A').targets[0].batches[0].id,'SPLIT|2');assert.equal(allocations.find(row=>row.sourceTaskId==='EXTRA').targets[0].batches.find(row=>row.id==='SPLIT|1').quantity,100);assert.equal(allocatedTo('A',f.activity()).quantity,300);
});
test('quarantine reconciliation reduces only the selected claim, preserves receipt and borrowing debt, and cannot increase stock',async()=>{
 const f=fixture();await f.save({...f.base,input:f.input()});const {createStockExceptionOperations,stockExceptionVersion}=load('inventoryExceptions.js',cache),read=async()=>({...f.workspace,activity:f.activity()}),quarantine=createStockExceptionOperations({store:f.store,names:{NCT:{activity:'Activity'}},readContext:read});
 await quarantine({...f.base,requestId:'22222222-2222-4222-8222-222222222222',staff:{...f.staff,canReportStockException:true},input:{action:'QUARANTINE',sourceTaskId:'A',quantity:5,kind:'INTERNAL_DAMAGE',reason:'Actual damaged cartons',version:stockExceptionVersion(await read())}});
 const input={action:'ALLOCATE',planMode:'RECONCILE',sourceTaskId:'A',taskId:'A',batchId:'WHOLE',quantity:195,reason:'Five cartons quarantined',version:f.version()};await f.save({...f.base,requestId:'33333333-3333-4333-8333-333333333333',input});assert.equal(allocatedTo('A',f.activity()).quantity,245);assert.equal(allocatedTo('B',f.activity()).quantity,250);assert.equal(readAllocationLoans(f.activity())[0].outstanding,30);assert.equal(f.tasks[0].warehouse.accepted,200);
 await assert.rejects(f.save({...f.base,requestId:'44444444-4444-4444-8444-444444444444',input:{...input,quantity:200,version:f.version()}}),/only reduce/);
});
