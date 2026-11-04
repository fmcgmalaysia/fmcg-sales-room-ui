const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {projectPurchaseOrders,createPurchaseOrderOperations}=load('purchaseOrderWorkflow.js');
const {createAccountSettlementOperations}=load('accountSettlement.js');
const clone=value=>JSON.parse(JSON.stringify(value));

test('Self Collect is scoped to the exact PO group and changes its review version while legacy hashes stay exact',()=>{
 const f=fixture(),{operationId}=load('purchaseOperationJournal.js');
 const before=projectPurchaseOrders({company:'NCT',workspace:f.workspace,records:[]})[0];
 assert.equal(before.selfCollect,false);
 assert.equal(before.version,operationId(null,['T1','T2'],['V1','V2'],[undefined,undefined],[],[]));
 f.workspace.tasks[1].procurement.transportMode='SELF_COLLECT';
 const mixed=projectPurchaseOrders({company:'NCT',workspace:f.workspace,records:[]})[0];assert.equal(mixed.selfCollect,true);assert.notEqual(mixed.version,before.version);assert.equal(mixed.contentVersion,before.contentVersion);assert.equal(mixed.amount,before.amount);
 f.workspace.tasks[1].po='NCT-PO-OTHER';
 const separated=projectPurchaseOrders({company:'NCT',workspace:f.workspace,records:[]});assert.equal(separated.find(row=>row.number==='NCT-PO-001').selfCollect,false);assert.equal(separated.find(row=>row.number==='NCT-PO-OTHER').selfCollect,true);
 f.workspace.tasks[1].procurement.transportMode='SUPPLIER_DELIVER';assert.ok(projectPurchaseOrders({company:'NCT',workspace:f.workspace,records:[]}).every(row=>!row.selfCollect));
});
test('one supplier PO includes multiple customers without combining their task identities',()=>{
 const f=fixture();f.workspace.customers.push({id:'B',name:'SECOND CUSTOMER',shortName:'SECOND'});f.workspace.tasks[1].customerId='B';
 const rows=projectPurchaseOrders({company:'NCT',workspace:f.workspace,records:[]});
 assert.equal(rows.length,1);assert.equal(rows[0].customerName,'CUST / SECOND');assert.equal(rows[0].taskIds.length,2);assert.equal(rows[0].amount,1105);assert.equal(rows[0].itemCount,1);
});
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
async function deletionFixture(service){
 const f=fixture(service),row=(await f.operations.list('NCT',f.staff))[0],document={fileId:'owned_document_123',name:'2026-10-11 SUP PI 001.pdf',type:'PI',number:'PI001',date:'2026-10-11',sha256:'a'.repeat(64),linked:true,uploadedAt:'2026-10-11T01:00:00Z',uploadedBy:'LAW',uploadedByStaffId:'STF'};
 f.records.set('PurchaseOrders/'+row.id,{_id:row.id,title:row.id,company:'NCT',details:{taskIds:row.taskIds,documents:[document],audit:[]}});
 const current=(await f.operations.list('NCT',f.staff))[0];return {...f,row:current,document,input:{id:current.id,version:current.version,action:'DELETE_DOCUMENT',fileId:document.fileId,reason:'Replace incorrect PDF'}};
}

test('only the original uploader may delete: matching names or client-supplied owner fields confer no permission',async()=>{
 let calls=0;const f=await deletionFixture(async input=>{calls++;return {...input,ok:true,trashed:true};});
 assert.equal(f.row.documents[0].deleteAllowed,true);
 const other={...f.staff,staffId:'OTHER',memberId:'OTHER-MEMBER'};
 assert.equal((await f.operations.list('NCT',other))[0].documents[0].deleteAllowed,false);
 await assert.rejects(f.operations.save({...f.base,staff:other,input:{...f.input,uploadedByStaffId:'OTHER'}}),/original uploader/);assert.equal(calls,0);
 const saved=f.records.get('PurchaseOrders/'+f.row.id);delete saved.details.documents[0].uploadedByStaffId;
 const row=(await f.operations.list('NCT',f.staff))[0];await assert.rejects(f.operations.save({...f.base,input:{...f.input,version:row.version}}),/original uploader/);assert.equal(calls,0);
});

