const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {fixture}=require('../prototypes/stock-loaded-contract-20261028/check-current.cjs');
const {createSupportDeskOperations,readSupportDesks}=load('supportDesk.js');
const {createSupportInvoiceOperations,supportInvoiceState}=load('supportInvoice.js');
const {createSupportDocumentOperations,readSupportDocuments,supportDocumentVersion}=load('supportDocuments.js');
const {readPhysicalOutflows}=load('physicalOutflow.js');
async function setup(){
 const f=fixture(),names={NCT:{activity:'N'},GHR:{activity:'G'}},now=()=>new Date('2026-11-03T00:00:00Z');
 f.tasks[0].warehouse.accepted=100;
 f.records.get('N/ALLOCATION-A').details.targets=[{taskId:'A',quantity:100}];
 f.records.get('N/ALLOCATION-B').details.targets=[{taskId:'B',quantity:50}];
 const staff={...f.staff,packingDepartment:'SUPPORT'},state=async()=>readSupportDesks((await f.context()).activity,'NCT').find(s=>s.customerId==='CUSTOMER-A');
 const assign=createSupportDeskOperations({store:f.store,names,readContext:f.context,now});
 await assign({company:'NCT',staff,requestId:f.nextId(),input:{action:'DESK_SPLIT',customerId:'CUSTOMER-A',taskId:'A',desk:0,revision:'',parts:[{desk:1,quantity:60},{desk:2,quantity:40}]}});
 const invoice=createSupportInvoiceOperations({store:f.store,names,readContext:f.context,saveFulfilment:f.fulfilSave,readRates:async()=>[{currency:'USD',rateToMyr:4}],now});
 for(const [desk,quantity] of [[1,60],[2,40]]){
  const sent=await f.packing({action:'DESK_SEND',customerId:'CUSTOMER-A',desk,deskRevision:(await state()).revision,lines:[{taskId:'A',quantity}]});
  await f.packing({action:'DESK_LOAD',id:sent.id,revision:sent.list.revision,taskId:'A',loaded:quantity,reasonCodes:[]},'WAREHOUSE');
  await invoice({company:'NCT',staff,requestId:f.nextId(),input:{version:supportInvoiceState(await f.context()).version,desk:{number:desk,revision:(await state()).revision},customerId:'CUSTOMER-A',orderId:'ORDER-A',number:'TEST-SI-D'+desk,lines:[{taskId:'A',quantity}]}});
 }
 f.tasks[0].archived=true;
 const calls=[];let lose=false;
 const save=createSupportDocumentOperations({store:f.store,names,readContext:f.context,now,documentService:async input=>{calls.push(input);if(input.action==='ALLOCATE')return {fileId:'test-split-file-'+calls.length};if(lose){lose=false;throw Error('lost upload reply');}return {...input,ok:true,customerLinkReady:true,size:Buffer.from(input.base64,'base64').length};}});
 const request=async(desk=1)=>({company:'NCT',staff,requestId:f.nextId(),input:{code:'SI',scope:'DESK',customerId:'CUSTOMER-A',orderId:'ORDER-A',desk,version:supportDocumentVersion(await f.context()),reference:'',amountCents:0,base64:Buffer.from('%PDF-1.4\n test split SI '+desk).toString('base64')}});
 return {...f,state,save,request,calls,lose:()=>lose=true};
}
test('both issued split Desks accept their own SI PDF after archive without changing stock, invoices or task data',async()=>{
 const f=await setup(),before=await f.context(),stock=await f.stock();
 for(const desk of [1,2]){const r=await f.request(desk),a=await f.save(r),b=await f.save(r);assert.equal(a.documentId,b.documentId);}
 const after=await f.context(),docs=readSupportDocuments(after.activity,'NCT');
 assert.deepEqual(docs.map(d=>[d.desk,d.reference,d.amountCents]),[[1,'TEST-SI-D1',144000],[2,'TEST-SI-D2',96000]]);
 assert.deepEqual(after.tasks,before.tasks);assert.deepEqual(await f.stock(),stock);assert.equal(after.tasks[0].archived,true);
 assert.deepEqual(JSON.stringify(readPhysicalOutflows(after.activity)),JSON.stringify(readPhysicalOutflows(before.activity)));
 assert.deepEqual(after.activity.filter(r=>r.action==='CUSTOMER_SHIPMENT_CHANGED'),before.activity.filter(r=>r.action==='CUSTOMER_SHIPMENT_CHANGED'));
 assert.equal(f.calls.filter(c=>c.action==='ALLOCATE').length,2);assert.equal(f.calls.filter(c=>c.action==='UPLOAD').length,2);
});
test('missing Desk, wrong customer/order/company and wrong role fail before allocating any file',async()=>{
 const f=await setup();
 for(const delta of [{desk:3},{customerId:'CUSTOMER-B'},{orderId:'ORDER-B'}]){const r=await f.request();await assert.rejects(f.save({...r,input:{...r.input,...delta}}));}
 const r=await f.request();await assert.rejects(f.save({...r,company:'GHR'}));await assert.rejects(f.save({...r,staff:{...r.staff,packingDepartment:'WAREHOUSE'}}));assert.equal(f.calls.length,0);
});
test('lost split SI reply retries the same request and allocated file, preserving issued invoices',async()=>{
 const f=await setup(),r=await f.request();f.lose();await assert.rejects(f.save(r),/lost upload/);await f.save(r);await f.save(r);
 assert.equal(f.calls.filter(c=>c.action==='ALLOCATE').length,1);assert.equal(new Set(f.calls.filter(c=>c.action==='UPLOAD').map(c=>c.fileId)).size,1);assert.equal(readSupportDocuments((await f.context()).activity,'NCT').length,1);
});
