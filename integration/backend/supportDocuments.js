import { Buffer } from 'buffer';
import { createHash } from 'crypto';
import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
const ACTION='SUPPORT_DOCUMENT_UPLOADED',codes=['BC','SI','DO','CN','PL','INS','CF','$'];
const typeFor=code=>'SUPPORT_'+(code==='$'?'PAYMENT':code);
const text=value=>String(value??'').trim();
export function readSupportDocuments(activity,company){
 if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');
 const docs=activity.filter(row=>row.action===ACTION&&row.result==='SAVED').map(row=>row.details?.document);
 if(docs.some(d=>!d||d.company!==company||!d.id||!d.customerId||!d.orderId||!codes.includes(d.code)||!['ORDER','INVOICE'].includes(d.scope)||d.scope==='INVOICE'&&!d.invoiceId||!/^[A-Za-z0-9_-]{10,200}$/.test(d.fileId||'')||!/^[a-f0-9]{64}$/.test(d.sha256||'')||!Number.isFinite(Date.parse(d.at))||!d.byStaffId||!d.name||!Number.isSafeInteger(d.size)||d.size<=0||d.size>3*1024*1024||!Number.isSafeInteger(d.amountCents)||d.amountCents<0)||new Set(docs.map(d=>d.id)).size!==docs.length)throw Error('Support document history requires review.');
 return docs;
}
export function supportDocumentVersion(context){return operationId(context.company,readSupportDocuments(context.activity,context.company));}
// Support attachments record evidence only. Payment slips and customer CNs do not post Finance reconciliation.
export function createSupportDocumentOperations({store,names,readContext,documentService,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  if(!['NCT','GHR'].includes(company)||!names[company]||staff?.packingDepartment!=='SUPPORT'||!input||!codes.includes(input.code)||!['ORDER','INVOICE'].includes(input.scope)||typeof input.orderId!=='string'||!input.orderId||input.orderId.length>100||typeof input.customerId!=='string'||!input.customerId||input.customerId.length>100)throw Error('Support document access is required.');
  if(typeof input.base64!=='string'||input.base64.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw Error('Select a PDF up to 3 MiB.');
  const bytes=Buffer.from(input.base64,'base64');if(bytes.length<5||bytes.length>3*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.toString('base64')!==input.base64)throw Error('Select a valid PDF up to 3 MiB.');
  const sha256=createHash('sha256').update(bytes).digest('hex'),safeInput={...input,base64:undefined,sha256,size:bytes.length};
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{supportDocument:safeInput},prepare:async()=>{
   const context=await readContext(company,staff),docs=readSupportDocuments(context.activity,company);
   if(context.company!==company||input.version!==supportDocumentVersion(context))throw Error('Documents changed. Refresh before uploading.');
   const tasks=context.tasks.filter(row=>row.customerId===input.customerId&&row.orderId===input.orderId&&!row.specialPurchase&&!row.procurementSource),customer=context.customers.find(row=>row.id===input.customerId);
   if(!tasks.length||!customer)throw Error('This customer order is unavailable.');
   const invoice=input.scope==='INVOICE'?readCustomerShipments(context.activity).find(row=>row.id===input.invoiceId&&row.customerId===input.customerId&&row.company===company&&row.invoice&&row.lines.some(line=>line.orderId===input.orderId)):null;
   if(input.scope==='INVOICE'&&!invoice||input.code==='SI'&&!invoice)throw Error('Issue the Sales Invoice before attaching its PDF.');
   const currencies=new Set(tasks.map(row=>row.transactionCurrency));if(currencies.size!==1||!(/^[A-Z]{3}$/).test([...currencies][0]||''))throw Error('Order currency requires review.');
   const reference=invoice&&input.code==='SI'?invoice.invoice.number:text(input.reference);
   if(reference.length>100||['$','CN'].includes(input.code)&&!reference||!Number.isSafeInteger(input.amountCents)||input.amountCents<0||input.amountCents>999999999999||['$','CN'].includes(input.code)&&input.amountCents<=0)throw Error('Enter the document reference and a positive amount.');
   const invoiceId=invoice?.id||'';
   if(docs.some(d=>d.code===input.code&&d.scope===input.scope&&d.customerId===input.customerId&&d.orderId===input.orderId&&d.invoiceId===invoiceId&&d.sha256===sha256))throw Error('This PDF is already attached to the order.');
   const id=operationId(company,requestId,staff.memberId,ACTION),allocated=await documentService({action:'ALLOCATE',company});
   if(!/^[A-Za-z0-9_-]{10,200}$/.test(allocated?.fileId||''))throw Error('File allocation is not confirmed.');
   const at=now().toISOString(),clean=value=>text(value).replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,80),name=at.slice(0,10)+' '+clean(customer.name)+' '+(input.code==='$'?'PAYMENT':input.code)+' '+clean(reference||input.orderId)+'.pdf';
   const document={id,company,customerId:input.customerId,customerName:customer.name,orderId:input.orderId,scope:input.scope,invoiceId,code:input.code,reference,currency:[...currencies][0],amountCents:input.code==='SI'?invoice.invoice.amountCents:input.amountCents,fileId:allocated.fileId,sha256,size:bytes.length,name,at,by:staff.staffName,byStaffId:staff.staffId,url:'https://drive.google.com/file/d/'+allocated.fileId+'/view'};
   return {version:input.version,upload:{action:'UPLOAD',company,department:'SUPPORT',type:typeFor(input.code),poId:id,fileId:allocated.fileId,name,sha256},event:{_id:id,title:id,description:input.orderId,image:input.customerId,action:ACTION,result:'SAVED',actorType:'STAFF',activityTime:at,initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Support attached '+input.code,details:{document}}};
  },apply:async plan=>{
   const existing=await store.read(names[company].activity,plan.event._id);
   if(!existing){if(supportDocumentVersion(await readContext(company,staff))!==plan.version)throw Error('Documents changed during upload. Retry the original upload.');const result=await documentService({...plan.upload,base64:input.base64});if(result?.ok!==true||['company','poId','fileId','sha256','name'].some(key=>result[key]!==plan.upload[key])||result.size!==bytes.length)throw Error('File upload is not confirmed. Retry this same upload.');await store.insert(names[company].activity,{...plan.event,activityTime:new Date(plan.event.activityTime)});}
   else if(operationId(existing.details)!==operationId(plan.event.details))throw Error('Document receipt requires review.');
   return {ok:true,company,requestId,documentId:plan.event._id};
  }});
 };
}
