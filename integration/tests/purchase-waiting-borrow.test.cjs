const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {fixture}=require('../prototypes/stock-loaded-contract-20261028/check-current.cjs');
const {customerAllocationContext,projectSupplyAllocation,readAllocationLoans}=load('customerAllocationContext.js');
const {createPlannerAllocationOperations,allocationVersion,readAllocations}=load('plannerAllocation.js');
const {quoteCustomerAllocation,planCustomerAllocation}=load('customerAllocationPlan.js');
const {createSupportDeskOperations,readSupportDesks}=load('supportDesk.js');
const {createPackingListOperations,packingVersion}=load('packingListOperations.js');
const {projectPackingContext}=load('packingListContext.js');
const {createShortloadResolutionOperations}=load('shortloadResolution.js');
const {projectStockCard}=load('stockCardProjection.js');
const {readSalesDemand}=load('salesOrderAdjustment.js');
const names={NCT:{activity:'N'},GHR:{activity:'G'}};
function scenario(){
 const f=fixture();f.records.clear();const [a,b]=f.tasks;
 Object.assign(a,{ord:200,requested:200,inc:150,procurement:{totalCtn:100,customerCtn:100},warehouse:{hasPhysicalReceipt:true,accepted:100}});
 Object.assign(b,{ord:300,requested:300,inc:250,procurement:{totalCtn:300,customerCtn:300},warehouse:{hasPhysicalReceipt:true,accepted:250,issue:true},quantityCases:[{kind:'RECEIPT',decision:{supplierDeliveryDecision:'STOP'}}]});
 f.tasks.push({...a,id:'A2',po:'PO-A2',supplierId:'SUPPLIER-2',procurementSource:true,customerDemandTaskId:'A',warehouse:{hasPhysicalReceipt:true,accepted:50,issue:true},quantityCases:[{kind:'RECEIPT',decision:{supplierDeliveryDecision:'WAIT'}}]});
 const context=async(company='NCT')=>{
  const c=await f.context(company);
  for(const t of c.tasks.filter(t=>!t.procurementSource)){const d=readSalesDemand(t.id,t.requested,c.activity);t.ord=t.requested=d.requested;}
  const physical=customerAllocationContext(c,c.activity,readAllocations(c.activity),'');
  for(const supply of projectSupplyAllocation(c,physical)){const t=c.tasks.find(t=>t.id===supply.taskId);t.inc=supply.received;t.supplyAllocation=supply;}
  c.allocations=physical.sources.map(s=>({...c.allocations.find(row=>row.sourceTaskId===s.id),sourceTaskId:s.id,targets:s.targets.map(({protectedQuantity,...target})=>target)}));return c;
 };
 const snapshot=async()=>{const c=await context();return customerAllocationContext(c,c.activity,readAllocations(c.activity),allocationVersion(c,c.activity));};
 const save=createPlannerAllocationOperations({store:f.store,names,readWorkspace:context});
 const request=async(input={})=>({company:'NCT',staff:f.staff,requestId:f.nextId(),input:{action:'ALLOCATE',planMode:'CUSTOMER',taskId:'A',batchId:'WHOLE',fulfilNow:true,borrow:true,donorTaskId:'B',version:(await snapshot()).version,...input}});
 const packingContext=async company=>projectPackingContext(await context(company));
 const packing=createPackingListOperations({store:f.store,names,readContext:packingContext});
 const resolve=createShortloadResolutionOperations({store:f.store,names,readContext:packingContext});
 const deskSave=createSupportDeskOperations({store:f.store,names,readContext:context});
 const state=async()=>readSupportDesks((await context()).activity,'NCT').find(x=>x.customerId==='CUSTOMER-A');
 const packingRequest=async(input,department='SUPPORT')=>({company:'NCT',staff:{...f.staff,packingDepartment:department},requestId:f.nextId(),input:{version:packingVersion(await packingContext('NCT')),...input}});
 const prepare=async()=>{
  await deskSave(await packingRequest({action:'DESK_ASSIGN',taskId:'A',customerId:'CUSTOMER-A',desk:1,revision:''}));
  return packing(await packingRequest({action:'DESK_SEND',customerId:'CUSTOMER-A',desk:1,deskRevision:(await state()).revision,lines:[{taskId:'A',quantity:200}]}));
 };
 const current=async id=>(await packingContext('NCT')).lists.find(x=>x.id===id);
 const loaded=async(id,quantity)=>{const list=await current(id);return packingRequest({action:'DESK_LOAD',id,revision:list.revision,taskId:'A',loaded:quantity,resolutionRevision:list.lines[0].resolution?.revision||'',reasonCodes:quantity<list.lines[0].quantity?['INSUFFICIENT']:[]},'WAREHOUSE');};
 const repay=async quantity=>save(await request({planMode:'REPAY',loanId:(await snapshot()).loans[0].id,quantity}));
 const quantities=async()=>{const c=await context(),p=await snapshot(),stock=projectStockCard(c).items[0];return {physical:stock.onHand,a:p.sources.reduce((n,s)=>n+(s.targets.find(t=>t.taskId==='A')?.quantity||0),0),b:p.sources.reduce((n,s)=>n+(s.targets.find(t=>t.taskId==='B')?.quantity||0),0),debt:p.loans.reduce((n,l)=>n+l.outstanding,0),waiting:c.tasks.find(t=>t.id==='A').supplyAllocation.waiting,bGap:c.tasks.find(t=>t.id==='B').supplyAllocation.gap};};
 return {...f,context,snapshot,save,request,packing,resolve,state,packingRequest,prepare,current,loaded,repay,quantities};
}

