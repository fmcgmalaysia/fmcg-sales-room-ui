const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./load-master-module.cjs');
const {fixture}=require('../prototypes/stock-loaded-contract-20261028/check-current.cjs');
const desks=load('supportDesk.js'),invoice=load('supportInvoice.js');
const {packingVersion}=load('packingListOperations.js');
const {createShortloadResolutionOperations}=load('shortloadResolution.js');
const {readCustomerShipments}=load('customerShipmentLedger.js');
const {readPhysicalOutflows}=load('physicalOutflow.js');
const {deskTaskPortions}=load('shortloadResolutionModel.js');

async function setup(){
 const f=fixture(),names={NCT:{activity:'N'},GHR:{activity:'G'}},staff={...f.staff,packingDepartment:'SUPPORT'};
 const saveDesk=desks.createSupportDeskOperations({store:f.store,names,readContext:f.context});
 const issue=invoice.createSupportInvoiceOperations({store:f.store,names,readContext:f.context,saveFulfilment:f.fulfilSave,readRates:async()=>[{currency:'USD',rateToMyr:4}]});
 const resolve=createShortloadResolutionOperations({store:f.store,names,readContext:f.packingContext});
 const state=async()=>desks.readSupportDesks((await f.context()).activity,'NCT').find(row=>row.customerId==='CUSTOMER-A');
 const assign=async(input)=>saveDesk({company:'NCT',staff,requestId:f.nextId(),input:{customerId:'CUSTOMER-A',revision:(await state())?.revision||'',...input}});
 const request=async(input,department='SUPPORT')=>({company:'NCT',staff:{...staff,packingDepartment:department},requestId:f.nextId(),input:{version:packingVersion(await f.packingContext('NCT')),...input}});
 const current=async id=>(await f.packingContext('NCT')).lists.find(row=>row.id===id);
 const send=async(quantity)=>f.packingSave(await request({action:'DESK_SEND',customerId:'CUSTOMER-A',desk:1,deskRevision:(await state()).revision,lines:[{taskId:'A',quantity}]}));
 const loadQty=async(list,quantity)=>f.packingSave(await request({action:'DESK_LOAD',id:list.id,revision:list.revision,taskId:'A',loaded:quantity,reasonCodes:quantity<list.lines[0].quantity?['INSUFFICIENT']:[]} ,'WAREHOUSE'));
 const invoiceRequest=async(quantity,number)=>({company:'NCT',staff,requestId:f.nextId(),input:{version:invoice.supportInvoiceState(await f.context()).version,customerId:'CUSTOMER-A',orderId:'ORDER-A',desk:{number:1,revision:(await state()).revision},number,lines:[{taskId:'A',quantity}]}});
 await assign({action:'DESK_ASSIGN',taskId:'A',desk:1});
 return {...f,staff,state,assign,request,current,send,loadQty,issue,resolve,invoiceRequest};
}

async function partialInvoice(existing){
 const f=existing||await setup(),sent=await f.send(100);await f.loadQty(sent.list,90);
 const list=await f.current(sent.id),resolution=await f.request({action:'DESK_RESOLVE',id:list.id,revision:list.revision,taskId:'A',deskRevision:(await f.state()).revision,resolutionRevision:list.lines[0].resolution.revision,parts:[{mode:'TRANSFER',desk:0,quantity:10}]});
 await f.resolve(resolution);const request=await f.invoiceRequest(90,'TEST-REUSE-001'),issued=await f.issue(request);
 return {...f,firstId:sent.id,firstInvoice:issued,firstRequest:request};
}

test('partial SI preserves10 Unassigned, original demand, physical quantity and one original invoice',async()=>{
 const f=await partialInvoice(),ctx=await f.context(),parts=deskTaskPortions(ctx.activity,await f.state(),ctx.tasks[0],readPhysicalOutflows(ctx.activity));
 assert.equal(parts.find(row=>row.desk===0).quantity,10);assert.equal(ctx.tasks[0].requested,100);assert.equal((await f.stock()).onHand,60);
 await f.issue(f.firstRequest);assert.equal(readCustomerShipments((await f.context()).activity).filter(row=>row.invoice).length,1);
});

