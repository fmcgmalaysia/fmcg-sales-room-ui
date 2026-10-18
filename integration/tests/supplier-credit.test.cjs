const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createSupplierCreditOperations,readCreditTransfers}=load('supplierCredit.js');
function fixture(){
 const records=new Map(),source={id:'SOURCE',company:'NCT',supplierId:'S',invoiceChecked:true},target={id:'TARGET',company:'NCT',supplierId:'S'};
 const store={all:async()=>[...records.values()],read:async(c,id)=>records.get(id)||null,insert:async(c,row)=>{if(records.has(row._id))throw Error('duplicate');records.set(row._id,row);return row;},remove:async(c,id)=>records.delete(id)};
 const listOrders=async()=>{const transfers=readCreditTransfers([...records.values()]),used=transfers.reduce((sum,row)=>sum+row.cents,0);return [{...source,version:'S'+used,finance:{supplierCreditCents:10000-used}},{...target,version:'T'+used,finance:{balanceCents:50000-used}}];};
 const apply=createSupplierCreditOperations({store,names:{NCT:{activity:'A'}},listOrders});
 const base={company:'NCT',staff:{memberId:'M',staffId:'F',staffName:'ACCOUNT'},requestId:'11111111-1111-4111-8111-111111111111'};
 const input={action:'APPLY_CREDIT',id:'TARGET',sourceId:'SOURCE',version:'T0',sourceVersion:'S0',cents:4000,reason:'Deduct agreed supplier CN'};
 return {records,source,target,apply,base,input,listOrders};
}
test('supplier credit is consumed once and partial remainder stays available',async()=>{
 const f=fixture();await f.apply({...f.base,input:f.input});await f.apply({...f.base,input:f.input});
 const rows=await f.listOrders();assert.equal(rows[0].finance.supplierCreditCents,6000);assert.equal(rows[1].finance.balanceCents,46000);assert.equal(readCreditTransfers([...f.records.values()]).length,1);
 await assert.rejects(f.apply({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input:f.input}),/changed/);
});
test('credit cannot cross supplier/company, exceed available balance or bypass finance check',async()=>{
 for(const change of [f=>f.target.supplierId='OTHER',f=>f.target.company='GHR',f=>f.input.cents=10001,f=>f.source.invoiceChecked=false]){
  const f=fixture();change(f);await assert.rejects(f.apply({...f.base,input:f.input}));assert.equal(readCreditTransfers([...f.records.values()]).length,0);
 }
});
