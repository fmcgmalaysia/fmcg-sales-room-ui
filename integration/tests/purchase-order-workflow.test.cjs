const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {projectPurchaseOrders,createPurchaseOrderOperations}=load('purchaseOrderWorkflow.js');
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(documentService){
 const workspace={company:'NCT',customers:[{id:'C',name:'CUSTOMER',shortName:'CUST'}],suppliers:[{id:'S',shortName:'SUP',name:'SUPPLIER FULL'}],tasks:[
  {id:'T1',editVersion:'V1',customerId:'C',supplierId:'S',po:'NCT-PO-001',barcode:'001',packing:'16',ord:90,procurement:{totalCtn:100},lpCtn:10.05,disc1:0,disc2:0,disc3:0,history:[{id:'A',action:'PURCHASE_PO_ASSIGNED',result:'SAVED',time:'2026-10-11T01:00:00Z',actor:'LAW'}]},
  {id:'T2',editVersion:'V2',customerId:'C',supplierId:'S',po:'NCT-PO-001',barcode:'001',packing:'16',ord:10,procurement:{totalCtn:10},lpCtn:10,disc1:0,disc2:0,disc3:0,history:[]}]};
 const records=new Map();let fail=false;
 const store={all:async c=>[...records].filter(([k])=>k.startsWith(c+'/')).map(([,v])=>clone(v)),read:async(c,id)=>clone(records.get(c+'/'+id)||null),insert:async(c,row)=>{if(records.has(c+'/'+row._id))throw Error('duplicate');records.set(c+'/'+row._id,clone(row));if(c==='PurchaseOrders'&&fail){fail=false;throw Error('response lost');}return clone(row);},update:async(c,row)=>{records.set(c+'/'+row._id,clone(row));return clone(row);},remove:async(c,id)=>records.delete(c+'/'+id)};
 const operations=createPurchaseOrderOperations({store,documentService,names:{NCT:{activity:'NCTActivity'},GHR:{activity:'GHRActivity'}},readWorkspace:async()=>clone(workspace),now:()=>new Date('2026-10-11T02:00:00Z')});
 const staff={memberId:'M',staffId:'STF',staffName:'LAW'},base={company:'NCT',staff,requestId:'11111111-1111-4111-8111-111111111111'};
 return {workspace,records,store,operations,staff,base,fail:()=>fail=true};
}
test('PO amount uses supplier cartons, MYR and distinct product count; no invented payment, invoice or archive',()=>{
 const f=fixture(),row=projectPurchaseOrders({company:'NCT',workspace:f.workspace,records:[]})[0];
 assert.equal(row.amount,1105);assert.equal(row.itemCount,1);assert.equal(row.customerName,'CUST');assert.equal(row.currency,'MYR');
 assert.equal(row.createdBy,'LAW');assert.equal(row.canArchive,false);assert.equal(row.documentStatus,'MISSING');assert.equal(row.dueDate,null);assert.equal(row.state,'ACTIVE');
 f.workspace.tasks[0].lpCtn=null;assert.equal(projectPurchaseOrders({company:'NCT',workspace:f.workspace,records:[]})[0].amount,null);
});
test('chase persists once, retains staff/time/reason and stable identity across a full PO rename',async()=>{
 const f=fixture(),row=(await f.operations.list('NCT',f.staff))[0],input={id:row.id,version:row.version,action:'CHASE',enabled:true,reason:'Supplier waiting for payment'};
 await f.operations.save({...f.base,input});await f.operations.save({...f.base,input});
 for(const task of f.workspace.tasks)task.po='NCT-PO-002';
 const saved=(await f.operations.list('NCT',f.staff))[0];assert.equal(saved.id,row.id);assert.equal(saved.chasePayment,true);assert.equal(saved.number,'NCT-PO-002');
 const audit=saved.history.filter(e=>e.action==='PAYMENT_CHASE_CHANGED');assert.equal(audit.length,1);assert.equal(audit[0].actor,'LAW');assert.equal(audit[0].time,'2026-10-11T02:00:00.000Z');
 assert.equal(f.workspace.tasks[0].ord,90);assert.equal(f.workspace.tasks[0].procurement.totalCtn,100);
});
test('lost acknowledgement resumes identical save without duplicate audit; stale and foreign company inputs fail',async()=>{
 const f=fixture(),row=(await f.operations.list('NCT',f.staff))[0],input={id:row.id,version:row.version,action:'TERM',termDays:30,reason:'Supplier agreed 30 days from invoice'};
 f.fail();await assert.rejects(f.operations.save({...f.base,input}),/response lost/);await f.operations.save({...f.base,input});
 const saved=(await f.operations.list('NCT',f.staff))[0];assert.equal(saved.termDays,30);assert.equal(saved.dueDate,null);assert.equal(saved.history.filter(e=>e.action==='PAYMENT_TERM_CHANGED').length,1);
 await assert.rejects(f.operations.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input:{...input,termDays:60}}),/changed/);
 await assert.rejects(f.operations.list('GHR',f.staff),/Select/);
});
test('saved PO cannot silently split its document/payment identity across new numbers',async()=>{
 const f=fixture(),row=(await f.operations.list('NCT',f.staff))[0];await f.operations.save({...f.base,input:{id:row.id,version:row.version,action:'CHASE',enabled:true,reason:'Urgent'}});
 f.workspace.tasks[1].po='NCT-PO-002';await assert.rejects(f.operations.list('NCT',f.staff),/split/);
});
test('a lost upload receipt retries one file; no PDF bytes are written to CMS and no premature green status',async()=>{
 let allocated=0,uploads=0,lost=true;const ids=[];
 const f=fixture(async input=>{if(input.action==='ALLOCATE'){allocated++;return {fileId:'document_file_123'};}uploads++;ids.push(input.fileId);if(lost){lost=false;throw Error('response lost');}return {...input,ok:true};});
 const row=(await f.operations.list('NCT',f.staff))[0],base64=Buffer.from('%PDF-1.4\nfixture').toString('base64');
 const input={id:row.id,version:row.version,action:'DOCUMENT',type:'INV',date:'2026-10-11',number:'INV001',reason:'Final supplier invoice',base64};
 await assert.rejects(f.operations.save({...f.base,input}),/response lost/);
 assert.equal((await f.operations.list('NCT',f.staff))[0].documentStatus,'MISSING');
 assert.equal(JSON.stringify([...f.records.values()]).includes(base64),false);
 await f.operations.save({...f.base,input});await f.operations.save({...f.base,input});
 assert.equal(allocated,1);assert.equal(uploads,2);assert.equal(new Set(ids).size,1);
 const saved=(await f.operations.list('NCT',f.staff))[0];assert.equal(saved.documents.length,1);assert.equal(saved.documents[0].uploadedBy,'LAW');assert.equal(saved.documentStatus,'COMPLETE');assert.equal(saved.invoiceDate,'2026-10-11');assert.equal(saved.canArchive,false);
 assert.equal(saved.history.filter(event=>event.action==='SUPPLIER_DOCUMENT_UPLOADED').length,1);
});
test('corrupt PDF is rejected before storage or Drive access',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;}),row=(await f.operations.list('NCT',f.staff))[0];
 await assert.rejects(f.operations.save({...f.base,input:{id:row.id,version:row.version,action:'DOCUMENT',base64:Buffer.from('not a PDF').toString('base64')}}),/valid PDF/);
 assert.equal(calls,0);assert.equal(f.records.size,0);
});
