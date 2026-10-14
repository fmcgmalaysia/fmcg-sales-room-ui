const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {paymentReviewVersion,procurementSubmissionVersion,projectProcurementHandoff,transitionProcurementHandoff}=load('paymentHandoff.js');
const identity={byStaffId:'P1',by:'PURCHASE',at:'2026-10-14T10:00:00.000Z'};
const accountant={byStaffId:'A1',by:'ACCOUNT',at:'2026-10-14T10:01:00.000Z'};
function fixture(){
 const row={company:'NCT',id:'PO1',number:'NCT-001',supplierId:'S1',termDays:30,contentVersion:'cost1',taskIds:['T1','T2'],amount:10000,documents:[],finance:{payments:[]}};
 const details={};
 const act=(action,extra={},department='PURCHASE')=>details.procurementHandoff=transitionProcurementHandoff(row,details,{action,reason:'Verified instruction',...extra},department==='PURCHASE'?identity:accountant,department);
 return {row,details,act};
}
test('whole PO submission freezes one version; withdrawal preserves original submission and audit identity',()=>{
 const f=fixture();assert.equal(projectProcurementHandoff(f.row,f.details).stage,'LEGACY');assert.equal(projectProcurementHandoff(f.row,f.details).editable,false);
 f.act('SUBMIT_FINANCE',{urgent:true});const original=f.details.procurementHandoff.submission;
 assert.equal(original.amountCents,1000000);assert.equal(projectProcurementHandoff(f.row,f.details).editable,false);
 assert.throws(()=>f.act('SUBMIT_FINANCE'),/already submitted/);
 f.act('WITHDRAW_FINANCE');assert.equal(projectProcurementHandoff(f.row,f.details).editable,true);assert.deepEqual(f.details.procurementHandoff.submission,original);
 f.row.contentVersion='cost2';f.act('SUBMIT_FINANCE');assert.notEqual(f.details.procurementHandoff.submission.version,original.version);assert.deepEqual(f.details.procurementHandoff.previousSubmission,original);
});
test('Finance ownership prevents unilateral withdrawal; return requires explicit bank reconciliation',()=>{
 const f=fixture();f.act('SUBMIT_FINANCE');f.act('TAKE_OWNERSHIP',{},'ACCOUNT');
 assert.throws(()=>f.act('WITHDRAW_FINANCE'),/before Finance/);f.act('REQUEST_RETURN');
 assert.equal(projectProcurementHandoff(f.row,f.details).editable,false);
 assert.throws(()=>f.act('RETURN_PROCUREMENT',{},'ACCOUNT'),/unresolved bank/);
 assert.throws(()=>f.act('RETURN_PROCUREMENT',{bankClear:true}),/not authorized/);
 f.act('RETURN_PROCUREMENT',{bankClear:true},'ACCOUNT');assert.equal(projectProcurementHandoff(f.row,f.details).editable,true);
});
test('unknown bank outcome remains frozen even when return requested; only reconciled result releases processing',()=>{
 const f=fixture();f.act('SUBMIT_FINANCE');f.act('TAKE_OWNERSHIP',{},'ACCOUNT');
 f.details.paymentHandoff={review:{version:paymentReviewVersion(f.row),requestedCents:500000}};
 f.act('PAYMENT_PROCESSING',{bankClear:true},'ACCOUNT');f.act('PAYMENT_UNKNOWN',{},'ACCOUNT');f.act('REQUEST_RETURN');
 assert.equal(f.details.procurementHandoff.stage,'UNKNOWN');
 assert.throws(()=>f.act('RETURN_PROCUREMENT',{bankClear:true},'ACCOUNT'),/unresolved bank/);
 assert.throws(()=>f.act('PAYMENT_RESOLVED',{bankClear:true,outcome:'RECORDED',paymentId:'absent'},'ACCOUNT'),/actual payment proof/);
 f.row.finance.payments.push({id:'actual',at:'2026-10-14T10:02:00.000Z',confirmed:true,cents:500000,proof:{linked:true}});
 f.act('PAYMENT_RESOLVED',{bankClear:true,outcome:'RECORDED',paymentId:'actual'},'ACCOUNT');
 assert.equal(f.details.procurementHandoff.stage,'RETURN_REQUESTED');assert.equal(f.row.finance.payments[0].cents,500000);
 f.act('RETURN_PROCUREMENT',{bankClear:true},'ACCOUNT');assert.equal(f.row.finance.payments.length,1);
});
test('supplier, terms, membership, FOC content and documents bind submission; viewing and chasing do not',()=>{
 const f=fixture(),original=procurementSubmissionVersion(f.row);
 for(const [key,value] of [['supplierId','S2'],['termDays',60],['number','NCT-002'],['contentVersion','same-amount-new-FOC'],['taskIds',['T1']],['documents',[{fileId:'PI1',type:'PI',sha256:'new',linked:true}]]]){
  const changed={...f.row,[key]:value};assert.notEqual(procurementSubmissionVersion(changed),original,key);
 }
 assert.equal(procurementSubmissionVersion({...f.row,chasePayment:true,readAt:'later',taskIds:['T2','T1']}),original);
 f.act('SUBMIT_FINANCE');f.row.supplierId='S2';assert.equal(projectProcurementHandoff(f.row,f.details).stale,true);
 assert.throws(()=>f.act('TAKE_OWNERSHIP',{},'ACCOUNT'),/changed/);
});
test('incomplete and cross-role submissions are refused; legacy Finance instruction is not silently adopted',()=>{
 const f=fixture();f.row.amount=null;assert.throws(()=>f.act('SUBMIT_FINANCE'),/complete saved/);f.row.amount=10000;
 assert.throws(()=>f.act('SUBMIT_FINANCE',{},'ACCOUNT'),/not authorized/);
 f.details.paymentHandoff={review:{version:'legacy'}};assert.throws(()=>f.act('SUBMIT_FINANCE'),/existing payment instruction/);
});
