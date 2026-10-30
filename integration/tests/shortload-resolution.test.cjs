const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {fixture}=require('../prototypes/stock-loaded-contract-20261028/check-current.cjs');
const {createShortloadResolutionOperations}=load('shortloadResolution.js'),{createSupportDeskOperations,readSupportDesks}=load('supportDesk.js'),{createPackingListOperations,packingVersion}=load('packingListOperations.js'),{projectPackingContext}=load('packingListContext.js'),{readSalesDemand}=load('salesOrderAdjustment.js'),{readPhysicalOutflows}=load('physicalOutflow.js'),{deskTaskPortions,shortloadStatus}=load('shortloadResolutionModel.js'),{projectDeskDeliverySummaries}=load('deskDelivery.js');
async function purchase(f){
 const activity=(await f.context('NCT')).activity,orders=[],tasks=[];
 for(const t of f.tasks){orders.push({title:t.orderId,sourceLineId:t.sourceLineId,submissionId:'SUB-'+t.id,customerId:t.customerId,customerCompanyName:t.customerId,description:t.barcode,image:t.name,imageAltText:t.packing,orderId:t.ea,orderQtyInCtn:100,transactionCurrency:'USD'});tasks.push({title:t.id,description:t.orderId,imageAltText:t.sourceLineId,purchaseQtyInCtn:100,ourPoNumber:t.po,supplierId:t.supplierId,lpCtn:60,lpPc:5,disc1:0,disc2:0,disc3:0});
 activity.push({title:'INTAKE-'+t.id,description:t.orderId,action:'ORDER_RECEIVED',result:'ACCEPTED',details:{submissionId:'SUB-'+t.id,taskIds:[t.id]}},{title:'PLAN-'+t.id,description:t.orderId,image:t.sourceLineId,imageAltText:t.id,action:'PURCHASE_PLAN_SAVED',result:'SAVED',activityTime:'2026-10-28T00:00:00Z',details:{beforeRevision:'',totalCtn:100,extraCtn:0}},{title:'RECEIVED-'+t.id,description:t.po,action:'WAREHOUSE_RECEIPT_SAVED',result:'SAVED',activityTime:'2026-10-28T00:00:00Z',details:{beforeRevision:'',lines:[{taskId:t.id,orderId:t.orderId,sourceLineId:t.sourceLineId,beforeAccepted:0,beforeRejected:0,accepted:t.warehouse.accepted,rejected:0,issue:false}]}});
 }
 return {...load('purchaseProjection.js').projectPurchaseWorkspace({company:'NCT',orders,tasks,activity,suppliers:[],staff:f.staff}),activity};
}
async function setup(initial=90,borrow=0,split=false,twoRows=false){
 const f=fixture(),names={NCT:{activity:'N'},GHR:{activity:'G'}};let tick=0;const now=()=>new Date(Date.UTC(2026,9,31,0,0,tick++));
 for(const task of f.tasks){task.warehouse.accepted=100;task.inc=100;}
 for(const id of ['A','B'])f.records.get('N/ALLOCATION-'+id).details.targets=[{taskId:id,quantity:100}];
 if(borrow){f.tasks[0].warehouse.accepted=100-borrow;f.records.get('N/ALLOCATION-A').details.targets=[{taskId:'A',quantity:100-borrow}];const detail=f.records.get('N/ALLOCATION-B').details;detail.targets=[{taskId:'A',quantity:borrow},{taskId:'B',quantity:100-borrow}];detail.loanChanges=[{id:'SYNTHETIC-LOAN',beforeRevision:'',state:{id:'SYNTHETIC-LOAN',borrowerTaskId:'A',lenderTaskId:'B',quantity:borrow,outstanding:borrow,sources:[{sourceTaskId:'B',quantity:borrow,lenderBatchId:'WHOLE'}]}}];}
 if(twoRows)f.tasks[1].customerId='CUSTOMER-A';
 const context=async company=>{const ctx=await f.context(company);for(const task of ctx.tasks){const demand=readSalesDemand(task.id,100,ctx.activity);task.ord=task.requested=demand.requested;task.salesDemandRevision=demand.revision;task.inc=ctx.allocations.flatMap(row=>row.targets).filter(row=>row.taskId===task.id).reduce((n,row)=>n+row.quantity,0);}return ctx;};
 const packingContext=async company=>projectPackingContext(await context(company)),save=createPackingListOperations({store:f.store,names,readContext:packingContext,now}),resolve=createShortloadResolutionOperations({store:f.store,names,readContext:packingContext,now});
 const state=async()=>readSupportDesks((await context('NCT')).activity,'NCT').find(row=>row.customerId==='CUSTOMER-A');
 const request=async(input,department='SUPPORT')=>({company:'NCT',staff:{...f.staff,packingDepartment:department},requestId:f.nextId(),input:{version:packingVersion(await packingContext('NCT')),...input}});
 const assign=createSupportDeskOperations({store:f.store,names,readContext:context,now});await assign(await request({action:'DESK_ASSIGN',taskId:'A',customerId:'CUSTOMER-A',desk:1,revision:''}));
 if(split){const {createSalesOrderAdjustmentOperations,salesAdjustmentVersion}=load('salesOrderAdjustment.js'),{readShipmentPlans,shipmentPlanVersion}=load('customerShipmentPlan.js');const adjust=createSalesOrderAdjustmentOperations({store:f.store,names,readContext:context,readPlans:readShipmentPlans,planVersion:shipmentPlanVersion,now});await adjust({company:'NCT',staff:{...f.staff,customerId:'CUSTOMER-A'},requestId:f.nextId(),input:{action:'ADJUST',mode:'SPLIT',quantity:60,taskId:'A',customerId:'CUSTOMER-A',orderId:'ORDER-A',version:salesAdjustmentVersion(await context('NCT'),shipmentPlanVersion)}});}
 if(twoRows)await assign(await request({action:'DESK_ASSIGN',taskId:'B',customerId:'CUSTOMER-A',desk:1,revision:(await state()).revision}));
 const send=async(desk=1,quantity=100)=>save(await request({action:'DESK_SEND',customerId:'CUSTOMER-A',desk,deskRevision:(await state()).revision,lines:[{taskId:'A',quantity},...(twoRows&&desk===1?[{taskId:'B',quantity:100}]:[])]}));
 const loading=async(list,loaded)=>save(await request({action:'DESK_LOAD',id:list.id,revision:list.revision,taskId:'A',loaded,resolutionRevision:list.lines[0].resolution?.revision||'',reasonCodes:loaded<list.lines[0].quantity?['INSUFFICIENT']:[]},'WAREHOUSE'));
 const sent=await send();await loading(sent.list,initial);
 const current=async(id=sent.id)=>(await packingContext('NCT')).lists.find(row=>row.id===id);
 const decision=async parts=>{const list=await current();return request({action:'DESK_RESOLVE',id:list.id,revision:list.revision,taskId:'A',deskRevision:(await state()).revision,resolutionRevision:list.lines[0].resolution.revision,parts});};
 const stock=async()=>{const row=load('stockCardProjection.js').projectStockCard(await context('NCT')).items[0];return {onHand:row.onHand,free:row.available,reserved:row.reservedUsable};};
 return {...f,context,stock,packingContext,save,resolve,state,request,send,loading,current,decision};
}
test('continue 10 clears the exception to pending, then Loaded posts only the additional 10',async()=>{
 const f=await setup(),before=await f.stock();assert.equal(before.onHand,110);
 await f.resolve(await f.decision([{mode:'CONTINUE',quantity:10}]));const list=await f.current();assert.equal(list.lines[0].resolution.issue,false);assert.equal(list.lines[0].resolution.pending,true);assert.equal((await f.stock()).onHand,110);
 await f.loading(list,100);assert.equal((await f.stock()).onHand,100);assert.equal((await f.current()).lines[0].resolution.pending,false);
});
test('transfer 10 retains 90 on the original Desk and fences the old Warehouse form',async()=>{
 const f=await setup(),old=await f.current();await f.resolve(await f.decision([{mode:'TRANSFER',desk:2,quantity:10}]));
 const ctx=await f.context('NCT'),parts=deskTaskPortions(ctx.activity,await f.state(),ctx.tasks[0],readPhysicalOutflows(ctx.activity));assert.deepEqual(JSON.parse(JSON.stringify(parts)),[{desk:1,quantity:90,loaded:90,allocated:90},{desk:2,quantity:10,loaded:0,allocated:10}]);
 await assert.rejects(f.loading(old,100),/resolved by Support/);assert.equal((await f.stock()).onHand,110);
 const sent=await f.send(2,10);await f.loading(sent.list,10);assert.equal((await f.stock()).onHand,100);assert.equal(projectDeskDeliverySummaries((await f.context('NCT')).activity)[0].issue,false);
});
test('cancel 10 atomically releases only unshipped ownership and reduces demand, without changing physical stock',async()=>{
 const f=await setup();await f.resolve(await f.decision([{mode:'CANCEL',quantity:10}]));const ctx=await f.context('NCT');assert.equal(ctx.tasks[0].ord,90);assert.equal(ctx.tasks[0].inc,90);assert.equal((await f.stock()).onHand,110);assert.equal((await f.stock()).free,10);assert.equal((await f.current()).lines[0].resolution.issue,false);
});
test('mixed transfer 6 and cancellation 4 preserves a total of 96 customer cartons',async()=>{
 const f=await setup();await f.resolve(await f.decision([{mode:'TRANSFER',desk:2,quantity:6},{mode:'CANCEL',quantity:4}]));const ctx=await f.context('NCT'),parts=deskTaskPortions(ctx.activity,await f.state(),ctx.tasks[0],readPhysicalOutflows(ctx.activity));assert.equal(parts.reduce((n,row)=>n+row.quantity,0),96);assert.equal(parts.find(row=>row.desk===2).allocated,6);assert.equal((await f.stock()).free,4);
});
test('lost acknowledgement reuses the same resolution and stock release exactly once',async()=>{
 const f=await setup(),request=await f.decision([{mode:'CANCEL',quantity:10}]);f.lose('DESK_SHORTLOAD_RESOLVED');await assert.rejects(f.resolve(request),/lost acknowledgement/);const result=await f.resolve(request);assert(result.resolutionId);await f.resolve(request);assert.equal((await f.context('NCT')).activity.filter(row=>row.action==='DESK_SHORTLOAD_RESOLVED').length,1);assert.equal((await f.stock()).free,10);
});
test('Warehouse, wrong company, incomplete decisions, duplicate decisions and stale loading are rejected',async()=>{
 const f=await setup(),request=await f.decision([{mode:'CANCEL',quantity:10}]);await assert.rejects(f.resolve({...request,staff:{...request.staff,packingDepartment:'WAREHOUSE'}}),/require Support/);await assert.rejects(f.resolve({...request,company:'GHR'}),/changed/);await assert.rejects(f.resolve(await f.decision([{mode:'CANCEL',quantity:9}])),/exactly/);
 await f.resolve(request);await assert.rejects(f.resolve({...request,requestId:f.nextId()}),/changed/);assert.equal((await f.stock()).free,10);
});
test('a new short load after continuation reopens the remaining exception',async()=>{
 const f=await setup();await f.resolve(await f.decision([{mode:'CONTINUE',quantity:10}]));await f.loading(await f.current(),95);const list=await f.current();assert.equal(list.lines[0].resolution.issue,true);assert.equal(list.lines[0].resolution.remaining,5);
});
test('zero Loaded can cancel the entire demand without an outflow',async()=>{
 const f=await setup(0);await f.resolve(await f.decision([{mode:'CANCEL',quantity:100}]));const ctx=await f.context('NCT');assert.equal(ctx.tasks[0].ord,0);assert.equal(ctx.tasks[0].inc,0);assert.equal(readPhysicalOutflows(ctx.activity).length,0);assert.equal((await f.stock()).onHand,200);assert.equal((await f.stock()).free,100);
});
for(const order of [[1,2],[2,1]])test('Desk invoices consume their own Loaded references in order '+order.join(' then '),async()=>{
 const f=await setup();await f.resolve(await f.decision([{mode:'TRANSFER',desk:2,quantity:10}]));const second=await f.send(2,10);await f.loading(second.list,10);
 const {createSupportInvoiceOperations,supportInvoiceState}=load('supportInvoice.js'),{createCustomerFulfilmentOperations}=load('customerFulfilment.js'),names={NCT:{activity:'N'}},readRates=async()=>[{currency:'USD',rateToMyr:4}],saveFulfilment=createCustomerFulfilmentOperations({store:f.store,names,readContext:f.context,readRates});
 const invoice=createSupportInvoiceOperations({store:f.store,names,readContext:f.context,saveFulfilment,readRates});
 for(const desk of order){const ctx=await f.context('NCT'),readiness=supportInvoiceState(ctx),quantity=desk===1?90:10;assert.equal(readiness.deskLines.find(row=>row.desk===desk).maxInvoiceQty,quantity);
  await invoice(await f.request({version:readiness.version,desk:{number:desk,revision:(await f.state()).revision},customerId:'CUSTOMER-A',orderId:'ORDER-A',number:'SYNTHETIC-DESK-'+desk,lines:[{taskId:'A',quantity}]}));
 }
 const shipments=load('customerShipmentLedger.js').readCustomerShipments((await f.context('NCT')).activity);assert.equal(shipments.length,2);for(const shipment of shipments){assert.equal(shipment.lines[0].quantity,shipment.desk===1?90:10);const flows=readPhysicalOutflows((await f.context('NCT')).activity);assert(shipment.lines[0].physicalOutflowRefs.every(ref=>flows.find(flow=>flow.id===ref.id).desk===shipment.desk));}assert.equal((await f.stock()).onHand,100);
});
test('original 90 can be invoiced while the next Desk 10 is still awaiting loading',async()=>{
 const f=await setup();await f.resolve(await f.decision([{mode:'TRANSFER',desk:2,quantity:10}]));await f.send(2,10);
 const {createSupportInvoiceOperations,supportInvoiceState}=load('supportInvoice.js'),{createCustomerFulfilmentOperations}=load('customerFulfilment.js'),names={NCT:{activity:'N'}},readRates=async()=>[{currency:'USD',rateToMyr:4}],saveFulfilment=createCustomerFulfilmentOperations({store:f.store,names,readContext:f.context,readRates});
 const invoice=createSupportInvoiceOperations({store:f.store,names,readContext:f.context,saveFulfilment,readRates}),state=supportInvoiceState(await f.context('NCT'));
 assert.equal(state.deskLines.find(row=>row.desk===1).maxInvoiceQty,90);assert.equal(state.deskLines.find(row=>row.desk===2).maxInvoiceQty,0);
 await invoice(await f.request({version:state.version,desk:{number:1,revision:(await f.state()).revision},customerId:'CUSTOMER-A',orderId:'ORDER-A',number:'SYNTHETIC-FIRST-90',lines:[{taskId:'A',quantity:90}]}));assert.equal((await f.stock()).onHand,110);
});
test('cancelling unshipped borrowed 10 returns ownership to B and retains debt for the 20 already Loaded',async()=>{
 const f=await setup(90,30);await f.resolve(await f.decision([{mode:'CANCEL',quantity:10}]));const ctx=await f.context('NCT'),loans=load('customerAllocationContext.js').readAllocationLoans(ctx.activity);assert.equal(loans[0].outstanding,20);assert.equal(ctx.tasks[0].inc,90);assert.equal(ctx.tasks[1].inc,80);assert.equal((await f.stock()).onHand,80);assert.equal((await f.stock()).free,0);
});
test('zero loading cancellation returns all borrowed 30 and only releases owned 70 as free stock',async()=>{
 const f=await setup(0,30);await f.resolve(await f.decision([{mode:'CANCEL',quantity:100}]));const ctx=await f.context('NCT');assert.equal(load('customerAllocationContext.js').readAllocationLoans(ctx.activity)[0].outstanding,0);assert.equal(ctx.tasks[1].inc,100);assert.equal((await f.stock()).onHand,170);assert.equal((await f.stock()).free,70);
});
test('cancellation does not clear quarantine or advertise damaged cartons as free stock',async()=>{
 const f=await setup(),{createStockExceptionOperations,stockExceptionVersion,readStockExceptions}=load('inventoryExceptions.js'),save=createStockExceptionOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.context});
 await save({company:'NCT',staff:{...f.staff,canReportStockException:true},requestId:f.nextId(),input:{action:'QUARANTINE',sourceTaskId:'A',quantity:10,kind:'INTERNAL_DAMAGE',reason:'Synthetic damaged remainder',version:stockExceptionVersion(await f.context('NCT'))}});
 await f.resolve(await f.decision([{mode:'CANCEL',quantity:10}]));const ctx=await f.context('NCT');assert.equal(ctx.tasks[0].inc,90);assert.equal(readStockExceptions(ctx.activity)[0].quantity,10);assert.equal((await f.stock()).onHand,110);assert.equal((await f.stock()).free,0);
});
test('partial continuation 4 plus transfer 6 permits only 4 more on the original Desk',async()=>{
 const f=await setup();await f.resolve(await f.decision([{mode:'CONTINUE',quantity:4},{mode:'TRANSFER',desk:2,quantity:6}]));await f.send(2,6);await f.loading(await f.current(),94);assert.equal((await f.stock()).onHand,106);assert.equal((await f.current()).lines[0].resolution.issue,false);await assert.rejects(f.loading(await f.current(),95),/resolved by Support/);
});
test('concurrent Warehouse completion and Support cancellation cannot both consume the remaining 10',async()=>{
 const f=await setup(),decision=await f.decision([{mode:'CANCEL',quantity:10}]),list=await f.current();const results=await Promise.allSettled([f.resolve(decision),f.loading(list,100)]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);const ctx=await f.context('NCT'),loaded=readPhysicalOutflows(ctx.activity).filter(row=>row.taskId==='A').reduce((n,row)=>n+row.quantity,0);assert.equal(ctx.tasks[0].inc,loaded);assert([90,100].includes(loaded));
});
test('a simultaneous Desk edit prevents a stale resolution without partially releasing stock',async()=>{
 const f=await setup(),decision=await f.decision([{mode:'CANCEL',quantity:10}]),assign=createSupportDeskOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.context}),insert=f.store.insert;let intercepted=false;
 f.store.insert=async(collection,row)=>{if(row.action==='DESK_SHORTLOAD_RESOLVED'&&!intercepted){intercepted=true;await assign(await f.request({action:'DESK_REFERENCES',customerId:'CUSTOMER-A',desk:1,revision:(await f.state()).revision,soNo:'SYNTHETIC-NEW',poNo:''}));}return insert(collection,row);};
 await assert.rejects(f.resolve(decision),/duplicate|changed/);const ctx=await f.context('NCT');assert.equal(ctx.tasks[0].ord,100);assert.equal(ctx.tasks[0].inc,100);assert.equal((await f.current()).lines[0].resolution.issue,true);
});