test('deletion refuses Finance references, payment records and submitted handoffs before touching Drive',async()=>{
 for(const protection of [{finance:{payments:[{id:'BANK'}]}},{finance:{amounts:[{fileId:'owned_document_123',cents:100}]}},{paymentHandoff:{review:{version:'old'}}},{procurementHandoff:{schema:1,stage:'SUBMITTED',submission:{version:'old',byStaffId:'STF',at:'2026-10-11T01:00:00Z'}}}]){
  let calls=0;const f=await deletionFixture(async input=>{calls++;return {...input,ok:true,trashed:true};});Object.assign(f.records.get('PurchaseOrders/'+f.row.id).details,protection);
  const row=(await f.operations.list('NCT',f.staff))[0];assert.equal(row.documents[0].deleteAllowed,false);
  await assert.rejects(f.operations.save({...f.base,input:{...f.input,version:row.version}}),/locked by payment or Finance/);assert.equal(calls,0);
 }
});

test('lost Drive trash receipt leaves a recoverable pending deletion; same request completes once with uploader and deletion audit retained',async()=>{
 let calls=0,lost=true,trashed=false;const f=await deletionFixture(async input=>{calls++;assert.equal(input.action,'TRASH');trashed=true;if(lost){lost=false;throw Error('lost Drive receipt');}return {...input,ok:true,trashed};});
 await assert.rejects(f.operations.save({...f.base,input:f.input}),/lost Drive receipt/);assert.equal(trashed,true);
 let row=(await f.operations.list('NCT',f.staff))[0];assert.equal(row.documents.length,0);
 await assert.rejects(f.operations.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input:{id:row.id,version:row.version,action:'TERM',termDays:30,reason:'Change terms'}}),/deletion is pending/);
 await f.operations.save({...f.base,input:f.input});await f.operations.save({...f.base,input:f.input});assert.equal(calls,2);
 const record=f.records.get('PurchaseOrders/'+row.id),document=record.details.documents[0];assert.equal(document.linked,false);assert.equal(document.deletion.state,'DELETED');assert.equal(document.uploadedByStaffId,'STF');assert.equal(document.uploadedAt,f.document.uploadedAt);assert.equal(record.details.documentDeletion,null);
 row=(await f.operations.list('NCT',f.staff))[0];const logs=row.history.filter(event=>event.action==='SUPPLIER_DOCUMENT_DELETED');assert.equal(logs.length,1);assert.equal(logs[0].actor,'LAW');assert.equal(logs[0].actorStaffId,'STF');assert.equal(logs[0].changes.name,f.document.name);assert.equal(row.amount,1105);
});

test('lost CMS acknowledgement after unlink preparation retries without losing the exact file identity',async()=>{
 let calls=0;const f=await deletionFixture(async input=>{calls++;return {...input,ok:true,trashed:true};}),update=f.store.update;let lost=true;
 f.store.update=async(c,row)=>{const result=await update(c,row);if(lost&&row.details.documentDeletion){lost=false;throw Error('CMS acknowledgement lost');}return result;};
 await assert.rejects(f.operations.save({...f.base,input:f.input}),/CMS acknowledgement lost/);assert.equal(calls,0);
 await f.operations.save({...f.base,input:f.input});assert.equal(calls,1);assert.equal((await f.operations.list('NCT',f.staff))[0].history.filter(e=>e.action==='SUPPLIER_DOCUMENT_DELETED').length,1);
});

