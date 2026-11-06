import { Buffer } from 'buffer';
import { createHash } from 'crypto';
import { operationId, createOperationJournal, canonical } from 'backend/purchaseOperationJournal.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { normalizeChargeLines } from 'backend/customerInvoicePayments.js';
import { readSupportDesks, currentSupportDeskState, currentSupportDeskLocks, supportDeskBatchId, invoiceDeskSnapshot } from 'backend/supportDesk.js';
import { deskTaskPortions } from 'backend/shortloadResolutionModel.js';
import { readPhysicalOutflows } from 'backend/physicalOutflow.js';
const ACTION='SUPPORT_DOCUMENT_UPLOADED',codes=['SO','BC','SI','DO','CN','DN','PL','INS','CF','BL','$'];
const typeFor=code=>'SUPPORT_'+(code==='$'?'PAYMENT':code);
const text=value=>String(value??'').trim();
const financialCodes=['$','CN','DN'];
const financeBasis=activity=>operationId(activity.filter(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'&&row.result==='SAVED').map(row=>[row._id,canonical(row.details?.document)]).sort((a,b)=>a[0].localeCompare(b[0])));
const isCharge=doc=>doc.invoiceKind==='CHARGE'&&doc.code==='SI'&&doc.scope==='INVOICE'&&doc.orderId==='';
export function supportDocumentMatchesShipment(document,shipment,activity,snapshot=invoiceDeskSnapshot(activity,shipment.id)){
 if(document.customerId!==shipment.customerId||document.company!==shipment.company)return false;
 if(document.invoiceId)return document.invoiceId===shipment.id;
 if(!shipment.lines.some(line=>line.orderId===document.orderId))return false;
 if(document.scope==='ORDER')return true;
 if(document.scope!=='DESK'||document.desk!==shipment.desk)return false;
 if(!snapshot)return false;
 const initial=supportDeskBatchId({company:shipment.company,customerId:shipment.customerId},shipment.desk);
 return (document.batchId||initial)===(snapshot.batchId||initial);
}
export function readSupportDocuments(activity,company){
 if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');
 const docs=activity.filter(row=>row.action===ACTION&&row.result==='SAVED').map(row=>row.details?.document);
 if(docs.some(d=>!d||d.company!==company||!d.id||!d.customerId||d.scope!=='CUSTOMER'&&!d.orderId&&!isCharge(d)||!codes.includes(d.code)||!['ORDER','INVOICE','DESK','CUSTOMER'].includes(d.scope)||d.scope==='CUSTOMER'&&(!financialCodes.includes(d.code)||d.orderId||d.invoiceId||d.desk)||d.scope==='INVOICE'&&!d.invoiceId||d.scope==='DESK'&&(!Number.isSafeInteger(d.desk)||d.desk<1||d.desk>3)||d.depositPayment!==undefined&&(typeof d.depositPayment!=='boolean'||d.depositPayment&&d.code!=='$')||!/^[A-Za-z0-9_-]{10,200}$/.test(d.fileId||'')||!/^[a-f0-9]{64}$/.test(d.sha256||'')||!Number.isFinite(Date.parse(d.at))||!d.byStaffId||!d.name||!Number.isSafeInteger(d.size)||d.size<=0||d.size>3*1024*1024||!Number.isSafeInteger(d.amountCents)||d.amountCents<0)||new Set(docs.map(d=>d.id)).size!==docs.length)throw Error('Support document history requires review.');
 for(const doc of docs.filter(d=>d.invoiceKind!==undefined)){if(!isCharge(doc)||doc.invoiceId!==doc.id||doc.amountCents!==normalizeChargeLines(doc.chargeLines).reduce((n,line)=>n+line.amountCents,0))throw Error('Charge invoice evidence requires review.');}
 const replaced=new Set();for(const d of docs.filter(row=>row.replacesDocumentId)){const prior=docs.find(row=>row.id===d.replacesDocumentId);if(!prior||prior.id===d.id||replaced.has(prior.id)||prior.company!==d.company||prior.customerId!==d.customerId||prior.code!==d.code||prior.scope!==d.scope||prior.orderId!==d.orderId||prior.invoiceId!==d.invoiceId||prior.desk!==d.desk||!financialCodes.includes(d.code)||Date.parse(prior.at)>Date.parse(d.at))throw Error('Support document replacement requires review.');replaced.add(prior.id);}
 return docs.map(d=>replaced.has(d.id)?{...d,superseded:true}:d);
}
export function supportDocumentVersion(context){const docs=readSupportDocuments(context.activity,context.company),posted=context.activity.filter(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'&&row.result==='SAVED'&&row.details?.document?.confirmedByFinance===true).map(row=>row.details.document);return posted.length?operationId(context.company,docs,posted):operationId(context.company,docs);}
// Resume only the current employee's persisted intent. Never infer a new request.
export function pendingSupportDocumentUploads(activity,company,staff){
 const pending=[];if(!['NCT','GHR'].includes(company)||!staff?.memberId||!staff.staffId||staff.packingDepartment!=='SUPPORT')throw Error('Verified Support access is required.');
 const byId=new Map(activity.map(row=>[row._id,row]));
 for(const row of activity){
  const d=row.details,plan=d?.plan,doc=plan?.event?.details?.document;
  if(row.action!=='PURCHASE_OPERATION_PREPARED'||plan?.event?.action!==ACTION||!doc||doc.company!==company||d.actorMemberId!==staff.memberId||d.actorStaffId!==staff.staffId)continue;
  const key=operationId(company+'/PURCHASE',d.requestId,staff.memberId),id=operationId(company,d.requestId,staff.memberId,ACTION);
  if(row._id!==key||plan.event._id!==id||doc.id!==id||plan.upload?.poId!==id||plan.upload.fileId!==doc.fileId||plan.upload.sha256!==doc.sha256||plan.upload.company!==company)throw Error('Original document request identity requires review.');
  const result=byId.get(operationId(key,'RESULT')),saved=byId.get(id);
  if(result&&(!saved||result.details?.digest!==d.digest)||saved&&canonical(saved.details)!==canonical(plan.event.details))throw Error('Original document receipt requires review.');
  if(result||saved)continue;
  const input={version:plan.inputVersion||plan.version,code:doc.code,customerId:doc.customerId,orderId:doc.orderId,invoiceId:doc.invoiceKind?'':doc.invoiceId||'',scope:doc.scope,...(doc.invoiceKind?{invoiceKind:doc.invoiceKind,chargeLines:doc.chargeLines}:{}),...(doc.replacesDocumentId?{replacesDocumentId:doc.replacesDocumentId}:{}),...(doc.scope==='DESK'?{desk:doc.desk,batchId:doc.batchId}:{}),...(doc.code==='$'?{depositPayment:doc.depositPayment===true}:{}),reference:doc.code==='SI'&&!doc.invoiceKind?'':doc.reference||'',amountCents:doc.code==='SI'&&!doc.invoiceKind?0:doc.amountCents};
  const recoverable=operationId({supportDocument:{...input,base64:undefined,sha256:doc.sha256,size:doc.size}})===d.digest;
  pending.push({requestId:d.requestId,documentId:id,fileId:doc.fileId,sha256:doc.sha256,size:doc.size,context:{company,customerId:doc.customerId,orderId:doc.orderId,invoiceId:input.invoiceId,code:doc.code,desk:doc.desk||0,batchId:doc.batchId||'',replacesDocumentId:doc.replacesDocumentId||''},recoverable,input:recoverable?input:null});
 }
 return pending;
}
export function customerFileReady(activity,document,company){return document.company===company&&(document.customerDeliveryVersion===1&&document.customerLinkReady===true||activity.some(row=>row.action==='CUSTOMER_DOCUMENT_DELIVERED'&&row.result==='SAVED'&&['company','customerId','fileId','sha256'].every(key=>row.details?.document?.[key]===document[key])&&row.details.document.sourceDocumentId===document.id));}
export function supportCustomerFiles(context){
 const support=readSupportDocuments(context.activity,context.company).map(d=>({...d,sourceKind:'SUPPORT'})),legacy=context.activity.filter(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'&&row.result==='SAVED').map(row=>row.details?.document).filter(d=>d&&d.company===context.company&&!d.sourceDocumentId&&['SALES_INV','SALES_CN','DEBIT_NOTE','CUSTOMER_RECEIPT'].includes(d.type)).map(d=>({...d,sourceKind:'ACCOUNT'}));
 return support.concat(legacy).map(d=>({...d,customerLinkReady:customerFileReady(context.activity,d,context.company)}));
}
// One-time preparation for known historical customer PDFs. Never invoked by a read.
export function createSupportCustomerDeliveryOperations({store,names,readContext,documentService,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  if(!['NCT','GHR'].includes(company)||!names[company]||staff?.packingDepartment!=='SUPPORT'||input?.action!=='DELIVER'||!['SUPPORT','ACCOUNT'].includes(input.sourceKind)||typeof input.documentId!=='string'||typeof input.customerId!=='string')throw Error('Support customer-file access is required.');
  const find=context=>supportCustomerFiles(context).find(d=>d.sourceKind===input.sourceKind&&d.id===input.documentId&&d.customerId===input.customerId&&!d.superseded);
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{customerFile:{action:'DELIVER',documentId:input.documentId,customerId:input.customerId,sourceKind:input.sourceKind,version:input.version}},prepare:async()=>{
   const context=await readContext(company,staff),source=find(context);if(context.company!==company||!source)throw Error('This customer document is unavailable.');if(source.customerLinkReady)return {alreadyReady:true,documentId:source.id};if(input.version!==supportDocumentVersion(context))throw Error('Documents changed. Refresh before preparing the file.');
   const customerName=source.customerName||context.customers.find(c=>c.id===source.customerId)?.name;if(!customerName)throw Error('Customer identity requires review.');
   const id=operationId(company,'CUSTOMER_DOCUMENT_DELIVERED',source.sourceKind,source.id),document={sourceDocumentId:source.id,company,customerId:source.customerId,fileId:source.fileId,sha256:source.sha256};
   return {sourceHash:operationId(source),upload:{action:'DELIVER_CUSTOMER_DOCUMENT',company,department:source.sourceKind==='SUPPORT'?'SUPPORT':'SALES',type:source.sourceKind==='SUPPORT'?typeFor(source.code):source.type,poId:source.id,fileId:source.fileId,sha256:source.sha256,name:source.name,customerId:source.customerId,customerName,customerScope:source.scope||'ACCOUNT',businessId:source.invoiceId||source.shipmentId||source.orderId||''},event:{_id:id,title:id,action:'CUSTOMER_DOCUMENT_DELIVERED',result:'SAVED',description:source.id,image:source.customerId,activityTime:now().toISOString(),actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,details:{document}}};
  },apply:async plan=>{
   if(plan.alreadyReady)return {ok:true,company,requestId,documentId:plan.documentId,customerLinkReady:true};const existing=await store.read(names[company].activity,plan.event._id);
   if(!existing){const source=find(await readContext(company,staff));if(!source||operationId(source)!==plan.sourceHash)throw Error('Customer file changed. Retain the original preparation request.');const result=await documentService(plan.upload);if(result?.ok!==true||result.customerLinkReady!==true||['company','customerId','fileId','sha256','name','poId'].some(k=>result[k]!==plan.upload[k]))throw Error('Customer download is not confirmed. Retry this same preparation.');await store.insert(names[company].activity,{...plan.event,activityTime:new Date(plan.event.activityTime)});}
   else if(operationId(existing.details)!==operationId(plan.event.details))throw Error('Customer file delivery receipt requires review.');return {ok:true,company,requestId,documentId:plan.event.details.document.sourceDocumentId,customerLinkReady:true};
  }});
 };
}
// Support attachments record evidence only. Payment slips and customer CNs do not post Finance reconciliation.
export function createSupportDocumentOperations({store,names,readContext,readCustomers,documentService,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  const charge=input&&isCharge(input);if(input?.invoiceKind!==undefined&&!charge||charge&&(input.invoiceId||input.desk||input.replacesDocumentId))throw Error('Charge invoice identity requires review.');
  const chargeLines=charge?normalizeChargeLines(input.chargeLines):null;
  if(charge&&input.amountCents!==chargeLines.reduce((n,line)=>n+line.amountCents,0))throw Error('Charge lines must match the reference total.');
  if(!['NCT','GHR'].includes(company)||!names[company]||staff?.packingDepartment!=='SUPPORT'||!input||!codes.includes(input.code)||!['ORDER','INVOICE','DESK','CUSTOMER'].includes(input.scope)||typeof input.orderId!=='string'||input.scope!=='CUSTOMER'&&!input.orderId&&!charge||input.orderId.length>100||input.scope==='CUSTOMER'&&(!financialCodes.includes(input.code)||input.orderId||input.invoiceId||input.desk)||typeof input.customerId!=='string'||!input.customerId||input.customerId.length>100||input.scope==='DESK'&&(!Number.isSafeInteger(input.desk)||input.desk<1||input.desk>3)||input.depositPayment!==undefined&&(typeof input.depositPayment!=='boolean'||input.depositPayment&&input.code!=='$')||input.replacesDocumentId!==undefined&&(typeof input.replacesDocumentId!=='string'||!input.replacesDocumentId||input.replacesDocumentId.length>100))throw Error('Support document access is required.');
  if(typeof input.base64!=='string'||input.base64.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw Error('Select a PDF up to 3 MiB.');
  const bytes=Buffer.from(input.base64,'base64');if(bytes.length<5||bytes.length>3*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.toString('base64')!==input.base64)throw Error('Select a valid PDF up to 3 MiB.');
  const sha256=createHash('sha256').update(bytes).digest('hex'),safeInput={...input,base64:undefined,sha256,size:bytes.length};
  const prepare=async original=>{
   const context=await readContext(company,staff),docs=readSupportDocuments(context.activity,company);
   if(context.company!==company||!/^[a-f0-9]{32}$/.test(input.version||''))throw Error('Documents changed. Refresh before uploading.');
   const preparedVersion=supportDocumentVersion(context);
   const customerScope=input.scope==='CUSTOMER'||charge,deskScope=input.scope==='DESK',storedDesk=deskScope?readSupportDesks(context.activity,company).find(row=>row.customerId===input.customerId):null,deskState=storedDesk&&currentSupportDeskState(context,storedDesk),deskLock=deskScope?currentSupportDeskLocks(context).find(row=>row.customerId===input.customerId&&row.desk===input.desk):null;
   const invoiceCandidates=deskScope?readCustomerShipments(context.activity).filter(row=>row.customerId===input.customerId&&row.company===company&&row.desk===input.desk&&row.invoice&&row.lines.some(line=>line.orderId===input.orderId)):[];
   const historicalInvoice=deskScope?(input.invoiceId?invoiceCandidates.find(row=>row.id===input.invoiceId):!input.batchId&&input.code==='SI'&&invoiceCandidates.length===1?invoiceCandidates[0]:null):null;
   const historicalDesk=historicalInvoice&&invoiceDeskSnapshot(context.activity,historicalInvoice.id),initialBatch=supportDeskBatchId({company,customerId:input.customerId},input.desk),batchId=deskScope?(historicalDesk?.batchId||historicalDesk&&initialBatch||deskState&&supportDeskBatchId(deskState,input.desk)):null;
   if(deskScope&&(!batchId||input.invoiceId&&!historicalDesk||(input.batchId||initialBatch)!==batchId))throw Error('This Desk batch is unavailable or changed. Reopen the intended batch before uploading.');
   const directory=customerScope&&readCustomers?await readCustomers({company,staff}):null;if(customerScope&&(!directory||directory.company!==company||!Array.isArray(directory.customers)))throw Error('Customer directory is unavailable.');
   const flows=deskScope?readPhysicalOutflows(context.activity):[];
   const tasks=context.tasks.filter(row=>row.customerId===input.customerId&&!row.specialPurchase&&!row.procurementSource&&(deskScope?historicalInvoice?historicalInvoice.lines.some(line=>line.taskId===row.id):deskTaskPortions(context.activity,deskState,row,flows).some(part=>part.desk===input.desk&&part.quantity>0):row.orderId===input.orderId)),customer=(customerScope?directory.customers:context.customers).find(row=>row.id===input.customerId);
   if(!customer||!customerScope&&!tasks.length)throw Error('This customer order is unavailable.');
   if(deskScope&&!tasks.some(row=>row.orderId===input.orderId))throw Error('This order is not assigned to the selected Desk.');
   const invoice=historicalInvoice||(!charge&&(input.scope==='INVOICE'||deskScope)?readCustomerShipments(context.activity).find(row=>row.id===(deskScope?deskLock?.invoiceId:input.invoiceId)&&row.customerId===input.customerId&&row.company===company&&row.invoice&&row.lines.some(line=>line.orderId===input.orderId)):null);
   if(!charge&&(input.scope==='INVOICE'&&!invoice||input.code==='SI'&&!invoice))throw Error('Issue the Sales Invoice before attaching its PDF.');
   const currencies=new Set(customerScope?[customer.currency]:tasks.map(row=>row.transactionCurrency));if(currencies.size!==1||!(/^[A-Z]{3}$/).test([...currencies][0]||''))throw Error('Order currency requires review.');
   const reference=invoice&&input.code==='SI'?invoice.invoice.number:text(input.reference);
   if(reference.length>100||(['$','CN','DN'].includes(input.code)||charge)&&!reference||!Number.isSafeInteger(input.amountCents)||input.amountCents<0||input.amountCents>999999999999)throw Error('Enter the document reference and a valid reference amount. Finance records the actual amount.');
   const invoiceId=charge?operationId(company,requestId,staff.memberId,ACTION):invoice?.id||'';
   const replaces=input.replacesDocumentId?docs.find(d=>d.id===input.replacesDocumentId):null,posted=context.activity.filter(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'&&row.result==='SAVED').map(row=>row.details?.document);
   if(input.replacesDocumentId&&(!replaces||replaces.superseded||!financialCodes.includes(input.code)||replaces.customerId!==input.customerId||replaces.code!==input.code||replaces.scope!==input.scope||replaces.orderId!==input.orderId||replaces.invoiceId!==invoiceId||replaces.desk!==(deskScope?input.desk:undefined)||posted.some(d=>d&&(d.sourceDocumentId===replaces.id||d.fileId===replaces.fileId||d.sha256===replaces.sha256))))throw Error('Only an unrecorded current proof can be replaced.');
   if((financialCodes.includes(input.code)||charge)&&(docs.some(d=>(financialCodes.includes(d.code)||isCharge(d))&&d.sha256===sha256)||posted.some(d=>d?.sha256===sha256)))throw Error('This proof is already recorded or attached. Review the existing file.');
   if(docs.some(d=>d.code===input.code&&d.scope===input.scope&&d.customerId===input.customerId&&(deskScope?d.desk===input.desk&&(d.batchId||initialBatch)===batchId:d.orderId===input.orderId&&d.invoiceId===invoiceId)&&d.sha256===sha256))throw Error('This PDF is already attached to the order.');
   const id=operationId(company,requestId,staff.memberId,ACTION),allocated=original?{fileId:original.upload.fileId}:await documentService({action:'ALLOCATE',company});
   if(!/^[A-Za-z0-9_-]{10,200}$/.test(allocated?.fileId||''))throw Error('File allocation is not confirmed.');
   const at=original?original.event.activityTime:now().toISOString(),clean=value=>text(value).replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,80),name=at.slice(0,10)+' '+clean(customer.name)+' '+(input.code==='$'?'PAYMENT':input.code)+' '+clean(reference||input.orderId)+'.pdf';
   const document={id,company,customerId:input.customerId,customerName:customer.name,customerDeliveryVersion:1,customerLinkReady:true,orderId:input.orderId,scope:input.scope,invoiceId,...(deskScope?{desk:input.desk,batchId}:{}),...(replaces?{replacesDocumentId:replaces.id}:{}),...(input.code==='$'?{depositPayment:input.depositPayment===true}:{}),code:input.code,reference,currency:[...currencies][0],amountCents:input.code==='SI'&&!charge?invoice.invoice.amountCents:input.amountCents,...(charge?{invoiceKind:'CHARGE',chargeLines}:{}),fileId:allocated.fileId,sha256,size:bytes.length,name,at,by:staff.staffName,byStaffId:staff.staffId,url:'https://drive.google.com/file/d/'+allocated.fileId+'/view'};
   return {version:preparedVersion,inputVersion:input.version,financeBasis:financeBasis(context.activity),upload:{action:'UPLOAD',company,department:'SUPPORT',type:typeFor(input.code),poId:id,fileId:allocated.fileId,name,sha256,customerId:input.customerId,customerName:customer.name,customerScope:input.scope,businessId:invoiceId||input.orderId},event:{_id:id,title:id,description:input.orderId,image:input.customerId,action:ACTION,result:'SAVED',actorType:'STAFF',activityTime:at,initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Support attached '+input.code,details:{document}}};
  };
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{supportDocument:safeInput},prepare:()=>prepare(),apply:async plan=>{
   const existing=await store.read(names[company].activity,plan.event._id);
   if(!existing){const context=await readContext(company,staff);if(supportDocumentVersion(context)!==plan.version){
     // A different completed attachment may precede this retry. Reuse every
     // original validation and identity without allocating or rewriting a plan.
     if(plan.financeBasis?financeBasis(context.activity)!==plan.financeBasis:context.activity.some(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'&&row.result==='SAVED'))throw Error('Documents changed during upload. Retry the original upload.');
     const checked=await prepare(plan);if(canonical(checked.upload)!==canonical(plan.upload)||canonical(checked.event.details)!==canonical(plan.event.details))throw Error('Original upload context changed. Review before retrying.');
    }const result=await documentService({...plan.upload,base64:input.base64});if(result?.ok!==true||['company','poId','fileId','sha256','name'].some(key=>result[key]!==plan.upload[key])||result.size!==bytes.length||plan.upload.customerId&&(result.customerId!==plan.upload.customerId||result.customerLinkReady!==true))throw Error('File upload is not confirmed. Retry this same upload.');await store.insert(names[company].activity,{...plan.event,activityTime:new Date(plan.event.activityTime)});}
   else if(operationId(existing.details)!==operationId(plan.event.details))throw Error('Document receipt requires review.');
   return {ok:true,company,requestId,documentId:plan.event._id};
  }});
 };
}
