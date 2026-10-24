import { Buffer } from 'buffer';
import { operationId, createOperationJournal } from 'backend/r2purchaseOperationJournal.js';
import { readCustomerShipments } from 'backend/r2customerShipmentLedger.js';
import { createHash } from 'crypto';
export const CUSTOMER_ACCOUNT_ACTION='CUSTOMER_ACCOUNT_DOCUMENT_SAVED';
const text=value=>String(value??'').trim();
const types=['SALES_INV','SALES_CN','DEBIT_NOTE','CUSTOMER_RECEIPT'];
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function readCustomerAccountDocuments(activity){
 const docs=activity.filter(row=>row.action===CUSTOMER_ACCOUNT_ACTION&&row.result==='SAVED').map(row=>row.details?.document);
 if(docs.some(row=>!row||!types.includes(row.type)||!['NCT','GHR'].includes(row.company)||!row.customerId||!row.id||!row.number||!validDate(row.date)||!Number.isSafeInteger(row.amountCents)||row.amountCents<=0||!(/^[A-Z]{3}$/).test(row.currency)||!row.fileId||!row.sha256)||new Set(docs.map(row=>row.id)).size!==docs.length)throw Error('Customer document ledger requires review.');
 return docs;
}
export function customerAccountVersion({company,activity}){return operationId(company,readCustomerAccountDocuments(activity),readCustomerShipments(activity));}
export function createCustomerAccountOperations({store,names,readContext,documentService,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  if(!names[company]||staff?.canUploadCustomerDocument!==true||input?.action!=='DOCUMENT'||!types.includes(input.type))throw Error('Customer document upload is not authorized.');
  if(typeof input.base64!=='string'||input.base64.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw Error('Select a PDF up to 3 MiB.');
  const bytes=Buffer.from(input.base64,'base64');if(bytes.length<5||bytes.length>3*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.toString('base64')!==input.base64)throw Error('Select a valid PDF up to 3 MiB.');
  const sha256=createHash('sha256').update(bytes).digest('hex'),journalInput={...input,base64:undefined,sha256,size:bytes.length};
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{customerDocument:journalInput},prepare:async()=>{
   const context=await readContext(company,staff),docs=readCustomerAccountDocuments(context.activity),shipments=readCustomerShipments(context.activity);
   if(context.company!==company||input.version!==customerAccountVersion(context))throw Error('Customer ledger changed. Refresh before saving.');
   const customer=context.customers.find(row=>row.id===input.customerId);if(!customer||staff.customerId&&staff.customerId!==customer.id)throw Error('Customer is not authorized.');
   const number=text(input.number),currency=text(input.currency).toUpperCase(),reason=text(input.reason);
   if(!number||number.length>100||!validDate(input.date)||!Number.isSafeInteger(input.amountCents)||input.amountCents<=0||input.amountCents>999999999999||!(/^[A-Z]{3}$/).test(currency)||!reason||reason.length>2000)throw Error('Enter document number, date, currency, amount and reason.');
   if(docs.some(row=>row.company===company&&((row.type===input.type&&row.number.toUpperCase()===number.toUpperCase())||row.sha256===sha256)))throw Error('This customer document or PDF is already recorded.');
   let shipmentId='';
   if(input.type==='SALES_INV'){
    const shipment=shipments.find(row=>row.id===input.shipmentId&&row.company===company&&row.customerId===customer.id&&['INVOICED','DISPATCHED'].includes(row.status));
    if(!shipment||shipment.invoice.number!==number||shipment.invoice.currency!==currency||shipment.invoice.amountCents!==input.amountCents||shipment.invoice.date!==input.date)throw Error('Sales Invoice document must match the invoice entered by Support.');
    if(docs.some(row=>row.type==='SALES_INV'&&row.shipmentId===shipment.id))throw Error('Sales Invoice PDF is already attached.');shipmentId=shipment.id;
   }
   const id=operationId(company,requestId,staff.memberId,'CUSTOMER_DOCUMENT'),allocated=await documentService({action:'ALLOCATE',company});
   if(!/^[A-Za-z0-9_-]{10,200}$/.test(allocated.fileId||''))throw Error('Document identity could not be confirmed.');
   const clean=value=>text(value).replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,90),name=input.date+' '+clean(customer.name||customer.id)+' '+input.type+' '+clean(number)+'.pdf',at=now().toISOString();
   const document={id,company,customerId:customer.id,customerName:customer.name||customer.id,type:input.type,number,date:input.date,currency,amountCents:input.amountCents,reason,shipmentId,fileId:allocated.fileId,sha256,size:bytes.length,name,at,by:staff.staffName,byStaffId:staff.staffId,url:'https://drive.google.com/file/d/'+allocated.fileId+'/view'};
   return {expectedVersion:customerAccountVersion(context),upload:{action:'UPLOAD',company,department:'SALES',type:input.type,poId:id,fileId:allocated.fileId,name,sha256},event:{_id:id,title:id,description:id,image:customer.id,action:CUSTOMER_ACCOUNT_ACTION,result:'SAVED',activityTime:at,actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:reason,details:{document}}};
  },apply:async plan=>{
   const collection=names[company].activity,prior=await store.read(collection,plan.event._id);
   if(!prior){if(customerAccountVersion(await readContext(company,staff))!==plan.expectedVersion)throw Error('Customer ledger changed while saving.');const receipt=await documentService({...plan.upload,base64:input.base64});if(receipt.ok!==true||['fileId','company','poId','sha256','name'].some(key=>receipt[key]!==plan.upload[key]))throw Error('Customer document upload receipt mismatch.');await store.insert(collection,{...plan.event,activityTime:new Date(plan.event.activityTime)});}
   else if(operationId(prior.details)!==operationId(plan.event.details))throw Error('Customer document receipt conflict.');
   return {ok:true,company,requestId,documentId:plan.event._id};
  }});
 };
}
