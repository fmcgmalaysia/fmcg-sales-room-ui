'use strict';
const {hash}=require('./commit-proof.cjs'),{copy,same}=require('./segmented-plan.cjs'),{requireOriginalSalesDelegation}=require('./sales-delegation.cjs');
function pdfFacts(base64){const {Buffer}=require('node:buffer');const {createHash}=require('node:crypto');const bytes=Buffer.from(base64,'base64');return{bytes,sha256:createHash('sha256').update(bytes).digest('hex')};}
const fileId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(value),clean=value=>String(value??'').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,90);
// PRIVATE candidate prepare capture. The original factory owns all document, invoice,
// duplicate, PDF, customer and account-version rules. Never its legacy apply.
async function captureOriginalCustomerDocumentPlan({company,staff,requestId,input,context,createCustomerAccountOperations,now,slot}){
 requireOriginalSalesDelegation(staff,input?.customerId);
 if(!['NCT','GHR'].includes(company)||context?.company!==company||!Array.isArray(context.activity)||!Array.isArray(context.customers)
  ||staff.canUploadCustomerDocument!==true||input?.action!=='DOCUMENT'||typeof createCustomerAccountOperations!=='function'||typeof now!=='function'||!fileId(slot))throw Error('Original private customer document scope required');
 const journal=company==='NCT'?'NCTActivity':'NCTActivity1',scratch=new Map(),boundary=Error('Original private customer document boundary');let captured,reads=0,allocated=0;
 const scope=collection=>{if(collection!==journal)throw Error('Original customer document collection scope');};
 const store={read:async(collection,id)=>{scope(collection);return copy(scratch.get(id)||null);},
  insert:async(collection,row)=>{scope(collection);
   if(row.action==='PURCHASE_OPERATION_PREPARED'&&row.details?.kind==='PREPARED'){
    if(captured||scratch.size!==1||row.details.plan?.event?.action!=='CUSTOMER_ACCOUNT_DOCUMENT_SAVED')throw Error('Original customer document prepare conflict');captured=copy(row.details.plan);throw boundary;
   }
   if(row.action!=='PURCHASE_OPERATION_LOCK'||row.details?.kind!=='LOCK'||scratch.size)throw Error('Original customer document legacy apply forbidden');scratch.set(row._id,copy(row));return copy(row);
  },remove:async(collection,id)=>{scope(collection);if(scratch.get(id)?.action!=='PURCHASE_OPERATION_LOCK')throw Error('Only original scratch document lock removal allowed');scratch.delete(id);}};
 const save=createCustomerAccountOperations({store,names:{[company]:{activity:journal}},now,
  readContext:async(selected,employee)=>{if(selected!==company||employee.memberId!==staff.memberId||employee.staffId!==staff.staffId||++reads!==1)throw Error('Original customer document context/actor conflict');return copy(context);},
  documentService:async command=>{if(!same(command,{action:'ALLOCATE',company})||allocated++)throw Error('Original document external apply forbidden during capture');return{ok:true,fileId:slot};}});
 try{await save({company,staff:copy(staff),requestId,input:copy(input)});throw Error('Original document prepare boundary missing');}catch(error){if(error!==boundary)throw error;}
 if(!captured||reads!==1||scratch.size||allocated!==1)throw Error('Original customer document capture incomplete');
 assertCustomerDocumentPlan({company,staff,requestId,input,plan:captured});return captured;
}
function assertCustomerDocumentPlan({company,staff,requestId,input,plan}){
 requireOriginalSalesDelegation(staff,input?.customerId);
 const event=plan?.event,doc=event?.details?.document,id=hash(company,requestId,staff.memberId,'CUSTOMER_DOCUMENT');
 if(!['NCT','GHR'].includes(company)||staff.canUploadCustomerDocument!==true||!/^[a-f0-9-]{36}$/i.test(requestId||'')||input?.action!=='DOCUMENT'
  ||typeof input.base64!=='string'||input.base64.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw Error('Immutable original customer PDF required');
 const {bytes,sha256}=pdfFacts(input.base64);
 if(bytes.length<5||bytes.length>3*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.toString('base64')!==input.base64
  ||event?._id!==id||event.title!==id||event.description!==id||event.image!==input.customerId||event.action!=='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'||event.result!=='SAVED'
  ||event.initiatedByStaffId!==staff.staffId||event.initiatedByStaffName!==staff.staffName||event.actorType!=='STAFF'||event.message!==String(input.reason).trim()||!Number.isFinite(Date.parse(event.activityTime))
  ||doc?.id!==id||doc.company!==company||doc.customerId!==input.customerId||doc.byStaffId!==staff.staffId||doc.by!==staff.staffName||doc.at!==event.activityTime
  ||!['SALES_INV','SALES_CN','DEBIT_NOTE','CUSTOMER_RECEIPT'].includes(doc.type)||doc.type!==input.type||doc.number!==String(input.number).trim()||doc.date!==input.date
  ||doc.currency!==String(input.currency).trim().toUpperCase()||doc.amountCents!==input.amountCents||doc.reason!==String(input.reason).trim()
  ||doc.shipmentId!==(input.type==='SALES_INV'?input.shipmentId:'')||!fileId(doc.fileId)||doc.sha256!==sha256||doc.size!==bytes.length
  ||doc.url!=='https://drive.google.com/file/d/'+doc.fileId+'/view'||doc.name!==input.date+' '+clean(doc.customerName||doc.customerId)+' '+input.type+' '+clean(doc.number)+'.pdf'
  ||plan.expectedVersion!==input.version||!same(plan.upload,{action:'UPLOAD',company,department:'SALES',type:input.type,poId:id,fileId:doc.fileId,name:doc.name,sha256}))throw Error('Immutable original customer document plan conflict');
 return true;
}
async function uploadCustomerDocumentSlot({company,staff,requestId,input,plan,documentService}){
 assertCustomerDocumentPlan({company,staff,requestId,input,plan});if(typeof documentService!=='function')throw Error('Original document service required');
 const upload=copy(plan.upload),receipt=await documentService({...upload,base64:input.base64});
 if(receipt?.ok!==true||['fileId','company','poId','sha256','name'].some(key=>receipt[key]!==upload[key]))throw Error('Original customer document upload unconfirmed; retain same file ID');
 return{fileId:upload.fileId,company,poId:upload.poId,sha256:upload.sha256,name:upload.name};
}
module.exports={captureOriginalCustomerDocumentPlan,assertCustomerDocumentPlan,uploadCustomerDocumentSlot};
