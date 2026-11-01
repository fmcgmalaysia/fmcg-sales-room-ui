import { Buffer } from 'buffer';
import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { createHash } from 'crypto';
import { readSupportDocuments } from 'backend/supportDocuments.js';
import { CUSTOMER_ALLOCATION_ACTION, normalizeInvoiceAllocations, normalizeChargeLines, projectInvoicePayments, customerInvoiceFacts, readInvoiceAllocationStates } from 'backend/customerInvoicePayments.js';
export const CUSTOMER_ACCOUNT_ACTION='CUSTOMER_ACCOUNT_DOCUMENT_SAVED';
const text=value=>String(value??'').trim();
const types=['SALES_INV','SALES_CN','DEBIT_NOTE','CUSTOMER_RECEIPT','CHARGE_INV'];
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function readCustomerAccountDocuments(activity){
 const docs=activity.filter(row=>row.action===CUSTOMER_ACCOUNT_ACTION&&row.result==='SAVED').map(row=>row.details?.document);
 if(docs.some(row=>!row||!types.includes(row.type)||!['NCT','GHR'].includes(row.company)||!row.customerId||!row.id||!row.number||!validDate(row.date)||!Number.isSafeInteger(row.amountCents)||row.amountCents<=0||!(/^[A-Z]{3}$/).test(row.currency)||!row.fileId||!row.sha256)||new Set(docs.map(row=>row.id)).size!==docs.length)throw Error('Customer document ledger requires review.');
 for(const doc of docs.filter(row=>row.type==='CHARGE_INV'))if(!doc.confirmedByFinance||!doc.sourceDocumentId||normalizeChargeLines(doc.chargeLines).reduce((n,line)=>n+line.amountCents,0)!==doc.amountCents)throw Error('Charge invoice ledger requires review.');
 return docs;
}
export function customerAccountVersion({company,activity}){const matching=activity.filter(row=>row.action===CUSTOMER_ALLOCATION_ACTION&&row.result==='SAVED');return matching.length?operationId(company,readCustomerAccountDocuments(activity),readCustomerShipments(activity),readSupportDocuments(activity,company),matching):operationId(company,readCustomerAccountDocuments(activity),readCustomerShipments(activity),readSupportDocuments(activity,company));}
const accountType=(code,kind)=>code==='SI'&&kind==='CHARGE'?'CHARGE_INV':({'$':'CUSTOMER_RECEIPT',CN:'SALES_CN',DN:'DEBIT_NOTE'})[code];
const rejectConfirmation=message=>{const error=Error(message);error.code='CUSTOMER_ACCOUNT_REJECTED';throw error;};
export function readCustomerAccountEvidence({company,activity}){
 const posted=readCustomerAccountDocuments(activity).filter(row=>row.company===company);
 return readSupportDocuments(activity,company).filter(row=>accountType(row.code,row.invoiceKind)&&!row.superseded).map(source=>{
  const entry=posted.find(row=>row.sourceDocumentId===source.id||row.customerId===source.customerId&&row.type===accountType(source.code,source.invoiceKind)&&(row.fileId===source.fileId||row.sha256===source.sha256));
  return {sourceDocumentId:source.id,company,customerId:source.customerId,customerName:source.customerName||source.customerId,type:accountType(source.code,source.invoiceKind),...(source.chargeLines?{chargeLines:source.chargeLines}:{}),reference:source.reference,referenceCurrency:source.currency,referenceAmountCents:source.amountCents,uploadedAt:source.at,fileId:source.fileId,name:source.name,status:entry?'RECORDED':'AWAITING_REVIEW',...(entry?{accountDocumentId:entry.id,postedDate:entry.date,postedCurrency:entry.currency,postedAmountCents:entry.amountCents}:{} )};
 });
}
// This retained entry point only recovers an already committed historical Sales request.
// New customer uploads belong to Support; all new monetary postings belong to Finance.
export function createCustomerAccountOperations({store,names,readContext,documentService,now=()=>new Date()}){
 return async({company,staff,requestId,input})=>{
  const denied='Sales uploads are closed. Ask Support to upload the customer document.';
  if(!names[company]||!staff?.memberId||!staff.staffId||!staff.customerId||input?.action!=='DOCUMENT'||input.customerId!==staff.customerId||!types.includes(input.type)||!/^[a-f0-9-]{36}$/i.test(requestId||''))throw Error(denied);
  if(typeof input.base64!=='string'||input.base64.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw Error('Select a PDF up to 3 MiB.');
  const bytes=Buffer.from(input.base64,'base64');if(bytes.length<5||bytes.length>3*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.toString('base64')!==input.base64)throw Error('Select a valid PDF up to 3 MiB.');
  const sha256=createHash('sha256').update(bytes).digest('hex'),journalInput={...input,base64:undefined,sha256,size:bytes.length};
  const collection=names[company].activity,key=operationId(company+'/PURCHASE',requestId,staff.memberId),digest=operationId({customerDocument:journalInput});
  const prepared=await store.read(collection,key),result=await store.read(collection,operationId(key,'RESULT'));
  if(prepared?.details?.digest!==digest||!prepared.details.plan?.event?._id)throw Error(denied);
  const event=await store.read(collection,prepared.details.plan.event._id),document=event?.details?.document;
  if(!document||event.action!==CUSTOMER_ACCOUNT_ACTION||event.result!=='SAVED'||operationId(event.details)!==operationId(prepared.details.plan.event.details)||document.company!==company||document.customerId!==staff.customerId||document.sha256!==sha256)throw Error(denied);
  if(result&&(result.details?.digest!==digest||result.details?.outcome?.documentId!==event._id))throw Error('Original customer document receipt requires review.');
  return {ok:true,company,requestId,documentId:event._id};
 };
}
export function createFinanceCustomerAccountOperations({store,names,readContext,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 const allocationSave=async({company,staff,requestId,input})=>{
  if(!names[company]||staff?.canPostCustomerAccount!==true||typeof input.documentId!=='string'||!input.documentId||input.documentId.length>100||typeof input.customerId!=='string'||!input.customerId)throw Error('Finance invoice matching access is required.');
  const allocations=normalizeInvoiceAllocations(input.allocations),checkedInput={action:input.action,documentId:input.documentId,customerId:input.customerId,version:input.version,allocations};
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{financeInvoiceMatching:checkedInput},prepare:async()=>{
   const context=await readContext(company,staff),docs=readCustomerAccountDocuments(context.activity).filter(row=>row.company===company),doc=docs.find(row=>row.id===input.documentId&&row.customerId===input.customerId&&['CUSTOMER_RECEIPT','SALES_CN','DEBIT_NOTE'].includes(row.type));
   if(context.company!==company||!doc)rejectConfirmation('The posted customer document is unavailable.');
   if(input.version!==customerAccountVersion(context))rejectConfirmation('Invoice matching changed. Refresh before confirming.');
   const state=readInvoiceAllocationStates(docs,context.activity,company).get(doc.id),id=operationId(company,requestId,staff.memberId,'CUSTOMER_INVOICE_MATCHING'),at=now().toISOString();
   if(operationId(state.allocations)===operationId(allocations))return {unchanged:true,documentId:doc.id};
   const event={_id:id,title:id,description:doc.id,action:CUSTOMER_ALLOCATION_ACTION,result:'SAVED',activityTime:at,actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Finance updated invoice matching',details:{company,requestId,customerId:doc.customerId,beforeRevision:state.revision,allocations}};
   projectInvoicePayments({company,documents:docs,invoices:customerInvoiceFacts(company,readCustomerShipments(context.activity),docs),activity:context.activity.concat(event)});
   return {expectedVersion:customerAccountVersion(context),event};
  },apply:async plan=>{
   if(plan.unchanged)return {ok:true,company,requestId,documentId:plan.documentId,matching:true};
   const collection=names[company].activity,prior=await store.read(collection,plan.event._id);
   if(!prior){if(customerAccountVersion(await readContext(company,staff))!==plan.expectedVersion)rejectConfirmation('Invoice matching changed while confirming. Refresh before saving.');await store.insert(collection,{...plan.event,activityTime:new Date(plan.event.activityTime)});}
   else if(operationId(prior.details)!==operationId(plan.event.details))throw Error('Invoice matching receipt requires review.');
   return {ok:true,company,requestId,documentId:plan.event.description,matching:true};
  }});
 };
 return async({company,staff,requestId,input})=>{
  if(input?.action==='ALLOCATE_DOCUMENT')return allocationSave({company,staff,requestId,input});
  if(!names[company]||staff?.canPostCustomerAccount!==true||input?.action!=='CONFIRM_DOCUMENT'||typeof input.sourceDocumentId!=='string'||!input.sourceDocumentId||input.sourceDocumentId.length>100||typeof input.customerId!=='string'||!input.customerId||input.customerId.length>100)throw Error('Finance customer-account access is required.');
  const number=text(input.number),currency=text(input.currency).toUpperCase(),reason=text(input.reason);
  if(!number||number.length>100||!validDate(input.date)||!Number.isSafeInteger(input.amountCents)||input.amountCents<=0||input.amountCents>999999999999||!(/^[A-Z]{3}$/).test(currency)||reason.length>2000)throw Error('Enter the actual document number, date, currency and positive amount.');
  const allocations=input.allocations===undefined?undefined:normalizeInvoiceAllocations(input.allocations);
  const chargeLines=input.chargeLines===undefined?undefined:normalizeChargeLines(input.chargeLines);
  const existingDebitNoteId=text(input.existingDebitNoteId);
  if(existingDebitNoteId.length>100)throw Error('Select a valid existing debit note.');
  const checkedInput={action:input.action,sourceDocumentId:input.sourceDocumentId,customerId:input.customerId,version:input.version,number,date:input.date,currency,amountCents:input.amountCents,reason,...(allocations?{allocations}:{}),...(chargeLines?{chargeLines}:{}),...(existingDebitNoteId?{existingDebitNoteId}:{})};
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{financeCustomerDocument:checkedInput},prepare:async()=>{
   const context=await readContext(company,staff),docs=readCustomerAccountDocuments(context.activity).filter(row=>row.company===company);
   if(context.company!==company)throw Error('Customer company could not be confirmed.');
   const source=readSupportDocuments(context.activity,company).find(row=>row.id===input.sourceDocumentId&&row.customerId===input.customerId&&accountType(row.code,row.invoiceKind)&&!row.superseded);
   if(!source)rejectConfirmation('The Support document is unavailable.');
   const existing=docs.find(row=>row.sourceDocumentId===source.id);
   if(existing){if(existing.number!==number||existing.date!==input.date||existing.currency!==currency||existing.amountCents!==input.amountCents||allocations&&operationId(existing.allocations||[])!==operationId(allocations)||chargeLines&&operationId(existing.chargeLines)!==operationId(chargeLines))throw Error('This document is already recorded. Its posted amount cannot be overwritten.');return {existingId:existing.id};}
   if(input.version!==customerAccountVersion(context))rejectConfirmation('Customer ledger or evidence changed. Refresh before confirming.');
   if(docs.some(row=>row.fileId===source.fileId||row.sha256===source.sha256||row.type===accountType(source.code,source.invoiceKind)&&row.number.toUpperCase()===number.toUpperCase()))rejectConfirmation('This proof or document reference is already recorded. Review the existing entry.');
   const id=operationId(company,'SUPPORT_ACCOUNT_POSTING',source.id),at=now().toISOString();
   const document={id,company,customerId:source.customerId,customerName:source.customerName||source.customerId,type:accountType(source.code,source.invoiceKind),number,date:input.date,currency,amountCents:input.amountCents,reason,shipmentId:source.invoiceId||'',fileId:source.fileId,sha256:source.sha256,size:source.size,name:source.name,at,by:staff.staffName,byStaffId:staff.staffId,url:'https://drive.google.com/file/d/'+source.fileId+'/view',sourceDocumentId:source.id,referenceAmountCents:source.amountCents,referenceCurrency:source.currency,sourceUploadedAt:source.at,confirmedByFinance:true};
   if(document.type==='CHARGE_INV'){
    if(existingDebitNoteId||docs.some(row=>row.type==='DEBIT_NOTE'&&row.customerId===source.customerId&&row.currency===currency&&[number.toUpperCase(),source.reference.toUpperCase()].includes(row.number.toUpperCase())))rejectConfirmation('This charge is already represented by a debit note. Keep the existing posting; do not create a second receivable.');
    if(allocations?.length)rejectConfirmation('Match incoming payments after the charge invoice is confirmed.');
    document.chargeLines=chargeLines||normalizeChargeLines(source.chargeLines);
    if(document.chargeLines.reduce((n,line)=>n+line.amountCents,0)!==document.amountCents)rejectConfirmation('Finance charge lines must equal the actual invoice amount.');
    if(customerInvoiceFacts(company,readCustomerShipments(context.activity),docs).some(row=>row.number.toUpperCase()===number.toUpperCase()))rejectConfirmation('This invoice number is already issued.');
   }else if(chargeLines)rejectConfirmation('Charge lines belong only to a charge invoice.');
   if(allocations)document.allocations=allocations;
   projectInvoicePayments({company,documents:docs.concat(document),invoices:customerInvoiceFacts(company,readCustomerShipments(context.activity),docs.concat(document)),activity:context.activity});
   return {expectedVersion:customerAccountVersion(context),event:{_id:id,title:id,description:source.id,image:source.customerId,action:CUSTOMER_ACCOUNT_ACTION,result:'SAVED',activityTime:at,actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:reason||'Finance recorded customer document',details:{document}}};
  },apply:async plan=>{
   if(plan.existingId)return {ok:true,company,requestId,documentId:plan.existingId,alreadyRecorded:true};
   const collection=names[company].activity,prior=await store.read(collection,plan.event._id);
   if(!prior){if(customerAccountVersion(await readContext(company,staff))!==plan.expectedVersion)rejectConfirmation('Customer ledger or evidence changed while confirming. Refresh and review the updated record.');await store.insert(collection,{...plan.event,activityTime:new Date(plan.event.activityTime)});}
   else if(operationId(prior.details)!==operationId(plan.event.details))throw Error('Customer confirmation receipt requires review.');
   return {ok:true,company,requestId,documentId:plan.event._id};
  }});
 };
}
