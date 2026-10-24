const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),load=require('./load-master-module.cjs');
const {createCurrentPackingService}=require('../prototypes/stock-current-state/current-packing-service.cjs');
const {createPackingPhotoFencedStore}=require('../prototypes/stock-current-state/packing-photo-fenced-store.cjs');
const {createCurrentPurchaseBorrowGateway}=require('../prototypes/stock-current-state/current-purchase-borrow-gateway.cjs');
const {createBorrowCurrentQuery}=require('../prototypes/stock-current-state/borrow-current-query.cjs');
const {createCurrentSalesDemandSave}=require('../prototypes/stock-current-state/current-sales-save.cjs');
const {readCurrentSalesWorkspace}=require('../prototypes/stock-current-state/sales-current-workspace.cjs');
const {createSalesOrderAdjustmentOperations,salesAdjustmentVersion}=load('salesOrderAdjustment.js');
const {readShipmentPlans,shipmentPlanVersion}=load('customerShipmentPlan.js');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
const {WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs');
const copy=value=>JSON.parse(JSON.stringify(value)),folder=path.join(__dirname,'../prototypes/stock-current-state');
const filename=require.resolve('./stock-current-warehouse-receipt-web.test.cjs');
const warehouseFixture=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',
 {require:createRequire(filename),__dirname,Map});

// One mock SDK/database and one real candidate coordinator across original roots.
// Starts with approved PO tasks and zero physical stock, NOT with preseeded claims
// or a packing draft. It does not exercise real Wix, order intake or PO issuance.
async function fixture(company){
 const f=await warehouseFixture(company,true,2,100),warehouseMember=await f.deps.readMember(),warehouseRows=await f.deps.readStaffRecords();
 const supportMember={_id:'SM',status:'APPROVED',loginEmail:'support@example.test'},supportRows=[{
  title:'S',description:'SM',staffEmail:supportMember.loginEmail,staffName:'Support',staffStatus:'ACTIVE',departments:['SUPPORT']}];
 const purchaseMember={_id:'PM',status:'APPROVED',loginEmail:'purchase@example.test'},purchaseRows=[{
  title:'P',description:'PM',staffEmail:purchaseMember.loginEmail,staffName:'Purchase',staffStatus:'ACTIVE',departments:['PURCHASE']}];
 let selected='WAREHOUSE';
 f.deps.readMember=async()=>copy(selected==='WAREHOUSE'?warehouseMember:selected==='PURCHASE'?purchaseMember:supportMember);
 f.deps.readStaffRecords=async()=>copy(selected==='WAREHOUSE'?warehouseRows:selected==='PURCHASE'?purchaseRows:supportRows);
 f.context.tasks.forEach(task=>{task.transactionCurrency='USD';});
 const bindings={...f.bindings,...load('packingListContext.js'),...load('packingListOperations.js'),
  createCurrentPackingService,createPackingPhotoFencedStore,PURCHASE_CURRENT_PROJECTION_VERSION:2};
 let source=fs.readFileSync(path.join(folder,'stockCurrentPacking.js'),'utf8');
 source=source.replace('const writerCoverage=Object.freeze({});','const writerCoverage=Object.freeze('+JSON.stringify(Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])))+');');
 const create=vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return createCurrentMasterPacking;})()',bindings);
 let sequence=20;
 async function root(department){selected=department;return create({company,department,authenticateOriginalPacking:async()=>bindings.requirePackingStaff(await f.deps.readMember(),await f.deps.readStaffRecords(),department)});}
 async function read(department){return(await root(department)).read();}
 async function command(department,action,details={}){
  const endpoint=await root(department),state=await endpoint.read(),current=details.id?state.lists.find(list=>list.id===details.id):null;
  const request={requestId:'44444444-4444-4444-8444-'+String(sequence++).padStart(12,'0'),
   stockProtocol:1,stockBuild:'TEST',stockGeneration:state.stockCurrent.stockGeneration,
   stockIdentity:{staffId:state.staff.staffId,memberId:state.staff.memberId},
   input:{action,version:state.version,...(current?{revision:current.revision}:{}),...details}};
  const result=await endpoint.save(request);assert.equal(result.ok,true,action);
  assert.deepEqual(copy(await endpoint.save(request)),copy(result),'same original request replays once: '+action);
  return result;
 }
 const requirePurchaseStaff=load('purchaseProjection.js').requirePurchaseStaff;
 const authenticatePurchase=async()=>({...requirePurchaseStaff(await f.deps.readMember(),await f.deps.readStaffRecords()),memberId:(await f.deps.readMember())._id});
 const borrowBindings={...bindings,requirePurchaseStaff,createCurrentPurchaseBorrowGateway,operationId:hash,getPurchaseStaffContext:authenticatePurchase};
 let borrowSource=fs.readFileSync(path.join(folder,'stockCurrentBorrow.web.js'),'utf8');
 borrowSource=borrowSource.replace('const writerCoverage = Object.freeze({});','const writerCoverage = Object.freeze('+JSON.stringify(Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])))+');');
 const borrowApi=vm.runInNewContext('(function(){'+borrowSource.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return{getPurchaseBorrowOptionsCurrent,savePurchaseBorrowingCurrent};})()',borrowBindings);
 const relations=createBorrowCurrentQuery({company,items:f.items,protocol:f.protocol,authenticate:authenticatePurchase});
 return{...f,read,command,root,borrowApi,relations,select:department=>{selected=department;}};
}
const physical=f=>copy([...f.db].filter(([key])=>key.startsWith('StockPositions/')||key.startsWith('StockClaims/')));
const balances=f=>[...f.db].filter(([key])=>key.startsWith('StockProducts/')).map(([,row])=>[row.onHand,row.reservedUsable,row.available,row.isolated]);
const listById=(read,id)=>read.lists.find(list=>list.id===id);

