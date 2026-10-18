import { operationId } from 'backend/purchaseOperationJournal.js';
export function paymentReviewVersion(row){
 return operationId(row.company,row.id,row.contentVersion,row.documents.filter(doc=>doc.linked&&!doc.superseded&&['PI','SO','INV','CN'].includes(doc.type)).map(doc=>[doc.fileId,doc.sha256,doc.type,doc.number,doc.date,doc.declaredCents]).sort());
}
// One current request per PO; cash and transferred credit are deducted once at PO level.
export function paymentRequestQuote(row,creditNotes=[]){
 const docs=(row.documents||[]).filter(doc=>doc.linked===true&&!doc.superseded&&doc.fileId&&(!doc.contentVersion||doc.contentVersion===row.contentVersion));
 const invoices=docs.filter(doc=>doc.type==='INV'),bases=invoices.length?invoices:docs.filter(doc=>['PI','SO'].includes(doc.type));
 const valid=value=>Number.isSafeInteger(value)&&value>=0&&value<=999999999999;
 const amount=doc=>{const confirmed=(row.finance?.amounts||[]).filter(entry=>entry.fileId===doc.fileId&&entry.sha256===doc.sha256);return confirmed.length===1?confirmed[0].cents:doc.declaredCents;};
 if(!docs.some(doc=>doc.type==='PO')||!bases.length)throw Error('Payment request requires Our PO and supplier PI or Invoice.');
 if(new Set(docs.map(doc=>doc.fileId)).size!==docs.length||new Set(bases.filter(doc=>doc.sha256).map(doc=>doc.sha256)).size!==bases.filter(doc=>doc.sha256).length)throw Error('Payment request contains duplicate documents.');
 if(!invoices.length&&bases.length!==1)throw Error('Payment request requires one current PI or SO; supersede replaced versions first.');
 if(bases.some(doc=>!valid(amount(doc))||amount(doc)===0))throw Error('Payment request requires the recorded amount of every supporting document.');
 const credits=docs.filter(doc=>doc.type==='CN');
 if(!Array.isArray(creditNotes)||creditNotes.length!==credits.length||new Set(creditNotes.map(item=>item.fileId)).size!==credits.length)throw Error('Payment request requires a decision for every current CN.');
 const allocations=credits.map(doc=>{
  const item=creditNotes.find(item=>item.fileId===doc.fileId),confirmed=(row.finance?.amounts||[]).find(entry=>entry.fileId===doc.fileId&&entry.sha256===doc.sha256);
  if(!item||!bases.some(base=>base.fileId===item.basisFileId)||!['DEDUCT','ALREADY_INCLUDED'].includes(item.treatment)||!valid(amount(doc)))throw Error('Payment request requires a valid CN amount, document association and treatment.');
  if(confirmed?.treatment&&confirmed.treatment!==item.treatment)throw Error('Payment request CN treatment differs from Account reconciliation.');
  return {fileId:doc.fileId,sha256:doc.sha256,number:doc.number,basisFileId:item.basisFileId,treatment:item.treatment,cents:amount(doc),confirmed:Boolean(confirmed?.byStaffId&&confirmed?.at&&confirmed.treatment===item.treatment)};
 });
 const documentCents=bases.reduce((sum,doc)=>sum+amount(doc),0),cnCents=allocations.reduce((sum,item)=>sum+(item.treatment==='DEDUCT'?item.cents:0),0),paidCents=row.finance?.paidCents,creditAppliedCents=row.finance?.creditAppliedCents??0;
 if(!valid(paidCents)||!valid(creditAppliedCents)||!valid(documentCents)||!valid(cnCents))throw Error('Payment request amounts or payment records require Account review.');
 const netCents=documentCents-cnCents-paidCents-creditAppliedCents;
 return {documentCents,cnCents,paidCents,creditAppliedCents,availableCents:Math.max(0,netCents),creditBalanceCents:Math.max(0,-netCents),documents:bases.map(doc=>({fileId:doc.fileId,sha256:doc.sha256,type:doc.type,number:doc.number,cents:amount(doc)})),creditNotes:allocations,cnPending:allocations.some(item=>!item.confirmed)};
}
// Procurement confirmation is separate from payment proof and final settlement.
export function procurementSubmissionVersion(row){
 return operationId(row.company,row.id,row.number,row.supplierId,row.termDays,row.contentVersion,[...(row.taskIds||[])].sort(),paymentReviewVersion(row),...(row.paymentRequestRevision?[row.paymentRequestRevision]:[]));
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
 const purchase=['REQUEST_PAYMENT','SUBMIT_FINANCE','WITHDRAW_FINANCE','REQUEST_RETURN'],account=['REVIEW_LEGACY','TAKE_OWNERSHIP','RETURN_PROCUREMENT','PAYMENT_PROCESSING','PAYMENT_UNKNOWN','PAYMENT_RESOLVED'];
 if(!(department==='PURCHASE'?purchase:department==='ACCOUNT'?account:[]).includes(action))throw Error('Procurement handoff action is not authorized.');
 if(!identity.byStaffId||!identity.by||!identity.at||!String(input.reason||'').trim())throw Error('Procurement handoff requires a staff identity and reason.');
 if(row.state==='HISTORY'||row.invoiceChecked===true)throw Error('Procurement handoff is protected by final Finance reconciliation.');
 let next;
 if(action==='REVIEW_LEGACY'){
  if(stage!=='LEGACY'||input.bankClear!==true||!row.supplierId||!row.number||!row.taskIds?.length||!Number.isFinite(row.amount)||row.amount<=0)throw Error('Procurement handoff requires Finance to reconcile the complete legacy order and bank status.');
  next={schema:1,stage:'OWNED',legacyReviewed:true,submission:{version:procurementSubmissionVersion(row),amountCents:Math.round(row.amount*100),...identity},ownership:identity};
 }else if(action==='REQUEST_PAYMENT'){
  if(!['LEGACY','WITHDRAWN','RETURNED','SUBMITTED'].includes(stage)||stage==='SUBMITTED'&&(!current.submission?.paymentRequest||current.ownership)||details.paymentHandoff?.review&&stage!=='RETURNED')throw Error('Payment request is locked by Account.');
  if(!row.supplierId||!row.number||!row.taskIds?.length||!row.paymentRequestRevision)throw Error('Payment request requires a complete saved PO.');
  if(!['FULL','DEPOSIT','PART','BALANCE'].includes(input.purpose)||![0,7,14,30,45,60,90].includes(input.termDays))throw Error('Payment request purpose or terms are invalid.');
  const quote=paymentRequestQuote(row,input.creditNotes||[]);
  if(!quote.documents.some(doc=>doc.fileId===input.basisFileId)||!Number.isSafeInteger(input.requestedCents)||input.requestedCents<=0||input.requestedCents>quote.availableCents||['FULL','BALANCE'].includes(input.purpose)&&input.requestedCents!==quote.availableCents)throw Error('Payment request amount must match the available balance or a valid partial amount.');
  const paymentRequest={...quote,requestedCents:input.requestedCents,purpose:input.purpose,basisFileId:input.basisFileId,termDays:input.termDays};
  next={schema:1,stage:'SUBMITTED',submission:{version:procurementSubmissionVersion(row),amountCents:Math.round(row.amount*100),paymentRequest,...identity},previousSubmission:current.submission||null};
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
  if(current.submission?.paymentRequest){const request=current.submission.paymentRequest,quote=paymentRequestQuote(row,request.creditNotes);if(quote.cnPending||quote.availableCents<Math.max(0,request.requestedCents-(quote.paidCents-request.paidCents)-(quote.creditAppliedCents-request.creditAppliedCents)))throw Error('Payment request CN or available balance requires Account reconciliation.');}
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
 const payments=(row.finance?.payments||[]).filter(payment=>payment.confirmed&&payment.direction!=='REFUND'&&(payment.proofs||[payment.proof]).some(proof=>proof?.linked&&!payment.deletedProofs?.some(d=>d.fileId===proof.fileId))),acknowledgements=saved.acknowledgements||[];
 const notices=payments.map(payment=>({paymentId:payment.id,reference:payment.reference,cents:payment.cents,at:payment.at,by:payment.by,acknowledgement:acknowledgements.find(entry=>entry.paymentId===payment.id&&entry.sha256===payment.proof.sha256)||null}));
 const paid=row.finance?.paidCents||0,finalKnown=row.finance?.payableCents!=null,requestedCents=row.finance?.payableCents??review?.requestedCents??null,balance=requestedCents===null?null:requestedCents-paid-(row.finance?.creditAppliedCents||0)+(finalKnown?0:(review?.paidAtReviewCents||0)+(review?.creditAtReviewCents||0)),today=new Date(now.getTime()+8*60*60*1000).toISOString().slice(0,10);
 const instalmentRemaining=review?review.requestedCents-paid-(row.finance?.creditAppliedCents||0)+(review.paidAtReviewCents||0)+(review.creditAtReviewCents||0):null,instalmentBalanceCents=instalmentRemaining===null?null:finalKnown?Math.min(instalmentRemaining,balance):instalmentRemaining;
 const dueDays=row.dueDate?Math.round((Date.parse(row.dueDate)-Date.parse(today))/86400000):null;
 const status=paid>0?(balance===null?'PAYMENT_RECORDED':balance<=0?(row.finance?.payableCents==null?'INSTALLMENT_PAID':'PAID'):'PARTLY_PAID'):review?.stage||'AWAITING_REVIEW';
 return {paymentHandoff:{review,reviewStale:Boolean(saved.review&&!review),requestedCents,balanceCents:balance,instalmentBalanceCents,status,notices,unreadCount:notices.filter(notice=>!notice.acknowledgement).length,dueDays,paymentDue:balance>0&&dueDays!==null&&dueDays<=0}};
}
