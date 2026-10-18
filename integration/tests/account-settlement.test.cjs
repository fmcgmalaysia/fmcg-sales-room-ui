const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {projectAccountSettlement,createAccountSettlementOperations}=load('accountSettlement.js');
const {projectPurchaseOrders}=load('purchaseOrderWorkflow.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 const docs=[{fileId:'INV1',type:'INV',linked:true,sha256:'abc',number:'I1',date:'2026-10-11'},{fileId:'DO1',type:'DO',linked:true,sha256:'def'}];
 const row={id:'PO',company:'NCT',version:'v1',contentVersion:'cost1',taskIds:['T'],documents:docs,warehouse:{complete:true,issues:false,receivedCtn:100},salesInvoiceComplete:false};
 const details={finance:{amounts:[{fileId:'INV1',sha256:'abc',cents:100000}],payments:[],cnNotApplicable:{enabled:true,byStaffId:'F',at:'2026-10-11T00:00:00Z'}}};
 return {row,details};
}
const payment=(id,cents,confirmed=true)=>({id,cents,confirmed,by:'FINANCE',byStaffId:'F',at:'2026-10-11T00:00:00Z',proof:{fileId:'proof-'+id,sha256:'hash',linked:true}});

test('a procurement price change after Finance Checked restores risk until Finance reviews the new version',()=>{
 const {row,details}=fixture();details.finance.payments=[payment('P',100000)];let state=projectAccountSettlement(row,details);
 details.finance.check={enabled:true,reviewVersion:state.finance.reviewVersion,byStaffId:'F',at:'2026-10-13T01:00:00Z'};
 assert.equal(projectAccountSettlement(row,details).invoiceChecked,true);
 row.contentVersion='new-price';state=projectAccountSettlement(row,details);assert.equal(state.invoiceChecked,false);assert.equal(state.reviewRequired,true);assert.equal(state.financialRisk,true);assert.equal(state.creditorActive,true);assert.match(state.checkBlocker,/重新核对/);
 details.finance.check={enabled:true,reviewVersion:state.finance.reviewVersion,byStaffId:'F',at:'2026-10-13T02:00:00Z'};state=projectAccountSettlement(row,details);assert.equal(state.financialRisk,false);assert.equal(state.invoiceChecked,true);assert.equal(state.canArchive,false,'customer invoice still required');
});
test('prepayment remains visible without final invoice; refund proof reduces cash exposure',()=>{
 const {row,details}=fixture();row.documents=[];details.finance.payments=[payment('P',100000)];
 let state=projectAccountSettlement(row,details);assert.equal(state.creditorActive,true);assert.equal(state.prepaymentPending,true);assert.equal(state.finance.paidCents,100000);assert.equal(state.canArchive,false);
 details.finance.payments.push({...payment('R',10000),direction:'REFUND'});state=projectAccountSettlement(row,details);assert.equal(state.finance.cashPaidCents,100000);assert.equal(state.finance.refundCents,10000);assert.equal(state.finance.paidCents,90000);
});
test('CN already reflected in reduced Final Invoice is not deducted twice',()=>{
 const {row,details}=fixture();details.finance.amounts[0].cents=90000;row.documents.push({fileId:'CN',type:'CN',sha256:'cn',linked:true});details.finance.amounts.push({fileId:'CN',sha256:'cn',cents:10000,treatment:'ALREADY_INCLUDED'});details.finance.payments=[payment('P',100000)];
 const state=projectAccountSettlement(row,details);assert.equal(state.finance.payableCents,90000);assert.equal(state.finance.balanceCents,-10000);
});
test('short received goods plus CN remain high risk until financial check; approved credit survives partial consumption',()=>{
 const {row,details}=fixture();row.warehouse={complete:false,issues:true,receivedCtn:90};const decision={customerDecision:'STOP',supplierDecision:'CREDIT',financeRequired:true};
 row.shortageIssues=[{taskId:'T',decision}];row.receiptLines=[{hasReceipt:true,accepted:90,planned:100,issue:true,decision}];row.documents.push({fileId:'CN1',sha256:'cn',type:'CN',linked:true});details.finance.amounts.push({fileId:'CN1',sha256:'cn',cents:10000});details.finance.payments=[payment('P',100000)];
 let state=projectAccountSettlement(row,details);assert.equal(state.canCheck,false);assert.equal(state.financialRisk,true);
 details.finance.creditRecognition={cents:10000,reviewVersion:state.finance.reviewVersion,byStaffId:'F',at:'2026-10-12T00:00:00Z'};
 state=projectAccountSettlement(row,details);assert.equal(state.finance.supplierCreditCents,10000);assert.equal(state.canCheck,true);assert.equal(state.financialRisk,true);
 details.finance.check={enabled:true,reviewVersion:state.finance.reviewVersion,byStaffId:'F',at:'2026-10-12T00:01:00Z'};
 state=projectAccountSettlement(row,details);assert.equal(state.financialRisk,false);assert.equal(state.paymentCompleted,true);assert.equal(state.state,'ACTIVE');
 row.creditTransfers=[{id:'USE',sourceId:'PO',targetId:'NEXT',cents:4000}];state=projectAccountSettlement(row,details);assert.equal(state.finance.supplierCreditCents,6000);assert.equal(state.invoiceChecked,true);assert.equal(state.finance.paidCents,100000);
});
test('invoice upload alone cannot approve, remove creditor, or archive; legacy flags ignored',()=>{
 const {row}=fixture(),state=projectAccountSettlement(row,{invoiceCheck:{enabled:true},paymentCompleted:true});
 assert.equal(state.invoiceChecked,false);assert.equal(state.creditorActive,true);assert.equal(state.canArchive,false);assert.match(state.checkBlocker,/amounts/);
});
test('partial payments sum only confirmed records; PO reference does not determine payable',()=>{
 const {row,details}=fixture();row.amount=500;details.finance.payments=[payment('1',40000),payment('2',60000,false)];
 let state=projectAccountSettlement(row,details);assert.equal(state.finance.payableCents,100000);assert.equal(state.finance.balanceCents,60000);assert.equal(state.status,'Pending Payment');
 details.finance.payments[1].confirmed=true;state=projectAccountSettlement(row,details);assert.equal(state.finance.balanceCents,0);assert.equal(state.status,'Paid W/T Inv');assert.equal(state.creditorActive,true);
});
test('Checked requires receipts and DO; overpayment, unresolved issues and missing CN decision block',()=>{
 const {row,details}=fixture();assert.equal(projectAccountSettlement(row,details).canCheck,true);
 for(const mutate of [r=>r.warehouse.complete=false,r=>r.warehouse.issues=true,r=>r.documents=r.documents.filter(d=>d.type!=='DO')]){const r=clone(row);mutate(r);assert.equal(projectAccountSettlement(r,details).canCheck,false);}
 const d=clone(details);d.finance.cnNotApplicable=null;assert.equal(projectAccountSettlement(row,d).canCheck,false);
 details.finance.payments=[payment('1',100001)];assert.match(projectAccountSettlement(row,details).checkBlocker,/overpayment/);
});
test('CN reduces payable, audit-bound check makes Files green; Sales Invoice and settled payment gate History',()=>{
 const {row,details}=fixture();row.documents.push({fileId:'CN1',type:'CN',sha256:'cn',linked:true});details.finance.amounts.push({fileId:'CN1',sha256:'cn',cents:10000});details.finance.cnNotApplicable=null;
 details.finance.payments=[payment('1',90000)];let state=projectAccountSettlement(row,details);
 details.finance.check={enabled:true,reviewVersion:state.finance.reviewVersion,byStaffId:'F',at:'2026-10-11T01:00:00Z'};
 state=projectAccountSettlement(row,details);assert.equal(state.documentStatus,'COMPLETE');assert.equal(state.creditorActive,false);assert.equal(state.state,'ACTIVE');
 row.salesInvoiceComplete=true;state=projectAccountSettlement(row,details);assert.equal(state.state,'HISTORY');
 row.contentVersion='changed-cost';assert.equal(projectAccountSettlement(row,details).invoiceChecked,false);
});
test('new or replaced invoice invalidates amount mapping and check; malformed payment never proves paid',()=>{
 const {row,details}=fixture();row.documents[0].sha256='replacement';assert.equal(projectAccountSettlement(row,details).finance.payableCents,null);
 details.finance.payments=[{...payment('1',100000),proof:null}];assert.equal(projectAccountSettlement(row,details).finance.paidCents,null);
});
test('shared PO requires a real locked customer invoice for final History, not a bare CMS number',()=>{
 const {details}=fixture();details.taskIds=['T'];details.documents=fixture().row.documents;
 const task={id:'T',editVersion:'v1',customerId:'C',supplierId:'S',po:'NCT-PO-001',barcode:'1',packing:'1',procurement:{totalCtn:100},lpCtn:10,disc1:0,disc2:0,disc3:0,warehouse:{accepted:100,issue:false},salesInvoiceNumber:'SI001',salesInvoiceLocked:false};
 const workspace={company:'NCT',tasks:[task],customers:[],suppliers:[]};let po=projectPurchaseOrders({company:'NCT',workspace,records:[]})[0];
 const record={_id:po.id,company:'NCT',details};details.finance.payments=[payment('1',100000)];po=projectPurchaseOrders({company:'NCT',workspace,records:[record]})[0];
 details.finance.check={enabled:true,reviewVersion:po.finance.reviewVersion,byStaffId:'F',at:'2026-10-11T01:00:00Z'};
 assert.equal(projectPurchaseOrders({company:'NCT',workspace,records:[record]})[0].state,'ACTIVE');task.salesInvoiceLocked=true;
 assert.equal(projectPurchaseOrders({company:'NCT',workspace,records:[record]})[0].state,'HISTORY');
});
test('financial action audits server employee, survives lost acknowledgement without duplicate and rejects stale/forged flags',async()=>{
 const {row,details}=fixture(),records=new Map([['PurchaseOrders/PO',{_id:'PO',company:'NCT',details}]]);let loseAck=true;
 const store={read:async(c,id)=>clone(records.get(c+'/'+id)||null),insert:async(c,r)=>{if(records.has(c+'/'+r._id))throw Error('duplicate');records.set(c+'/'+r._id,clone(r));return clone(r);},update:async(c,r)=>{records.set(c+'/'+r._id,clone(r));if(loseAck){loseAck=false;throw Error('lost acknowledgement');}return clone(r);},remove:async(c,id)=>records.delete(c+'/'+id)};
 const listOrders=async()=>{const d=records.get('PurchaseOrders/PO').details;return [{...row,version:JSON.stringify(d),...projectAccountSettlement(row,d)}];};
 const operations=createAccountSettlementOperations({store,listOrders,names:{NCT:{activity:'NCTActivity'}},now:()=>new Date('2026-10-11T03:00:00Z')}),staff={memberId:'M',staffId:'F',staffName:'LAW'};
 const req={company:'NCT',staff,requestId:'11111111-1111-4111-8111-111111111111',input:{id:'PO',version:(await listOrders())[0].version,action:'CHECK',enabled:true,reason:'Complete physical receipt and supplier documents reconciled',by:'CLIENT'}};
 await assert.rejects(operations.save(req),/lost acknowledgement/);assert.equal((await operations.save(req)).ok,true);assert.equal(records.get('PurchaseOrders/PO').details.audit.length,1);assert.equal(records.get('PurchaseOrders/PO').details.finance.check.by,'LAW');
 const stale={...req,requestId:'22222222-2222-4222-8222-222222222222',input:{...req.input,version:'stale'}};await assert.rejects(operations.save(stale),/changed/);
});
test('payment proof upload uses Account route and lost upload response retries the identical file and one monetary record',async()=>{
 const {row,details}=fixture(),records=new Map([['PurchaseOrders/PO',{_id:'PO',company:'NCT',details}]]),uploads=[];let allocated=0,loseUpload=true;
 const store={read:async(c,id)=>clone(records.get(c+'/'+id)||null),insert:async(c,r)=>{if(records.has(c+'/'+r._id))throw Error('duplicate');records.set(c+'/'+r._id,clone(r));return clone(r);},update:async(c,r)=>{records.set(c+'/'+r._id,clone(r));return clone(r);},remove:async(c,id)=>records.delete(c+'/'+id)};
 const listOrders=async()=>{const d=records.get('PurchaseOrders/PO').details;return [{...row,version:JSON.stringify(d),supplierShortName:'SUP',...projectAccountSettlement(row,d)}];};
 const documentService=async input=>{if(input.action==='ALLOCATE'){allocated++;return {fileId:'account-proof-id-123'};}uploads.push(clone(input));if(loseUpload){loseUpload=false;throw Error('upload response lost');}return {ok:true,...input};};
 const staff={memberId:'M',staffId:'F',staffName:'LAW'},operations=createAccountSettlementOperations({store,listOrders,documentService,names:{NCT:{activity:'NCTActivity'}},now:()=>new Date('2026-10-11T03:00:00Z')});
 const req={company:'NCT',staff,requestId:'33333333-3333-4333-8333-333333333333',input:{id:'PO',version:(await listOrders())[0].version,action:'DOCUMENT_UPLOAD',type:'PAYMENT',recipientChoice:'OTHER',paymentSource:'CASH',date:'2026-10-11',number:'BANK-001',cents:40000,base64:Buffer.from('%PDF-1.4\nTEST ONLY').toString('base64'),reason:'LOCAL TEST payment already executed'}};
 await assert.rejects(operations.save(req),/response lost/);assert.equal(records.get('PurchaseOrders/PO').details.finance.payments.length,0);
 assert.equal((await operations.save(req)).ok,true);assert.equal(allocated,1);assert.equal(uploads[0].fileId,uploads[1].fileId);assert.equal(uploads[1].department,'ACCOUNT');
 const saved=records.get('PurchaseOrders/PO').details.finance;assert.equal(saved.payments.length,1);assert.equal(saved.payments[0].by,'LAW');assert.equal((await listOrders())[0].finance.paidCents,40000);
 assert.equal(JSON.stringify([...records.values()]).includes(req.input.base64),false,'PDF bytes must not persist in CMS');
 const duplicate={...req,requestId:'44444444-4444-4444-8444-444444444444',input:{...req.input,version:(await listOrders())[0].version}};await assert.rejects(operations.save(duplicate),/reference is already/);assert.equal(allocated,1);
});

