const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {paymentReviewVersion,projectPaymentHandoff}=load('paymentHandoff.js');
test('supplier invoice due date drives alerts only while a known balance remains unpaid',()=>{
 const row={company:'NCT',id:'P',contentVersion:'v',documents:[],dueDate:'2026-10-12',finance:{payableCents:50000,paidCents:20000,payments:[]}};
 let state=projectPaymentHandoff(row,{},new Date('2026-10-11T16:10:00Z')).paymentHandoff;assert.equal(state.paymentDue,true);assert.equal(state.dueDays,0);
 row.finance.paidCents=50000;state=projectPaymentHandoff(row,{},new Date('2026-10-13T00:00:00Z')).paymentHandoff;assert.equal(state.paymentDue,false);
 row.finance.payableCents=null;state=projectPaymentHandoff(row,{},new Date('2026-10-13T00:00:00Z')).paymentHandoff;assert.equal(state.paymentDue,false);assert.equal(state.status,'PAYMENT_RECORDED');
});
test('changed cost or replacement documents invalidate paper review without acknowledging any proof',()=>{
 const row={company:'NCT',id:'P',contentVersion:'v',documents:[{fileId:'PI',type:'PI',linked:true,sha256:'OLD',declaredCents:50000}],finance:{payments:[],paidCents:0}};
 const details={paymentHandoff:{review:{version:paymentReviewVersion(row),stage:'REVIEWING',requestedCents:50000,paperReceived:true}}};assert.equal(projectPaymentHandoff(row,details).paymentHandoff.reviewStale,false);
 row.documents[0].sha256='NEW';assert.equal(projectPaymentHandoff(row,details).paymentHandoff.reviewStale,true);
});