test('same database: original PO receipt → Support draft/send → Warehouse Loaded, both companies, no inventory deduction/invoice',async()=>{
 for(const company of ['NCT','GHR']){
  const f=await fixture(company);
  assert.equal(physical(f).length,0);assert.deepEqual(balances(f),[[0,0,0,0],[0,0,0,0]]);
  const empty=await f.read('SUPPORT');assert.equal(empty.lists.length,0);assert.deepEqual(copy(empty.tasks.map(task=>task.ready)),[0,0]);
  f.select('WAREHOUSE');assert.equal((await f.api.saveWarehouseReceiptCurrent(company,f.initial)).ok,true);
  const received=await f.read('SUPPORT');assert.deepEqual(copy(received.tasks.map(task=>task.ready)),[100,100]);
  assert.deepEqual(balances(f),[[100,100,0,0],[100,100,0,0]]);const before=physical(f);
  const draft=await f.command('SUPPORT','CREATE',{customerId:'C',currency:'USD',lines:f.context.tasks.map(task=>({taskId:task.id,quantity:100}))});
  assert.equal((await f.read('WAREHOUSE')).lists.length,0,'unsent Support draft is not an outgoing Warehouse task');
  await f.command('SUPPORT','SEND',{id:draft.id});const outgoing=await f.read('WAREHOUSE');
  assert.equal(listById(outgoing,draft.id).status,'SENT');assert.equal(outgoing.tasks.length,0);
  assert.equal((await f.read('SUPPORT')).tasks.every(task=>task.readyToArrange===0),true,'sent lines cannot be assigned twice');
  await f.command('WAREHOUSE','START',{id:draft.id});
  await f.command('WAREHOUSE','PROGRESS',{id:draft.id,lines:f.context.tasks.map(task=>({taskId:task.id,packed:100,loaded:100,reason:''}))});
  await f.command('WAREHOUSE','COMPLETE',{id:draft.id});
  const final=listById(await f.read('SUPPORT'),draft.id);assert.equal(final.status,'COMPLETED');
  assert.deepEqual(copy(final.lines.map(line=>[line.quantity,line.packed,line.loaded])),[[100,100,100],[100,100,100]]);
  assert.deepEqual(copy(final.remainders),[]);assert.deepEqual(physical(f),before,'Loaded is not physical exit');
  assert.deepEqual(balances(f),[[100,100,0,0],[100,100,0,0]]);
  assert.equal(final.invoiceId,undefined);assert.equal(final.dispatchedAt,undefined);
  assert.equal([...f.db.values()].filter(row=>row.action==='WAREHOUSE_RECEIPT_SAVED').length,1);
  assert.equal([...f.db.values()].filter(row=>row.action==='SUPPORT_PACKING_LIST_CURRENT').length,1);
  assert.equal([...f.db.values()].some(row=>row.action==='CUSTOMER_SHIPMENT_CHANGED'),false);
  assert.equal((await f.protocol.readControl()).generation,6,'one receipt plus five distinct packing saves; replay never duplicates');
 }
});