test('shared PO waits until every physically received source carton has a customer invoice',()=>{const task={id:'T',editVersion:'v1',customerId:'C',supplierId:'S',po:'PO-MULTI',barcode:'1',packing:'1',procurement:{totalCtn:30},lpCtn:10,disc1:0,disc2:0,disc3:0,warehouse:{accepted:30,hasPhysicalReceipt:true,issue:false},salesFulfilment:{sourceInvoicedQty:10}};const workspace={company:'NCT',tasks:[task],customers:[],suppliers:[]};assert.equal(projectPurchaseOrders({company:'NCT',workspace,records:[]})[0].salesInvoiceComplete,false);task.salesFulfilment.sourceInvoicedQty=30;assert.equal(projectPurchaseOrders({company:'NCT',workspace,records:[]})[0].salesInvoiceComplete,true);});

test('an actual payment after withdrawal remains recorded with its instruction exception',async()=>{
 const {row,details}=fixture();details.procurementHandoff={schema:1,stage:'WITHDRAWN',submission:{version:'old-instruction',byStaffId:'P',by:'PURCHASE',at:'2026-10-10T00:00:00Z'}};
 const records=new Map([['PurchaseOrders/PO',{_id:'PO',company:'NCT',details}]]);
 const store={read:async(c,id)=>clone(records.get(c+'/'+id)||null),insert:async(c,r)=>{if(records.has(c+'/'+r._id))throw Error('duplicate');records.set(c+'/'+r._id,clone(r));return clone(r);},update:async(c,r)=>{records.set(c+'/'+r._id,clone(r));return clone(r);},remove:async(c,id)=>records.delete(c+'/'+id)};
 const listOrders=async()=>{const d=records.get('PurchaseOrders/PO').details;return [{...row,version:JSON.stringify(d),supplierShortName:'SUP',...projectAccountSettlement(row,d)}];};
 const operations=createAccountSettlementOperations({store,listOrders,names:{NCT:{activity:'NCTActivity'}},documentService:async input=>input.action==='ALLOCATE'?{fileId:'actual-proof'}:{...input,ok:true}});
 await operations.save({company:'NCT',staff:{memberId:'M',staffId:'F',staffName:'LAW'},requestId:'77777777-7777-4777-8777-777777777777',input:{id:'PO',version:(await listOrders())[0].version,action:'DOCUMENT_UPLOAD',type:'PAYMENT',recipientChoice:'OTHER',paymentSource:'CASH',date:'2026-10-14',number:'BANK-EXCEPTION',cents:40000,base64:Buffer.from('%PDF-1.4\nACTUAL').toString('base64'),reason:'Actual bank payment discovered after withdrawal'}});
 const saved=records.get('PurchaseOrders/PO').details;
 assert.equal(saved.procurementHandoff.stage,'WITHDRAWN');assert.equal(saved.finance.payments[0].cents,40000);
 assert.equal(saved.finance.payments[0].procurementInstruction.requiresReview,true);assert.equal(saved.finance.payments[0].procurementInstruction.version,'old-instruction');
 assert.equal((await listOrders())[0].finance.paidCents,40000);
});

