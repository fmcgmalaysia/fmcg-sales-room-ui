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
test('Final Invoice creates a creditor but upload and legacy flags cannot make Files green',async()=>{
 const f=fixture(),row=(await f.listOrders('NCT'))[0];assert.equal(row.creditorActive,false);
 await f.store.insert('PurchaseOrders',{_id:row.id,company:'NCT',details:{taskIds:['T'],finalInvoiceComplete:true,invoiceCheck:{enabled:true},paymentCompleted:true,documents:[{fileId:'INV1',type:'INV',linked:true,number:'INV001'}]}});
 const before=(await f.listOrders('NCT'))[0];assert.equal(before.documentStatus,'PROVISIONAL');assert.equal(before.invoiceChecked,false);
 assert.equal(before.creditorActive,true,'payment alone cannot remove a creditor');assert.equal(before.canCheck,false);assert.equal(before.canArchive,false);
 const record=await f.store.read('PurchaseOrders',row.id);
 await assert.rejects(f.operations.save({company:'NCT',staff:f.staff,requestId:'11111111-1111-4111-8111-111111111111',input:{id:before.id,version:before.version,action:'INVOICE_CHECK',enabled:true,cnNotApplicable:true,warehouseClosed:true,paymentCompleted:true}}),/Warehouse receipts/);
 assert.deepEqual(await f.store.read('PurchaseOrders',row.id),record,'client-supplied completion flags cannot write approval');
});
test('PI and superseded invoices do not create a creditor; current Final Invoice does without a second sync',async()=>{
 const f=fixture(),row=(await f.listOrders('NCT'))[0];
 const record={_id:row.id,company:'NCT',details:{taskIds:['T'],documents:[{type:'PI',fileId:'PI1',linked:true},{type:'INV',fileId:'INV1',linked:true,superseded:true}]}};
 await f.store.insert('PurchaseOrders',record);assert.equal((await f.listOrders('NCT'))[0].creditorActive,false);
 record.details.documents.push({type:'INV',fileId:'INV2',linked:true});await f.store.update('PurchaseOrders',record);
 assert.equal((await f.listOrders('NCT'))[0].creditorActive,true);assert.equal((await f.listOrders('NCT'))[0].invoiceChecked,false);
});
test('no invoice, stale version and wrong company are rejected',async()=>{
 const f=fixture(),row=(await f.listOrders('NCT'))[0],base={company:'NCT',staff:f.staff,requestId:'22222222-2222-4222-8222-222222222222',input:{id:row.id,version:row.version,action:'INVOICE_CHECK',enabled:true}};
 await assert.rejects(f.operations.save(base),/Final supplier Invoice/);await assert.rejects(f.operations.save({...base,requestId:'33333333-3333-4333-8333-333333333333',input:{...base.input,version:'stale'}}),/changed/);
 await assert.rejects(f.operations.save({...base,company:'GHR'}),/Select/);
});
