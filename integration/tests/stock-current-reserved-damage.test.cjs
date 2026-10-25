const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),load=require('./load-master-module.cjs');
const file=require.resolve('./stock-current-quantity-read.test.cjs'),{issued,intake}=vm.runInNewContext(fs.readFileSync(file,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';({issued,intake});',
 {require:createRequire(file),__dirname,Map,Buffer});
const copy=value=>JSON.parse(JSON.stringify(value));
const product=f=>f.list('StockProducts')[0],claim=f=>f.list('StockClaims').find(row=>row.taskId===f.taskId);
async function stockRequest(f,department,action,details={}){
 f.select(department);const view=await f.stock.getStockExceptions(f.submission.destination),requestId=f.metadata().requestId;
 const input={action,version:action==='QUARANTINE'?view.version:view.resolutionVersion,...details};
 return{input,send:()=>f.stock.saveStockException(f.submission.destination,requestId,input,view.stockCurrent),view};
}
async function stock(f,department,action,details={}){const request=await stockRequest(f,department,action,details);return f.finishCommand(request.send,{});}
async function list(f,loaded=false,quantity=100){const draft=await f.packingSave('SUPPORT','CREATE',{customerId:'C',currency:'USD',lines:[{taskId:f.taskId,quantity}]});
 await f.packingSave('SUPPORT','SEND',{id:draft.id});if(loaded){await f.packingSave('WAREHOUSE','START',{id:draft.id});
  await f.packingSave('WAREHOUSE','PROGRESS',{id:draft.id,lines:[{taskId:f.taskId,packed:quantity,loaded:quantity,reason:''}]});await f.packingSave('WAREHOUSE','COMPLETE',{id:draft.id});}return draft.id;}
const quarantine=(f,kind='INTERNAL_DAMAGE')=>stock(f,'WAREHOUSE','QUARANTINE',{sourceTaskId:f.taskId,quantity:10,kind,reason:'Physical inspection found ten damaged cartons'});

test('both companies: real reserved isolation after Loaded keeps original demand/PO/list and permits reasoned actual90correction, not isolated loading',async()=>{
 for(const company of ['NCT','GHR']){
  const f=await issued(company);await f.receipt(100);const id=await list(f,true),originalPo=f.list(f.names.tasks)[0].ourPoNumber;
  const saved=await quarantine(f);assert.equal(saved.ok,true);assert.equal(claim(f).isolatedAttributed,10);assert.equal(claim(f).reservedUsable,90);
  assert.deepEqual([product(f).onHand,product(f).reservedUsable,product(f).isolated,product(f).available],[100,90,10,0]);
  const task=f.list(f.names.tasks)[0];assert.equal(task.purchaseQtyInCtn,100);assert.equal(task.ourPoNumber,originalPo);assert.equal(task.stockDispatchedCumulative,0);
  const read=await(await f.packingRead('SUPPORT')).read();assert.equal(read.tasks[0].ready,90);assert.equal(read.tasks[0].remaining,100);assert.equal(read.tasks[0].stockDamageIsolation,10);
  assert.equal(read.lists.find(row=>row.id===id).stockDamageReviewRequired,true);
  await f.packingSave('WAREHOUSE','REOPEN',{id,reason:'Remove the ten isolated cartons from the recorded Loaded quantity'});
  const before=JSON.stringify([...f.db]);
  await assert.rejects(f.packingSave('WAREHOUSE','PROGRESS',{id,lines:[{taskId:f.taskId,packed:100,loaded:100,reason:''}]}),/Isolated stock cannot/);
  assert.equal(JSON.stringify([...f.db]),before);
  await f.packingSave('WAREHOUSE','PROGRESS',{id,lines:[{taskId:f.taskId,packed:90,loaded:90,reason:'Ten damaged cartons remain isolated; customer demand unchanged'}]});
  await f.packingSave('WAREHOUSE','COMPLETE',{id});
  const final=await(await f.packingRead('SUPPORT')).read(),completed=final.lists.find(row=>row.id===id);
  assert.equal(completed.lines[0].quantity,100);assert.equal(completed.lines[0].loaded,90);assert.equal(completed.remainders[0].quantity,10);
  assert.equal(completed.stockDamageReviewRequired,false);assert.equal(completed.stockDamageReview.cases[0].caseId,saved.caseId);
  assert.equal(final.tasks[0].readyToArrange,0);assert.equal(final.tasks[0].remaining,100);assert.equal(completed.invoiceId,undefined);
  const quantity=await f.quantitySend({company,customerId:'C',orders:[{orderId:f.submission.orderId,submissionId:f.submission.submissionId}]});
  assert.equal(quantity.status,200);assert.equal(quantity.body.orders[0].lines[0].committedQtyCtn,100);assert.equal(quantity.body.orders[0].lines[0].receivedQtyCtn,90);
  assert.equal(f.list(f.names.activity).filter(row=>row.action==='STOCK_EXCEPTION_REPORTED').length,1);
 }
});

async function lender(f){const company=f.submission.destination,submission={...intake.body(company),orderId:'DONOR_ORDER',submissionId:'DONOR_SUBMISSION',customerId:'DONOR_CUSTOMER'},accepted=await f.finish(submission),id=accepted.taskIds[0],raw=()=>f.db.get(f.names.tasks+'/'+id);
 await f.purchaseSave('PLAN',{taskId:id,version:f.bindings.taskEditVersion(raw()),planRevision:'',supplierId:'SUP',totalCtn:100,transportMode:'SUPPLIER_DELIVER',reason:'Donor customer procurement',
  costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:100,freeCtn:0,prices:{lpPc:1,lpCtn:12,disc1:0,disc2:0,disc3:0}}});
 await f.purchaseSave('PO',{taskIds:[id],versions:{[id]:f.bindings.taskEditVersion(raw())},poNumber:company+'-PO-1001'});await f.receipt(100,[id]);return id;
}
async function borrow(f,donor,quantity){const company=f.submission.destination;f.select('PURCHASE');const quote=await f.purchase.getPurchaseBorrowOptionsCurrent(company,{borrowerTaskId:f.taskId});assert.equal(quote.ok,true);
 const option=quote.options.find(row=>row.lenderSourceId===donor);assert.ok(option);const input={expectedRevision:quote.expectedRevision,borrowerTaskId:f.taskId,lenderSourceId:donor,replacementSourceId:f.taskId,quantity,reason:'Purchase approves bounded damage shortage repair'};
 return{quote,result:await f.finishCommand(request=>f.purchase.savePurchaseBorrowingCurrent(company,request),{...f.metadata(),operation:'BORROW_APPROVE',input})};}

