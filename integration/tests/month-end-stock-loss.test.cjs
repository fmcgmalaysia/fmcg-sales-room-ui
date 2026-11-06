const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createStockExceptionOperations,stockExceptionVersion,stockPosition,readStockExceptions}=load('inventoryExceptions.js');
const {createStockResolutionOperations,stockResolutionVersion,stockTakePeriod}=load('stockExceptionResolution.js');
const {projectStockControlPage}=load('stockControlService.js');
const {projectStockValuationPage}=load('stockValuationService.js');
const {calculatePlanCosting}=load('purchasePlan.js');
const {projectWarehouseStockWorkspace}=load('warehouseDeliveryView.js');
const {projectStockWorkspace}=load('stockExceptionWorkspace.js');
const copy=value=>JSON.parse(JSON.stringify(value));
async function fixture(company='NCT'){
 const db=new Map(),names={NCT:{activity:'NCTActivity'},GHR:{activity:'NCTActivity1'}};
 let clock='2026-10-20T02:00:00Z',seq=0;
 const store={read:async(c,id)=>copy(db.get(c+'/'+id)||null),insert:async(c,row)=>{const id=c+'/'+row._id;if(db.has(id))throw Error('duplicate');db.set(id,copy(row));return copy(row);},remove:async(c,id)=>db.delete(c+'/'+id)};
 const costing=calculatePlanCosting({schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:100,freeCtn:0,prices:{lpPc:1,lpCtn:10,disc1:0,disc2:0,disc3:0}},100,10);
 const task={id:'T',company,customerId:'C',orderId:'O',sourceLineId:'L',barcode:'001',name:'Test',packing:'10x1',ea:10,ord:0,requested:0,specialPurchase:true,po:'PO-1',supplierId:'S',costCurrency:'MYR',netCostCtn:10,procurement:{totalCtn:100,customerCtn:0,costing},warehouse:{hasPhysicalReceipt:true,accepted:100}};
 const orders=[{id:'PO',taskIds:['T'],version:'PO-V',finance:{amounts:[],quantityClaims:[],payments:[],balanceCents:100000},documents:[]}];
 const activity=()=>[...db].filter(([id])=>id.startsWith(names[company].activity+'/')).map(([,row])=>copy(row));
 const context=async()=>({company,activity:activity(),tasks:[{...copy(task),warehouse:{...task.warehouse,stock:stockPosition('T',100,activity())}}],customers:[{id:'C',name:'Customer'}],suppliers:[{id:'S',name:'Supplier'}]});
 const staff=role=>({memberId:role,staffId:role,staffName:role,canReportStockException:role==='WAREHOUSE',canCloseStockException:role==='ACCOUNT',canApproveStockLoss:role==='ADMIN',canPlanStockResolution:role==='PURCHASE'});
 const now=()=>new Date(clock),report=createStockExceptionOperations({store,names,readContext:context,now}),resolve=createStockResolutionOperations({store,names,readContext:context,listOrders:async()=>orders,now});
 const request=async(role,input)=>({company,staff:staff(role),requestId:String(++seq).padStart(8,'0')+'-1111-4111-8111-111111111111',input:{reason:'Counted damaged cartons',version:input.action==='QUARANTINE'?stockExceptionVersion(await context()):stockResolutionVersion(await context(),orders),...input}});
 const reported=await report(await request('WAREHOUSE',{action:'QUARANTINE',sourceTaskId:'T',quantity:10,kind:'INTERNAL_DAMAGE'}));
 const id=readStockExceptions(activity())[0].id;
 const loss={action:'CLOSE',id,outcome:'LOSS',cents:10000,period:'2026-10',stockTakeConfirmed:true,goodsStatus:'PRESENT'};
 return {company,db,task,context,activity,request,resolve,loss,id,orders,staff,clock:value=>{clock=value;},close:async(input={})=>resolve(await request('ACCOUNT',{...loss,...input}))};
}
for(const company of ['NCT','GHR'])test(company+' Warehouse report quarantines once; Finance month-end loss preserves receipts, value and a disposal trail',async()=>{
 const f=await fixture(company),before=await f.context();
 assert.equal(before.tasks[0].warehouse.stock.availablePhysical,90);assert.equal(before.tasks[0].warehouse.stock.held,10);
 assert.equal(readStockExceptions(f.activity())[0].owner,'ACCOUNT');
 assert.equal(projectStockValuationPage(before).summary.valuation.knownValueCents,100000);
 await assert.rejects(f.close(),/month-end Stock Take/);
 f.clock('2026-10-30T16:00:00Z'); // 31 October in Malaysia
 const request=await f.request('ACCOUNT',f.loss);await f.resolve(request);await f.resolve(request);
 const after=await f.context(),stock=after.tasks[0].warehouse.stock;
 assert.equal(stock.received,100);assert.equal(stock.shipped,0);assert.equal(stock.availablePhysical,90);assert.equal(stock.held,0);
 const wh=projectStockControlPage(after),fin=projectStockValuationPage(after);
 assert.equal(wh.items[0].onHand,90);assert.equal(wh.items[0].awaitingDisposal,10);assert.equal(wh.items[0].physicalCustody,100);
 assert.equal(fin.quantityVersion,wh.version);assert.equal(fin.summary.valuation.knownValueCents,90000);
 assert.doesNotMatch(JSON.stringify(wh),/cents|cost|valuation|payment/i);
 const item=readStockExceptions(f.activity())[0],approval=copy(item.resolution.financeApproval);
 assert.equal(approval.cents,10000);assert.equal(approval.period,'2026-10');assert.equal(approval.before.isolated,10);assert.equal(approval.after.isolated,0);
 assert.equal(f.activity().filter(e=>e.action==='STOCK_EXCEPTION_RESOLUTION_SAVED').length,1,'same receipt creates no duplicate loss');
 await assert.rejects(f.close(),/Resolved stock cases/);
 const view=projectWarehouseStockWorkspace(projectStockWorkspace(after,f.orders,f.staff('WAREHOUSE')));
 assert.equal(view.cases[0].resolution.financeApproval.goodsStatus,'PRESENT');assert.doesNotMatch(JSON.stringify(view),/cents|cost|valuation|payment/i);
 const disposal=await f.request('WAREHOUSE',{action:'DISPOSE',id:f.id,quantity:10,reference:'DISPOSAL-1'});
 await f.resolve(disposal);await f.resolve(disposal);
 const final=await f.context(),finalRow=projectStockControlPage(final).items[0];
 assert.equal(finalRow.awaitingDisposal,0);assert.equal(finalRow.physicalCustody,90);assert.equal(finalRow.onHand,90);
 assert.deepEqual(copy(readStockExceptions(f.activity())[0].resolution.financeApproval),approval);
 assert.equal(projectStockValuationPage(final).summary.valuation.knownValueCents,90000);
 assert.equal(f.activity().filter(e=>e.action==='STOCK_EXCEPTION_RESOLUTION_SAVED').length,2);
 await assert.rejects(f.resolve(await f.request('WAREHOUSE',{action:'DISPOSE',id:f.id,quantity:10,reference:'SECOND'})),/awaiting disposal/);
 assert([...f.db.keys()].every(key=>key.startsWith(company==='NCT'?'NCTActivity/':'NCTActivity1/')));
});
test('only Finance closes loss; Warehouse cannot alter amount, prior approval or another company',async()=>{
 const f=await fixture();f.clock('2026-10-31T02:00:00Z');
 for(const role of ['WAREHOUSE','PURCHASE','SUPPORT','ADMIN'])await assert.rejects(f.resolve(await f.request(role,f.loss)),/not authorized/);
 await assert.rejects(f.resolve(await f.request('ADMIN',{action:'APPROVE_LOSS',id:f.id,cents:10000})),/separate Admin approval/);
 for(const cents of [0,9999,10001,null])await assert.rejects(f.close({cents}),/original source cost/);
 await assert.rejects(f.close({stockTakeConfirmed:false}),/Confirm Stock Take/);
 await assert.rejects(f.close({goodsStatus:'UNKNOWN'}),/Confirm Stock Take/);
 const wrong=await f.request('ACCOUNT',f.loss);wrong.company='GHR';await assert.rejects(f.resolve(wrong),/Stock case changed/);
 assert.equal((await f.context()).tasks[0].warehouse.stock.held,10);
});
test('stale and concurrent Stock Take confirmation do not duplicate loss or alter isolation twice',async()=>{
 const f=await fixture();f.clock('2026-10-31T02:00:00Z');
 const a=await f.request('ACCOUNT',f.loss),b=await f.request('ACCOUNT',f.loss);
 const results=await Promise.allSettled([f.resolve(a),f.resolve(b)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(f.activity().filter(e=>e.action==='STOCK_EXCEPTION_RESOLUTION_SAVED').length,1);
 assert.equal((await f.context()).tasks[0].warehouse.stock.availablePhysical,90);
});
test('month-end accepts leap-year and Malaysian boundaries but never future or pre-report periods',()=>{
 assert.equal(stockTakePeriod('2024-02','2024-02-28T16:00:00Z','2024-02-10T00:00:00Z'),'2024-02');
 assert.throws(()=>stockTakePeriod('2024-02','2024-02-28T15:59:59Z','2024-02-10T00:00:00Z'),/month-end/);
 assert.throws(()=>stockTakePeriod('2026-10','2026-11-30T00:00:00Z','2026-10-31T16:00:00Z'),/period containing/);
 assert.throws(()=>stockTakePeriod('2026-13','2026-11-30T00:00:00Z','2026-10-10T00:00:00Z'),/Select/);
});
test('missing source cost stays pending, and physical disposal cannot precede Finance closure',async()=>{
 const f=await fixture();f.clock('2026-10-31T02:00:00Z');
 await assert.rejects(f.resolve(await f.request('WAREHOUSE',{action:'DISPOSE',id:f.id,quantity:10,reference:'EARLY'})),/awaiting disposal/);
 const event=[...f.db.values()].find(e=>e.action==='STOCK_EXCEPTION_REPORTED');event.details.referenceCostCents=null;
 await assert.rejects(f.close(),/original source cost/);assert.equal((await f.context()).tasks[0].warehouse.stock.held,10);
});

test('CMS field ordering cannot invalidate disposal history; changing a closed amount is still rejected',async()=>{
 const f=await fixture();f.clock('2026-10-31T02:00:00Z');await f.close();
 await f.resolve(await f.request('WAREHOUSE',{action:'DISPOSE',id:f.id,quantity:10,reference:'DISPOSAL'}));
 const events=copy(f.activity()),event=events.find(e=>e.details?.action==='DISPOSE');
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reorder(item)])):value;
 event.details.state=reorder(event.details.state);assert.equal(readStockExceptions(events)[0].resolution.disposal.quantity,10);
 event.details.state.financeApproval.cents+=1;assert.throws(()=>readStockExceptions(events),/cannot be rewritten/);
});