test('WAIT50 is an explicit early-fulfilment choice, not a global change to incoming PO coverage',async()=>{
 const f=scenario(),c=await f.snapshot(),input=(await f.request()).input;
 assert.equal(quoteCustomerAllocation(c,{...input,fulfilNow:false}).shortage,0);
 assert.equal(quoteCustomerAllocation(c,input).shortage,50);
 assert.equal(quoteCustomerAllocation(c,input).waiting,50);
 await f.save(await f.request());
 assert.deepEqual(await f.quantities(),{physical:400,a:200,b:200,debt:50,waiting:0,bGap:100});
 assert.equal(f.tasks[2].quantityCases[0].decision.supplierDeliveryDecision,'WAIT');
 assert.equal(f.tasks[1].quantityCases[0].decision.supplierDeliveryDecision,'STOP');
 await assert.rejects(f.save(await f.request()),/has not changed/);
 assert.equal((await f.context()).activity.filter(x=>x.action==='PLANNER_ALLOCATION_SAVED').length,1);
});

test('borrow50, Loaded180, late30 + repay30, late20 + repay20 conserve physical stock and original B shortage50',async()=>{
 const f=scenario();await f.save(await f.request());const sent=await f.prepare(),request=await f.loaded(sent.id,180);
 await f.packing(request);await f.packing(request);
 assert.deepEqual(await f.quantities(),{physical:220,a:200,b:200,debt:50,waiting:0,bGap:100});
 f.tasks[2].warehouse.accepted=80;
 assert.deepEqual(await f.quantities(),{physical:250,a:200,b:200,debt:50,waiting:0,bGap:100});
 await f.repay(30);assert.deepEqual(await f.quantities(),{physical:250,a:200,b:230,debt:20,waiting:0,bGap:70});
 f.tasks[2].warehouse.accepted=100;await f.repay(20);
 assert.deepEqual(await f.quantities(),{physical:270,a:200,b:250,debt:0,waiting:0,bGap:50});
 const list=await f.current(sent.id);
 await f.resolve(await f.packingRequest({action:'DESK_RESOLVE',id:sent.id,revision:list.revision,taskId:'A',deskRevision:(await f.state()).revision,resolutionRevision:list.lines[0].resolution.revision,parts:[{mode:'CONTINUE',quantity:20}]}));
 const rest=await f.loaded(sent.id,200);await f.packing(rest);await f.packing(rest);
 assert.deepEqual(await f.quantities(),{physical:250,a:200,b:250,debt:0,waiting:0,bGap:50});
});