test('Purchase alone may top up the exact damaged held shortage when borrower still has uncommitted own PO; ordinary receipt repays first',async()=>{
 const f=await issued('NCT'),donor=await lender(f);await f.receipt(50,[f.taskId]);const id=await list(f,true,50);await quarantine(f);
 const positionBefore=copy(f.list('StockPositions')),poBefore=f.list(f.names.tasks).map(task=>[task._id,task.ourPoNumber,task.purchaseQtyInCtn]);
 for(const department of ['SUPPORT','WAREHOUSE']){f.select(department);assert.equal((await f.purchase.getPurchaseBorrowOptionsCurrent('NCT',{borrowerTaskId:f.taskId})).ok,false);}
 const {quote}=await borrow(f,donor,10);assert.equal(quote.options.find(row=>row.lenderSourceId===donor).maximumQuantity,10,'held repair is capped to factual damaged10, not all unreceived50');
 assert.equal(product(f).onHand,positionBefore.reduce((sum,row)=>sum+row.onHand,0));assert.equal(product(f).reservedUsable,140);assert.equal(product(f).isolated,10);
 assert.equal(f.list(f.names.activity).find(row=>row.action==='STOCK_TRANSFER_CURRENT').details.relation.repaid,0);
 const stillNeedsRecheck=(await(await f.packingRead('SUPPORT')).read()).lists.find(row=>row.id===id);assert.equal(stillNeedsRecheck.stockDamageReviewRequired,true,'good stock restoration cannot certify old Loaded evidence');
 await f.packingSave('WAREHOUSE','REOPEN',{id,reason:'Check replacement of the damaged ten physical cartons'});
 await assert.rejects(f.packingSave('WAREHOUSE','COMPLETE',{id}),/recheck damaged packing/);
 await assert.rejects(f.packingSave('WAREHOUSE','PROGRESS',{id,lines:[{taskId:f.taskId,packed:50,loaded:50,reason:''}]}),/Explain the physical damage recheck/);
 await f.packingSave('WAREHOUSE','PROGRESS',{id,lines:[{taskId:f.taskId,packed:50,loaded:50,reason:'Inspected and actually loaded ten Purchase-approved borrowed cartons'}]});await f.packingSave('WAREHOUSE','COMPLETE',{id});
 await f.receipt(50,[f.taskId]);const transfer=f.list(f.names.activity).find(row=>row.action==='STOCK_TRANSFER_CURRENT');assert.equal(transfer.status,'CLOSED');assert.equal(transfer.details.relation.repaid,10);
 assert.deepEqual(f.list(f.names.tasks).map(task=>[task._id,task.ourPoNumber,task.purchaseQtyInCtn]),poBefore);assert.equal(product(f).reservedUsable,190);assert.equal(product(f).isolated,10);
});