test('cancellation after Purchase reconciles allocation does not release stock twice',async()=>{
 const f=await setup();const before=await f.context('NCT'),old=before.allocations.find(row=>row.sourceTaskId==='A');
 await f.store.insert('N',{_id:'SYNTHETIC-RECONCILED',title:'SYNTHETIC-RECONCILED',imageAltText:'A',action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',activityTime:'2026-10-31T01:00:00Z',details:{beforeRevision:old.revision,targets:[{taskId:'A',quantity:90}]}});
 await f.resolve(await f.decision([{mode:'CANCEL',quantity:10}]));assert.equal((await f.stock()).free,10);assert.equal((await f.context('NCT')).tasks[0].requested,90);
});
test('existing Sales split keeps batch ownership through cancellation and subsequent increase',async()=>{
 const f=await setup(90,0,true);await f.resolve(await f.decision([{mode:'CANCEL',quantity:10}]));const {readShipmentPlans,shipmentPlanVersion}=load('customerShipmentPlan.js'),{createSalesOrderAdjustmentOperations,salesAdjustmentVersion}=load('salesOrderAdjustment.js');let ctx=await f.context('NCT'),p=readShipmentPlans(ctx.activity)[0];assert.deepEqual(JSON.parse(JSON.stringify(p.batches.map(row=>row.lines[0].quantity))),[60,30]);
 const view=load('customerAllocationContext.js').customerAllocationContext(ctx,ctx.activity,ctx.allocations,'');assert.equal(view.sources.find(row=>row.id==='A').targets[0].quantity,90);
 const adjust=createSalesOrderAdjustmentOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.context,readPlans:readShipmentPlans,planVersion:shipmentPlanVersion});await adjust({company:'NCT',staff:{...f.staff,customerId:'CUSTOMER-A'},requestId:f.nextId(),input:{action:'ADJUST',mode:'INCREASE',quantity:5,batchId:p.id+'|2',taskId:'A',customerId:'CUSTOMER-A',orderId:'ORDER-A',version:salesAdjustmentVersion(ctx,shipmentPlanVersion)}});ctx=await purchase(f);assert.equal(ctx.tasks[0].requested,95);assert.equal(ctx.tasks[0].inc,90);assert.equal(load('stockCardProjection.js').projectStockCard(ctx).items[0].available,10);
});
test('interrupted resolution is offered only to its original operator and reuses the same request',async()=>{
 const f=await setup(),request=await f.decision([{mode:'CANCEL',quantity:10}]),{pendingShortloadResolutions}=load('shortloadResolution.js');f.lose('DESK_SHORTLOAD_RESOLVED');await assert.rejects(f.resolve(request),/lost/);let activity=(await f.context('NCT')).activity;const pending=pendingShortloadResolutions(activity,'NCT',f.staff.memberId);assert.equal(pending.length,1);assert.equal(pending[0].requestId,request.requestId);assert.equal(pendingShortloadResolutions(activity,'NCT','OTHER').length,0);await f.resolve({...request,input:pending[0].input});activity=(await f.context('NCT')).activity;assert.equal(pendingShortloadResolutions(activity,'NCT',f.staff.memberId).length,0);
});

