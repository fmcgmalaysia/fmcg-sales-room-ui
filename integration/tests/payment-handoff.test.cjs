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
test('paying a requested deposit does not mark the whole PO paid or invent a final balance',()=>{
 const row={company:'NCT',id:'P',contentVersion:'v',amount:10000,documents:[],finance:{payableCents:null,paidCents:500000,payments:[]}};
 const details={paymentHandoff:{review:{version:paymentReviewVersion(row),stage:'REVIEWING',requestedCents:500000}}};
 const state=projectPaymentHandoff(row,details).paymentHandoff;
 assert.equal(state.status,'INSTALLMENT_PAID');assert.equal(state.balanceCents,0);assert.equal(row.finance.payableCents,null);assert.equal(row.finance.paidCents,500000);
 row.finance.payableCents=1000000;assert.equal(projectPaymentHandoff(row,details).paymentHandoff.status,'PARTLY_PAID');
});
test('a second instalment excludes earlier deposits; final invoice remains the whole-order authority',()=>{
 const row={company:'NCT',id:'P',contentVersion:'v',documents:[],finance:{payableCents:null,paidCents:500000,creditAppliedCents:0,payments:[]}};
 const details={paymentHandoff:{review:{version:paymentReviewVersion(row),stage:'REVIEWING',requestedCents:500000,paidAtReviewCents:500000,creditAtReviewCents:0}}};
 assert.equal(projectPaymentHandoff(row,details).paymentHandoff.balanceCents,500000);
 row.finance.paidCents=700000;assert.equal(projectPaymentHandoff(row,details).paymentHandoff.balanceCents,300000);
 row.finance.paidCents=1000000;assert.equal(projectPaymentHandoff(row,details).paymentHandoff.status,'INSTALLMENT_PAID');
 row.finance.payableCents=900000;assert.equal(projectPaymentHandoff(row,details).paymentHandoff.balanceCents,-100000);
});