test('final Finance check cannot hide an unresolved bank operation',()=>{
 const {row,details}=fixture();details.procurementHandoff={stage:'UNKNOWN'};
 assert.equal(projectAccountSettlement(row,details).canCheck,false);
 assert.match(projectAccountSettlement(row,details).checkBlocker,/bank payment/);
});

function proofFileHarness(){
 const {row,details}=fixture();row.supplierId='SUP';const records=new Map([['PurchaseOrders/PO',{_id:'PO',company:'NCT',details}]]),calls=[];let seq=0,failExtra=false;
 const supplier={title:'SUP',bankName:'EXAMPLE BANK',bankAccountNo:'0012345'};
 const store={all:async()=>[supplier],read:async(c,id)=>clone(records.get(c+'/'+id)||null),insert:async(c,r)=>{if(records.has(c+'/'+r._id))throw Error('duplicate');records.set(c+'/'+r._id,clone(r));return r;},update:async(c,r)=>{records.set(c+'/'+r._id,clone(r));return r;},remove:async(c,id)=>records.delete(c+'/'+id)};
 const listOrders=async()=>{const d=records.get('PurchaseOrders/PO').details;return [{...row,version:JSON.stringify(d),supplierShortName:'SAMPLE',...projectAccountSettlement(row,d)}];};
 const documentService=async input=>{calls.push(clone(input));if(input.action==='ALLOCATE')return {fileId:'proof-file-'+(++seq)};if(failExtra&&input.name.endsWith('-2.pdf')){failExtra=false;throw Error('lost upload response');}return {...input,ok:true,trashed:input.action==='TRASH'};};
 const operations=createAccountSettlementOperations({store,listOrders,documentService,names:{NCT:{activity:'NCTActivity'}}}),staff={memberId:'M',staffId:'F',staffName:'FINANCE',role:'ACCOUNT'};
 const request=async(input,actor=staff)=>({company:'NCT',staff:actor,requestId:require('node:crypto').randomUUID(),input:{id:'PO',version:(await listOrders())[0].version,...input}});
 const pdf=n=>Buffer.from('%PDF-1.4\nTEST ONLY '+n).toString('base64');
 const input={action:'DOCUMENT_UPLOAD',type:'PAYMENT',date:'2026-10-17',number:'',cents:20000,base64:pdf(1),attachments:[{base64:pdf(2)}],recipientChoice:'SUPPLIER',recipientBank:{bankName:supplier.bankName,bankAccountNo:supplier.bankAccountNo},paymentSource:'CASH',reason:''};
 return {operations,request,input,calls,records,listOrders,supplier,failExtra:()=>failExtra=true};
}
test('multi-file payment preserves one amount, server bank snapshot and the same files after a lost response',async()=>{
 const h=proofFileHarness(),req=await h.request(h.input);h.failExtra();await assert.rejects(h.operations.save(req),/lost upload/);assert.equal(h.records.get('PurchaseOrders/PO').details.finance.payments.length,0);
 await h.operations.save(req);const p=h.records.get('PurchaseOrders/PO').details.finance.payments[0];assert.equal(p.proofs.length,2);assert.equal(p.cents,20000);assert.equal(p.reference,'');assert.equal(p.recipientBank.bankAccountNo,'0012345');assert.equal(h.calls.filter(c=>c.action==='ALLOCATE').length,2);assert.equal((await h.listOrders())[0].finance.paidCents,20000);assert.equal(JSON.stringify([...h.records.values()]).includes(h.input.base64),false);
 h.supplier.bankAccountNo='changed';assert.equal(p.recipientBank.bankAccountNo,'0012345');
});
test('payment requires recipient and source, rejects a stale supplier account, and permits Other without a reason',async()=>{
 for(const change of [{recipientChoice:''},{paymentSource:''},{recipientBank:{bankName:'EXAMPLE BANK',bankAccountNo:'wrong'}}]){const h=proofFileHarness();await assert.rejects(h.operations.save(await h.request({...h.input,...change})),/Select/);assert.equal(h.calls.filter(c=>c.action==='UPLOAD').length,0);}
 const h=proofFileHarness();await h.operations.save(await h.request({...h.input,recipientChoice:'OTHER',recipientBank:{bankAccountNo:'client-forged'}}));assert.equal(h.records.get('PurchaseOrders/PO').details.finance.payments[0].recipientBank,null);
});
test('only uploader or SUPER ADMIN may trash payment proof; removing every file preserves paid amounts and audit',async()=>{
 const h=proofFileHarness();await h.operations.save(await h.request(h.input));let p=h.records.get('PurchaseOrders/PO').details.finance.payments[0];const input={action:'PAYMENT_FILE_DELETE',paymentId:p.id,fileId:p.proofs[0].fileId};
 await assert.rejects(h.operations.save(await h.request(input,{memberId:'X',staffId:'X',staffName:'OTHER',role:'ACCOUNT'})),/Only the uploader/);assert.equal(h.calls.filter(c=>c.action==='TRASH').length,0);
 await h.operations.save(await h.request(input));await h.operations.save(await h.request({...input,fileId:p.proofs[1].fileId},{memberId:'A',staffId:'A',staffName:'ADMIN',role:'SUPER ADMIN'}));
 p=h.records.get('PurchaseOrders/PO').details.finance.payments[0];assert.equal(p.deletedProofs.length,2);assert.equal((await h.listOrders())[0].finance.paidCents,20000);assert.equal(h.calls.filter(c=>c.action==='TRASH').length,2);assert.equal(h.calls.filter(c=>c.action==='TRASH').every(c=>c.department==='ACCOUNT'&&c.type==='PAYMENT'),true);
});

