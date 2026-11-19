const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),load=require('./load-master-module.cjs');
const filename=require.resolve('./stock-current-intake-loaded-composition.test.cjs');
const {fixture,intake,root}=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';({fixture,intake,root});',
 {require:createRequire(filename),__dirname,Map,Buffer});
const copy=value=>JSON.parse(JSON.stringify(value)),folder=path.join(__dirname,'../prototypes/stock-current-state');
const quantityBody=(company,submission)=>({company,customerId:submission.customerId,orders:[{orderId:submission.orderId,submissionId:submission.submissionId}]});
async function issued(company){
 const f=await fixture(company),submission=intake.body(company),accepted=await f.finish(submission),taskId=accepted.taskIds[0];
 const raw=()=>f.db.get(f.names.tasks+'/'+taskId);
 await f.purchaseSave('PLAN',{taskId,version:f.bindings.taskEditVersion(raw()),planRevision:'',supplierId:'SUP',totalCtn:100,transportMode:'SUPPLIER_DELIVER',reason:'Original supplier',
  costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:100,freeCtn:0,prices:{lpPc:1,lpCtn:12,disc1:0,disc2:0,disc3:0}}});
 await f.purchaseSave('PO',{taskIds:[taskId],versions:{[taskId]:f.bindings.taskEditVersion(raw())},poNumber:company+'-PO-1001'});
 return{...f,submission,taskId};
}

test('original bearer quantity entry stays customer-safe from real intake/PO through borrowing and automatic repayment, both companies',async()=>{
 for(const company of ['NCT','GHR']){
  const f=await issued(company),other={...intake.body(company),orderId:'OTHER_ORDER',submissionId:'OTHER_SUBMISSION',customerId:'OTHER_CUSTOMER',customerCompanyName:'Other customer'},accepted=await f.finish(other),lender=accepted.taskIds[0];
  const raw=()=>f.db.get(f.names.tasks+'/'+lender);
  await f.purchaseSave('PLAN',{taskId:lender,version:f.bindings.taskEditVersion(raw()),planRevision:'',supplierId:'SUP',totalCtn:100,transportMode:'SUPPLIER_DELIVER',reason:'Other customer supplier',
   costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:100,freeCtn:0,prices:{lpPc:1,lpCtn:12,disc1:0,disc2:0,disc3:0}}});
  await f.purchaseSave('PO',{taskIds:[lender],versions:{[lender]:f.bindings.taskEditVersion(raw())},poNumber:company+'-PO-1001'});
  await f.receipt(100,[lender]);
  const originalPo=JSON.stringify(f.list(f.names.tasks).map(task=>[task._id,task.ourPoNumber,task.purchaseQtyInCtn]));
  let a=await f.quantitySend(quantityBody(company,f.submission)),b=await f.quantitySend(quantityBody(company,other));
  assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.body.orders[0].lines[0].receivedQtyCtn,0);assert.equal(b.body.orders[0].lines[0].receivedQtyCtn,100);
  f.select('PURCHASE');const quote=await f.purchase.getPurchaseBorrowOptionsCurrent(company,{borrowerTaskId:f.taskId});assert.equal(quote.ok,true);
  const input={expectedRevision:quote.expectedRevision,borrowerTaskId:f.taskId,lenderSourceId:lender,replacementSourceId:f.taskId,quantity:30,reason:'Purchase approves customer loading'};
  await f.finishCommand(request=>f.purchase.savePurchaseBorrowingCurrent(company,request),{...f.metadata(),operation:'BORROW_APPROVE',input});
  const before=JSON.stringify([...f.db]);a=await f.quantitySend(quantityBody(company,f.submission));b=await f.quantitySend(quantityBody(company,other));
  assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.body.orders[0].lines[0].receivedQtyCtn,30);assert.equal(b.body.orders[0].lines[0].receivedQtyCtn,70);
  assert.equal(a.body.orders[0].lines[0].receivedUpdatedAt,'2026-10-23T04:00:00.000Z','SDK stock update time, not a fabricated own-PO receipt');
  assert.equal(JSON.stringify([...f.db]),before,'original quantity read performs no refresh, stock write, receipt or margin mutation');
  for(const response of [a,b])assert.doesNotMatch(JSON.stringify(response.body),/supplierId|lpCtn|sellingPrice|stockCommitVersion|positionId|borrowerTaskId|lenderSourceId/);
  assert.doesNotMatch(JSON.stringify(a.body),/OTHER_CUSTOMER|OTHER_ORDER/);
  await f.receipt(100,[f.taskId]);
  a=await f.quantitySend(quantityBody(company,f.submission));b=await f.quantitySend(quantityBody(company,other));
  assert.equal(a.body.orders[0].lines[0].receivedQtyCtn,100);assert.equal(b.body.orders[0].lines[0].receivedQtyCtn,100);
  assert.equal(JSON.stringify(f.list(f.names.tasks).map(task=>[task._id,task.ourPoNumber,task.purchaseQtyInCtn])),originalPo);
  assert.equal(f.list(f.names.activity).filter(row=>row.action==='STOCK_TRANSFER_CURRENT')[0].status,'CLOSED');
  const wrong=await f.quantitySend({...quantityBody(company,f.submission),customerId:'OTHER_CUSTOMER'});assert.equal(wrong.status,503);
 }
});

