import { Buffer } from 'buffer';
import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { createHash } from 'crypto';
import { readSupportDocuments } from 'backend/supportDocuments.js';
export const CUSTOMER_ACCOUNT_ACTION='CUSTOMER_ACCOUNT_DOCUMENT_SAVED';
const text=value=>String(value??'').trim();
const types=['SALES_INV','SALES_CN','DEBIT_NOTE','CUSTOMER_RECEIPT'];
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function readCustomerAccountDocuments(activity){
 const docs=activity.filter(row=>row.action===CUSTOMER_ACCOUNT_ACTION&&row.result==='SAVED').map(row=>row.details?.document);
 if(docs.some(row=>!row||!types.includes(row.type)||!['NCT','GHR'].includes(row.company)||!row.customerId||!row.id||!row.number||!validDate(row.date)||!Number.isSafeInteger(row.amountCents)||row.amountCents<=0||!(/^[A-Z]{3}$/).test(row.currency)||!row.fileId||!row.sha256)||new Set(docs.map(row=>row.id)).size!==docs.length)throw Error('Customer document ledger requires review.');
 return docs;
}
export function customerAccountVersion({company,activity}){return operationId(company,readCustomerAccountDocuments(activity),readCustomerShipments(activity),readSupportDocuments(activity,company));}
const accountType=code=>({'$':'CUSTOMER_RECEIPT',CN:'SALES_CN',DN:'DEBIT_NOTE'})[code];
const rejectConfirmation=message=>{const error=Error(message);error.code='CUSTOMER_ACCOUNT_REJECTED';throw error;};
export function readCustomerAccountEvidence({company,activity}){
 const posted=readCustomerAccountDocuments(activity).filter(row=>row.company===company);
 return readSupportDocuments(activity,company).filter(row=>accountType(row.code)&&!row.superseded).map(source=>{
  const entry=posted.find(row=>row.sourceDocumentId===source.id||row.customerId===source.customerId&&row.type===accountType(source.code)&&(row.fileId===source.fileId||row.sha256===source.sha256));
  return {sourceDocumentId:source.id,company,customerId:source.customerId,customerName:source.customerName||source.customerId,type:accountType(source.code),reference:source.reference,referenceCurrency:source.currency,referenceAmountCents:source.amountCents,uploadedAt:source.at,fileId:source.fileId,name:source.name,status:entry?'RECORDED':'AWAITING_REVIEW',...(entry?{accountDocumentId:entry.id,postedDate:entry.date,postedCurrency:entry.currency,postedAmountCents:entry.amountCents}:{} )};
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
 return async({company,staff,requestId,input})=>{
  if(!names[company]||staff?.canPostCustomerAccount!==true||input?.action!=='CONFIRM_DOCUMENT'||typeof input.sourceDocumentId!=='string'||!input.sourceDocumentId||input.sourceDocumentId.length>100||typeof input.customerId!=='string'||!input.customerId||input.customerId.length>100)throw Error('Finance customer-account access is required.');
  const number=text(input.number),currency=text(input.currency).toUpperCase(),reason=text(input.reason);
  if(!number||number.length>100||!validDate(input.date)||!Number.isSafeInteger(input.amountCents)||input.amountCents<=0||input.amountCents>999999999999||!(/^[A-Z]{3}$/).test(currency)||reason.length>2000)throw Error('Enter the actual document number, date, currency and positive amount.');
  const checkedInput={action:input.action,sourceDocumentId:input.sourceDocumentId,customerId:input.customerId,version:input.version,number,date:input.date,currency,amountCents:input.amountCents,reason};
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{financeCustomerDocument:checkedInput},prepare:async()=>{
   const context=await readContext(company,staff),docs=readCustomerAccountDocuments(context.activity).filter(row=>row.company===company);
   if(context.company!==company)throw Error('Customer company could not be confirmed.');
   const source=readSupportDocuments(context.activity,company).find(row=>row.id===input.sourceDocumentId&&row.customerId===input.customerId&&accountType(row.code)&&!row.superseded);
   if(!source)rejectConfirmation('The Support document is unavailable.');
   const existing=docs.find(row=>row.sourceDocumentId===source.id);
   if(existing){if(existing.number!==number||existing.date!==input.date||existing.currency!==currency||existing.amountCents!==input.amountCents)throw Error('This document is already recorded. Its posted amount cannot be overwritten.');return {existingId:existing.id};}
   if(input.version!==customerAccountVersion(context))rejectConfirmation('Customer ledger or evidence changed. Refresh before confirming.');
   if(docs.some(row=>row.fileId===source.fileId||row.sha256===source.sha256||row.type===accountType(source.code)&&row.number.toUpperCase()===number.toUpperCase()))rejectConfirmation('This proof or document reference is already recorded. Review the existing entry.');
   const id=operationId(company,'SUPPORT_ACCOUNT_POSTING',source.id),at=now().toISOString();
   const document={id,company,customerId:source.customerId,customerName:source.customerName||source.customerId,type:accountType(source.code),number,date:input.date,currency,amountCents:input.amountCents,reason,shipmentId:source.invoiceId||'',fileId:source.fileId,sha256:source.sha256,size:source.size,name:source.name,at,by:staff.staffName,byStaffId:staff.staffId,url:'https://drive.google.com/file/d/'+source.fileId+'/view',sourceDocumentId:source.id,referenceAmountCents:source.amountCents,referenceCurrency:source.currency,sourceUploadedAt:source.at,confirmedByFinance:true};
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