test('same received stock: container-full remainder stays customer-reserved and only remainder can enter next list',async()=>{
 const f=await fixture('NCT');f.select('WAREHOUSE');await f.api.saveWarehouseReceiptCurrent('NCT',f.initial);const before=physical(f);
 const first=await f.command('SUPPORT','CREATE',{customerId:'C',currency:'USD',lines:[{taskId:'A',quantity:100},{taskId:'B',quantity:100}]});
 await f.command('SUPPORT','SEND',{id:first.id});await f.command('WAREHOUSE','START',{id:first.id});
 await f.command('WAREHOUSE','PROGRESS',{id:first.id,lines:[{taskId:'A',packed:100,loaded:80,reason:'Container full'},{taskId:'B',packed:100,loaded:100,reason:''}]});
 await f.command('WAREHOUSE','COMPLETE',{id:first.id});
 const support=await f.read('SUPPORT'),remainder=listById(support,first.id).remainders;
 assert.deepEqual(copy(remainder),[{taskId:'A',quantity:20,packed:20,reason:'Container full'}]);
 assert.equal(support.tasks.find(task=>task.taskId==='A').readyToArrange,20);
 assert.equal(support.tasks.find(task=>task.taskId==='B').readyToArrange,0);
 const next=await f.command('SUPPORT','CREATE',{customerId:'C',currency:'USD',lines:[{taskId:'A',quantity:20}]});
 await f.command('SUPPORT','SEND',{id:next.id});
 assert.equal((await f.read('SUPPORT')).tasks.find(task=>task.taskId==='A').readyToArrange,0);
  const generation=(await f.protocol.readControl()).generation;
  await assert.rejects(f.command('WAREHOUSE','REOPEN',{id:first.id,reason:'Recheck loading'}),/Usable customer stock/,
   'reopening cannot reclaim the remainder already sent on a second list');
  assert.equal((await f.protocol.readControl()).generation,generation);
 assert.deepEqual(physical(f),before,'remainder does not become free stock or leave the warehouse');
 assert.deepEqual(balances(f),[[100,100,0,0],[100,100,0,0]]);
});

test('same PO partial delivery does not satisfy draft until actual second receipt; no stock inferred from planned PO',async()=>{
 const f=await fixture('NCT');f.initial.input.lines.forEach(line=>Object.assign(line,{accepted:40,kind:'PARTIAL',reason:'More to arrive'}));
 f.select('WAREHOUSE');assert.equal((await f.api.saveWarehouseReceiptCurrent('NCT',f.initial)).ok,true);
 let support=await f.read('SUPPORT');assert.deepEqual(copy(support.tasks.map(task=>task.ready)),[40,40]);
 const draft=await f.command('SUPPORT','CREATE',{customerId:'C',currency:'USD',lines:[{taskId:'A',quantity:50}]});
 const generation=(await f.protocol.readControl()).generation;
 await assert.rejects(f.command('SUPPORT','SEND',{id:draft.id}),/Usable customer stock/);
 assert.equal((await f.protocol.readControl()).generation,generation);
 f.select('WAREHOUSE');
 const original=await f.bindings.readFulfilmentContext('NCT');
 const orders=f.bindings.projectWarehouseOrders({company:'NCT',purchaseOrders:f.bindings.projectPurchaseOrders({company:'NCT',workspace:original,records:[]}),tasks:original.tasks,activity:original.activity});
 const receipt=copy(f.initial);receipt.requestId='55555555-5555-4555-8555-555555555555';receipt.stockGeneration=generation;receipt.input.version=orders[0].version;
 receipt.input.lines.forEach(line=>Object.assign(line,{accepted:60,kind:'DELIVERY',reason:'',resolveIssue:true}));
 assert.equal((await f.api.saveWarehouseReceiptCurrent('NCT',receipt)).ok,true);
 support=await f.read('SUPPORT');assert.deepEqual(copy(support.tasks.map(task=>task.ready)),[100,100]);
 await f.command('SUPPORT','SEND',{id:draft.id});await f.command('WAREHOUSE','START',{id:draft.id});
 await f.command('WAREHOUSE','PROGRESS',{id:draft.id,lines:[{taskId:'A',packed:50,loaded:50,reason:''}]});
 await f.command('WAREHOUSE','COMPLETE',{id:draft.id});
 assert.equal(listById(await f.read('SUPPORT'),draft.id).lines[0].loaded,50);
 assert.deepEqual(balances(f),[[100,100,0,0],[100,100,0,0]]);
 assert.equal([...f.db.values()].filter(row=>row.action==='WAREHOUSE_RECEIPT_SAVED').length,2);
});

