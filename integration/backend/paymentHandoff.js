import { operationId } from 'backend/purchaseOperationJournal.js';
export function paymentReviewVersion(row){
 return operationId(row.company,row.id,row.contentVersion,row.documents.filter(doc=>doc.linked&&!doc.superseded&&['PI','SO','INV','CN'].includes(doc.type)).map(doc=>[doc.fileId,doc.sha256,doc.type,doc.number,doc.date,doc.declaredCents]).sort());
}
export function projectPaymentHandoff(row,details,now=new Date()){
 const saved=details.paymentHandoff||{},review=saved.review?.version===paymentReviewVersion(row)?saved.review:null;
 const payments=(row.finance?.payments||[]).filter(payment=>payment.confirmed&&payment.direction!=='REFUND'&&payment.proof?.linked),acknowledgements=saved.acknowledgements||[];
 const notices=payments.map(payment=>({paymentId:payment.id,reference:payment.reference,cents:payment.cents,at:payment.at,by:payment.by,acknowledgement:acknowledgements.find(entry=>entry.paymentId===payment.id&&entry.sha256===payment.proof.sha256)||null}));
 const paid=row.finance?.paidCents||0,requestedCents=row.finance?.payableCents??review?.requestedCents??null,balance=requestedCents===null?null:requestedCents-paid-(row.finance?.creditAppliedCents||0),today=new Date(now.getTime()+8*60*60*1000).toISOString().slice(0,10);
 const dueDays=row.dueDate?Math.round((Date.parse(row.dueDate)-Date.parse(today))/86400000):null;
 const status=paid>0?(balance===null?'PAYMENT_RECORDED':balance<=0?'PAID':'PARTLY_PAID'):review?.stage||'AWAITING_REVIEW';
 return {paymentHandoff:{review,reviewStale:Boolean(saved.review&&!review),requestedCents,balanceCents:balance,status,notices,unreadCount:notices.filter(notice=>!notice.acknowledgement).length,dueDays,paymentDue:balance>0&&dueDays!==null&&dueDays<=0}};
}