test('shortload20 can be deferred without deducting or dropping it; Support cannot cancel demand',async()=>{
 const f=scenario();await f.save(await f.request());const sent=await f.prepare();await f.packing(await f.loaded(sent.id,180));const list=await f.current(sent.id);
 const input={action:'DESK_RESOLVE',id:sent.id,revision:list.revision,taskId:'A',deskRevision:(await f.state()).revision,resolutionRevision:list.lines[0].resolution.revision};
 await assert.rejects(f.resolve(await f.packingRequest({...input,parts:[{mode:'CANCEL',quantity:20}]})),/Sales confirmation/);
 await f.resolve(await f.packingRequest({...input,parts:[{mode:'TRANSFER',desk:0,quantity:20}]}));
 assert.deepEqual(await f.quantities(),{physical:220,a:200,b:200,debt:50,waiting:0,bGap:100});
 const c=await f.context(),parts=load('shortloadResolutionModel.js').deskTaskPortions(c.activity,await f.state(),c.tasks[0],load('physicalOutflow.js').readPhysicalOutflows(c.activity));
 assert.equal(parts.find(x=>x.desk===0).quantity,20);
});

test('two borrowers racing for the last50 cannot both commit; no negative ownership or duplicate debt',async()=>{
 const f=scenario();f.tasks[1].warehouse.accepted=50;
 f.tasks.push({...f.tasks[0],id:'C',orderId:'ORDER-C',sourceLineId:'LINE-C',customerId:'CUSTOMER-C',ord:50,requested:50,inc:0,procurement:{totalCtn:50,customerCtn:50},warehouse:{hasPhysicalReceipt:false,accepted:0}});
 const first=await f.request(),second=await f.request({taskId:'C'}),results=await Promise.allSettled([f.save(first),f.save(second)]);
 assert.equal(results.filter(x=>x.status==='fulfilled'&&x.value.ok).length,1);
 const p=await f.snapshot();assert.equal(p.loans.reduce((n,x)=>n+x.outstanding,0),50);assert.equal(p.sources.find(x=>x.id==='B').targets.reduce((n,x)=>n+x.quantity,0),50);
});

test('lost acknowledgement recovers original early allocation once, never creates a second loan',async()=>{
 const f=scenario(),request=await f.request();f.lose('PLANNER_ALLOCATION_SAVED');await assert.rejects(f.save(request),/lost acknowledgement/);await f.save(request);await f.save(request);
 assert.equal((await f.context()).activity.filter(x=>x.action==='PLANNER_ALLOCATION_SAVED').length,1);
 assert.equal((await f.snapshot()).loans.length,1);assert.equal((await f.quantities()).debt,50);
 await assert.rejects(f.save({...request,input:{...request.input,fulfilNow:false}}),/identity|different changes/);
});

test('receipt30 while borrow50 dialog is open rejects stale confirmation; fresh view borrows only20',async()=>{
 const f=scenario(),request=await f.request();f.tasks[2].warehouse.accepted=80;
 await assert.rejects(f.save(request),/changed/);
 assert.equal(quoteCustomerAllocation(await f.snapshot(),(await f.request()).input).shortage,20);
 await f.save(await f.request());assert.deepEqual(await f.quantities(),{physical:430,a:200,b:230,debt:20,waiting:0,bGap:70});
});

test('held donor, other company and wrong packing remain unavailable even for early fulfilment',async()=>{
 for(const kind of ['held','company','packing']){
  const f=scenario(),c=await f.snapshot(),input=(await f.request()).input;
  if(kind==='held')c.tasks.find(x=>x.id==='B').held=true;
  if(kind==='company')c.sources.find(x=>x.id==='B').company='GHR';
  if(kind==='packing'){c.tasks.find(x=>x.id==='B').packing='OTHER';c.sources.find(x=>x.id==='B').packing='OTHER';}
  assert.throws(()=>planCustomerAllocation(c,input),/insufficient|requires review/);
 }
});

test('Sales cancellation returns only the unshipped borrowed20; Loaded180 and remaining debt30 survive',async()=>{
 const f=scenario();await f.save(await f.request());const sent=await f.prepare();await f.packing(await f.loaded(sent.id,180));const list=await f.current(sent.id);
 const req=await f.packingRequest({action:'DESK_RESOLVE',id:sent.id,revision:list.revision,taskId:'A',deskRevision:(await f.state()).revision,resolutionRevision:list.lines[0].resolution.revision,parts:[{mode:'CANCEL',quantity:20}]});
 req.staff={...f.staff,memberId:'SOURCE_SALES/SYNTHETIC-STAFF',customerId:'CUSTOMER-A'};await f.resolve(req);
 const q=await f.quantities();assert.equal(q.physical,220);assert.equal(q.a,180);assert.equal(q.b,220);assert.equal(q.debt,30);assert.equal((await f.context()).tasks[0].requested,180);
});