test('shared current stock refuses unsupplied send, wrong department and over-loaded progress without changing balances',async()=>{
 const f=await fixture('GHR'),draft=await f.command('SUPPORT','CREATE',{customerId:'C',currency:'USD',lines:[{taskId:'A',quantity:100}]});
 const beforeGeneration=(await f.protocol.readControl()).generation;
 await assert.rejects(f.command('SUPPORT','SEND',{id:draft.id}),/Usable customer stock/);
 assert.equal((await f.protocol.readControl()).generation,beforeGeneration);
 f.select('WAREHOUSE');const request=copy(f.initial);request.stockGeneration=beforeGeneration;
 await f.api.saveWarehouseReceiptCurrent('GHR',request);
 await f.command('SUPPORT','SEND',{id:draft.id});await f.command('WAREHOUSE','START',{id:draft.id});
 const before=physical(f),generation=(await f.protocol.readControl()).generation;
 await assert.rejects(f.command('SUPPORT','PROGRESS',{id:draft.id,lines:[{taskId:'A',packed:100,loaded:100,reason:''}]}),/other department/);
 await assert.rejects(f.command('WAREHOUSE','PROGRESS',{id:draft.id,lines:[{taskId:'A',packed:100,loaded:101,reason:''}]}),/Loaded must not exceed/);
 assert.deepEqual(physical(f),before);assert.equal((await f.protocol.readControl()).generation,generation);
 assert.equal(listById(await f.read('WAREHOUSE'),draft.id).lines[0].loaded,0);
});

