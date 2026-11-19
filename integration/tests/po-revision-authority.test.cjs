'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),load=require('./load-master-module.cjs');
function fixtureFrom(name){const file=path.join(__dirname,name),localRequire=createRequire(file),module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports={fixture};',{module,exports:module.exports,require:id=>id==='node:test'?()=>{}:localRequire(id),Buffer,console,__dirname:path.dirname(file),__filename:file},{filename:file});return module.exports.fixture;}
const operationFixture=fixtureFrom('purchase-operations.test.cjs'),poFixture=fixtureFrom('purchase-order-workflow.test.cjs');
const {taskEditVersion}=load('purchaseTaskIdentity.js'),{procurementContentLock}=load('paymentHandoff.js');
let serial=400;const rid=()=>String(++serial).padStart(8,'0')+'-1111-4111-8111-111111111111';
const payment=()=>({id:'PAYMENT',confirmed:true,direction:'PAYMENT',cents:10000,proof:{fileId:'PROOF',sha256:'proof',linked:true}});
const cost=(discount=0)=>({schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:200,freeCtn:0,prices:{lpPc:1,lpCtn:16,disc1:discount,disc2:0,disc3:0}});
async function placed(){const f=operationFixture();f.rows.get('NCTOrders/O0').cbmCtn=.05;await f.operate({...f.base,requestId:rid(),operation:'PLAN',input:{taskId:f.id,version:taskEditVersion(f.task()),planRevision:'',totalCtn:200,transportMode:'SUPPLIER_DELIVER',costing:cost(),reason:''}});await f.operate({...f.base,requestId:rid(),operation:'PO',input:{taskIds:[f.id],versions:f.versions(),poNumber:'NCT-PO-TEST'}});return f;}
for(const variant of ['legacy','returned','deleted-proof','refunded','final-check'])test('permanent lock covers '+variant+' on direct price writes',async()=>{
 const f=operationFixture(),paid=payment(),details={taskIds:[f.id],finance:{payments:[paid]}};f.task().ourPoNumber='NCT-PO-TEST';
 if(variant==='returned')details.procurementHandoff={schema:1,stage:'RETURNED'};
 if(variant==='deleted-proof'){paid.proof.linked=false;paid.deletedProofs=[{fileId:'PROOF'}];}
 if(variant==='refunded')details.finance.payments.push({...payment(),id:'REFUND',direction:'REFUND'});
 if(variant==='final-check')details.finance={check:{enabled:true}};
 f.rows.set('PurchaseOrders/P',{_id:'P',company:'NCT',details});const before=JSON.stringify(f.task());
 await assert.rejects(f.operate({...f.base,requestId:rid(),operation:'EDIT',input:{edits:[{taskId:f.id,version:taskEditVersion(f.task()),changes:{lpCtn:15}}]}}),/Procurement handoff .*locked/);assert.equal(JSON.stringify(f.task()),before);
});
test('refund-only or unconfirmed record is not a confirmed outgoing payment',()=>{assert.equal(procurementContentLock({finance:{payments:[{...payment(),direction:'REFUND'}]}}),'');assert.equal(procurementContentLock({finance:{payments:[{...payment(),confirmed:false}]}}),'');});
test('confirmed payment appearing after prepare blocks apply without changing price',async()=>{
 const f=operationFixture(),insert=f.store.insert;f.task().ourPoNumber='NCT-PO-TEST';f.store.insert=async(c,row)=>{const result=await insert(c,row);if(row.action==='PURCHASE_OPERATION_PREPARED')f.rows.set('PurchaseOrders/P',{_id:'P',company:'NCT',details:{taskIds:[f.id],finance:{payments:[payment()]}}});return result;};
 await assert.rejects(f.operate({...f.base,requestId:rid(),operation:'EDIT',input:{edits:[{taskId:f.id,version:taskEditVersion(f.task()),changes:{lpCtn:15}}]}}),/permanently locked/);assert.equal(f.task().lpCtn,16);
});
test('amendment needs no reason and one retry produces one amendment with exact money and CBM basis',async()=>{
 const f=await placed(),row=f.workspace().tasks.find(t=>t.id===f.id),request={...f.base,requestId:rid(),operation:'PLAN',input:{taskId:f.id,version:row.editVersion,planRevision:row.procurement.revision,totalCtn:200,transportMode:'SUPPLIER_DELIVER',costing:cost(.1),reason:''}};
 await f.operate(request);await f.operate(request);const updated=f.workspace().tasks.find(t=>t.id===f.id),event=updated.history.find(e=>e.requestId===request.requestId&&e.action==='PURCHASE_PLAN_SAVED');
 assert.equal(updated.procurement.amendmentCount,1);assert.equal(event.commercialBefore.amountCents,320000);assert.equal(event.commercialAfter.amountCents,288000);assert.equal(event.commercialBefore.cbmPerCtn,.05);assert.equal(event.commercialAfter.costing.prices.disc1,.1);assert.ok(event.time);
});
test('PO replacement is atomic, keeps one current file, preserves historical file and retries once',async()=>{
 let allocated=0;const f=poFixture(async input=>input.action==='ALLOCATE'?{fileId:'FILE-'+(++allocated)}:{...input,ok:true});
 for(let n=1;n<=2;n++){const row=(await f.operations.list('NCT',f.staff))[0],request={...f.base,requestId:rid(),input:{id:row.id,version:row.version,action:'DOCUMENT',type:'PO',number:'PO-'+n,base64:Buffer.from('%PDF-1.4\nTEST '+n).toString('base64'),reason:'Upload PO'}};await f.operations.save(request);await f.operations.save(request);}
 const row=(await f.operations.list('NCT',f.staff))[0],current=row.documents.filter(d=>!d.superseded);assert.equal(current.length,1);assert.equal(current[0].fileId,'FILE-2');assert.equal(row.documents.length,2);assert.equal(row.documentStates.PO.state,'AVAILABLE');assert.equal(allocated,2);
});
test('revision A to B to A never resurrects old PO and both reads share the same problem state',async()=>{
 const f=poFixture(async input=>input.action==='ALLOCATE'?{fileId:'FILE-1'}:{...input,ok:true});let row=(await f.operations.list('NCT',f.staff))[0];
 await f.operations.save({...f.base,requestId:rid(),input:{id:row.id,version:row.version,action:'DOCUMENT',type:'PO',number:'PO',base64:Buffer.from('%PDF-1.4\nTEST').toString('base64'),reason:'Upload'}});
 const task=f.workspace.tasks[0];task.lpCtn=9;task.history.push({id:'CHANGE1',requestId:'CHANGE1',action:'PURCHASE_PRICE_SAVED',result:'SAVED',time:'2026-10-11T03:00:00Z',commercialChanged:true,amendment:true});
 row=(await f.operations.list('NCT',f.staff))[0];assert.equal(row.documentStates.PO.state,'PROBLEM');assert.equal(row.documents.filter(d=>!d.superseded).length,0);
 task.lpCtn=10.05;task.history.push({id:'CHANGE2',requestId:'CHANGE2',action:'PURCHASE_PRICE_SAVED',result:'SAVED',time:'2026-10-11T04:00:00Z',commercialChanged:true,amendment:true});
 const purchase=(await f.operations.list('NCT',f.staff))[0],finance=(await f.operations.list('NCT',{...f.staff,staffId:'FINANCE'}))[0];assert.equal(purchase.documentStates.PO.state,'PROBLEM');assert.equal(JSON.stringify(purchase.documentStates),JSON.stringify(finance.documentStates));assert.equal(purchase.documents.filter(d=>!d.superseded).length,0);
});
test('transport-only change does not invalidate a current PO',async()=>{
 const f=poFixture(async input=>input.action==='ALLOCATE'?{fileId:'FILE-1'}:{...input,ok:true});let row=(await f.operations.list('NCT',f.staff))[0];await f.operations.save({...f.base,requestId:rid(),input:{id:row.id,version:row.version,action:'DOCUMENT',type:'PO',number:'PO',base64:Buffer.from('%PDF-1.4\nTEST').toString('base64'),reason:'Upload'}});
 f.workspace.tasks[0].procurement.transportMode='SELF_COLLECT';f.workspace.tasks[0].history.push({id:'TRANSPORT',action:'PURCHASE_PLAN_SAVED',result:'SAVED',commercialChanged:false,time:'2026-10-11T03:00:00Z'});row=(await f.operations.list('NCT',f.staff))[0];assert.equal(row.documentStates.PO.state,'AVAILABLE');
});
test('failed replacement leaves the previous PO current and never advances its button',async()=>{
 let allocated=0,fail=false;const f=poFixture(async input=>{if(input.action==='ALLOCATE')return {fileId:'FILE-'+(++allocated)};if(fail)throw Error('lost upload receipt');return {...input,ok:true};});
 let row=(await f.operations.list('NCT',f.staff))[0];await f.operations.save({...f.base,requestId:rid(),input:{id:row.id,version:row.version,action:'DOCUMENT',type:'PO',number:'ONE',base64:Buffer.from('%PDF-1.4\nONE').toString('base64'),reason:'Upload'}});
 row=(await f.operations.list('NCT',f.staff))[0];fail=true;await assert.rejects(f.operations.save({...f.base,requestId:rid(),input:{id:row.id,version:row.version,action:'DOCUMENT',type:'PO',number:'TWO',base64:Buffer.from('%PDF-1.4\nTWO').toString('base64'),reason:'Upload'}}),/lost upload/);
 row=(await f.operations.list('NCT',f.staff))[0];assert.equal(row.documents.filter(d=>!d.superseded)[0].fileId,'FILE-1');assert.equal(row.documentStates.PO.state,'AVAILABLE');
});
test('Finance explicitly confirms an old PI against current procurement without rewriting document amount',async()=>{
 const f=poFixture(),first=(await f.operations.list('NCT',f.staff))[0];f.records.set('PurchaseOrders/'+first.id,{_id:first.id,company:'NCT',details:{taskIds:first.taskIds,documents:[{type:'PO',fileId:'PO',linked:true,sha256:'po',uploadedAt:'2026-10-11T01:30:00Z'},{type:'PI',fileId:'PI',linked:true,sha256:'pi',declaredCents:100000}],audit:[]}});
 const {createAccountSettlementOperations}=load('accountSettlement.js'),finance=createAccountSettlementOperations({store:f.store,names:{NCT:{activity:'NCTActivity'}},listOrders:f.operations.list});let row=(await f.operations.list('NCT',f.staff))[0];assert.equal(row.documentStates.PI.state,'PROBLEM');assert.equal(row.amount,1105);
 const input={id:row.id,version:row.version,action:'PAYMENT_REVIEW',stage:'REVIEWING',paperReceived:true,requestedCents:100000,reason:'Checked supplier evidence'};
 await assert.rejects(finance.save({...f.base,requestId:rid(),input}),/require confirmation/);
 await finance.save({...f.base,requestId:rid(),input:{...input,confirmCurrentProcurement:true}});row=(await f.operations.list('NCT',f.staff))[0];assert.equal(row.documentStates.PI.state,'AVAILABLE');assert.equal(row.documents.find(d=>d.type==='PI').declaredCents,100000);assert.equal(row.amount,1105);
 await finance.save({...f.base,requestId:rid(),input:{...input,version:row.version,stage:'RECEIVED'}});row=(await f.operations.list('NCT',f.staff))[0];assert.equal(row.documentStates.PI.state,'AVAILABLE');
 f.workspace.tasks[0].lpCtn=9;f.workspace.tasks[0].history.push({id:'NEW',action:'PURCHASE_PRICE_SAVED',result:'SAVED',commercialChanged:true,time:'2026-10-11T04:00:00Z'});row=(await f.operations.list('NCT',f.staff))[0];assert.equal(row.documentStates.PI.state,'PROBLEM');assert.equal(row.documentStates.PO.state,'PROBLEM');
});
test('permanent payment lock protects plan and PO number but does not lock another company',async()=>{
 for(const operation of ['PLAN','PO']){const f=await placed();f.rows.set('PurchaseOrders/P',{_id:'P',company:'NCT',details:{taskIds:[f.id],finance:{payments:[payment()]}}});const row=f.workspace().tasks.find(t=>t.id===f.id),input=operation==='PLAN'?{taskId:f.id,version:row.editVersion,planRevision:row.procurement.revision,totalCtn:200,transportMode:'SUPPLIER_DELIVER',costing:cost(.1),reason:''}:{taskIds:[f.id],versions:f.versions(),poNumber:'NCT-PO-NEW'};await assert.rejects(f.operate({...f.base,requestId:rid(),operation,input}),/permanently locked/);}
 const f=operationFixture();f.task().ourPoNumber='NCT-PO-TEST';f.rows.set('PurchaseOrders/P',{_id:'P',company:'GHR',details:{taskIds:[f.id],finance:{payments:[payment()]}}});await f.operate({...f.base,requestId:rid(),operation:'EDIT',input:{edits:[{taskId:f.id,version:taskEditVersion(f.task()),changes:{lpCtn:15}}]}});assert.equal(f.task().lpCtn,15);
});
test('CN pending and file issues produce the same canonical red state while missing remains missing',()=>{
 const {purchaseDocumentStates}=load('purchaseDocumentPolicy.js');const state=purchaseDocumentStates([{type:'CN',linked:true,fileId:'CN'}],[],[{pending:true}]);assert.equal(state.CN.state,'PROBLEM');assert.equal(state.PO.state,'MISSING');assert.equal(purchaseDocumentStates([{type:'PI',linked:true,fileId:'PI'}],[{type:'SO',status:'OPEN'}]).PI.state,'PROBLEM');
});