test('same order can reuse Desk1 for remaining10 without altering first90 or deducting again on SI',async()=>{
 const f=await partialInvoice(),before=readCustomerShipments((await f.context()).activity).find(row=>row.invoice),oldList=await f.current(f.firstId);
 await f.assign({action:'DESK_SPLIT',taskId:'A',desk:1,parts:[{desk:1,quantity:100}]});
 const second=await f.send(10);assert.notEqual(second.id,f.firstId);await f.loadQty(second.list,10);await f.issue(await f.invoiceRequest(10,'TEST-REUSE-002'));
 const ctx=await f.context(),invoices=readCustomerShipments(ctx.activity).filter(row=>row.invoice);
 assert.equal(invoices.length,2);assert.deepEqual(invoices.find(row=>row.id===before.id),before);assert.deepEqual(await f.current(f.firstId),oldList);
 assert.equal(invoices.reduce((n,row)=>n+row.lines.reduce((s,line)=>s+line.quantity,0),0),100);assert.equal((await f.stock()).onHand,50);
 const evidence=JSON.stringify((await f.context()).activity);await f.issue(f.firstRequest);assert.equal(JSON.stringify((await f.context()).activity),evidence);assert.equal((await f.stock()).onHand,50);
 assert.equal(readPhysicalOutflows(ctx.activity).filter(row=>row.taskId==='A').reduce((n,row)=>n+row.quantity,0),100);
});

test('incomplete SI intent cannot release its Desk for another batch',async()=>{
 const f=await setup(),sent=await f.send(100);await f.loadQty(sent.list,100);const original=f.store.insert;let reject=true;
 f.store.insert=async(c,row)=>{if(reject&&row.action==='SUPPORT_INVOICE_PREPARED'){reject=false;throw Error('Synthetic interruption before SI preparation');}return original(c,row);};
 const request=await f.invoiceRequest(100,'TEST-PENDING-001');await assert.rejects(f.issue(request),/Synthetic interruption/);
 await assert.rejects(f.assign({action:'DESK_SHIPMENT',desk:1,transport:'LAND',date:'2026-11-04',arrival:''}),/locked/);
 await f.issue(request);assert.equal(readCustomerShipments((await f.context()).activity).filter(row=>row.invoice).length,1);
});

test('SI frees the workbench and its metadata without editing historical snapshots or writing on read',async()=>{
 const f=await setup();await f.assign({action:'DESK_REFERENCES',desk:1,soNo:'OLD-SO',poNo:'CUSTOMER-PO'});
 await f.assign({action:'DESK_SHIPMENT',desk:1,transport:'LAND',date:'2026-11-04',arrival:''});
 await partialInvoice(f);const ctx=await f.context(),original=JSON.stringify(ctx),raw=await f.state(),oldInvoice=desks.readSupportDeskLocks(ctx).find(row=>row.status==='ISSUED');
 for(let i=0;i<20;i++){const current=desks.currentSupportDeskState(ctx,raw);assert.equal(current.locks.length,0);assert.equal(current.shipments.length,0);assert.equal(current.references.length,0);assert.equal(current.deliveryHolds.length,0);assert.notEqual(desks.supportDeskBatchId(current,1),oldInvoice.snapshot.batchId);}
 assert.equal(JSON.stringify(ctx),original);assert.equal(oldInvoice.snapshot.references.soNo,'OLD-SO');assert.equal(oldInvoice.snapshot.shipment.date,'2026-11-04');assert.deepEqual(await f.state(),raw);
});

test('a fresh request from the old Warehouse form cannot load after its SI completes',async()=>{
 const f=await partialInvoice(),list=await f.current(f.firstId),stock=await f.stock();
 await assert.rejects(f.loadQty(list,100));assert.deepEqual(await f.stock(),stock);
 await f.assign({action:'DESK_SPLIT',taskId:'A',desk:1,parts:[{desk:1,quantity:100}]});
 await f.send(10);await assert.rejects(f.loadQty(list,100));assert.deepEqual(await f.stock(),stock);
});