test('a mismatched trash receipt never records successful deletion',async()=>{
 const f=await deletionFixture(async input=>({...input,ok:true,trashed:true,poId:'ANOTHER-PO'}));
 await assert.rejects(f.operations.save({...f.base,input:f.input}),/deletion could not be confirmed/);
 const record=f.records.get('PurchaseOrders/'+f.row.id);assert.equal(record.details.documents[0].deletion.state,'PENDING');assert.equal(record.details.audit.length,0);
});
test('PO amount uses supplier cartons, MYR and distinct product count; no invented payment, invoice or archive',()=>{
 const f=fixture(),row=projectPurchaseOrders({company:'NCT',workspace:f.workspace,records:[]})[0];
 assert.equal(row.amount,1105);assert.equal(row.itemCount,1);assert.equal(row.customerName,'CUST');assert.equal(row.currency,'MYR');
 assert.equal(row.createdBy,'LAW');assert.equal(row.canArchive,false);assert.equal(row.documentStatus,'MISSING');assert.equal(row.dueDate,null);assert.equal(row.state,'ACTIVE');
 f.workspace.tasks[0].lpCtn=null;assert.equal(projectPurchaseOrders({company:'NCT',workspace:f.workspace,records:[]})[0].amount,null);
});
test('term persists once, retains staff/time/reason and stable identity across a full PO rename',async()=>{
 const f=fixture(),row=(await f.operations.list('NCT',f.staff))[0],input={id:row.id,version:row.version,action:'TERM',termDays:30,reason:'Supplier agreed term'};
 await f.operations.save({...f.base,input});await f.operations.save({...f.base,input});
 for(const task of f.workspace.tasks)task.po='NCT-PO-002';
 const saved=(await f.operations.list('NCT',f.staff))[0];assert.equal(saved.id,row.id);assert.equal(saved.termDays,30);assert.equal(saved.number,'NCT-PO-002');
 const audit=saved.history.filter(e=>e.action==='PAYMENT_TERM_CHANGED');assert.equal(audit.length,1);assert.equal(audit[0].actor,'LAW');assert.equal(audit[0].time,'2026-10-11T02:00:00.000Z');
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
 const f=fixture(),row=(await f.operations.list('NCT',f.staff))[0];await f.operations.save({...f.base,input:{id:row.id,version:row.version,action:'TERM',termDays:30,reason:'Agreed term'}});
 f.workspace.tasks[1].po='NCT-PO-002';await assert.rejects(f.operations.list('NCT',f.staff),/split/);
});
test('a lost upload receipt retries one file; no PDF bytes are written to CMS and no premature green status',async()=>{
 let allocated=0,uploads=0,lost=true;const ids=[];
 const f=fixture(async input=>{if(input.action==='ALLOCATE'){allocated++;return {fileId:'document_file_123'};}uploads++;ids.push(input.fileId);if(lost){lost=false;throw Error('response lost');}return {...input,ok:true};});
 const row=(await f.operations.list('NCT',f.staff))[0],base64=Buffer.from('%PDF-1.4\nfixture').toString('base64');
 const input={id:row.id,version:row.version,action:'DOCUMENT',type:'INV',date:'2026-10-11',number:'INV001',reason:'Final supplier invoice',declaredCents:110500,base64};
 await assert.rejects(f.operations.save({...f.base,input}),/response lost/);
 assert.equal((await f.operations.list('NCT',f.staff))[0].documentStatus,'MISSING');
 assert.equal(JSON.stringify([...f.records.values()]).includes(base64),false);
 await f.operations.save({...f.base,input});await f.operations.save({...f.base,input});
 assert.equal(allocated,1);assert.equal(uploads,2);assert.equal(new Set(ids).size,1);
 const saved=(await f.operations.list('NCT',f.staff))[0];assert.equal(saved.documents.length,1);assert.equal(saved.documents[0].uploadedBy,'LAW');assert.equal(saved.documentStatus,'PROVISIONAL');assert.equal(saved.invoiceChecked,false);assert.equal(saved.invoiceDate,'2026-10-11');assert.equal(saved.canArchive,false);
 assert.equal(saved.history.filter(event=>event.action==='SUPPLIER_DOCUMENT_UPLOADED').length,1);
});
test('corrupt PDF is rejected before storage or Drive access',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;}),row=(await f.operations.list('NCT',f.staff))[0];
 await assert.rejects(f.operations.save({...f.base,input:{id:row.id,version:row.version,action:'DOCUMENT',base64:Buffer.from('not a PDF').toString('base64')}}),/valid PDF/);
 assert.equal(calls,0);assert.equal(f.records.size,0);
});

