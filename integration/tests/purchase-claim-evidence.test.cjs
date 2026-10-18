const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {preparePurchaseClaim,purchaseClaimBlockers}=load('purchaseClaimEvidence.js');
function fixture(){
 const item={id:'CASE-A',kind:'RECEIPT',quantity:10,signature:'SIG',decision:{supplierDecision:'REFUND'}},row={quantityCases:[item],documents:[{fileId:'CN',type:'CN',linked:true,sha256:'CN-HASH'}],finance:{amounts:[{fileId:'CN',sha256:'CN-HASH',cents:100000}],payments:[{id:'REFUND',direction:'REFUND',confirmed:true,cents:100000,proof:{linked:true,sha256:'R-HASH'}}],quantityClaims:[]},stockCases:[]};
 const input={caseId:'CASE-A',signature:'SIG',quantity:10,cents:100000,outcome:'REFUND',cnAllocations:[{fileId:'CN',cents:100000}],refundAllocations:[{paymentId:'REFUND',cents:100000}]};
 const identity={by:'FINANCE',byStaffId:'F',at:'2026-10-12T03:00:00Z'},prepare=()=>preparePurchaseClaim(row,input,identity,'Confirmed final documents');return {row,input,prepare};
}
test('short receipt cannot clear from upload or cash balance alone; it needs an explicit audited claim mapping',()=>{
 const f=fixture();assert.match(purchaseClaimBlockers(f.row,f.row.finance).join(),/Reconcile each/);
 const claim=f.prepare();assert.equal(claim.byStaffId,'F');assert.equal(claim.cnAllocations[0].sha256,'CN-HASH');f.row.finance.quantityClaims=[claim];assert.equal(purchaseClaimBlockers(f.row,f.row.finance).length,0);
 f.row.documents[0].sha256='REPLACED';assert.match(purchaseClaimBlockers(f.row,f.row.finance).join(),/unavailable/);
});
test('a CN or refund cannot be counted again for another shortage or quarantined-stock claim',()=>{
 for(const field of ['cnAllocations','refundAllocations'])for(const source of ['quantity','stock']){
  const f=fixture(),other={caseId:'OTHER',[field]:field==='cnAllocations'?[{fileId:'CN',cents:1}]:[{paymentId:'REFUND',cents:1}]};
  if(source==='quantity')f.row.finance.quantityClaims=[other];else f.row.stockCases=[{resolution:{financeApproval:other}}];
  assert.throws(f.prepare,/already assigned/);
 }
});
test('claim cannot change Purchase resolution, exceed proof or reuse stale receiving quantities',()=>{
 for(const change of [f=>f.input.signature='OLD',f=>f.input.quantity=9,f=>f.input.outcome='CREDIT',f=>f.row.finance.payments[0].confirmed=false,f=>f.row.finance.amounts[0].cents=99999]){const f=fixture();change(f);assert.throws(f.prepare);}
});
test('multiple actual refunds can cover one CN, and future credit needs no invented refund',()=>{
 const f=fixture();f.row.finance.payments=[{id:'R1',direction:'REFUND',confirmed:true,cents:30000,proof:{linked:true,sha256:'1'}},{id:'R2',direction:'REFUND',confirmed:true,cents:70000,proof:{linked:true,sha256:'2'}}];f.input.refundAllocations=[{paymentId:'R1',cents:30000},{paymentId:'R2',cents:70000}];assert.equal(f.prepare().refundAllocations.length,2);
 f.input.outcome='CREDIT';f.row.quantityCases[0].decision.supplierDecision='CREDIT';f.input.refundAllocations=[];assert.equal(f.prepare().refundAllocations.length,0);
});
