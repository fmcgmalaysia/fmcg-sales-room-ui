'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {projectWarehouseOrders,createWarehouseOperations}=load('warehouseReceiving.js');
const copy=v=>JSON.parse(JSON.stringify(v));
function fixture(changeDuringApply){
 const records=new Map(),tasks=[{id:'T',orderId:'O',sourceLineId:'L',barcode:'001',name:'Synthetic product',packing:'24 x 1',ord:100,procurement:{totalCtn:100}}];
 const po={id:'PO',company:'NCT',version:'RECORD-1',contentVersion:'COMMERCIAL-1',supplierId:'S',selfCollect:true,taskIds:['T'],customerId:'C',customerName:'Synthetic customer'};
 let reads=0;
 const store={all:async()=>copy([...records.values()]),read:async(c,id)=>copy(records.get(id)||null),insert:async(c,row)=>{assert(!records.has(row._id));records.set(row._id,copy(row));return copy(row);},remove:async(c,id)=>records.delete(id)};
 const project=()=>projectWarehouseOrders({company:'NCT',purchaseOrders:[po],tasks,activity:[...records.values()]})[0];
 const readOrders=async()=>{reads++;if(reads===2&&changeDuringApply)changeDuringApply(po,tasks);return [project()];};
 const operations=createWarehouseOperations({store,names:{NCT:{activity:'A'}},readOrders,now:()=>new Date('2026-10-31T00:00:00Z')});
 const request={company:'NCT',staff:{memberId:'M',staffId:'W',staffName:'Synthetic operator'},requestId:'11111111-1111-4111-8111-111111111111',input:{action:'RECEIVE',id:'PO',version:project().version,lines:[{taskId:'T',accepted:70,rejected:0,kind:'SHORT',reason:'Synthetic short delivery'}]}};
 return {po,tasks,records,project,request,save:r=>operations.save(r||request)};
}
test('a document or recorded-payment update does not discard a still-current operational receipt',async()=>{
 const f=fixture(po=>{po.version='RECORD-2';po.documents=[{fileId:'SYNTHETIC-INV'}];po.finance={paidCents:50000};});
 const result=await f.save();assert.equal(result.ok,true);assert.equal(f.project().lines[0].accepted,70);
 await f.save();assert.equal(f.project().lines[0].accepted,70);assert.equal([...f.records.values()].filter(r=>r.action==='WAREHOUSE_RECEIPT_SAVED').length,1);
});
for(const [name,mutate]of [
 ['commercial revision',po=>po.contentVersion='COMMERCIAL-2'],
 ['supplier identity',po=>po.supplierId='OTHER'],
 ['receiving transport',po=>po.selfCollect=false],
 ['approved quantity',(po,tasks)=>tasks[0].procurement.totalCtn=120],
 ['Finance checked lock',po=>po.invoiceChecked=true],
 ['Finance account closure',po=>po.supplierAccount={closed:true}]
])test('a concurrent '+name+' still rejects before creating a physical receipt',async()=>{
 const f=fixture(mutate);await assert.rejects(f.save(),/changed/);assert.equal([...f.records.values()].filter(r=>r.action==='WAREHOUSE_RECEIPT_SAVED').length,0);
 assert.equal(f.project().lines[0].accepted,0);
});
test('legacy POs without an authoritative commercial version retain the full record fence',()=>{
 const f=fixture();delete f.po.contentVersion;const old=f.project().version;f.po.version='RECORD-2';assert.notEqual(f.project().version,old);
});
test('a second receipt invalidates the earlier form even when documents are unchanged',async()=>{
 const f=fixture(),stale=copy(f.request);await f.save();await assert.rejects(f.save({...stale,requestId:'22222222-2222-4222-8222-222222222222'}),/changed/);
 assert.equal(f.project().lines[0].accepted,70);
});