test('sole borrowed-customer stock can be isolated without erasing debt; exact case replacement restores that customer, not PO owner or future-loan counters',async()=>{
 const f=await issued('GHR'),donor=await lender(f);await borrow(f,donor,100);const id=await list(f,true);
 const caseId=(await stock(f,'WAREHOUSE','QUARANTINE',{sourceTaskId:donor,quantity:10,kind:'SHORT_EXPIRY',reason:'Ten borrowed cartons failed physical inspection'})).caseId;
 const event=f.list(f.names.activity).find(row=>row._id===caseId);assert.equal(event.stockCustomerTaskId,f.taskId);assert.equal(event.imageAltText,donor);
 await stock(f,'PURCHASE','DECIDE',{id:caseId,decision:'REPLACE',disposition:'RETURN',supplierReference:'Replace the same failed cartons',expectedDate:'2026-11-01',reason:'Supplier replaces the affected customer goods'});
 await stock(f,'WAREHOUSE','REPLACEMENT',{id:caseId,quantity:10,reference:'BORROWED-RPL-10',acceptedGood:true,reason:'Ten good replacement cartons received'});
 assert.equal(f.list('StockClaims').filter(row=>row.taskId===f.taskId).reduce((sum,row)=>sum+row.reservedUsable,0),100);
 assert.equal(f.list('StockClaims').filter(row=>row.taskId===donor).reduce((sum,row)=>sum+row.reservedUsable,0),0);
 let transfer=f.list(f.names.activity).find(row=>row.action==='STOCK_TRANSFER_CURRENT');assert.equal(transfer.details.relation.repaid,0);assert.equal(transfer.status,'ACTIVE');
 const view=await(await f.packingRead('SUPPORT')).read(),pending=view.lists.find(row=>row.id===id);assert.equal(pending.stockDamageReviewRequired,true);
 assert.throws(()=>load('../prototypes/stock-current-state/packingListModel.candidate.js').packingInvoiceLines(pending),/whole list/);
 await f.packingSave('WAREHOUSE','REOPEN',{id,reason:'Inspect and actually load the good case replacements'});
 await f.packingSave('WAREHOUSE','PROGRESS',{id,lines:[{taskId:f.taskId,packed:100,loaded:100,reason:'Good replacement cartons physically loaded after inspection'}]});await f.packingSave('WAREHOUSE','COMPLETE',{id});
 await stock(f,'WAREHOUSE','RETURN',{id:caseId,quantity:10,reference:'BORROWED-RETURN-10',reason:'Isolated borrowed goods collected by supplier'});
 await f.receipt(100,[f.taskId]);transfer=f.list(f.names.activity).find(row=>row.action==='STOCK_TRANSFER_CURRENT');assert.equal(transfer.details.relation.repaid,100);assert.equal(transfer.status,'CLOSED');
 assert.equal(product(f).onHand,200);assert.equal(product(f).isolated,0);assert.equal(f.list(f.names.tasks).length,2);
});

test('shared source with two customer claims refuses arbitrary Warehouse loss attribution instead of choosing a loser',async()=>{
 const f=await issued('NCT'),donor=await lender(f);await borrow(f,donor,30);
 const pending=await stockRequest(f,'WAREHOUSE','QUARANTINE',{sourceTaskId:donor,quantity:10,kind:'INTERNAL_DAMAGE',reason:'Unknown customer physical attribution'}),before=JSON.stringify([...f.db]);
 assert.equal((await pending.send()).ok,false);assert.equal(JSON.stringify([...f.db]),before);assert.equal(f.list(f.names.activity).some(row=>row.action==='STOCK_EXCEPTION_REPORTED'),false);
});