test('loss and Finance stock value share confirmed cost; repriced or partial FOC stock cannot close silently',async()=>{
 const f=await fixture();f.clock('2026-10-31T02:00:00Z');
 f.task.procurement.costing=calculatePlanCosting({schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:100,freeCtn:0,prices:{lpPc:2,lpCtn:20,disc1:0,disc2:0,disc3:0}},100,10);
 await assert.rejects(f.close(),/cost changed or is unconfirmed/);
 f.task.procurement.totalCtn=110;
 f.task.procurement.costing=calculatePlanCosting({schema:1,mode:'FOC',moneySource:'PRICES',paidCtn:100,freeCtn:10,prices:{lpPc:1,lpCtn:10,disc1:0,disc2:0,disc3:0}},110,10);
 await assert.rejects(f.close(),/cost changed or is unconfirmed/);
 assert.equal((await f.context()).tasks[0].warehouse.stock.held,10);
 assert.equal(f.activity().filter(e=>e.action==='STOCK_EXCEPTION_RESOLUTION_SAVED').length,0);
});
test('real Desk: 480 authorized, 300 Loaded, isolate10; Purchase corrects only the unshipped batch and Support continues170',async()=>{
 const f=await require('./production-stock-contract.cjs').scenario('NCT',500);
 await f.split([300,200]);await f.plan(480);await f.delivery(480,'DELIVERY');await f.allocate(480);await f.pay(4800000,'PREPAY');
 const {createSupportDeskOperations,readSupportDesks}=load('supportDesk.js'),{packingVersion}=load('packingListOperations.js'),{createShortloadResolutionOperations}=load('shortloadResolution.js');
 const names={NCT:f.names},deskOps=createSupportDeskOperations({store:f.store,names,readContext:f.context}),resolve=createShortloadResolutionOperations({store:f.store,names,readContext:f.packingContext});
 let serial=10000;const request=async(input,department='SUPPORT')=>({company:'NCT',staff:{memberId:department,staffId:department,staffName:department,packingDepartment:department},requestId:String(++serial).padStart(8,'0')+'-1111-4111-8111-111111111111',input:{version:packingVersion(await f.packingContext()),...input}});
 const desk=async()=>readSupportDesks((await f.context()).activity,'NCT')[0];
 await deskOps(await request({action:'DESK_ASSIGN',customerId:'C',taskId:f.id,desk:1,revision:''}));
 const sent=await f.packingSave(await request({action:'DESK_SEND',customerId:'C',desk:1,deskRevision:(await desk()).revision,lines:[{taskId:f.id,quantity:480}]}));
 const current=async()=>(await f.packingContext()).lists.find(l=>l.id===sent.id);
 await f.packingSave(await request({action:'DESK_LOAD',id:sent.id,revision:(await current()).revision,taskId:f.id,loaded:300,reasonCodes:['INSUFFICIENT']},'WAREHOUSE'));
 await f.quarantine(10,'INTERNAL_DAMAGE');
 const paid=JSON.stringify((await f.po()).finance.payments),events=(await f.context()).activity.filter(e=>e.action==='WAREHOUSE_RECEIPT_SAVED');
 const {customerAllocationContext}=load('customerAllocationContext.js'),{allocationVersion,readAllocations}=load('plannerAllocation.js'),{planCustomerReconciliation}=load('customerAllocationPlan.js');
 const context=await f.context(),allocation=customerAllocationContext(context,context.activity,readAllocations(context.activity),allocationVersion(context,context.activity)),task=allocation.tasks.find(t=>t.id===f.id);
 assert.throws(()=>planCustomerReconciliation(allocation,{version:allocation.version,sourceTaskId:f.id,taskId:f.id,batchId:task.batches[0].id,quantity:290,reason:'Attempt to edit shipped batch'}),/Loaded|invoiced/);
 await f.allocate(470);
 let list=await current();await resolve(await request({action:'DESK_RESOLVE',id:list.id,revision:list.revision,taskId:f.id,deskRevision:(await desk()).revision,resolutionRevision:list.lines[0].resolution.revision,parts:[{mode:'CONTINUE',quantity:170},{mode:'TRANSFER',desk:2,quantity:10}]}));
 list=await current();await f.packingSave(await request({action:'DESK_LOAD',id:list.id,revision:list.revision,taskId:f.id,loaded:470,resolutionRevision:list.lines[0].resolution.revision,reasonCodes:[]},'WAREHOUSE'));
 const final=await f.task();assert.equal(final.warehouse.stock.shipped,470);assert.equal(final.warehouse.stock.availablePhysical,0);assert.equal(final.warehouse.stock.held,10);assert.equal(final.ord,500);
 assert.equal(JSON.stringify((await f.po()).finance.payments),paid);assert.deepEqual(copy((await f.context()).activity.filter(e=>e.action==='WAREHOUSE_RECEIPT_SAVED')),copy(events));
 assert.equal((await current()).lines[0].quantity,480,'original Warehouse authorization remains evidence');
 assert.equal((await current()).lines[0].loaded,470);
});