test('quarantine after Loaded retains loan50, blocks excess claims, and Finance month-end loss deducts10 only once',async()=>{
 const f=scenario();f.tasks[1].costCurrency='MYR';f.tasks[1].procurement.costing=load('purchasePlan.js').calculatePlanCosting({schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:300,freeCtn:0,prices:{lpPc:5,lpCtn:60,disc1:0,disc2:0,disc3:0}},300,12);
 await f.save(await f.request());const sent=await f.prepare();await f.packing(await f.loaded(sent.id,180));
 const {createStockExceptionOperations,stockExceptionVersion,readStockExceptions}=load('inventoryExceptions.js');
 const {createStockResolutionOperations,stockResolutionVersion}=load('stockExceptionResolution.js');
 let clock='2026-11-06T08:00:00Z';const now=()=>new Date(clock),report=createStockExceptionOperations({store:f.store,names,readContext:f.context,now});
 // A's unshipped20 belongs to the borrowed B source after own150 and borrowed30 loaded.
 await report({company:'NCT',staff:{...f.staff,canReportStockException:true},requestId:f.nextId(),input:{action:'QUARANTINE',sourceTaskId:'B',quantity:10,kind:'INTERNAL_DAMAGE',reason:'Synthetic counted damage',version:stockExceptionVersion(await f.context())}});
 const c=await f.context(),source=c.tasks.find(x=>x.id==='B');assert.equal(source.warehouse.stock.held,10);assert.equal((await f.quantities()).physical,220);assert.equal((await f.quantities()).debt,50);
 const orders=[{id:'PO-B',taskIds:['B'],version:'B-V',documents:[],finance:{payments:[],amounts:[],quantityClaims:[]}}];
 const id=readStockExceptions(c.activity)[0].id,resolve=createStockResolutionOperations({store:f.store,names,readContext:f.context,listOrders:async()=>orders,now});
 const request=async()=>({company:'NCT',staff:{...f.staff,canCloseStockException:true},requestId:f.nextId(),input:{action:'CLOSE',id,outcome:'LOSS',cents:60000,period:'2026-11',stockTakeConfirmed:true,goodsStatus:'PRESENT',reason:'Synthetic month-end count',version:stockResolutionVersion(await f.context(),orders)}});
 await assert.rejects(resolve(await request()),/month-end/);clock='2026-11-30T08:00:00Z';const loss=await request();await resolve(loss);await resolve(loss);
 assert.equal((await f.quantities()).physical,210);assert.equal((await f.quantities()).debt,50);assert.equal(readStockExceptions((await f.context()).activity)[0].status,'RESOLVED');
});

test('late receipt and explicit repayment cross the month boundary without changing PO, payment evidence or old Loaded',async()=>{
 const f=scenario();f.tasks.forEach(t=>{t.finance={paidCents:10000,locked:true};});const original=JSON.stringify(f.tasks.map(t=>[t.po,t.procurement,t.finance]));
 await f.save(await f.request());const sent=await f.prepare();await f.packing(await f.loaded(sent.id,180));
 const before=(await f.context()).activity.filter(e=>e.action!=='PURCHASE_OPERATION_PREPARED'&&e.action!=='PURCHASE_OPERATION_RESULT');
 f.tasks[2].warehouse.accepted=100;
 const repay=createPlannerAllocationOperations({store:f.store,names,readWorkspace:f.context,now:()=>new Date('2026-12-01T01:00:00Z')});
 const req=await f.request({planMode:'REPAY',loanId:(await f.snapshot()).loans[0].id,quantity:50});await repay(req);await repay(req);
 assert.equal((await f.quantities()).debt,0);assert.equal((await f.quantities()).physical,270);assert.equal(JSON.stringify(f.tasks.map(t=>[t.po,t.procurement,t.finance])),original);
 const after=(await f.context()).activity;for(const event of before)assert.deepEqual(after.find(e=>e.title===event.title),event);
});