test('one database: same/different PO borrow → both customer shipment splits → borrower Loaded → automatic repayment closes both halos',async()=>{
 for(const [company,separatePo] of ['NCT','GHR'].flatMap(company=>[[company,false],[company,true]])){
  const f=await fixture(company);
  f.context.tasks[1].barcode=f.context.tasks[0].barcode;
  f.context.tasks.forEach(task=>{task.customerId='C-'+task.id;});
  if(separatePo)f.context.tasks[1].po='PO-002';
  f.context.customers=f.context.tasks.map(task=>({id:task.customerId,name:'Customer '+task.id}));
  f.initial.input=copy(f.request().input);
  f.initial.input.lines=f.initial.input.lines.filter(line=>line.taskId==='B');
  const initialOrders=f.bindings.projectWarehouseOrders({company,purchaseOrders:f.bindings.projectPurchaseOrders({company,workspace:f.context,records:[]}),tasks:f.context.tasks,activity:[]});
  const lenderPo=initialOrders.find(order=>order.lines.some(line=>line.taskId==='B'));
  Object.assign(f.initial.input,{id:lenderPo.id,version:lenderPo.version});
  f.select('WAREHOUSE');assert.equal((await f.api.saveWarehouseReceiptCurrent(company,f.initial)).ok,true);
  let support=await f.read('SUPPORT');assert.equal(support.tasks.find(task=>task.taskId==='A').ready,0);assert.equal(support.tasks.find(task=>task.taskId==='B').ready,100);
  const originalPo=f.context.tasks.map(task=>task.po);
  for(const department of ['WAREHOUSE','SUPPORT']){
   f.select(department);assert.equal((await f.borrowApi.getPurchaseBorrowOptionsCurrent(company,{borrowerTaskId:'A'})).ok,false,'no self-allocation grant: '+department);
  }
  f.select('PURCHASE');const quote=await f.borrowApi.getPurchaseBorrowOptionsCurrent(company,{borrowerTaskId:'A'});
  assert.equal(quote.ok,true);assert.equal(quote.options.length,1);assert.equal(quote.options[0].maximumQuantity,100);
  const request={requestId:'66666666-6666-4666-8666-666666666666',operation:'BORROW_APPROVE',stockProtocol:1,stockBuild:'TEST',stockGeneration:quote.stockCurrent.stockGeneration,
   input:{expectedRevision:quote.expectedRevision,borrowerTaskId:'A',lenderSourceId:'B',replacementSourceId:'A',quantity:30,reason:'Complete customer A loading'}};
  const borrowed=await f.borrowApi.savePurchaseBorrowingCurrent(company,request);assert.equal(borrowed.ok,true);
  assert.deepEqual(copy(await f.borrowApi.savePurchaseBorrowingCurrent(company,request)),copy(borrowed));
  for(const taskId of ['A','B']){const view=await f.relations(company,{taskId});assert.equal(view.halo,true);assert.equal(view.items[0].remaining,30);}
  // SPLIT is a shipment-plan operation on the SAME demand task. Compose the
  // private authenticated Sales save with the actual borrow/receipt/packing roots
  // and one coordinator, not a separate fabricated post-split borrowing state.
  for(const [index,taskId] of ['A','B'].entries()){
   const task=f.context.tasks.find(row=>row.id===taskId),actor={staffId:'SOURCE-'+taskId,memberId:'SOURCE_SALES/SOURCE-'+taskId,
    staffName:'Original Sales',customerId:task.customerId,canSelectShipment:true},
    dependencies={company,items:f.items,store:f.store,protocol:f.protocol,coverage:Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])),
     authenticateOriginalDelegation:async()=>copy(actor),readContext:f.bindings.readFulfilmentContext,
     readCurrentTaskRows:async(selected,ids)=>{assert.equal(selected,company);return f.store.readMany(f.tasks,ids);},
     readPurchaseRecords:async()=>[],projectPurchaseOrders:f.bindings.projectPurchaseOrders,
     readAllocations:f.bindings.readAllocations,readCustomerShipments:f.bindings.readCustomerShipments,
     readPackingLists:f.bindings.readPackingLists,packingHeld:f.bindings.packingHeld,
     createSalesOrderAdjustmentOperations,readPlans:readShipmentPlans,planVersion:shipmentPlanVersion,now:()=>new Date('2026-10-23T00:00:00.000Z')};
   const captured=await f.protocol.readSnapshot(async control=>readCurrentSalesWorkspace({...dependencies,control,
    context:await dependencies.readContext(company,actor),staff:actor}));
   const splitRequest={requestId:'55555555-5555-4555-8555-'+String(index).padStart(12,'0'),stockProtocol:1,stockBuild:'TEST',
    stockGeneration:captured.generation,stockIdentity:{staffId:actor.staffId,memberId:actor.memberId},
    input:{action:'ADJUST',customerId:task.customerId,orderId:task.orderId,taskId,mode:'SPLIT',quantity:30,batchId:'',
     version:salesAdjustmentVersion(captured.rows.context,shipmentPlanVersion)}};
   const beforePhysical=physical(f),beforeRelation=copy([...f.db.values()].find(row=>row.action==='STOCK_TRANSFER_CURRENT')),
    rawTasks=copy([...f.db].filter(([key])=>key.startsWith(f.tasks+'/'))),save=createCurrentSalesDemandSave(dependencies);
   const split=await save(splitRequest);assert.equal(split.ok,true);assert.deepEqual(copy(await save(splitRequest)),copy(split));
   assert.deepEqual(physical(f),beforePhysical);assert.deepEqual(copy([...f.db].filter(([key])=>key.startsWith(f.tasks+'/'))),rawTasks);
   assert.deepEqual(copy([...f.db.values()].find(row=>row.action==='STOCK_TRANSFER_CURRENT')),beforeRelation);
   const plan=readShipmentPlans([...f.db.values()]).find(row=>row.customerId===task.customerId&&row.orderId===task.orderId);
   assert.deepEqual(copy(plan.batches.map(batch=>batch.lines.find(line=>line.taskId===taskId).quantity)),[30,70]);
   const splitLines=plan.batches.map(batch=>batch.lines.find(line=>line.taskId===taskId));
   assert.equal(splitLines.reduce((n,line)=>n+line.stockCoverage.reduce((sum,source)=>sum+source.quantity,0),0),taskId==='A'?30:70,
    'split must distribute, not duplicate, the actual borrowed/customer stock coverage');
   assert.equal(splitLines.reduce((n,line)=>n+line.sourceCoverage.reduce((sum,source)=>sum+source.quantity,0),0),100,
    'split keeps exactly the original customer PO commitment');
   const linked=await f.relations(company,{taskId});assert.equal(linked.halo,true);assert.equal(linked.items[0].remaining,30);
  }
  support=await f.read('SUPPORT');assert.equal(support.tasks.find(task=>task.taskId==='A').ready,30);assert.equal(support.tasks.find(task=>task.taskId==='B').ready,70);
  const draft=await f.command('SUPPORT','CREATE',{customerId:'C-A',currency:'USD',lines:[{taskId:'A',quantity:30}]});
  await f.command('SUPPORT','SEND',{id:draft.id});await f.command('WAREHOUSE','START',{id:draft.id});
  await f.command('WAREHOUSE','PROGRESS',{id:draft.id,lines:[{taskId:'A',packed:30,loaded:30,reason:''}]});await f.command('WAREHOUSE','COMPLETE',{id:draft.id});
  f.select('PURCHASE');assert.equal((await f.relations(company,{taskId:'A'})).items[0].remaining,30,'Loaded cannot discharge repayment');
  for(const [index,quantity] of [20,80].entries()){
   f.select('WAREHOUSE');const context=await f.bindings.readFulfilmentContext(company);
   const orders=f.bindings.projectWarehouseOrders({company,purchaseOrders:f.bindings.projectPurchaseOrders({company,workspace:context,records:[]}),tasks:context.tasks,activity:context.activity});
   const receipt=copy(f.initial);receipt.requestId='77777777-7777-4777-8777-'+String(index).padStart(12,'0');receipt.stockGeneration=(await f.protocol.readControl()).generation;
   const borrowerPo=orders.find(order=>order.lines.some(line=>line.taskId==='A'));receipt.input.id=borrowerPo.id;receipt.input.version=borrowerPo.version;
   receipt.input.lines=[{taskId:'A',accepted:quantity,rejected:0,kind:index===0?'PARTIAL':'DELIVERY',reason:index===0?'Balance delivery pending':'',resolveIssue:index===1}];
   const saved=await f.api.saveWarehouseReceiptCurrent(company,receipt);assert.equal(saved.ok,true,'replacement receipt '+index);
   assert.deepEqual(copy(await f.api.saveWarehouseReceiptCurrent(company,receipt)),copy(saved),'same receipt cannot repay twice');
   f.select('PURCHASE');for(const taskId of ['A','B']){
    const view=await f.relations(company,{taskId});assert.equal(view.halo,index===0);
    if(index===0){assert.equal(view.items[0].repaid,20);assert.equal(view.items[0].remaining,10);}else assert.equal(view.total,0);
   }
  }
  support=await f.read('SUPPORT');assert.equal(support.tasks.find(task=>task.taskId==='A').ready,100);assert.equal(support.tasks.find(task=>task.taskId==='B').ready,100);
  assert.equal(support.tasks.find(task=>task.taskId==='A').readyToArrange,70,'loaded30 remains held, not duplicated in next draft');
  assert.deepEqual(copy(f.context.tasks.map(task=>task.po)),copy(originalPo),'borrowing creates no new PO and never changes original PO ownership');
  const transfer=[...f.db.values()].filter(row=>row.action==='STOCK_TRANSFER_CURRENT');assert.equal(transfer.length,1);
  assert.equal(transfer[0].status,'CLOSED');assert.equal(transfer[0].details.relation.repaid,30);
  const positions=[...f.db].filter(([key])=>key.startsWith('StockPositions/')).map(([,row])=>row);
  assert.equal(positions.reduce((n,row)=>n+row.onHand,0),200);assert.equal(positions.reduce((n,row)=>n+row.dispatched,0),0);
  assert.equal([...f.db.values()].filter(row=>row.action==='WAREHOUSE_RECEIPT_SAVED').length,3);
  assert.equal([...f.db.values()].filter(row=>row.action==='SALES_ORDER_ADJUSTMENT_SAVED').length,2);
  for(const taskId of ['A','B']){const task=f.context.tasks.find(row=>row.id===taskId),plan=readShipmentPlans([...f.db.values()]).find(row=>row.customerId===task.customerId);
   assert.deepEqual(copy(plan.batches.map(batch=>batch.lines.find(line=>line.taskId===taskId).quantity)),[30,70]);}
  assert.equal(listById(support,draft.id).invoiceId,undefined);
 }
});