test('original auth before control/data; empty coverage, closed/missing/pending control never falls back to historical quantities',async()=>{
 const f=await issued('NCT'),body=quantityBody('NCT',f.submission),reads=f.reads.length;
 assert.equal((await f.quantitySend(body,false)).status,401);assert.equal(f.reads.length,reads);
 assert.equal((await f.quantitySend(body,true,f.quantityApi(false))).status,503);
 for(const mode of ['SHADOW','MAINTENANCE']){f.control().mode=mode;const before=JSON.stringify([...f.db]);assert.equal((await f.quantitySend(body)).status,503);assert.equal(JSON.stringify([...f.db]),before);}
 f.control().mode='ACTIVE';f.control().pending={key:'OTHER',digest:'UNFINISHED'};assert.equal((await f.quantitySend(body)).status,503);f.control().pending=null;
 const control=copy(f.control());f.db.delete(f.names.activity+'/'+f.protocol.ids.controlId);assert.equal((await f.quantitySend(body)).status,503);f.db.set(f.names.activity+'/'+f.protocol.ids.controlId,control);
 const api=f.quantityApi(true,{PURCHASE_CURRENT_QUANTITY_PROJECTION_VERSION:1});assert.equal((await f.quantitySend(body,true,api)).status,503);
});

test('quantity snapshot rejects native timestamp/type/version/identity and concurrent generation changes; it does not invent a timestamp or return old stock',async()=>{
 for(const variant of ['time','version','identity','generation','missing']){
  const f=await issued('NCT');await f.receipt(100);const original=f.bindings.items;
  const items={...original,query:collection=>{const query=original.query(collection),descending=query.descending,find=query.find;let timestamp=false;
   query.descending=(...args)=>{timestamp=true;return descending(...args);};query.find=async(...args)=>{const page=await find(...args);
    if(timestamp&&collection==='StockClaims'){
     if(variant==='time')page.items[0]._updatedDate=page.items[0]._updatedDate.toISOString();
     if(variant==='version')page.items[0].stockCommitVersion='FOREIGN_VERSION';
     if(variant==='identity')page.items[0].stockKey='FOREIGN_PRODUCT';
     if(variant==='generation'){f.control().generation++;f.control()._version='CONCURRENT_COMMITTED_VERSION';}
     if(variant==='missing'){page.items=[];page.totalCount=0;}
    }return page;};return query;}};
  const api=f.quantityApi(true,{items}),result=await f.quantitySend(quantityBody('NCT',f.submission),true,api);assert.equal(result.status,503,variant);
  assert.equal(result.body.ok,false);assert.equal(result.body.orders,undefined);
 }
});

test('explicit clean LEGACY retains the exact original endpoint result; formatter original body is unchanged outside its one stock seam',async()=>{
 const f=await issued('NCT');await f.receipt(100);
 // Separate parity fixture for an existing pre-ACTIVE allocation. The current
 // physical100matches it; this immutable historical event is NOT a new writer.
 f.db.set(f.names.activity+'/PRE_ACTIVE_ALLOC',{_id:'PRE_ACTIVE_ALLOC',title:'PRE_ACTIVE_ALLOC',description:f.submission.orderId,imageAltText:f.taskId,
  action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',activityTime:'2026-10-22T03:30:00.000Z',initiatedByStaffName:'Original planner',
  details:{beforeRevision:'',targets:[{taskId:f.taskId,customerId:'C',orderId:f.submission.orderId,sourceLineId:'L',quantity:100}]}});
 const current=await f.quantitySend(quantityBody('NCT',f.submission));f.control().mode='LEGACY';
 const original=root('../..'+ '/backend/purchaseQuantityRead.js',['readPurchaseQuantities'],{...f.bindings,projectPurchaseQuantities:load('purchaseQuantityProjection.js').projectPurchaseQuantities,
  timingSafeEqual:require('node:crypto').timingSafeEqual,getSecret:async()=> 'SYNTHETIC-COMPOSITION-ONLY',wixData:f.bindings.items});
 const body=quantityBody('NCT',f.submission),request={headers:{Authorization:'Bearer SYNTHETIC-COMPOSITION-ONLY'},body:{json:async()=>copy(body)}};
 assert.deepEqual(copy(await f.quantitySend(body)),copy(await original.readPurchaseQuantities(request)));
 assert.deepEqual(copy(current),copy(await original.readPurchaseQuantities(request)),'unaffected original receipt timestamp and full safe response remain exact at ACTIVE too');
 assert.match(execFileSync(process.execPath,[path.join(folder,'build-current-quantity-read.cjs'),'--check'],{encoding:'utf8'}),/verified/);
 const candidate=fs.readFileSync(path.join(folder,'purchaseQuantityProjection.candidate.js'),'utf8').replace(/\r\n/g,'\n');
 const restored=candidate.replace('export const PURCHASE_CURRENT_QUANTITY_PROJECTION_VERSION = 2;\n','').replace(/      const originalWarehouse=readWarehouseTask\(task,activity\),current=workspace\?\.stockAllocationView==='CURRENT_V2';\n      if\(current[^\n]+\n      const warehouse=current\?[^\n]+,decision=/,'      const warehouse=readWarehouseTask(task,activity),decision=');
 assert.equal(restored,fs.readFileSync(path.join(__dirname,'../backend/purchaseQuantityProjection.js'),'utf8').replace(/\r\n/g,'\n'));
});