test('sent plan damaged before starting: Warehouse records good90/remainder10; Purchase decision and exact customer replacement/return preserve PO acceptance',async()=>{
 const f=await issued('NCT');await f.receipt(100);const id=await list(f),caseId=(await quarantine(f,'SHORT_EXPIRY')).caseId;
 await stock(f,'PURCHASE','DECIDE',{id:caseId,decision:'REPLACE',disposition:'RETURN',supplierReference:'Original supplier agrees',expectedDate:'2026-11-01',reason:'Replace the affected customer cartons'});
 const tooSoon=await stockRequest(f,'WAREHOUSE','RETURN',{id:caseId,quantity:10,reference:'RETURN-PENDING',reason:'Supplier waiting'}),before=JSON.stringify([...f.db]);
 const refused=await tooSoon.send();assert.equal(refused.ok,false);assert.equal(refused.pending,undefined);assert.equal(JSON.stringify([...f.db]),before);
 await f.packingSave('WAREHOUSE','START',{id});
 await f.packingSave('WAREHOUSE','PROGRESS',{id,lines:[{taskId:f.taskId,packed:90,loaded:90,reason:'Ten isolated cartons not loaded'}]});await f.packingSave('WAREHOUSE','COMPLETE',{id});
 await stock(f,'WAREHOUSE','RETURN',{id:caseId,quantity:10,reference:'RETURN-10',reason:'Supplier actually collected ten isolated cartons'});
 assert.deepEqual([product(f).onHand,product(f).reservedUsable,product(f).isolated,product(f).available],[90,90,0,0]);assert.equal(claim(f).isolatedAttributed,0);
 await stock(f,'WAREHOUSE','REPLACEMENT',{id:caseId,quantity:10,reference:'REPLACEMENT-10',reason:'Ten good replacements physically received',acceptedGood:true});
 assert.deepEqual([product(f).onHand,product(f).reservedUsable,product(f).isolated,product(f).available],[100,100,0,0]);
 const position=f.list('StockPositions')[0];assert.equal(position.receiptAccepted,100);assert.equal(position.replacementReceived,10);assert.equal(position.supplierReturned,10);
 assert.equal((await(await f.packingRead('SUPPORT')).read()).tasks[0].readyToArrange,10);
 const next=await f.packingSave('SUPPORT','CREATE',{customerId:'C',currency:'USD',lines:[{taskId:f.taskId,quantity:10}]});await f.packingSave('SUPPORT','SEND',{id:next.id});
 assert.equal((await(await f.packingRead('SUPPORT')).read()).tasks[0].readyToArrange,0);assert.equal(f.list(f.names.tasks).length,1);assert.equal(f.list('PurchaseOrders').length,0);
});

test('original damage-model candidate reproducible; unchanged original model remains a protected fallback, not a damage bypass',()=>{
 assert.match(execFileSync(process.execPath,[path.join(__dirname,'../prototypes/stock-current-state/build-packing-damage-candidate.cjs'),'--check'],{encoding:'utf8'}),/verified/);
 const original=load('packingListModel.js'),candidate=load('../prototypes/stock-current-state/packingListModel.candidate.js');
 assert.equal(original.PACKING_CURRENT_DAMAGE_VERSION,undefined);assert.equal(candidate.PACKING_CURRENT_DAMAGE_VERSION,1);
 const originalRead=load('packingListOperations.js'),paired=load('../prototypes/stock-current-state/packingListOperations.candidate.js');
 assert.equal(originalRead.PACKING_CURRENT_DAMAGE_READ_VERSION,undefined);assert.equal(paired.PACKING_CURRENT_DAMAGE_READ_VERSION,1);
});

test('paired original reader rejects malformed or contradictory pending damage evidence, preserving normal original rows',()=>{
 const paired=load('../prototypes/stock-current-state/packingListOperations.candidate.js'),original=load('packingListOperations.js'),{operationId}=load('purchaseOperationJournal.js');
 const list={id:'LIST',company:'NCT',customerId:'C',currency:'USD',revision:'R',status:'COMPLETED',lines:[{taskId:'T',quantity:100,packed:100,loaded:100}]};
 const row=details=>({_id:operationId('NCT','LIST','PACKING_CURRENT'),action:paired.PACKING_CURRENT,description:'LIST',details:{list:{...copy(list),...details}}});
 const valid={stockDamageReviewRequired:true,stockDamageCases:[{caseId:'CASE',taskId:'T'}]};
 assert.deepEqual(copy(paired.readPackingLists([row({})],'NCT')),copy(original.readPackingLists([row({})],'NCT')));
 assert.equal(paired.readPackingLists([row(valid)],'NCT')[0].stockDamageReviewRequired,true);
 for(const details of [{stockDamageReviewRequired:'true'}, {...valid,stockDamageCases:[]}, {...valid,stockDamageReviewRequired:false}, {...valid,stockDamageCases:[{caseId:'CASE',taskId:'OTHER'}]}, {...valid,stockDamageCases:[...valid.stockDamageCases,...valid.stockDamageCases]}, {stockDamageCases:valid.stockDamageCases}, {stockDamageReview:{cases:valid.stockDamageCases,at:'not a time'}}])assert.throws(()=>paired.readPackingLists([row(details)],'NCT'),/Packing damage/);
 assert.equal(paired.readPackingLists([row({stockDamageReviewRequired:false,stockDamageCases:[],stockDamageReview:{cases:valid.stockDamageCases,at:'2026-10-23T00:00:00.000Z'}})],'NCT').length,1);
});