for(const mode of ['CONTINUE','TRANSFER','CANCEL'])test('Purchase reads the same '+mode+' disposition without changing supplier purchase quantities',async()=>{
 const f=await setup();await f.resolve(await f.decision([{mode,quantity:10,...(mode==='TRANSFER'?{desk:2}:{})}]));const result=await purchase(f),row=result.tasks.find(row=>row.id==='A');assert.equal(row.ord,mode==='CANCEL'?90:100);assert.equal(row.inc,mode==='CANCEL'?90:100);assert.equal(row.procurement.totalCtn,100);assert.equal(row.warehouse.accepted,100);assert.equal(result.deskDeliveries.find(row=>row.taskId==='A').issue,false);assert.equal(result.deskDeliveries.find(row=>row.taskId==='A').pending,mode==='CONTINUE');assert.equal(load('stockCardProjection.js').projectStockCard(result).items[0].available,mode==='CANCEL'?10:0);
});
test('next Desk shipment details accept the transferred task currency without moving the whole task',async()=>{
 const f=await setup();await f.resolve(await f.decision([{mode:'TRANSFER',desk:2,quantity:10}]));const save=createSupportDeskOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.context});await save(await f.request({action:'DESK_SHIPMENT',customerId:'CUSTOMER-A',desk:2,revision:(await f.state()).revision,transport:'',date:'',arrival:'',lastGateIn:'',departureDate:'',details:{poNo:'',soNo:'',invoiceNoDraft:'',depositAmountCents:100,depositDate:'',depositCurrency:'USD'}}));assert.equal((await f.state()).references.find(row=>row.desk===2).depositAmountCents,100);
});

test('Support resolves a confirmed short line while another line in the same Desk is still loading',async()=>{
 const f=await setup(90,0,false,true);assert.equal((await f.current()).status,'PROCESSING');await f.resolve(await f.decision([{mode:'TRANSFER',desk:2,quantity:10}]));const list=await f.current();assert.equal(list.lines[0].resolution.issue,false);await f.save(await f.request({action:'DESK_LOAD',id:list.id,revision:list.revision,taskId:'B',loaded:100,reasonCodes:[]},'WAREHOUSE'));assert.equal((await f.current()).status,'COMPLETED');assert.equal((await f.stock()).onHand,10);
});
