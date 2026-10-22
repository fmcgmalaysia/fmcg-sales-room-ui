const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),load=require('./load-master-module.cjs');
const {WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value));
const intakeFile=require.resolve('./stock-current-intake-root.test.cjs');
const intake=vm.runInNewContext(fs.readFileSync(intakeFile,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';({fixture,body});',
 {require:createRequire(intakeFile),__dirname,Map,Buffer});
const runtimeSource=fs.readFileSync(path.join(folder,'stockCurrentCommands.js'),'utf8');
const runtimeNames=[...runtimeSource.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(match=>match[1]);
const runtime=vm.runInNewContext(runtimeSource.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';({'+runtimeNames.join(',')+'});',
 {createHash:crypto.createHash,randomBytes:crypto.randomBytes,StockRuntimeBuffer:Buffer});
const coverage=JSON.stringify(Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])));
function root(file,names,bindings,covered=true){
 const source=fs.readFileSync(path.join(folder,file),'utf8').replace(/const writerCoverage\s*=\s*Object.freeze\(\{\}\);/,covered?'const writerCoverage=Object.freeze('+coverage+');':'const writerCoverage=Object.freeze({});');
 return vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return{'+names.join(',')+'};})()',bindings);
}

// The ONLY synthetic initial business inputs are the original customer submission
// and an existing supplier profile. No tasks, POs, claims or stock are seeded.
// All transitions run original generated roots against one mock SDK/coordinator.
async function fixture(company,steps=100){
 const f=await intake.fixture({company,steps,generated:true}),db=f.rows,names=load('purchaseProjection.js').PURCHASE_COLLECTIONS[company];
 f.control().transferIndexVersion=2; // TEST VM only, never activation evidence.
 db.set('SharedSuppliers/SUP',{_id:'SUP',title:'SUP',supplierName:'Original supplier',supplierStatus:'ACTIVE'});
 const list=collection=>[...db].filter(([key])=>key.startsWith(collection+'/')).map(([,row])=>copy(row));
 const native=row=>{row=copy(row);if(row._version){row.stockCommitVersion=row._version;delete row._version;}if(row.activityTime)row.activityTime=new Date(row.activityTime);row._updatedDate=new Date('2026-10-23T04:00:00.000Z');return row;};
 const members=Object.fromEntries(['PURCHASE','WAREHOUSE','SUPPORT','ACCOUNT','ADMIN'].map(department=>[department,{_id:department+'_MEMBER',status:'APPROVED',loginEmail:department.toLowerCase()+'@example.test'}]));
 let department='PURCHASE',sequence=1,lastPrivateError;
 const employee=()=>({title:department,description:members[department]._id,staffEmail:members[department].loginEmail,staffName:department,staffStatus:'ACTIVE',departments:[department],...(department==='ADMIN'?{role:'SUPER ADMIN'}:{})});
 const fulfilmentStore={all:async collection=>collection==='StaffMasterAccess'?[employee()]:list(collection).map(native),
  read:async(collection,id)=>{const row=await f.store.read(collection,id);return row?native(row):null;}};
 const items={query:collection=>{const filters=[];let limit=50,offset=0;const q={eq:(key,value)=>{filters.push(row=>Array.isArray(row[key])?row[key].includes(value):row[key]===value);return q;},
  hasSome:(key,values)=>{filters.push(row=>values.includes(row[key]));return q;},gt:(key,value)=>{filters.push(row=>row[key]>value);return q;},ascending:()=>q,descending:field=>{assert.equal(field,'_updatedDate');return q;},skip:n=>{offset=n;return q;},limit:n=>{limit=n;return q;},find:async()=>{
   const rows=list(collection).filter(row=>filters.every(fn=>fn(row))).sort((a,b)=>a._id.localeCompare(b._id)).map(native);return{items:rows.slice(offset,offset+limit),totalCount:rows.length,hasNext:()=>false};}};return q;}};
 const noNativeWrite=()=>{throw Error('No native SDK write during mock listed-row normalization');};
 const codec=runtime.createSdkConditionalStore({company,items:{...items,insert:noNativeWrite,patch:noNativeWrite,remove:noNativeWrite},collections:runtime.planCollections(company,true),dateTimeFields:{[names.activity]:['activityTime']}});
 f.store.normalizeListedRow=codec.normalizeListedRow;
 f.store.readMany=codec.readMany;
 const damageModel=load('../prototypes/stock-current-state/packingListModel.candidate.js');
 const cache={'purchaseDisplayOrder.js':load('../prototypes/stock-current-state/purchaseDisplayOrder.candidate.js'),'packingListModel.js':damageModel};
 cache['packingListOperations.js']=load('../prototypes/stock-current-state/packingListOperations.candidate.js',cache);
 const modules=Object.assign({},...['purchaseOperations.js','purchaseSources.js','purchaseTaskIdentity.js','purchaseOrderWorkflow.js','purchaseOperationJournal.js',
  'warehouseReceiving.js','warehouseCustomerReadiness.js','warehouseCbm.js','customerShipmentPlan.js','salesOrderAdjustment.js','customerShipmentLedger.js',
  'packingListContext.js','packingListOperations.js','packingListModel.js','purchaseMarginRefresh.js','purchaseProgress.js','purchaseShortage.js','purchaseQuantityCases.js',
  'customerAccountLedger.js','customerDebtor.js','inventoryExceptions.js','stockExceptionResolution.js','stockExceptionWorkspace.js','departmentMessages.js'].map(file=>load(file,cache)),
  load('../prototypes/stock-current-state/plannerAllocation.candidate.js'),load('../prototypes/stock-current-state/purchaseProjection.candidate.js',cache),
  load('../prototypes/stock-current-state/warehousePreparation.candidate.js'),load('../prototypes/stock-current-state/customerFulfilment.candidate.js'));
 const bindings={...runtime,...modules,Buffer,Date,Math,items,fulfilmentStore,PURCHASE_CURRENT_DISPLAY_ORDER_VERSION:2,CUSTOMER_CURRENT_FULFILMENT_VERSION:2,
  currentMember:{getMember:async()=>copy(members[department])},Permissions:{SiteMember:'SITE'},webMethod:(_,fn)=>fn,
  readCurrentAdminFx:async currencies=>currencies.map(currency=>({currency,rateToMyr:1,updatedAt:new Date().toISOString()})),readCustomerShortNames:async()=>[],
  capturePointbaseCosts:async()=>{throw Error('Unexpected cost refresh');},requestPurchaseDocument:async()=>{throw Error('No file operation in Loaded acceptance');},
  createSdkConditionalStore:()=>f.store,createSegmentedFencedProof:configuration=>{assert.equal(configuration.store,f.store);return f.protocol;}};
 for(const factory of ['createCurrentPurchaseTaskGateway','createCurrentWarehouseReceiptSave','createCurrentStockExceptionSave','createCurrentStockResolutionSave']){
  const original=bindings[factory];bindings[factory]=(...args)=>{const save=original(...args);return async(...input)=>{try{return await save(...input);}catch(error){lastPrivateError=error;throw error;}};};
 }
 bindings.getPurchaseStaffContext=async()=>({...bindings.requirePurchaseStaff(await bindings.currentMember.getMember(),[employee()]),memberId:members[department]._id});
 const originalService=fs.readFileSync(path.join(folder,'customerFulfilmentService.candidate.js'),'utf8');
 const contextSource=originalService.slice(originalService.indexOf('export async function readFulfilmentContext('),originalService.indexOf('const saveFulfilmentEvent='));
 bindings.readFulfilmentContext=vm.runInNewContext(contextSource.replace(/^export /gm,'')+';readFulfilmentContext;',bindings);
 const readSource=originalService.slice(originalService.indexOf('export async function readCustomerFulfilment('));
 bindings.readCustomerFulfilment=vm.runInNewContext(readSource.replace(/^export /gm,'')+';readCustomerFulfilment;',bindings);
 const purchase=root('stockCurrentBorrow.web.js',['savePurchaseTasksCurrent','getPurchaseWorkspaceCurrent','getPurchaseBorrowOptionsCurrent','savePurchaseBorrowingCurrent'],bindings);
 const warehouse=root('stockCurrentWarehouse.web.js',['saveWarehouseReceiptCurrent','getWarehouseOrdersCurrent'],bindings);
 const packing=root('stockCurrentPacking.js',['createCurrentMasterPacking'],bindings);
 const source=root('stockCurrentSourceSales.js',['createCurrentSourceSales'],bindings);
 const stockRoot=root('stockCurrentExceptions.js',['createCurrentStockExceptions'],bindings);
 const stock=root('stockExceptions.web.candidate.js',['getStockExceptions','saveStockException'],{...bindings,...stockRoot});
 const quantityModules=load('../prototypes/stock-current-state/purchaseQuantityProjection.candidate.js',{'warehousePreparation.js':modules});
 function quantityApi(covered=true,patch={}){const privateRoot=root('stockCurrentQuantityRead.js',['createCurrentPurchaseQuantityRead'],{...bindings,...quantityModules,...patch},covered);
  return root('purchaseQuantityRead.candidate.js',['readPurchaseQuantities'],{...bindings,...quantityModules,...privateRoot,timingSafeEqual:crypto.timingSafeEqual,
   getSecret:async()=> 'SYNTHETIC-COMPOSITION-ONLY',wixData:items});}
 const quantitySend=(body,authorized=true,api=quantityApi())=>api.readPurchaseQuantities({headers:{Authorization:'Bearer '+(authorized?'SYNTHETIC-COMPOSITION-ONLY':'WRONG')},body:{json:async()=>copy(body)}});
 const sourceGateway=root('customerFulfilmentGateway.candidate.js',['handleSalesFulfilment'],{...bindings,...source,timingSafeEqual:crypto.timingSafeEqual,
  getSecret:async()=> 'SYNTHETIC-COMPOSITION-ONLY',dispatchCurrentSalesGateway:runtime.dispatchCurrentSalesGateway,
  saveCustomerFulfilment:()=>{throw Error('Legacy source save');},saveCustomerAccountDocument:()=>{throw Error('Legacy source document');},handleSalesTaskChat:()=>{throw Error('No chat');}});
 const uuid=()=> '88888888-8888-4888-8888-'+String(sequence++).padStart(12,'0');
 const metadata=()=>({requestId:uuid(),stockProtocol:1,stockBuild:'TEST',stockGeneration:f.control().generation});
 async function finish(send,request){let result;for(let step=0;step<300;step++){result=await send(request);if(!result.pending)break;}assert.equal(result.ok,true,lastPrivateError?.stack||JSON.stringify(result));
  assert.deepEqual(copy(await send(request)),copy(result),'exact original request replays without another transition');return result;}
 const sourceSend=async(action,input={},requestId=uuid())=>{
  const body={company,customerId:'C',customerName:'Customer',staff:{staffId:'S',staffName:'Original Sales'},action,input,requestId};
  for(let step=0;step<300;step++){
   const response=await sourceGateway.handleSalesFulfilment({headers:{Authorization:'Bearer SYNTHETIC-COMPOSITION-ONLY'},body:{json:async()=>copy(body)}});
   assert.equal(response.status,200,response.body.error);if(!response.body.result.pending)return response.body.result;
  }
  throw Error('Source same-request continuation did not finish');
 };
 async function purchaseSave(operation,input){department='PURCHASE';return finish(request=>purchase.savePurchaseTasksCurrent(company,request),{...metadata(),operation,input});}
 async function packingRead(selected){department=selected;return(await packing.createCurrentMasterPacking({company,department:selected,
  authenticateOriginalPacking:async()=>bindings.requirePackingStaff(await bindings.currentMember.getMember(),[employee()],selected)}));}
 async function packingSave(selected,action,details={}){const endpoint=await packingRead(selected),view=await endpoint.read(),current=details.id?view.lists.find(row=>row.id===details.id):null;
  return finish(request=>endpoint.save(request),{...metadata(),stockIdentity:view.stockCurrent.stockIdentity||{staffId:view.staff.staffId,memberId:view.staff.memberId},
   input:{action,version:view.version,...(current?{revision:current.revision}:{}),...details}});}
 async function receipt(quantity,taskIds=null){department='WAREHOUSE';const context=await bindings.readFulfilmentContext(company,{}),orders=bindings.projectWarehouseOrders({company,
  purchaseOrders:bindings.projectPurchaseOrders({company,workspace:context,records:list('PurchaseOrders')}),tasks:context.tasks,activity:context.activity});
  assert.equal(orders.length,1);const request={...metadata(),stockIdentity:{staffId:'WAREHOUSE',memberId:members.WAREHOUSE._id},input:{action:'RECEIVE',id:orders[0].id,version:orders[0].version,
   lines:orders[0].lines.filter(line=>!taskIds||taskIds.includes(line.taskId)).map(line=>({taskId:line.taskId,accepted:quantity,rejected:0,kind:quantity===100?'DELIVERY':'PARTIAL',reason:quantity===100?'':'Remaining delivery pending'}))}};
  return finish(value=>warehouse.saveWarehouseReceiptCurrent(company,value),request);
 }
 return{...f,db,names,list,bindings,purchase,stock,purchaseSave,sourceSend,quantitySend,quantityApi,packingRead,packingSave,receipt,metadata,finishCommand:finish,select:selected=>{department=selected;}};
}