test('fully isolated then actually returned CLOSED claim/source reopen only on real exact-customer replacement',async()=>{
 const f=await issued('GHR');await f.receipt(100);
 const caseId=(await stock(f,'WAREHOUSE','QUARANTINE',{sourceTaskId:f.taskId,quantity:100,kind:'SHORT_EXPIRY',reason:'All cartons failed incoming follow-up inspection'})).caseId;
 await stock(f,'PURCHASE','DECIDE',{id:caseId,decision:'REPLACE',disposition:'RETURN',supplierReference:'Full replacement',expectedDate:'2026-11-01',reason:'Supplier approved replacing all one hundred cartons'});
 await stock(f,'WAREHOUSE','RETURN',{id:caseId,quantity:100,reference:'RETURN-ALL',reason:'All isolated cartons actually collected'});
 assert.equal(product(f).status,'CLOSED');assert.equal(claim(f).status,'CLOSED');assert.equal(claim(f).reservedUsable,0);assert.equal(claim(f).isolatedAttributed,0);
 await stock(f,'WAREHOUSE','REPLACEMENT',{id:caseId,quantity:100,reference:'REPLACEMENT-ALL',reason:'All good replacement cartons inspected and received',acceptedGood:true});
 assert.equal(product(f).status,'ACTIVE');assert.equal(claim(f).status,'ACTIVE');assert.equal(claim(f).reservedUsable,100);assert.equal(product(f).onHand,100);assert.equal(f.list('StockPositions')[0].receiptAccepted,100);
});

test('existing separate Admin/Account release restores reserved customer, while stock restoration alone never clears Loaded review',async()=>{
 const f=await issued('NCT');await f.receipt(100);const id=await list(f,true),caseId=(await quarantine(f)).caseId;
 await stock(f,'ADMIN','APPROVE_RELEASE',{id:caseId,reason:'Physical inspection confirms the same isolated cartons are usable'});
 const same=await stockRequest(f,'ADMIN','CLOSE',{id:caseId,outcome:'RELEASED',reason:'Cannot approve own release'});assert.equal((await same.send()).ok,false);
 await stock(f,'ACCOUNT','CLOSE',{id:caseId,outcome:'RELEASED',reason:'Different employee verified original inspection release'});
 assert.deepEqual([product(f).onHand,product(f).reservedUsable,product(f).isolated,product(f).available],[100,100,0,0]);assert.equal(claim(f).isolatedAttributed,0);
 const view=await(await f.packingRead('SUPPORT')).read();assert.equal(view.lists.find(row=>row.id===id).stockDamageReviewRequired,true);assert.equal(view.tasks[0].ready,100);
});

test('case replacement/release cannot double-cover a customer already fulfilled from approved free stock',()=>{
 const {validate,freeCaseMovement,releaseFreeCase}=require('../prototypes/stock-current-state/borrowing-model.cjs'),identity={company:'NCT',barcode:'1',packing:'12',ea:12};
 const state={...identity,complete:true,revision:0,relations:[],tasks:[{...identity,id:'T',customerId:'C',requested:100,dispatched:0}],packingHolds:{company:'NCT',complete:true,scope:'TASK_TOTAL',version:'H',heldByTask:{T:0}},sources:[
  {...identity,id:'OWN',poId:'PO',poValid:true,reviewRequired:false,ownerTaskId:'T',ownerShare:100,receiptPolicy:'OWNER_DEMAND',planned:100,accepted:100,onHand:100,available:0,isolated:10,claims:{T:90},isolatedClaims:{T:10}},
  {...identity,id:'FREE',poId:'STOCK-PO',poValid:true,reviewRequired:false,ownerTaskId:null,ownerShare:0,receiptPolicy:'EXPLICIT_ONLY',planned:10,accepted:10,onHand:10,available:0,isolated:0,claims:{T:10}}]};
 validate(state);
 for(const after of [freeCaseMovement(state,{expectedRevision:0,sourceId:'OWN',customerTaskId:'T',action:'REPLACEMENT',quantity:10}).after,releaseFreeCase(state,{expectedRevision:0,sourceId:'OWN',customerTaskId:'T',quantity:10}).after]){
  assert.equal(after.sources.reduce((sum,row)=>sum+(row.claims.T||0),0),100);assert.equal(after.sources.find(row=>row.id==='OWN').available,10);assert.equal(after.tasks[0].requested,100);assert.equal(after.relations.length,0);
 }
});