test('adding replacement proofs to a paid record never appends or changes the monetary payment',async()=>{
 const h=proofFileHarness();await h.operations.save(await h.request(h.input));const payment=h.records.get('PurchaseOrders/PO').details.finance.payments[0];
 await h.operations.save(await h.request({action:'DOCUMENT_UPLOAD',type:'PAYMENT',paymentId:payment.id,date:'2026-10-17',base64:Buffer.from('%PDF-1.4\nREPLACEMENT').toString('base64')}));
 const payments=h.records.get('PurchaseOrders/PO').details.finance.payments;assert.equal(payments.length,1);assert.equal(payments[0].proofs.length,3);assert.equal((await h.listOrders())[0].finance.paidCents,20000);
});


test('planning two instalments preserves payment money and reconciliation state',async()=>{
 const h=proofFileHarness(),before=(await h.listOrders())[0].finance;
 const plan=[{date:'2026-10-18',cents:30000,source:'CASH'},{date:'2026-10-20',cents:70000,source:'LOAN'}];
 await h.operations.save(await h.request({action:'PLAN',plan}));
 const after=(await h.listOrders())[0].finance;assert.deepEqual(after.plan,plan);assert.equal(after.paidCents,before.paidCents);assert.equal(after.balanceCents,before.balanceCents);assert.equal(after.reviewVersion,before.reviewVersion);assert.equal(h.calls.length,0);
 await h.operations.save(await h.request({action:'PLAN',plan:[]}));assert.deepEqual((await h.listOrders())[0].finance.plan,[]);
});
test('planning rejects incomplete instalments, excess balance and unresolved bank operations',async()=>{
 for(const plan of [[{date:'2026-02-30',cents:100,source:'CASH'}],[{date:'2026-10-18',cents:100001,source:'CASH'}],[{date:'2026-10-18',cents:100,source:''}]]){const h=proofFileHarness();await assert.rejects(h.operations.save(await h.request({action:'PLAN',plan})),/Enter/);}
 const h=proofFileHarness();h.records.get('PurchaseOrders/PO').details.procurementHandoff={stage:'UNKNOWN'};await assert.rejects(h.operations.save(await h.request({action:'PLAN',plan:[]})),/Resolve bank/);
});
test('a prior secondary proof cannot be recorded again as a new primary proof',async()=>{
 const h=proofFileHarness();await h.operations.save(await h.request(h.input));await assert.rejects(h.operations.save(await h.request({...h.input,base64:h.input.attachments[0].base64,attachments:[]})),/already recorded/);assert.equal((await h.listOrders())[0].finance.paidCents,20000);
});