test('pre-SI files and late historical PDF attach to exactly one use of the same Desk and order',async()=>{
 const f=await setup(),doc=load('supportDocuments.js'),calls=[];
 const save=doc.createSupportDocumentOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.context,documentService:async input=>{calls.push(input);return input.action==='ALLOCATE'?{fileId:'reuse-document-'+calls.length}:{...input,ok:true,customerLinkReady:true,size:Buffer.from(input.base64,'base64').length};}});
 const request=async(code,content,invoiceId='')=>{const ctx=await f.context(),state=desks.currentSupportDeskState(ctx,await f.state()),snapshot=invoiceId&&desks.invoiceDeskSnapshot(ctx.activity,invoiceId);return {company:'NCT',staff:f.staff,requestId:f.nextId(),input:{code,scope:'DESK',customerId:'CUSTOMER-A',orderId:'ORDER-A',desk:1,batchId:snapshot?.batchId||desks.supportDeskBatchId(state,1),invoiceId,version:doc.supportDocumentVersion(ctx),reference:'TEST',amountCents:0,base64:Buffer.from('%PDF-1.4\n'+content).toString('base64')}};};
 const first=await request('BC','FIRST');await save(first);await partialInvoice(f);
 const firstSI=readCustomerShipments((await f.context()).activity).find(row=>row.invoice);
 await f.assign({action:'DESK_SPLIT',taskId:'A',desk:1,parts:[{desk:1,quantity:100}]});
 const second=await request('BC','SECOND');await save(second);
 const stale={...first,requestId:f.nextId(),input:{...first.input,base64:Buffer.from('%PDF-1.4\nSTALE').toString('base64')}};await assert.rejects(save(stale),/batch/);
 const sent=await f.send(10);await f.loadQty(sent.list,10);await f.issue(await f.invoiceRequest(10,'TEST-REUSE-DOC-002'));
 await save(await request('SI','LATE FIRST SI',firstSI.id));
 const ctx=await f.context(),invoices=readCustomerShipments(ctx.activity).filter(row=>row.invoice),documents=doc.readSupportDocuments(ctx.activity,'NCT');
 for(const invoice of invoices){const files=documents.filter(row=>doc.supportDocumentMatchesShipment(row,invoice,ctx.activity));assert.equal(files.filter(row=>row.code==='BC').length,1);assert.equal(files.find(row=>row.code==='BC').batchId,desks.invoiceDeskSnapshot(ctx.activity,invoice.id).batchId);assert.equal(files.filter(row=>row.code==='SI').length,invoice.id===firstSI.id?1:0);}
 assert.equal(calls.filter(row=>row.action==='ALLOCATE').length,3);assert.equal((await f.stock()).onHand,50);
});

test('all three issued Desks are released together and a new order can use Desk1',async()=>{
 const f=await setup();await f.assign({action:'DESK_SPLIT',taskId:'A',desk:0,parts:[{desk:1,quantity:30},{desk:2,quantity:30},{desk:3,quantity:40}]});
 for(const [desk,quantity]of [[1,30],[2,30],[3,40]]){
  const sent=await f.packing({action:'DESK_SEND',customerId:'CUSTOMER-A',desk,deskRevision:(await f.state()).revision,lines:[{taskId:'A',quantity}]});
  await f.packing({action:'DESK_LOAD',id:sent.id,revision:sent.list.revision,taskId:'A',loaded:quantity,reasonCodes:[]},'WAREHOUSE');
  const request=await f.invoiceRequest(quantity,'TEST-THREE-'+desk);request.input.desk.number=desk;await f.issue(request);
 }
 const ctx=await f.context(),current=desks.currentSupportDeskState(ctx,await f.state());assert.equal(desks.currentSupportDeskLocks(ctx).length,0);assert.equal(current.deliveryHolds.length,0);assert.equal(readCustomerShipments(ctx.activity).filter(row=>row.invoice).length,3);
 f.tasks.push({...structuredClone(f.tasks[0]),id:'NEW-A',orderId:'NEW-ORDER-A',sourceLineId:'NEW-LINE',requested:10,ord:10,inc:0,po:'',procurement:undefined,warehouse:{hasPhysicalReceipt:false,accepted:0},archived:false});
 await f.assign({action:'DESK_ASSIGN',taskId:'NEW-A',desk:1});assert.equal((await f.state()).assignments.find(row=>row.taskId==='NEW-A').desk,1);assert.equal((await f.stock()).onHand,50);
});