test('submission lost receipt retries once; Finance ownership defeats a stale Purchase withdrawal',async()=>{
 const f=fixture(),row=(await f.operations.list('NCT',f.staff))[0];
 const input={id:row.id,version:row.version,action:'SUBMIT_FINANCE',urgent:true,reason:'All PO sources confirmed'};
 f.fail();await assert.rejects(f.operations.save({...f.base,input}),/response lost/);await f.operations.save({...f.base,input});
 let saved=(await f.operations.list('NCT',f.staff))[0];
 assert.equal(saved.procurementHandoff.stage,'SUBMITTED');assert.equal(saved.chasePayment,true);assert.equal(saved.history.filter(e=>e.action==='PROCUREMENT_SUBMIT_FINANCE').length,1);
 const staleWithdraw={id:row.id,version:saved.version,action:'WITHDRAW_FINANCE',reason:'Revised supplier offer'};
 const account=createAccountSettlementOperations({store:f.store,names:{NCT:{activity:'NCTActivity'}},listOrders:f.operations.list});
 await account.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input:{id:row.id,version:saved.version,action:'TAKE_OWNERSHIP',reason:'Finance received PO'}});
 await assert.rejects(f.operations.save({...f.base,requestId:'33333333-3333-4333-8333-333333333333',input:staleWithdraw}),/changed/);
 saved=(await f.operations.list('NCT',f.staff))[0];assert.equal(saved.procurementHandoff.stage,'OWNED');
 await assert.rejects(f.operations.save({...f.base,requestId:'44444444-4444-4444-8444-444444444444',input:{...staleWithdraw,version:saved.version}}),/before Finance/);
 await assert.rejects(f.operations.save({...f.base,requestId:'55555555-5555-4555-8555-555555555555',input:{id:row.id,version:saved.version,action:'TERM',termDays:90,reason:'Change terms'}}),/locked payment terms/);
});

test('a saved FOC quantity changing between preparation and application prevents stale PO submission',async()=>{
 const f=fixture(),insert=f.store.insert;let changed=false;
 f.store.insert=async(collection,record)=>{const result=await insert(collection,record);if(!changed&&record.action==='PURCHASE_OPERATION_PREPARED'){changed=true;f.workspace.tasks[0].procurement.totalCtn=110;}return result;};
 const row=(await f.operations.list('NCT',f.staff))[0];
 await assert.rejects(f.operations.save({...f.base,input:{id:row.id,version:row.version,action:'SUBMIT_FINANCE',reason:'Confirm PO'}}),/changed while saving/);
 assert.equal([...f.records.keys()].some(key=>key.startsWith('PurchaseOrders/')),false);
});

test('Finance cannot take ownership of FOC content changed after its save was prepared',async()=>{
 const f=fixture();let row=(await f.operations.list('NCT',f.staff))[0];
 await f.operations.save({...f.base,input:{id:row.id,version:row.version,action:'SUBMIT_FINANCE',reason:'Confirm PO'}});
 row=(await f.operations.list('NCT',f.staff))[0];
 const insert=f.store.insert;let changed=false;
 f.store.insert=async(collection,record)=>{const result=await insert(collection,record);if(!changed&&record.action==='PURCHASE_OPERATION_PREPARED'){changed=true;f.workspace.tasks[0].procurement.totalCtn=110;}return result;};
 const account=createAccountSettlementOperations({store:f.store,names:{NCT:{activity:'NCTActivity'}},listOrders:f.operations.list});
 await assert.rejects(account.save({...f.base,requestId:'66666666-6666-4666-8666-666666666666',input:{id:row.id,version:row.version,action:'TAKE_OWNERSHIP',reason:'Check all sources'}}),/changed while saving/);
 assert.equal((await f.operations.list('NCT',f.staff))[0].procurementHandoff.stage,'SUBMITTED');
});

