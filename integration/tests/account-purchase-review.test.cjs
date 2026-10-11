const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {requireAccountStaff,createAccountReviewOperations}=load('accountPurchaseReview.js');
const {projectPurchaseOrders}=load('purchaseOrderWorkflow.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 const records=new Map(),workspace={company:'NCT',customers:[{id:'C',name:'CUSTOMER'}],suppliers:[{id:'S',name:'SUPPLIER'}],tasks:[{id:'T',editVersion:'v1',customerId:'C',supplierId:'S',po:'NCT-PO-001',barcode:'001',packing:'1',procurement:{totalCtn:100},lpCtn:10,disc1:0,disc2:0,disc3:0,history:[]}]};
 const store={read:async(c,id)=>clone(records.get(c+'/'+id)||null),insert:async(c,row)=>{if(records.has(c+'/'+row._id))throw Error('duplicate');records.set(c+'/'+row._id,clone(row));return clone(row);},update:async(c,row)=>{records.set(c+'/'+row._id,clone(row));return clone(row);},remove:async(c,id)=>records.delete(c+'/'+id)};
 const listOrders=async company=>projectPurchaseOrders({company,workspace,records:[...records].filter(([key])=>key.startsWith('PurchaseOrders/')).map(([,row])=>clone(row))});
 const staff={memberId:'M',staffId:'STF',staffName:'FINANCE'},operations=createAccountReviewOperations({store,listOrders,names:{NCT:{activity:'NCTActivity'},GHR:{activity:'NCTActivity1'}},now:()=>new Date('2026-10-11T08:00:00Z')});
 return {records,workspace,store,listOrders,operations,staff};
}
test('Account requires an approved matched active personal staff account; Purchase does not gain finance authority',()=>{
 const member={_id:'M',loginEmail:'finance@example.com',status:'APPROVED'},record={title:'STF',description:'M',staffEmail:'finance@example.com',staffName:'FINANCE',staffStatus:'ACTIVE',departments:['ACCOUNT'],role:'STAFF'};
 assert.equal(requireAccountStaff(member,[record]).staffName,'FINANCE');
 for(const change of [{departments:['PURCHASE']},{description:'other'},{staffStatus:'INACTIVE'}])assert.throws(()=>requireAccountStaff(member,[{...record,...change}]));
 assert.throws(()=>requireAccountStaff({...member,status:'PENDING'},[record]));assert.throws(()=>requireAccountStaff(member,[record,record]));
 assert.equal(requireAccountStaff(member,[{...record,departments:[],role:'TOP MANAGEMENT'}]).role,'TOP MANAGEMENT');
});
test('Final Invoice upload and legacy finalInvoiceComplete never grant approval; finance check is audited and repeat-safe',async()=>{
 const f=fixture(),row=(await f.listOrders('NCT'))[0];
 await f.store.insert('PurchaseOrders',{_id:row.id,company:'NCT',details:{taskIds:['T'],finalInvoiceComplete:true,documents:[{fileId:'INV1',type:'INV',linked:true,sha256:'HASH',number:'INV001',date:'2026-10-11'}]}});
 const before=(await f.listOrders('NCT'))[0];assert.equal(before.documentStatus,'PROVISIONAL');assert.equal(before.invoiceChecked,false);
 const save={company:'NCT',staff:f.staff,requestId:'11111111-1111-4111-8111-111111111111',input:{id:before.id,version:before.version,action:'INVOICE_CHECK',enabled:true,reason:'Documents checked'}};
 await f.operations.save(save);await f.operations.save(save);
 const after=(await f.listOrders('NCT'))[0];assert.equal(after.documentStatus,'COMPLETE');assert.equal(after.canArchive,false);assert.equal(after.history.length,1);assert.equal(after.invoiceCheck.checkedBy,'FINANCE');assert.equal(after.invoiceCheck.checkedAt,'2026-10-11T08:00:00.000Z');
 const record=await f.store.read('PurchaseOrders',row.id);record.details.documents.push({fileId:'CN1',type:'CN',linked:true,sha256:'NEW',number:'CN001',date:'2026-10-11'});await f.store.update('PurchaseOrders',record);
 assert.equal((await f.listOrders('NCT'))[0].invoiceChecked,false);assert.equal((await f.listOrders('NCT'))[0].documentStatus,'PROVISIONAL');
 record.details.documents.pop();await f.store.update('PurchaseOrders',record);f.workspace.tasks[0].editVersion='v2';
 assert.equal((await f.listOrders('NCT'))[0].invoiceChecked,true,'non-financial task edit does not revoke invoice review');
 f.workspace.tasks[0].lpCtn=11;
 assert.equal((await f.listOrders('NCT'))[0].invoiceChecked,false);assert.equal(f.workspace.tasks[0].procurement.totalCtn,100);
});
test('no invoice, stale version and wrong company are rejected',async()=>{
 const f=fixture(),row=(await f.listOrders('NCT'))[0],base={company:'NCT',staff:f.staff,requestId:'22222222-2222-4222-8222-222222222222',input:{id:row.id,version:row.version,action:'INVOICE_CHECK',enabled:true}};
 await assert.rejects(f.operations.save(base),/Final supplier Invoice/);await assert.rejects(f.operations.save({...base,requestId:'33333333-3333-4333-8333-333333333333',input:{...base.input,version:'stale'}}),/changed/);
 await assert.rejects(f.operations.save({...base,company:'GHR'}),/Select/);
});
test('cancellation requires a reason and keeps prior invoice/check history',async()=>{
 const f=fixture(),initial=(await f.listOrders('NCT'))[0];await f.store.insert('PurchaseOrders',{_id:initial.id,company:'NCT',details:{taskIds:['T'],documents:[{type:'INV',fileId:'INV1',linked:true}]}});
 const row=(await f.listOrders('NCT'))[0],base={company:'NCT',staff:f.staff,requestId:'44444444-4444-4444-8444-444444444444',input:{id:row.id,version:row.version,action:'INVOICE_CHECK',enabled:true}};
 await f.operations.save(base);const checked=(await f.listOrders('NCT'))[0],cancel={...base,requestId:'55555555-5555-4555-8555-555555555555',input:{...base.input,version:checked.version,enabled:false}};
 await assert.rejects(f.operations.save(cancel),/reason/);await f.operations.save({...cancel,input:{...cancel.input,reason:'Supplier sent a correction'}});
 const after=(await f.listOrders('NCT'))[0];assert.equal(after.documentStatus,'PROVISIONAL');assert.equal(after.documents.length,1);assert.equal(after.history.length,2);
});
