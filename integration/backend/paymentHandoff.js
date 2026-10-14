import { operationId } from 'backend/purchaseOperationJournal.js';
export function paymentReviewVersion(row){
 return operationId(row.company,row.id,row.contentVersion,row.documents.filter(doc=>doc.linked&&!doc.superseded&&['PI','SO','INV','CN'].includes(doc.type)).map(doc=>[doc.fileId,doc.sha256,doc.type,doc.number,doc.date,doc.declaredCents]).sort());
}
// Procurement confirmation is separate from payment proof and final settlement.
export function procurementSubmissionVersion(row){
 return operationId(row.company,row.id,row.number,row.supplierId,row.termDays,row.contentVersion,[...(row.taskIds||[])].sort(),paymentReviewVersion(row));
}
export function projectProcurementHandoff(row,details){
 const saved=details.procurementHandoff;
 if(!saved)return {stage:'LEGACY',submitted:false,editable:false,stale:false};
 const stages=['SUBMITTED','OWNED','RETURN_REQUESTED','PROCESSING','UNKNOWN','WITHDRAWN','RETURNED'];
 if(saved.schema!==1||!stages.includes(saved.stage)||!saved.submission?.version||!saved.submission?.byStaffId||!saved.submission?.at)throw Error('Procurement handoff requires review.');
 const stale=saved.submission.version!==procurementSubmissionVersion(row);
 return {...saved,submitted:!['WITHDRAWN','RETURNED'].includes(saved.stage),editable:['WITHDRAWN','RETURNED'].includes(saved.stage),stale};
}
export function transitionProcurementHandoff(row,details,input,identity,department){
 const current=projectProcurementHandoff(row,details),stage=current.stage,action=input.action;
 const purchase=['SUBMIT_FINANCE','WITHDRAW_FINANCE','REQUEST_RETURN'],account=['REVIEW_LEGACY','TAKE_OWNERSHIP','RETURN_PROCUREMENT','PAYMENT_PROCESSING','PAYMENT_UNKNOWN','PAYMENT_RESOLVED'];
 if(!(department==='PURCHASE'?purchase:department==='ACCOUNT'?account:[]).includes(action))throw Error('Procurement handoff action is not authorized.');
 if(!identity.byStaffId||!identity.by||!identity.at||!String(input.reason||'').trim())throw Error('Procurement handoff requires a staff identity and reason.');
 if(row.state==='HISTORY'||row.invoiceChecked===true)throw Error('Procurement handoff is protected by final Finance reconciliation.');
 let next;
 if(action==='REVIEW_LEGACY'){
  if(stage!=='LEGACY'||input.bankClear!==true||!row.supplierId||!row.number||!row.taskIds?.length||!Number.isFinite(row.amount)||row.amount<=0)throw Error('Procurement handoff requires Finance to reconcile the complete legacy order and bank status.');
  next={schema:1,stage:'OWNED',legacyReviewed:true,submission:{version:procurementSubmissionVersion(row),amountCents:Math.round(row.amount*100),...identity},ownership:identity};
 }else if(action==='SUBMIT_FINANCE'){
  if(!['LEGACY','WITHDRAWN','RETURNED'].includes(stage))throw Error('Procurement handoff is already submitted.');
  if(!row.supplierId||!row.number||!row.taskIds?.length||!Number.isFinite(row.amount)||row.amount<=0)throw Error('Procurement handoff requires a complete saved purchase order.');
  if(details.paymentHandoff?.review&&!['WITHDRAWN','RETURNED'].includes(stage))throw Error('Procurement handoff requires Finance to review the existing payment instruction.');
  if(input.urgent!==undefined&&typeof input.urgent!=='boolean')throw Error('Procurement handoff urgent selection is invalid.');
  next={schema:1,stage:'SUBMITTED',submission:{version:procurementSubmissionVersion(row),amountCents:Math.round(row.amount*100),...identity},previousSubmission:current.submission||null};
 }else if(action==='WITHDRAW_FINANCE'){
  if(stage!=='SUBMITTED')throw Error('Procurement handoff can only be withdrawn before Finance takes ownership.');
  next={...details.procurementHandoff,stage:'WITHDRAWN'};
 }else if(action==='REQUEST_RETURN'){
  if(!['OWNED','PROCESSING','UNKNOWN'].includes(stage))throw Error('Procurement handoff is not owned by Finance.');
  next={...details.procurementHandoff,returnRequested:{...identity,reason:input.reason},...(stage==='OWNED'?{stage:'RETURN_REQUESTED'}:{})};
 }else if(action==='TAKE_OWNERSHIP'){
  if(stage!=='SUBMITTED'||current.stale)throw Error('Procurement handoff changed. Refresh and request a current submission.');
  next={...details.procurementHandoff,stage:'OWNED',ownership:identity};
 }else if(action==='RETURN_PROCUREMENT'){
  if(!['OWNED','RETURN_REQUESTED'].includes(stage)||input.bankClear!==true)throw Error('Procurement handoff requires Finance to confirm no unresolved bank operation before return.');
  next={...details.procurementHandoff,stage:'RETURNED',bankClear:{...identity,reason:input.reason}};
 }else if(action==='PAYMENT_PROCESSING'){
  if(stage!=='OWNED'||current.stale||input.bankClear!==true)throw Error('Procurement handoff requires a current Finance-owned instruction and no unresolved bank operation.');
  const review=details.paymentHandoff?.review;
  if(!review||review.version!==paymentReviewVersion(row)||review.procurementVersion!==current.submission.version)throw Error('Procurement handoff requires a current payment review.');
  if(!(projectPaymentHandoff(row,details).paymentHandoff.instalmentBalanceCents>0))throw Error('Procurement handoff has no outstanding reviewed payment amount.');
  next={...details.procurementHandoff,stage:'PROCESSING',paymentStarted:identity,priorPaymentIds:(row.finance?.payments||[]).map(payment=>payment.id)};
 }else if(action==='PAYMENT_UNKNOWN'){
  if(stage!=='PROCESSING')throw Error('Procurement handoff has no payment processing to mark unknown.');
  next={...details.procurementHandoff,stage:'UNKNOWN'};
 }else{
  if(!['PROCESSING','UNKNOWN'].includes(stage)||input.bankClear!==true)throw Error('Procurement handoff requires the actual bank result to be reconciled.');
  if(!['NOT_PAID','RECORDED'].includes(input.outcome))throw Error('Procurement handoff requires a reconciled payment outcome.');
  if(input.outcome==='RECORDED'&&!(row.finance?.payments||[]).some(payment=>payment.id===input.paymentId&&!(current.priorPaymentIds||[]).includes(payment.id)&&payment.confirmed&&payment.proof?.linked&&payment.direction!=='REFUND'&&payment.at>=current.paymentStarted?.at))throw Error('Procurement handoff requires the actual payment proof for this processing attempt.');
  next={...details.procurementHandoff,stage:current.returnRequested?'RETURN_REQUESTED':'OWNED',bankResolution:{...identity,outcome:input.outcome,paymentId:input.paymentId||null,reason:input.reason}};
 }
 return {...next,updatedAt:identity.at,updatedBy:identity.by,updatedByStaffId:identity.byStaffId,reason:input.reason};
}
export function projectPaymentHandoff(row,details,now=new Date()){
 const saved=details.paymentHandoff||{},review=saved.review?.version===paymentReviewVersion(row)&&(!details.procurementHandoff||saved.review.procurementVersion===procurementSubmissionVersion(row)&&saved.review.procurementVersion===details.procurementHandoff.submission?.version)?saved.review:null;
 const payments=(row.finance?.payments||[]).filter(payment=>payment.confirmed&&payment.direction!=='REFUND'&&payment.proof?.linked),acknowledgements=saved.acknowledgements||[];
 const notices=payments.map(payment=>({paymentId:payment.id,reference:payment.reference,cents:payment.cents,at:payment.at,by:payment.by,acknowledgement:acknowledgements.find(entry=>entry.paymentId===payment.id&&entry.sha256===payment.proof.sha256)||null}));
 const paid=row.finance?.paidCents||0,finalKnown=row.finance?.payableCents!=null,requestedCents=row.finance?.payableCents??review?.requestedCents??null,balance=requestedCents===null?null:requestedCents-paid-(row.finance?.creditAppliedCents||0)+(finalKnown?0:(review?.paidAtReviewCents||0)+(review?.creditAtReviewCents||0)),today=new Date(now.getTime()+8*60*60*1000).toISOString().slice(0,10);
 const instalmentRemaining=review?review.requestedCents-paid-(row.finance?.creditAppliedCents||0)+(review.paidAtReviewCents||0)+(review.creditAtReviewCents||0):null,instalmentBalanceCents=instalmentRemaining===null?null:finalKnown?Math.min(instalmentRemaining,balance):instalmentRemaining;
 const dueDays=row.dueDate?Math.round((Date.parse(row.dueDate)-Date.parse(today))/86400000):null;
 const status=paid>0?(balance===null?'PAYMENT_RECORDED':balance<=0?(row.finance?.payableCents==null?'INSTALLMENT_PAID':'PAID'):'PARTLY_PAID'):review?.stage||'AWAITING_REVIEW';
 return {paymentHandoff:{review,reviewStale:Boolean(saved.review&&!review),requestedCents,balanceCents:balance,instalmentBalanceCents,status,notices,unreadCount:notices.filter(notice=>!notice.acknowledgement).length,dueDays,paymentDue:balance>0&&dueDays!==null&&dueDays<=0}};
}