test('CN payment request is idempotently persisted, replaced before Reviewing and rejected after Account ownership',async()=>{
 const f=fixture(),first=(await f.operations.list('NCT',f.staff))[0];
 f.records.set('PurchaseOrders/'+first.id,{_id:first.id,company:'NCT',details:{taskIds:first.taskIds,documents:[{fileId:'PO',type:'PO',linked:true,sha256:'po',uploadedAt:'2026-10-11T01:30:00Z'},{fileId:'INV',type:'INV',number:'I',date:'2026-10-11',linked:true,sha256:'inv',declaredCents:48000},{fileId:'CN',type:'CN',number:'C',date:'2026-10-11',linked:true,sha256:'cn',declaredCents:5000}],audit:[]}});
 let row=(await f.operations.list('NCT',f.staff))[0];const input={id:row.id,version:row.version,action:'REQUEST_PAYMENT',requestedCents:43000,purpose:'FULL',termDays:30,basisFileId:'INV',creditNotes:[{fileId:'CN',basisFileId:'INV',treatment:'DEDUCT'}],reason:'Pay supplier'};
 await f.operations.save({...f.base,input});await f.operations.save({...f.base,input});row=(await f.operations.list('NCT',f.staff))[0];assert.equal(row.procurementHandoff.stale,false);assert.equal(row.procurementHandoff.submission.paymentRequest.cnCents,5000);assert.equal(row.history.filter(e=>e.action==='PROCUREMENT_REQUEST_PAYMENT').length,1);
 const account=createAccountSettlementOperations({store:f.store,names:{NCT:{activity:'NCTActivity'}},listOrders:(company,staff)=>f.operations.list(company,staff),now:()=>new Date('2026-10-11T03:00:00Z')});
 await account.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input:{id:row.id,version:row.version,action:'TAKE_OWNERSHIP',reason:'Reviewing'}});
 row=(await f.operations.list('NCT',f.staff))[0];await assert.rejects(f.operations.save({...f.base,requestId:'33333333-3333-4333-8333-333333333333',input:{...input,version:row.version}}),/locked/);
 await assert.rejects(account.save({...f.base,requestId:'44444444-4444-4444-8444-444444444444',input:{id:row.id,version:row.version,action:'PAYMENT_REVIEW',stage:'REVIEWING',requestedCents:43000,paperReceived:true,reason:'Checked'}}),/reconciliation/);
});

test('retired CHASE rejects new actions without writes but returns an existing exact receipt',async()=>{
 const f=fixture(),row=(await f.operations.list('NCT',f.staff))[0],input={id:row.id,version:row.version,action:'CHASE',enabled:true,reason:'Earlier reminder'};
 await assert.rejects(f.operations.save({...f.base,input}),/use Messages/);assert.equal(f.records.size,0);
 const {operationId}=load('purchaseOperationJournal.js'),key=operationId('NCT/PURCHASE',f.base.requestId,f.staff.memberId),id=operationId(key,'RESULT'),outcome={ok:true,legacy:true};
 f.records.set('NCTActivity/'+id,{_id:id,details:{digest:operationId({purchaseOrder:input}),outcome}});
 assert.deepEqual(await f.operations.save({...f.base,input}),outcome);assert.equal(f.records.size,1);
 await assert.rejects(f.operations.save({...f.base,input:{...input,reason:'Changed reminder'}}),/different changes/);
});

