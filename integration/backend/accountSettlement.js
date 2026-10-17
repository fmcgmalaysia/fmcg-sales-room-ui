import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { purchaseDocumentState } from 'backend/purchaseDocumentPolicy.js';
import { createHash } from 'crypto';
import { Buffer } from 'buffer';
import { preparePurchaseClaim, purchaseClaimBlockers } from 'backend/purchaseClaimEvidence.js';
import { paymentRequestQuote, paymentReviewVersion, procurementSubmissionVersion, projectProcurementHandoff, transitionProcurementHandoff } from 'backend/paymentHandoff.js';
const text=value=>String(value??'').trim();
const cents=value=>Number.isSafeInteger(value)&&value>=0&&value<=999999999999;
const currentDocs=row=>row.documents.filter(doc=>doc.linked===true&&!doc.superseded&&doc.fileId);
export function settlementVersion(row,finance){
  return operationId(row.company,row.id,row.contentVersion,currentDocs(row).map(doc=>[doc.fileId,doc.type,doc.sha256,doc.date,doc.number]).sort(),row.warehouse,finance.amounts||[],finance.payments||[],...(finance.quantityClaims?.length?[finance.quantityClaims]:[]),row.shortageIssues||[],...(row.quantityCases?.length?[row.quantityCases]:[]),...(row.stockIssues?.length?[row.stockIssues]:[]),(row.creditTransfers||[]).filter(entry=>entry.targetId===row.id));
}
export function projectAccountSettlement(row,details){
  const finance=details.finance||{},documents=currentDocs(row),invoices=documents.filter(doc=>doc.type==='INV'),credits=documents.filter(doc=>doc.type==='CN');
  const amounts=Array.isArray(finance.amounts)?finance.amounts:[],payments=Array.isArray(finance.payments)?finance.payments:[];
  const documentAmount=doc=>{const entries=amounts.filter(entry=>entry.fileId===doc.fileId&&entry.sha256===doc.sha256&&cents(entry.cents));return entries.length===1?entries[0].cents:null;};
  const allMoney=[...invoices,...credits].map(documentAmount),amountComplete=invoices.length>0&&allMoney.every(value=>value!==null);
  const payableCents=amountComplete?invoices.reduce((n,doc)=>n+documentAmount(doc),0)-credits.reduce((n,doc)=>n+(amounts.find(entry=>entry.fileId===doc.fileId)?.treatment==='ALREADY_INCLUDED'?0:documentAmount(doc)),0):null;
  const validPayments=payments.filter(entry=>entry.id&&entry.proof?.fileId&&entry.proof?.sha256&&entry.proof?.linked===true&&cents(entry.cents)&&entry.cents>0&&entry.byStaffId&&entry.by&&entry.at&&(!entry.direction||['PAYMENT','REFUND'].includes(entry.direction)));
  const paymentRecordsValid=validPayments.length===payments.length&&new Set(payments.map(entry=>entry.id)).size===payments.length;
  const confirmedPayments=validPayments.filter(entry=>entry.confirmed===true);
  const cashPaidCents=paymentRecordsValid?confirmedPayments.filter(entry=>entry.direction!=='REFUND').reduce((n,entry)=>n+entry.cents,0):null;
  const refundCents=paymentRecordsValid?confirmedPayments.filter(entry=>entry.direction==='REFUND').reduce((n,entry)=>n+entry.cents,0):null;
  const creditAppliedCents=(row.creditTransfers||[]).filter(entry=>entry.targetId===row.id).reduce((sum,entry)=>sum+entry.cents,0),creditUsedCents=(row.creditTransfers||[]).filter(entry=>entry.sourceId===row.id).reduce((sum,entry)=>sum+entry.cents,0);
  const paidCents=paymentRecordsValid?cashPaidCents-refundCents:null,originalBalance=payableCents!==null&&paidCents!==null?payableCents-paidCents-creditAppliedCents:null,balanceCents=originalBalance===null?null:originalBalance+creditUsedCents;
  const reviewVersion=settlementVersion(row,finance),credit=finance.creditRecognition;
  const creditRecognized=Boolean(credits.length&&originalBalance<0&&credit?.reviewVersion===reviewVersion&&credit.cents===-originalBalance&&creditUsedCents<=credit.cents&&credit.byStaffId&&credit.at);
  const supplierCreditCents=creditRecognized?credit.cents-creditUsedCents:0;
  const receiptResolved=row.warehouse?.complete&&!row.warehouse.issues||Array.isArray(row.receiptLines)&&row.receiptLines.length>0&&row.receiptLines.every(line=>line.hasReceipt&&(line.accepted===line.planned&&!line.issue||['REFUND','CREDIT'].includes(line.decision?.supplierDecision)&&line.decision?.customerDecision!=='PENDING'));
  const blockers=[];
  if(['PROCESSING','UNKNOWN'].includes(details.procurementHandoff?.stage))blockers.push('Resolve bank payment processing / 核对未决银行付款');
  blockers.push(...purchaseClaimBlockers(row,finance));
  if(row.stockIssues?.length)blockers.push('Resolve quarantined stock / 隔离库存需完成损耗或供应商索赔核对');
  if(!invoices.length)blockers.push('Final Invoice required / 缺最终发票');
  if(!amountComplete||payableCents===null||payableCents<0)blockers.push('Confirm INV / CN amounts / 请核对发票及贷项金额');
  if(!documents.some(doc=>doc.type==='DO'))blockers.push('Supplier DO required / 缺送货单');
  if(!credits.length&&!(finance.cnNotApplicable?.enabled===true&&finance.cnNotApplicable.byStaffId&&finance.cnNotApplicable.at))blockers.push('Confirm CN or CN not applicable / 确认贷项单或不适用');
  if(!credits.length&&(row.receiptLines||[]).some(line=>['REFUND','CREDIT'].includes(line.decision?.supplierDecision)))blockers.push('Supplier CN required for the selected resolution / 已选择退款或贷项处理，需供应商 CN');
  if(!receiptResolved)blockers.push('Complete warehouse receiving / 仓库尚未完成收货或短缺处理');
  if(!paymentRecordsValid)blockers.push('Payment records require review / 付款记录需要检查');
  if(creditUsedCents>0&&(originalBalance===null||creditUsedCents>Math.max(0,-originalBalance)))blockers.push('Supplier credit consumption requires review / 已使用贷项的来源金额发生变化');
  if(paidCents!==null&&paidCents<0)blockers.push('Payment records require review / 退款超过已付款');
  if(balanceCents!==null&&balanceCents<0&&!creditRecognized)blockers.push('Resolve overpayment / 需处理退款或确认供应商贷项余额');
  if((row.shortageIssues||[]).some(issue=>issue.decision?.financeRequired)&&!(balanceCents===0||creditRecognized))blockers.push('Resolve supplier shortage liability / 供应商短缺款项尚未结清');
  const check=finance.check;
  const reviewRequired=check?.enabled===true&&check.reviewVersion!==reviewVersion;
  const checked=blockers.length===0&&check?.enabled===true&&check.reviewVersion===reviewVersion&&Boolean(check.byStaffId&&check.at);
  const paymentCompleted=payableCents!==null&&payableCents>=0&&(balanceCents===0||creditRecognized)&&paymentRecordsValid;
  const archiveBlockers=[...blockers,...(!paymentCompleted?['Complete supplier payment / 供应商款项未结清']:[]),...(!checked?['Finance Checked required / 财务尚未核对完成']:[]),...(!row.salesInvoiceComplete?['Customer Sales Invoice required / 客户销售发票未齐']:[])];
  return {invoiceChecked:checked,invoiceCheck:check||null,reviewRequired,canCheck:blockers.length===0,checkBlocker:blockers.join('; ')||(reviewRequired?'P.O. changed after the last check / 采购内容已修改，请重新核对':''),creditorActive:(invoices.length>0||cashPaidCents>0)&&!(paymentCompleted&&checked),prepaymentPending:cashPaidCents>0&&!invoices.length,financialRisk:!checked&&(reviewRequired||cashPaidCents>0&&row.warehouse?.issues||balanceCents<0||Boolean(row.shortageIssues?.length)||Boolean(row.stockIssues?.length)),documentStatus:purchaseDocumentState(row.documents,checked),
    finance:{receiptResolved:Boolean(receiptResolved),stockLossCents:(row.stockCases||[]).reduce((sum,item)=>{const approval=item.resolution?.financeApproval;return sum+(approval?.outcome==='LOSS'?approval.cents:approval?.unrecoveredCents||0);},0),amounts,quantityClaims:finance.quantityClaims||[],payments:validPayments,cnNotApplicable:finance.cnNotApplicable||null,payableCents,cashPaidCents,refundCents,paidCents,balanceCents,creditAppliedCents,creditUsedCents,supplierCreditCents,creditRecognition:credit||null,paymentCompleted,reviewVersion},
    paymentCompleted,status:paymentCompleted?(checked?'Completed':'Paid W/T Inv'):paidCents>0&&!invoices.length?'Paid W/T Inv':'Pending Payment',canArchive:archiveBlockers.length===0,archiveBlockers,state:archiveBlockers.length===0?'HISTORY':'ACTIVE',completedAt:archiveBlockers.length===0?check.at:null};
}
export function createAccountSettlementOperations({store,names,listOrders,documentService,now=()=>new Date()}){
  const journal=createOperationJournal({store,now});
  return {save:async({company,staff,requestId,input})=>{
    if(!names[company]||!['AMOUNTS','CN_NOT_APPLICABLE','CHECK','DOCUMENT_UPLOAD','PAYMENT_FILE_DELETE','RECOGNIZE_CREDIT','SHORTAGE_CLAIM','PAYMENT_REVIEW','REVIEW_LEGACY','TAKE_OWNERSHIP','RETURN_PROCUREMENT','PAYMENT_PROCESSING','PAYMENT_UNKNOWN','PAYMENT_RESOLVED'].includes(input?.action))throw Error('Unsupported financial action.');
    if(input.action==='PAYMENT_FILE_DELETE')return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{settlement:input},prepare:async()=>{
      const row=(await listOrders(company,staff)).find(row=>row.id===input.id);
      if(!row||row.version!==input.version)throw Error('Purchase order changed. Refresh before saving; your input is retained.');
      const record=await store.read('PurchaseOrders',row.id),payment=record?.details?.finance?.payments?.find(p=>p.id===input.paymentId),proof=(payment?.proofs||[payment?.proof]).find(p=>p?.fileId===input.fileId);
      if(!documentService||!proof?.linked||payment.deletedProofs?.some(p=>p.fileId===proof.fileId))throw Error('Select an available payment file.');
      if(proof.uploadedByStaffId!==staff.staffId&&staff.role!=='SUPER ADMIN')throw Error('Only the uploader or SUPER ADMIN can delete this file.');
      const at=now().toISOString(),audit={id:operationId(company,requestId,staff.memberId,'FINANCE'),action:'ACCOUNT_PAYMENT_FILE_DELETE',time:at,actor:staff.staffName,actorStaffId:staff.staffId,result:'SAVED',message:'Payment file deleted',changes:{paymentId:payment.id,fileId:proof.fileId,name:proof.name}};
      payment.deletedProofs=[...(payment.deletedProofs||[]),{fileId:proof.fileId,sha256:proof.sha256,at,by:staff.staffName,byStaffId:staff.staffId}];
      record.details.audit=[...(record.details.audit||[]),audit];record.details.updatedAt=at;
      return {record,expectedVersion:row.version,audit,trash:{action:'TRASH',department:'ACCOUNT',company,poId:row.id,fileId:proof.fileId,sha256:proof.sha256,name:proof.name,type:'PAYMENT'}};
    },apply:async plan=>{
      const current=await store.read('PurchaseOrders',plan.record._id);
      if(!current?.details?.audit?.some(e=>e.id===plan.audit.id)){
        const row=(await listOrders(company,staff)).find(r=>r.id===plan.record._id);if(row?.version!==plan.expectedVersion)throw Error('Purchase order changed while saving.');
        const receipt=await documentService(plan.trash);
        if(receipt?.ok!==true||receipt.trashed!==true||receipt.fileId!==plan.trash.fileId||receipt.sha256!==plan.trash.sha256||receipt.company!==company||receipt.poId!==plan.record._id||receipt.name!==plan.trash.name||receipt.type!=='PAYMENT')throw Error('Document deletion could not be confirmed. Retry the same deletion.');
        await store.update('PurchaseOrders',plan.record);
      }
      return {ok:true,company,requestId,poId:plan.record._id,savedAt:plan.audit.time};
    }});
    let uploadBase64=null,journalInput=input,extraFiles=[];
    if(input.action==='DOCUMENT_UPLOAD'){
      if(!documentService||!['DO','PAYMENT'].includes(input.type))throw Error('Select a supplier DO or payment proof.');
      if(typeof input.base64!=='string'||input.base64.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw Error('Select a PDF up to 3 MiB.');
      const bytes=Buffer.from(input.base64,'base64');
      if(bytes.length<5||bytes.length>3*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.toString('base64')!==input.base64)throw Error('Select a valid PDF up to 3 MiB.');
      uploadBase64=input.base64;journalInput={...input,base64:undefined,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
      if(input.attachments!==undefined){
        if(input.type!=='PAYMENT'||!Array.isArray(input.attachments)||input.attachments.length>5)throw Error('Select up to six payment PDF files.');
        let total=bytes.length;
        extraFiles=input.attachments.map(file=>{if(typeof file?.base64!=='string'||file.base64.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64))throw Error('Select valid PDF files up to 3 MiB in total.');const b=Buffer.from(file.base64,'base64');total+=b.length;if(b.length<5||b.subarray(0,5).toString()!=='%PDF-'||b.toString('base64')!==file.base64||total>3*1024*1024)throw Error('Select valid PDF files up to 3 MiB in total.');return {base64:file.base64,sha256:createHash('sha256').update(b).digest('hex'),size:b.length};});
        if(new Set([journalInput.sha256,...extraFiles.map(f=>f.sha256)]).size!==extraFiles.length+1)throw Error('This payment proof is already selected.');
        journalInput.attachments=extraFiles.map(({sha256,size})=>({sha256,size}));
      }
    }
    return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{settlement:journalInput},prepare:async()=>{
      const row=(await listOrders(company,staff)).find(row=>row.id===input.id);
      if(!row||row.version!==input.version)throw Error('Purchase order changed. Refresh before saving; your input is retained.');
      const record=await store.read('PurchaseOrders',row.id),details=record?.details||{},finance={...(details.finance||{})},at=now().toISOString(),reason=text(input.reason)||(input.action==='DOCUMENT_UPLOAD'&&input.type==='PAYMENT'?'Payment recorded':'');
      if(!reason||reason.length>2000)throw Error('Enter a reason or reconciliation note.');
      const audit={id:operationId(company,requestId,staff.memberId,'FINANCE'),action:'ACCOUNT_'+input.action,time:at,actor:staff.staffName,actorStaffId:staff.staffId,result:'SAVED',message:reason,changes:{}};
      const identity={at,by:staff.staffName,byStaffId:staff.staffId};
      let upload=null,document=null,handoff=null,procurement=null,extraUploads=[];
      if(['REVIEW_LEGACY','TAKE_OWNERSHIP','RETURN_PROCUREMENT','PAYMENT_PROCESSING','PAYMENT_UNKNOWN','PAYMENT_RESOLVED'].includes(input.action)){
        procurement=transitionProcurementHandoff(row,details,input,identity,'ACCOUNT');
        audit.changes={before:details.procurementHandoff||null,after:procurement};
      }else if(input.action==='DOCUMENT_UPLOAD'){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')||!Number.isFinite(Date.parse(input.date))||new Date(input.date).toISOString().slice(0,10)!==input.date)throw Error('Enter a valid document date.');
        const number=text(input.number);if((!number&&input.type!=='PAYMENT')||number.length>120)throw Error('Enter the document or payment reference.');
        if(input.type==='PAYMENT'&&!input.paymentId&&(!cents(input.cents)||input.cents===0))throw Error('Enter a valid paid amount.');
        if(input.direction!==undefined&&!['PAYMENT','REFUND'].includes(input.direction))throw Error('Select payment or received refund.');
        if(input.type==='PAYMENT'&&!input.paymentId&&input.direction==='REFUND'){
          const current=projectAccountSettlement(row,details);
          if(!Number.isSafeInteger(current.finance.paidCents)||input.cents>current.finance.paidCents)throw Error('Refund cannot exceed actual net payment.');
        }
        if(input.type==='PAYMENT'&&!input.paymentId&&number&&(finance.payments||[]).some(entry=>entry.reference===number&&entry.date===input.date))throw Error('This payment reference is already recorded for this purchase order.');
        if(input.type==='PAYMENT'&&(finance.payments||[]).some(entry=>entry.proof?.sha256===journalInput.sha256))throw Error('This payment proof is already recorded for this purchase order.');
        if(input.type==='DO'&&currentDocs(row).some(doc=>doc.type==='DO'&&doc.sha256===journalInput.sha256))throw Error('This DO is already linked to the purchase order.');
        const clean=value=>text(value).replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,120),name=`${input.date} ${clean(row.supplierShortName)} ${input.type} ${clean(number)}.pdf`;
        const allocated=await documentService({action:'ALLOCATE',company});
        upload={action:'UPLOAD',company,poId:row.id,fileId:allocated.fileId,type:input.type,name,sha256:journalInput.sha256,...(input.type==='PAYMENT'?{department:'ACCOUNT'}:{})};
        document={fileId:upload.fileId,type:input.type,name,sha256:upload.sha256,size:journalInput.size,number,date:input.date,linked:true,uploadedAt:at,uploadedBy:staff.staffName,uploadedByStaffId:staff.staffId};
        if(input.type==='PAYMENT'){
          let recipientBank=null;
          if(!input.paymentId&&input.direction!=='REFUND'){
            if(!['SUPPLIER','OTHER'].includes(input.recipientChoice))throw Error('Select the recipient account.');
            if(!['CASH','LOAN'].includes(input.paymentSource))throw Error('Select the payment source.');
            if(input.recipientChoice==='SUPPLIER'){
              const matches=(await store.all('SharedSuppliers')).filter(s=>s.title===row.supplierId),supplier=matches.length===1?matches[0]:null;
              if(!supplier?.bankName||!supplier?.bankAccountNo||input.recipientBank?.bankName!==supplier.bankName||input.recipientBank?.bankAccountNo!==supplier.bankAccountNo)throw Error('Select the current supplier bank account after refreshing.');
              recipientBank={bankName:supplier.bankName,bankAccountNo:supplier.bankAccountNo};
            }
          }
          const proofs=[document];
          for(const [index,file]of extraFiles.entries()){
            if((finance.payments||[]).some(p=>(p.proofs||[p.proof]).some(proof=>proof?.sha256===file.sha256)))throw Error('This payment proof is already recorded for this purchase order.');
            const allocatedExtra=await documentService({action:'ALLOCATE',company}),extra={...upload,fileId:allocatedExtra.fileId,sha256:file.sha256,name:name.replace(/\.pdf$/,`-${index+2}.pdf`)};
            extraUploads.push(extra);proofs.push({...document,fileId:extra.fileId,sha256:extra.sha256,name:extra.name,size:file.size});
          }
          const state=projectProcurementHandoff(row,details),instruction=details.procurementHandoff?{version:details.procurementHandoff.submission?.version||null,currentVersion:procurementSubmissionVersion(row),stage:state.stage,requiresReview:state.stale||!['PROCESSING','UNKNOWN'].includes(state.stage)}:null;
          if(input.paymentId){const existing=(finance.payments||[]).find(p=>p.id===input.paymentId&&p.confirmed);if(!existing)throw Error('Select an existing payment record.');finance.payments=finance.payments.map(p=>p.id===existing.id?{...p,proofs:[...(p.proofs||[p.proof]),...proofs]}:p);}else finance.payments=[...(finance.payments||[]),{id:audit.id,cents:input.cents,direction:input.direction||'PAYMENT',reference:number,date:input.date,confirmed:true,proof:document,...(proofs.length>1?{proofs}:{}),...(input.direction!=='REFUND'?{recipientChoice:input.recipientChoice,recipientBank,paymentSource:input.paymentSource,noteToPurchaser:text(input.reason)}:{}),...(instruction&&input.direction!=='REFUND'?{procurementInstruction:instruction}:{}),...identity}];
        }
        audit.changes={type:input.type,fileId:upload.fileId,number,date:input.date,...(input.type==='PAYMENT'?{cents:input.cents,direction:input.direction||'PAYMENT'}:{})};
      }else if(input.action==='AMOUNTS'){
        const docs=currentDocs(row).filter(doc=>['INV','CN'].includes(doc.type));
        if(!docs.length||!Array.isArray(input.amounts)||input.amounts.length!==docs.length||new Set(input.amounts.map(entry=>entry.fileId)).size!==docs.length)throw Error('Enter the amount for every current INV and CN.');
        finance.amounts=input.amounts.map(entry=>{const doc=docs.find(doc=>doc.fileId===entry.fileId);if(!doc||!cents(entry.cents)||(doc.type==='INV'&&entry.cents===0))throw Error('Enter valid MYR document amounts.');if(doc.type==='CN'&&!['DEDUCT','ALREADY_INCLUDED'].includes(entry.treatment))throw Error('Select whether the CN is already included in the final invoice.');return {fileId:doc.fileId,sha256:doc.sha256,cents:entry.cents,...(doc.type==='CN'?{treatment:entry.treatment}:{}),...identity};});
        if(docs.filter(doc=>doc.type==='CN').reduce((n,doc)=>{const entry=finance.amounts.find(entry=>entry.fileId===doc.fileId);return n+(entry.treatment==='ALREADY_INCLUDED'?0:entry.cents);},0)>docs.filter(doc=>doc.type==='INV').reduce((n,doc)=>n+finance.amounts.find(entry=>entry.fileId===doc.fileId).cents,0))throw Error('CN total exceeds the invoice total.');
        audit.changes={before:details.finance?.amounts||[],after:finance.amounts};
      }else if(input.action==='PAYMENT_REVIEW'){
        if(details.procurementHandoff){const state=projectProcurementHandoff(row,details);if(state.stage!=='OWNED'||state.stale)throw Error('Procurement handoff requires a current Finance-owned submission before payment review.');}
        if(details.procurementHandoff?.submission?.paymentRequest){const request=details.procurementHandoff.submission.paymentRequest,quote=paymentRequestQuote(row,request.creditNotes);if(quote.cnPending||input.requestedCents!==request.requestedCents||input.requestedCents>quote.availableCents)throw Error('Payment request CN or amount requires reconciliation or return to Purchase.');}
        if(!['RECEIVED','REVIEWING'].includes(input.stage)||input.paperReceived!==true||!cents(input.requestedCents)||input.requestedCents===0)throw Error('Confirm paper documents received, review stage and requested MYR amount.');
        if(!currentDocs(row).some(doc=>['PI','SO','INV'].includes(doc.type)))throw Error('Supplier PI / SO or Final Invoice is required before review.');
        handoff={...(details.paymentHandoff||{}),review:{stage:input.stage,requestedCents:input.requestedCents,paidAtReviewCents:row.finance?.paidCents||0,creditAtReviewCents:row.finance?.creditAppliedCents||0,paperReceived:true,version:paymentReviewVersion(row),...(details.procurementHandoff?{procurementVersion:details.procurementHandoff.submission.version}:{}),reason,...identity}};
        audit.changes={before:details.paymentHandoff?.review||null,after:handoff.review};
      }else if(input.action==='SHORTAGE_CLAIM'){
        const claim=preparePurchaseClaim(row,input,identity,reason);
        finance.quantityClaims=[...(finance.quantityClaims||[]).filter(value=>value.caseId!==claim.caseId),claim];
        audit.changes={caseId:claim.caseId,before:details.finance?.quantityClaims?.find(value=>value.caseId===claim.caseId)||null,after:claim};
      }else if(input.action==='RECOGNIZE_CREDIT'){
        const state=projectAccountSettlement(row,details);
        if(!currentDocs(row).some(doc=>doc.type==='CN')||!Number.isSafeInteger(state.finance.balanceCents)||state.finance.balanceCents>=0)throw Error('Verified CN and an actual supplier credit balance are required.');
        if(input.cents!==-state.finance.balanceCents)throw Error('Supplier credit amount changed. Refresh before confirming.');
        finance.creditRecognition={cents:input.cents,reviewVersion:state.finance.reviewVersion,...identity,reason};audit.changes={before:details.finance?.creditRecognition||null,after:finance.creditRecognition};
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
      if(!procurement&&!['CHECK','PAYMENT_REVIEW'].includes(input.action))finance.check={...(finance.check||{}),enabled:false};
      return {expected:record?operationId(record):null,expectedVersion:row.version,...(procurement||handoff?{expectedBasis:procurementSubmissionVersion(row)}:{}),record:{...(record||{}),_id:row.id,title:row.id,company,details:{...details,taskIds:row.taskIds,createdAt:row.createdAt,createdBy:row.createdBy,finance,...(procurement?{procurementHandoff:procurement}:{}),...(handoff?{paymentHandoff:handoff,chasePayment:false}:{}),...(document&&input.type==='PAYMENT'&&input.direction!=='REFUND'?{chasePayment:false}:{}),...(document&&input.type==='DO'?{documents:[...(details.documents||[]),document]}:{}),updatedAt:at,audit:[...(details.audit||[]),audit]}},audit,upload,extraUploads};
    },apply:async plan=>{
      const current=await store.read('PurchaseOrders',plan.record._id);
      if(!current?.details?.audit?.some(event=>event.id===plan.audit.id)){
        const row=(await listOrders(company,staff)).find(row=>row.id===plan.record._id);
        if((current?operationId(current):null)!==plan.expected||row?.version!==plan.expectedVersion||plan.expectedBasis&&procurementSubmissionVersion(row)!==plan.expectedBasis)throw Error('Purchase order changed while saving.');
        if(plan.upload){
          const receipt=await documentService({...plan.upload,base64:uploadBase64});
          if(receipt?.ok!==true||receipt.fileId!==plan.upload.fileId||receipt.sha256!==plan.upload.sha256||receipt.company!==company||receipt.poId!==plan.record._id||receipt.name!==plan.upload.name)throw Error('Document upload receipt mismatch.');
        }
        for(const [index,upload]of (plan.extraUploads||[]).entries()){
          const receipt=await documentService({...upload,base64:extraFiles[index]?.base64});
          if(receipt?.ok!==true||receipt.fileId!==upload.fileId||receipt.sha256!==upload.sha256||receipt.company!==company||receipt.poId!==plan.record._id||receipt.name!==upload.name)throw Error('Document upload receipt mismatch.');
        }
        if(current)await store.update('PurchaseOrders',plan.record);else await store.insert('PurchaseOrders',plan.record);
      }
      return {ok:true,company,requestId,poId:plan.record._id,savedAt:plan.audit.time};
    }});
  }};
}
