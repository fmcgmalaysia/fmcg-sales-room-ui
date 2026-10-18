const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {projectAccountSettlement,createAccountSettlementOperations}=load('accountSettlement.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function setup(){
 const row={id:'PO',company:'NCT',version:'v1',contentVersion:'cost1',taskIds:['T'],documents:[{fileId:'INV',type:'INV',linked:true,sha256:'inv'},{fileId:'DO',type:'DO',linked:true,sha256:'do'}],warehouse:{complete:true,issues:false,receivedCtn:10},salesInvoiceComplete:false};
 const details={finance:{amounts:[{fileId:'INV',sha256:'inv',cents:10000}],cnNotApplicable:{enabled:true,byStaffId:'F',at:'2026-10-18'},payments:[{id:'P',cents:10000,confirmed:true,by:'Finance',byStaffId:'F',at:'2026-10-18',proof:{fileId:'PAY',sha256:'pay',linked:true,uploadedByStaffId:'F'}}]}};
 const records=new Map([['PurchaseOrders/PO',{_id:'PO',company:'NCT',details}]]);
 const store={read:async(c,id)=>clone(records.get(c+'/'+id)||null),all:async()=>[],insert:async(c,r)=>{assert.ok(!records.has(c+'/'+r._id));records.set(c+'/'+r._id,clone(r));return r;},update:async(c,r)=>{records.set(c+'/'+r._id,clone(r));return r;},remove:async(c,id)=>records.delete(c+'/'+id)};
 const listOrders=async()=>{const d=records.get('PurchaseOrders/PO').details;return [{...row,version:JSON.stringify(d),...projectAccountSettlement(row,d)}];};
 const staff={staffId:'F',staffName:'Finance',memberId:'member'},ops=createAccountSettlementOperations({store,listOrders,names:{NCT:{activity:'Activity'}},now:()=>new Date('2026-10-18T06:00:00Z')});let seq=0;
 const save=async(action,extra={})=>ops.save({company:'NCT',staff,requestId:'aaaaaaaa-aaaa-4aaa-8aaa-'+String(++seq).padStart(12,'0'),input:{id:'PO',version:(await listOrders())[0].version,action,reason:'Reviewed',...extra}});
 return {row,details,records,store,listOrders,ops,staff,save};
}
test('supplier Job Done is independent of customer invoicing and preserves whole-order archive gates',async()=>{
 const f=setup();assert.equal((await f.listOrders())[0].supplierAccount.canClose,true);
 await f.save('CLOSE_ACCOUNT',{by:'Forged'});const row=(await f.listOrders())[0];
 assert.equal(row.supplierAccount.closed,true);assert.equal(row.state,'ACTIVE');assert.equal(row.invoiceChecked,true);assert.equal(row.supplierAccount.closure.by,'Finance');assert.equal(row.supplierAccount.closure.snapshot.paidCents,10000);
});
test('missing documents, shortage, quarantine, unpaid money, bank unknown and unresolved reports block Job Done',async()=>{
 for(const mutate of [f=>f.row.documents.pop(),f=>f.row.warehouse.complete=false,f=>f.row.stockIssues=[{id:'Q'}],f=>f.details.finance.payments[0].cents=5000,f=>f.details.procurementHandoff={stage:'UNKNOWN'},f=>f.details.documentIssues=[{status:'OPEN'}],f=>f.details.finance.payments[0].confirmed=false,f=>f.details.finance.payments[0].deletedProofs=[{fileId:'PAY'}]]){
  const f=setup();mutate(f);assert.equal((await f.listOrders())[0].supplierAccount.canClose,false);await assert.rejects(f.save('CLOSE_ACCOUNT'),/resolve these items/);assert.equal(f.details.finance.closure,undefined);
 }
});
test('Closed stays Closed after a new warehouse issue, exposes review warning, requires reason to reopen',async()=>{
 const f=setup();await f.save('CLOSE_ACCOUNT');f.row.warehouse.issues=true;f.row.warehouse.complete=false;
 let row=(await f.listOrders())[0];assert.equal(row.supplierAccount.closed,true);assert.equal(row.supplierAccount.reviewRequired,true);
 await assert.rejects(f.save('REOPEN_ACCOUNT',{reason:''}),/reason/);await f.save('REOPEN_ACCOUNT',{reason:'Investigate receipt correction'});
 row=(await f.listOrders())[0];assert.equal(row.supplierAccount.closed,false);assert.equal(row.invoiceChecked,false);assert.equal(row.supplierAccount.canClose,false);assert.equal(row.finance.paidCents,10000);
 const audit=f.records.get('PurchaseOrders/PO').details.audit;assert.deepEqual(audit.map(a=>a.action),['ACCOUNT_CLOSE_ACCOUNT','ACCOUNT_REOPEN_ACCOUNT']);assert.equal(audit[1].actorStaffId,'F');
});
test('closed finance edits and proof deletion are rejected, reopening retains payment ledger',async()=>{
 const f=setup();await f.save('CLOSE_ACCOUNT');for(const action of ['AMOUNTS','CHECK','PLAN','PAYMENT_REVIEW','DOCUMENT_ISSUE_REPORT','PAYMENT_FILE_DELETE'])await assert.rejects(f.save(action,{enabled:false,paymentId:'P',fileId:'PAY'}),/Reopen account/);
 await f.save('REOPEN_ACCOUNT');assert.equal((await f.listOrders())[0].finance.payments.length,1);await f.save('CLOSE_ACCOUNT');assert.equal((await f.listOrders())[0].supplierAccount.closed,true);
});
test('lost closing receipt retries once and stale decisions cannot close a changed account',async()=>{
 const f=setup(),update=f.store.update;let fail=true;f.store.update=async(c,r)=>{const value=await update(c,r);if(fail){fail=false;throw Error('lost acknowledgement');}return value;};
 const input={company:'NCT',staff:f.staff,requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',input:{id:'PO',version:(await f.listOrders())[0].version,action:'CLOSE_ACCOUNT',reason:'Reviewed'}};
 await assert.rejects(f.ops.save(input),/lost acknowledgement/);assert.equal((await f.ops.save(input)).ok,true);assert.equal(f.records.get('PurchaseOrders/PO').details.audit.length,1);
 await assert.rejects(f.ops.save({...input,requestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}),/changed/);
});