for(const company of ['NCT','GHR'])test(`${company}: actual intake → original Purchase PO → Source split → receipt → same Support/Warehouse list to Loaded`,async()=>{
 const f=await fixture(company,company==='GHR'?2:100),submission=intake.body(company),accepted=await f.finish(submission),taskId=accepted.taskIds[0];
 assert.equal(f.list(f.names.tasks).length,1);assert.equal(f.list('StockPositions').length,0);assert.equal(f.list('StockClaims').length,0);
 const raw=()=>f.db.get(f.names.tasks+'/'+taskId),orderBefore=copy(f.list(f.names.orders));
 await f.purchaseSave('PLAN',{taskId,version:f.bindings.taskEditVersion(raw()),planRevision:'',supplierId:'SUP',totalCtn:100,transportMode:'SUPPLIER_DELIVER',reason:'Original procurement',
  costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:100,freeCtn:0,prices:{lpPc:1,lpCtn:12,disc1:0,disc2:0,disc3:0}}});
 await f.purchaseSave('PO',{taskIds:[taskId],versions:{[taskId]:f.bindings.taskEditVersion(raw())},poNumber:company+'-PO-1001'});
 assert.equal(raw().ourPoNumber,company+'-PO-1001');assert.equal(raw().purchaseQtyInCtn,100);assert.equal(raw().receivedQtyInCtn,null);
 assert.equal(f.list('StockPositions').length,0,'a PO does not create physical stock');
 const immutableTask=copy(raw()),read=await f.sourceSend('READ');
 assert.equal(read.lines[0].allocated,0);assert.equal(read.lines[0].originalRequested,100);
 const splitId='99999999-9999-4999-8999-999999999999',splitInput={taskId,orderId:submission.orderId,mode:'SPLIT',quantity:60,batchId:'',version:read.adjustmentVersion,stockCurrent:read.stockCurrent};
 const split=await f.sourceSend('ADJUST',splitInput,splitId);assert.equal(split.ok,true);assert.equal(split.requested,100);
 assert.deepEqual(copy(await f.sourceSend('ADJUST',splitInput,splitId)),copy(split));
 const splitView=await f.sourceSend('READ');assert.deepEqual(copy(splitView.plans[0].batches.map(batch=>batch.lines[0].quantity)),[60,40]);
 assert.deepEqual(copy(raw()),immutableTask,'split never duplicates or rewrites the original PO/task');assert.deepEqual(f.list(f.names.orders),orderBefore);
 assert.equal(f.list(f.names.tasks).length,1);assert.equal(f.list('StockClaims').length,0);
 await f.receipt(100);
 assert.equal(f.list('StockProducts')[0].onHand,100);assert.equal(f.list('StockProducts')[0].reservedUsable,100);
 const physical=copy([...f.db].filter(([key])=>/^Stock(Positions|Claims)\//.test(key)));
 const draft=await f.packingSave('SUPPORT','CREATE',{customerId:'C',currency:'USD',lines:[{taskId,quantity:60}]});
 assert.equal((await(await f.packingRead('WAREHOUSE')).read()).lists.length,0);
 await f.packingSave('SUPPORT','SEND',{id:draft.id});
 await f.packingSave('WAREHOUSE','START',{id:draft.id});
 await f.packingSave('WAREHOUSE','PROGRESS',{id:draft.id,lines:[{taskId,packed:60,loaded:60,reason:''}]});
 await f.packingSave('WAREHOUSE','COMPLETE',{id:draft.id});
 const final=await(await f.packingRead('SUPPORT')).read(),list=final.lists.find(row=>row.id===draft.id);
 assert.equal(list.status,'COMPLETED');assert.equal(list.lines[0].loaded,60);assert.equal(final.tasks.find(row=>row.taskId===taskId).readyToArrange,40);
 assert.deepEqual(copy([...f.db].filter(([key])=>/^Stock(Positions|Claims)\//.test(key))),physical,'Loaded does not deduct stock or double reserve remaining40');
 assert.equal(raw().ourPoNumber,immutableTask.ourPoNumber);assert.equal(raw().purchaseQtyInCtn,100);assert.equal(raw().stockDispatchedCumulative,0);
 assert.equal(f.list(f.names.activity).filter(row=>row.action==='ORDER_RECEIVED').length,1);
 assert.equal(f.list(f.names.activity).filter(row=>row.action==='PURCHASE_PO_ASSIGNED').length,1);
 assert.equal(f.list(f.names.activity).filter(row=>row.action==='SALES_ORDER_ADJUSTMENT_SAVED').length,1);
 assert.equal(f.list(f.names.activity).filter(row=>row.action==='WAREHOUSE_RECEIPT_SAVED').length,1);
 assert.equal(f.list(f.names.tasks).length,1);assert.equal(f.list('PurchaseOrders').length,0,'no extra supplier PO record invented by splitting');
 assert.equal(list.invoiceId,undefined);assert.equal(list.dispatchedAt,undefined);
 assert.equal(f.list(f.names.activity).some(row=>row.details?.shipment?.status==='INVOICED'||row.details?.shipment?.status==='DISPATCHED'),false);
 const finalSource=await f.sourceSend('READ');assert.equal(finalSource.lines.reduce((sum,line)=>sum+line.allocated,0),100,'split source rows share the same100received');
 const customerQuantity=await f.quantitySend({company,customerId:'C',orders:[{orderId:submission.orderId,submissionId:submission.submissionId}]});
 assert.equal(customerQuantity.status,200);assert.equal(customerQuantity.body.orders[0].lines[0].receivedQtyCtn,100);
 assert.deepEqual(copy(customerQuantity.body.orders[0].lines[0].shipmentBatches.map(batch=>batch.quantity)),[60,40]);
 const beforeRefused=JSON.stringify([...f.db]);
 await assert.rejects(f.sourceSend('ADJUST',{...splitInput,quantity:30,batchId:finalSource.plans[0].id+'|1',version:finalSource.adjustmentVersion,stockCurrent:finalSource.stockCurrent}),/packing list holds/);
 assert.equal(JSON.stringify([...f.db]),beforeRefused,'Loaded prevents a silent Sales split/PO/hold rewrite');
 const duplicate=await f.finish(submission);assert.deepEqual(duplicate,accepted);assert.equal(f.list(f.names.tasks).length,1);
});