test('CN requirement ignores old discount and wrong-case files and follows the current decision',()=>{
 const {receiptCnRequirements}=load('purchaseOrderWorkflow.js');
 const c={id:'CASE',kind:'RECEIPT',taskId:'T1',signature:'SIG',quantity:5,decision:{supplierDeliveryDecision:'STOP',supplierDecision:'CN_PROMISED',revision:'D'}};
 const doc={type:'CN',fileId:'F',linked:true,cnReason:'SHORT_DELIVERY',receiptCaseId:'CASE',receiptCaseSignature:'SIG',receiptDecisionRevision:'D'};
 for(const d of [{...doc,cnReason:'DISCOUNT_REBATE'},{...doc,receiptCaseId:'OTHER'},{...doc,receiptDecisionRevision:'OLD'},{...doc,receiptCaseSignature:'OLD'},{...doc,superseded:true},{...doc,linked:false}])assert.equal(receiptCnRequirements([c],[d])[0].pending,true);
 assert.equal(receiptCnRequirements([c],[doc])[0].pending,false);
 assert.equal(receiptCnRequirements([{...c,decision:{...c.decision,revision:'NEW'}}],[doc])[0].pending,true);
});
test('CN reason and current case are persisted only after confirmed upload; same request does not duplicate',async()=>{
 let calls=0;const f=fixture(async input=>{calls++;return input.action==='ALLOCATE'?{fileId:'NEWCN'}:{...input,ok:true};});
 const c={id:'CASE',kind:'RECEIPT',taskId:'T1',signature:'SIG',quantity:5,decision:{supplierDeliveryDecision:'STOP',supplierDecision:'CN_PROMISED',revision:'D'}};
 f.workspace.tasks[0].quantityCases=[c];const row=(await f.operations.list('NCT',f.staff))[0];
 const input={id:row.id,version:row.version,action:'DOCUMENT',type:'CN',number:'CN1',date:'',reason:'Short delivery CN',declaredCents:5000,cnReason:'SHORT_DELIVERY',receiptCaseId:'CASE',receiptCaseSignature:'SIG',receiptDecisionRevision:'D',base64:Buffer.from('%PDF-1.4 sample').toString('base64')};
 await f.operations.save({...f.base,input});await f.operations.save({...f.base,input});const saved=(await f.operations.list('NCT',f.staff))[0];assert.equal(calls,2);assert.equal(saved.documents.length,1);assert.equal(saved.documents[0].date,'2026-10-11');assert.equal(saved.documents[0].cnReason,'SHORT_DELIVERY');assert.equal(saved.cnRequirements[0].pending,false);assert.equal(saved.invoiceChecked,false);
 await assert.rejects(f.operations.save({...f.base,input:{...input,cnReason:'GOODS_DAMAGED'}}),/different|conflict|changed|request/i);
});
test('invalid or stale CN case is refused before allocating a file',async()=>{
 for(const extra of [{cnReason:''},{cnReason:'DISCOUNT_REBATE',receiptCaseId:'CASE',receiptCaseSignature:'SIG',receiptDecisionRevision:'D'},{cnReason:'SHORT_DELIVERY',receiptCaseId:'CASE',receiptCaseSignature:'SIG',receiptDecisionRevision:'OLD'}]){
  let calls=0;const f=fixture(async()=>{calls++;throw Error('Unexpected upload');});f.workspace.tasks[0].quantityCases=[{id:'CASE',kind:'RECEIPT',taskId:'T1',signature:'SIG',decision:{supplierDeliveryDecision:'STOP',supplierDecision:'CN_PROMISED',revision:'D'}}];
  const row=(await f.operations.list('NCT',f.staff))[0];await assert.rejects(f.operations.save({...f.base,input:{id:row.id,version:row.version,action:'DOCUMENT',type:'CN',date:'',number:'CN1',reason:'CN',declaredCents:5000,base64:Buffer.from('%PDF-test').toString('base64'),...extra}}),/CN reason|shortfall decision/);assert.equal(calls,0);
 }
});

for(const type of ['PO','PI','SO','DO','INV','CN'])test(type+' upload uses server date without client input and retries without duplicating the file',async()=>{
 let calls=0;const f=fixture(async input=>{calls++;return input.action==='ALLOCATE'?{fileId:'AUTO-'+type}:{...input,ok:true};});const row=(await f.operations.list('NCT',f.staff))[0];
 const input={id:row.id,version:row.version,action:'DOCUMENT',type,number:type+'-AUTO',reason:'Upload document',declaredCents:1000,...(type==='CN'?{cnReason:'DISCOUNT_REBATE'}:{}),base64:Buffer.from('%PDF-1.4 date fixture').toString('base64')};
 await f.operations.save({...f.base,input});await f.operations.save({...f.base,input});const current=(await f.operations.list('NCT',f.staff))[0],doc=current.documents[0],audit=current.history.find(e=>e.action==='SUPPLIER_DOCUMENT_UPLOADED');
 assert.equal(calls,2);assert.equal(current.documents.length,1);assert.equal(doc.date,'2026-10-11');assert.equal(doc.uploadedAt,'2026-10-11T02:00:00.000Z');assert.equal(audit.changes.date,doc.date);assert.match(doc.name,/^2026-10-11 SUP /);assert.equal(current.invoiceChecked,false);assert.equal(current.canArchive,false);
});
