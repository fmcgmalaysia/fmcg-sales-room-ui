import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { purchaseDocumentState } from 'backend/purchaseDocumentPolicy.js';
import { createHash } from 'crypto';
import { Buffer } from 'buffer';
const text=value=>String(value??'').trim();
const cents=value=>Number.isSafeInteger(value)&&value>=0&&value<=999999999999;
const currentDocs=row=>row.documents.filter(doc=>doc.linked===true&&!doc.superseded&&doc.fileId);
export function settlementVersion(row,finance){
  return operationId(row.company,row.id,row.contentVersion,currentDocs(row).map(doc=>[doc.fileId,doc.type,doc.sha256,doc.date,doc.number]).sort(),row.warehouse,finance.amounts||[],finance.payments||[]);
}
export function projectAccountSettlement(row,details){
  const finance=details.finance||{},documents=currentDocs(row),invoices=documents.filter(doc=>doc.type==='INV'),credits=documents.filter(doc=>doc.type==='CN');
  const amounts=Array.isArray(finance.amounts)?finance.amounts:[],payments=Array.isArray(finance.payments)?finance.payments:[];
  const documentAmount=doc=>{const entries=amounts.filter(entry=>entry.fileId===doc.fileId&&entry.sha256===doc.sha256&&cents(entry.cents));return entries.length===1?entries[0].cents:null;};
  const allMoney=[...invoices,...credits].map(documentAmount),amountComplete=invoices.length>0&&allMoney.every(value=>value!==null);
  const payableCents=amountComplete?invoices.reduce((n,doc)=>n+documentAmount(doc),0)-credits.reduce((n,doc)=>n+documentAmount(doc),0):null;
  const validPayments=payments.filter(entry=>entry.id&&entry.proof?.fileId&&entry.proof?.sha256&&entry.proof?.linked===true&&cents(entry.cents)&&entry.cents>0&&entry.byStaffId&&entry.by&&entry.at);
  const paymentRecordsValid=validPayments.length===payments.length&&new Set(payments.map(entry=>entry.id)).size===payments.length;
  const confirmedPayments=validPayments.filter(entry=>entry.confirmed===true);
  const paidCents=paymentRecordsValid?confirmedPayments.reduce((n,entry)=>n+entry.cents,0):null,balanceCents=payableCents!==null&&paidCents!==null?payableCents-paidCents:null;
  const blockers=[];
  if(!invoices.length)blockers.push('Final Invoice required / 缺最终发票');
  if(!amountComplete||payableCents===null||payableCents<0)blockers.push('Confirm INV / CN amounts / 请核对发票及贷项金额');
  if(!documents.some(doc=>doc.type==='DO'))blockers.push('Supplier DO required / 缺送货单');
  if(!credits.length&&!(finance.cnNotApplicable?.enabled===true&&finance.cnNotApplicable.byStaffId&&finance.cnNotApplicable.at))blockers.push('Confirm CN or CN not applicable / 确认贷项单或不适用');
  if(!row.warehouse?.complete||row.warehouse.issues)blockers.push('Complete warehouse receiving / 仓库尚未完成无异常收货');
  if(!paymentRecordsValid)blockers.push('Payment records require review / 付款记录需要检查');
  if(balanceCents!==null&&balanceCents<0)blockers.push('Resolve overpayment / 需处理多付款');
  const reviewVersion=settlementVersion(row,finance),check=finance.check;
  const checked=blockers.length===0&&check?.enabled===true&&check.reviewVersion===reviewVersion&&Boolean(check.byStaffId&&check.at);
  const paymentCompleted=payableCents!==null&&payableCents>=0&&balanceCents===0&&paymentRecordsValid;
  const archiveBlockers=[...blockers,...(!paymentCompleted?['Complete supplier payment / 供应商款项未结清']:[]),...(!checked?['Finance Checked required / 财务尚未核对完成']:[]),...(!row.salesInvoiceComplete?['Customer Sales Invoice required / 客户销售发票未齐']:[])];
  return {invoiceChecked:checked,invoiceCheck:check||null,canCheck:blockers.length===0,checkBlocker:blockers.join('; '),creditorActive:invoices.length>0&&!(paymentCompleted&&checked),documentStatus:purchaseDocumentState(row.documents,checked),
    finance:{amounts,payments:validPayments,cnNotApplicable:finance.cnNotApplicable||null,payableCents,paidCents,balanceCents,paymentCompleted,reviewVersion},
    paymentCompleted,status:paymentCompleted?(checked?'Completed':'Paid W/T Inv'):paidCents>0&&!invoices.length?'Paid W/T Inv':'Pending Payment',canArchive:archiveBlockers.length===0,archiveBlockers,state:archiveBlockers.length===0?'HISTORY':'ACTIVE',completedAt:archiveBlockers.length===0?check.at:null};
}
export function createAccountSettlementOperations({store,names,listOrders,documentService,now=()=>new Date()}){
  const journal=createOperationJournal({store,now});
  return {save:async({company,staff,requestId,input})=>{
    if(!names[company]||!['AMOUNTS','CN_NOT_APPLICABLE','CHECK','DOCUMENT_UPLOAD'].includes(input?.action))throw Error('Unsupported financial action.');
    let uploadBase64=null,journalInput=input;
    if(input.action==='DOCUMENT_UPLOAD'){
      if(!documentService||!['DO','PAYMENT'].includes(input.type))throw Error('Select a supplier DO or payment proof.');
      if(typeof input.base64!=='string'||input.base64.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw Error('Select a PDF up to 3 MiB.');
      const bytes=Buffer.from(input.base64,'base64');
      if(bytes.length<5||bytes.length>3*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.toString('base64')!==input.base64)throw Error('Select a valid PDF up to 3 MiB.');
      uploadBase64=input.base64;journalInput={...input,base64:undefined,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
    }
    return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{settlement:journalInput},prepare:async()=>{
      const row=(await listOrders(company,staff)).find(row=>row.id===input.id);
      if(!row||row.version!==input.version)throw Error('Purchase order changed. Refresh before saving; your input is retained.');
      const record=await store.read('PurchaseOrders',row.id),details=record?.details||{},finance={...(details.finance||{})},at=now().toISOString(),reason=text(input.reason);
      if(!reason||reason.length>2000)throw Error('Enter a reason or reconciliation note.');
      const audit={id:operationId(company,requestId,staff.memberId,'FINANCE'),action:'ACCOUNT_'+input.action,time:at,actor:staff.staffName,actorStaffId:staff.staffId,result:'SAVED',message:reason,changes:{}};
      const identity={at,by:staff.staffName,byStaffId:staff.staffId};
      let upload=null,document=null;
      if(input.action==='DOCUMENT_UPLOAD'){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')||!Number.isFinite(Date.parse(input.date))||new Date(input.date).toISOString().slice(0,10)!==input.date)throw Error('Enter a valid document date.');
        const number=text(input.number);if(!number||number.length>120)throw Error('Enter the document or payment reference.');
        if(input.type==='PAYMENT'&&(!cents(input.cents)||input.cents===0))throw Error('Enter a valid paid amount.');
        if(input.type==='PAYMENT'&&(finance.payments||[]).some(entry=>entry.reference===number&&entry.date===input.date))throw Error('This payment reference is already recorded for this purchase order.');
        if(input.type==='PAYMENT'&&(finance.payments||[]).some(entry=>entry.proof?.sha256===journalInput.sha256))throw Error('This payment proof is already recorded for this purchase order.');
        if(input.type==='DO'&&currentDocs(row).some(doc=>doc.type==='DO'&&doc.sha256===journalInput.sha256))throw Error('This DO is already linked to the purchase order.');
        const clean=value=>text(value).replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,120),name=`${input.date} ${clean(row.supplierShortName)} ${input.type} ${clean(number)}.pdf`;
        const allocated=await documentService({action:'ALLOCATE',company});
        upload={action:'UPLOAD',company,poId:row.id,fileId:allocated.fileId,type:input.type,name,sha256:journalInput.sha256,...(input.type==='PAYMENT'?{department:'ACCOUNT'}:{})};
        document={fileId:upload.fileId,type:input.type,name,sha256:upload.sha256,size:journalInput.size,number,date:input.date,linked:true,uploadedAt:at,uploadedBy:staff.staffName,uploadedByStaffId:staff.staffId};
        if(input.type==='PAYMENT')finance.payments=[...(finance.payments||[]),{id:audit.id,cents:input.cents,reference:number,date:input.date,confirmed:true,proof:document,...identity}];
        audit.changes={type:input.type,fileId:upload.fileId,number,date:input.date,...(input.type==='PAYMENT'?{cents:input.cents}:{})};
      }else if(input.action==='AMOUNTS'){
        const docs=currentDocs(row).filter(doc=>['INV','CN'].includes(doc.type));
        if(!docs.length||!Array.isArray(input.amounts)||input.amounts.length!==docs.length||new Set(input.amounts.map(entry=>entry.fileId)).size!==docs.length)throw Error('Enter the amount for every current INV and CN.');
        finance.amounts=input.amounts.map(entry=>{const doc=docs.find(doc=>doc.fileId===entry.fileId);if(!doc||!cents(entry.cents)||(doc.type==='INV'&&entry.cents===0))throw Error('Enter valid MYR document amounts.');return {fileId:doc.fileId,sha256:doc.sha256,cents:entry.cents,...identity};});
        if(docs.filter(doc=>doc.type==='CN').reduce((n,doc)=>n+finance.amounts.find(entry=>entry.fileId===doc.fileId).cents,0)>docs.filter(doc=>doc.type==='INV').reduce((n,doc)=>n+finance.amounts.find(entry=>entry.fileId===doc.fileId).cents,0))throw Error('CN total exceeds the invoice total.');
        audit.changes={before:details.finance?.amounts||[],after:finance.amounts};
      }else if(input.action==='CN_NOT_APPLICABLE'){
        if(typeof input.enabled!=='boolean'||(input.enabled&&currentDocs(row).some(doc=>doc.type==='CN')))throw Error('Review the existing CN instead of selecting not applicable.');
        finance.cnNotApplicable={enabled:input.enabled,...identity,reason};audit.changes={before:details.finance?.cnNotApplicable||null,after:finance.cnNotApplicable};
      }else{
        if(typeof input.enabled!=='boolean')throw Error('Choose a financial check state.');
        const state=projectAccountSettlement(row,{...details,finance});
        if(input.enabled&&!state.canCheck)throw Error(state.checkBlocker);
        if(input.enabled===state.invoiceChecked)throw Error('Financial check has not changed.');
        finance.check={enabled:input.enabled,reviewVersion:state.finance.reviewVersion,...identity,reason};audit.changes={before:state.invoiceChecked,after:input.enabled,reviewVersion:state.finance.reviewVersion};
      }
      if(input.action!=='CHECK')finance.check={...(finance.check||{}),enabled:false};
      return {expected:record?operationId(record):null,expectedVersion:row.version,record:{...(record||{}),_id:row.id,title:row.id,company,details:{...details,taskIds:row.taskIds,createdAt:row.createdAt,createdBy:row.createdBy,finance,...(document&&input.type==='DO'?{documents:[...(details.documents||[]),document]}:{}),updatedAt:at,audit:[...(details.audit||[]),audit]}},audit,upload};
    },apply:async plan=>{
      const current=await store.read('PurchaseOrders',plan.record._id);
      if(!current?.details?.audit?.some(event=>event.id===plan.audit.id)){
        const row=(await listOrders(company,staff)).find(row=>row.id===plan.record._id);
        if((current?operationId(current):null)!==plan.expected||row?.version!==plan.expectedVersion)throw Error('Purchase order changed while saving.');
        if(plan.upload){
          const receipt=await documentService({...plan.upload,base64:uploadBase64});
          if(receipt?.ok!==true||receipt.fileId!==plan.upload.fileId||receipt.sha256!==plan.upload.sha256||receipt.company!==company||receipt.poId!==plan.record._id||receipt.name!==plan.upload.name)throw Error('Document upload receipt mismatch.');
        }
        if(current)await store.update('PurchaseOrders',plan.record);else await store.insert('PurchaseOrders',plan.record);
      }
      return {ok:true,company,requestId,poId:plan.record._id,savedAt:plan.audit.time};
    }});
  }};
}
