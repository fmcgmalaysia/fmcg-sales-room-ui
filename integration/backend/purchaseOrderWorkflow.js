import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { createHash } from 'crypto';
import { Buffer } from 'buffer';
import { purchaseDocumentName, purchaseDocumentState, purchaseInvoiceDueDate, effectivePurchaseDocuments, purchaseDocumentStates, purchaseDocumentReview } from 'backend/purchaseDocumentPolicy.js';
import { projectInvoiceReview } from 'backend/accountPurchaseReview.js';
import { projectPaymentHandoff, projectProcurementHandoff, transitionProcurementHandoff, procurementSubmissionVersion, procurementContentLock } from 'backend/paymentHandoff.js';
export const PURCHASE_ORDER_COLLECTION = 'PurchaseOrders';
const text = value => String(value ?? '').trim();
const finite = value => typeof value === 'number' && Number.isFinite(value);
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const groupKey = row => JSON.stringify([row.supplierId,row.po]);
export function receiptCnRequirements(cases,documents){
  return cases.filter(item=>item.kind==='RECEIPT'&&item.decision?.supplierDeliveryDecision==='STOP'&&item.decision.supplierDecision==='CN_PROMISED').map(item=>({
    caseId:item.id,signature:item.signature,decisionRevision:item.decision.revision,taskId:item.taskId,quantity:item.quantity,
    pending:!documents.some(doc=>doc.type==='CN'&&doc.linked===true&&!doc.superseded&&doc.fileId&&['SHORT_DELIVERY','GOODS_DAMAGED','GOODS_EXPIRED'].includes(doc.cnReason)&&doc.receiptCaseId===item.id&&doc.receiptCaseSignature===item.signature&&doc.receiptDecisionRevision===item.decision.revision)
  }));
}
export function purchaseDocumentDeleteBlocker(row,details,document,staff){
  if(row.supplierAccount?.closed)return 'This document is locked by a closed supplier account. Ask Finance to reopen it.';
  if(!document?.uploadedByStaffId||document.uploadedByStaffId!==staff?.staffId)return 'Only the original uploader can delete this document.';
  if(document.linked!==true||document.superseded||document.deletion)return 'This document is not available for deletion.';
  if(row.state==='HISTORY'||row.invoiceChecked||details.paymentHandoff?.review||(details.finance?.payments||[]).length||(details.finance?.amounts||[]).some(entry=>entry.fileId===document.fileId)||details.procurementHandoff&&!['WITHDRAWN','RETURNED'].includes(details.procurementHandoff.stage))return 'This document is locked by payment or Finance records.';
  if((details.documentIssues||[]).some(issue=>issue.status!=='RESOLVED'&&issue.fileId===document.fileId))return 'This document is locked by an unresolved Finance issue.';
  if(details.documentDeletion)return 'A document deletion is pending. Retry the original deletion.';
  if(!document.fileId||!document.sha256||!document.name)return 'Document identity is incomplete. Contact Admin.';
  return '';
}

// A stored identity survives number changes. Tasks and supplier plans remain authoritative.
export function projectPurchaseOrders({company,workspace,records,now=new Date()}) {
  if(!['NCT','GHR'].includes(company)||workspace.company!==company)throw Error('Select NCT or GHR.');
  const groups=new Map(),used=new Set();
  for(const row of workspace.tasks.filter(row=>text(row.po))) {
    const key=groupKey(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
  }
  return [...groups.values()].map(rows=>{
    const taskIds=rows.map(row=>row.id).sort(),first=rows[0];
    const matches=records.filter(record=>record.company===company&&record.details?.taskIds?.some(id=>taskIds.includes(id)));
    if(matches.length>1)throw Error('These tasks belong to different saved purchase orders. Review their P.O. association.');
    const record=matches[0],details=record?.details||{};
    if(record&&(used.has(record._id)||details.taskIds.some(id=>!taskIds.includes(id))))throw Error('A saved purchase order was split. Restore its task association before editing it.');
    if(record)used.add(record._id);
    const events=new Map();for(const row of rows)for(const event of row.history||[])if(event.result==='SAVED'&&event.action.startsWith('PURCHASE_'))events.set(event.id,event);
    const history=[...events.values()].sort((a,b)=>String(a.time).localeCompare(String(b.time)));
    const assigned=history.find(event=>event.action==='PURCHASE_PO_ASSIGNED');
    const id=record?._id||operationId(company,'PURCHASE_ORDER',taskIds);
    const supplier=workspace.suppliers.find(item=>item.id===first.supplierId),customer=workspace.customers.find(item=>item.id===first.customerId);
    const complete=rows.every(row=>Number.isSafeInteger(row.procurement?.totalCtn)&&row.procurement.totalCtn>0&&['lpCtn','disc1','disc2','disc3'].every(key=>finite(row[key]))&&row.lpCtn*(1-row.disc1)*(1-row.disc2)-row.disc3>=0);
    const amount=complete?rows.reduce((sum,row)=>sum+(row.procurement.costing?.amountCents??Math.round((row.lpCtn*(1-row.disc1)*(1-row.disc2)-row.disc3)*row.procurement.totalCtn*100)),0)/100:null;
    const commercialEvents=history.filter(event=>event.commercialChanged===true||event.commercialChanged===undefined&&(['PURCHASE_PO_ASSIGNED','PURCHASE_AVERAGE_COST_APPLIED'].includes(event.action)||event.action==='PURCHASE_PLAN_SAVED'&&event.changes?.before!==event.changes?.after||event.action==='PURCHASE_PRICE_SAVED'&&Object.keys(event.changes?.after||{}).some(key=>key!=='manualCostField'&&event.changes.after[key]!==event.changes.before?.[key])));
    const procurementRevision=operationId(commercialEvents.map(event=>event.id).sort());
    const contentVersion=operationId(rows.map(row=>[row.id,row.barcode,row.packing,row.procurement?.totalCtn,row.lpCtn,row.disc1,row.disc2,row.disc3,...(row.procurement?.costing?[row.procurement.costing]:[])]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
    const documents=effectivePurchaseDocuments(details.documents||[],procurementRevision,contentVersion,commercialEvents),invoiceDates=documents.filter(doc=>doc.type==='INV'&&!doc.superseded).map(doc=>doc.date).sort();
    const invoiceDate=invoiceDates[0]||null,termDays=Number.isSafeInteger(details.termDays)?details.termDays:null;
    // Invoice dates, receipt closure and payment completion are not inferred from tasks.
    // Their department writers are not connected yet; never offer a premature archive.
    const shortageIssues=rows.filter(row=>row.warehouse?.issue||row.shortage?.financeRequired).map(row=>({taskId:row.id,barcode:row.barcode,name:row.name,customerId:row.customerId,decision:row.shortage||null,receivingIssue:row.warehouse?.issue===true}));
    const quantityCases=rows.flatMap(row=>row.quantityCases||[]).filter(item=>item.kind==='RECEIPT');
    const creditTransfers=(workspace.creditTransfers||[]).filter(entry=>entry.sourceId===id||entry.targetId===id);
    const cnRequirements=receiptCnRequirements(quantityCases,documents);
    const stockCases=rows.flatMap(row=>row.warehouse?.stock?.cases||[]),stockIssues=stockCases.filter(row=>row.status!=='RESOLVED');
    const projected={id,paymentRequestRevision:details.paymentRequestRevision||null,version:operationId(record||null,taskIds,rows.map(row=>row.editVersion),rows.map(row=>row.warehouse),shortageIssues,creditTransfers,...(quantityCases.length?[quantityCases.map(item=>[item.id,item.signature,item.decision?.revision||null])]:[]),...(rows.some(row=>row.procurement?.transportMode)?[rows.map(row=>[row.id,row.procurement?.transportMode||''])]:[])),contentVersion,taskIds,shortageIssues,quantityCases,cnRequirements,stockIssues,stockCases,creditTransfers,
      procurementRevision,procurementContentLocked:Boolean(procurementContentLock(details)),procurementLockReason:procurementContentLock(details),
      number:first.po,company,currency:'MYR',customerId:first.customerId,customerIds:[...new Set(rows.map(row=>row.customerId))],customers:[...new Set(rows.map(row=>row.customerId))].map(id=>({id,name:workspace.customers.find(customer=>customer.id===id)?.name||id})),customerName:[...new Set(rows.map(row=>{const item=workspace.customers.find(customer=>customer.id===row.customerId);return item?.shortName||item?.name||row.customerId;}))].join(' / '),
      shipmentDates:[...new Map(rows.map(row=>[row.orderId,{orderId:row.orderId,customerId:row.customerId,date:row.estimatedShipmentDate,updatedAt:row.shipmentDate?.at||'',updatedBy:row.shipmentDate?.by||''}])).values()],
      selfCollect:rows.some(row=>row.procurement?.transportMode==='SELF_COLLECT'),supplierId:first.supplierId,supplierShortName:supplier?.shortName||supplier?.name||'',supplierName:supplier?.name||'',
      createdAt:details.createdAt||date(assigned?.time),createdBy:details.createdBy||text(assigned?.actor),
      itemCount:new Set(rows.map(row=>JSON.stringify([row.barcode,row.packing]))).size,amount,salesInvoiceComplete:rows.every(row=>row.salesFulfilment?.sourceInvoicedQty>0?row.salesFulfilment.sourceInvoicedQty===(row.warehouse?.stock?.usableReceived??row.warehouse?.accepted):Boolean(text(row.salesInvoiceNumber))&&row.salesInvoiceLocked===true),
      receiptLines:rows.map(row=>({taskId:row.id,hasReceipt:Boolean(row.warehouse)&&row.warehouse.hasPhysicalReceipt!==false,planned:row.procurement?.totalCtn,accepted:row.warehouse?.accepted||0,issue:row.warehouse?.issue===true,decision:row.shortage||null})),
      warehouse:{connected:true,receivedCtn:rows.reduce((sum,row)=>sum+(row.warehouse?.accepted||0),0),complete:rows.every(row=>row.warehouse&&row.warehouse.accepted===row.procurement?.totalCtn&&!row.warehouse.issue),issues:rows.some(row=>row.warehouse?.issue===true)},
      termDays,invoiceDate,dueDate:purchaseInvoiceDueDate(invoiceDate,termDays),
      chasePayment:details.chasePayment===true,state:'ACTIVE',documents,documentStatus:purchaseDocumentState(documents,details.finalInvoiceComplete===true),
      status:'Awaiting payment records',canArchive:false,archiveBlockers:['Warehouse receipt closure','Completed supplier payment','Final Account verification'],
      history:[...history,...(details.audit||[])].sort((a,b)=>String(a.time).localeCompare(String(b.time))),
      updatedAt:date(details.updatedAt),readAt:now.toISOString()};
    const settlement={...projected,...projectInvoiceReview(projected,details)};
    const payment=projectPaymentHandoff(settlement,details,now),reviewed=payment.paymentHandoff.review?.confirmCurrentProcurement===true;
    const documentReviewRequired=reviewed?[]:purchaseDocumentReview(documents,procurementRevision,commercialEvents);
    const reviewedDocuments=documents.map(doc=>({...doc,requiresProcurementReview:documentReviewRequired.includes(doc.fileId)}));
    return {...settlement,...payment,documents:reviewedDocuments,documentReviewRequired,documentStates:purchaseDocumentStates(reviewedDocuments,details.documentIssues||[],cnRequirements),procurementHandoff:projectProcurementHandoff(settlement,details)};
  }).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||a.number.localeCompare(b.number));
}

export function createPurchaseOrderOperations({store,readWorkspace,names,documentService,now=()=>new Date()}) {
  const journal=createOperationJournal({store,now});
  async function list(company,staff){
    if(!names[company])throw Error('Select NCT or GHR.');
    const [workspace,records]=await Promise.all([readWorkspace(company,staff),store.all(PURCHASE_ORDER_COLLECTION)]);
    return projectPurchaseOrders({company,workspace,records,now:now()}).map(row=>{
      const details=records.find(record=>record._id===row.id)?.details||{};
      return {...row,documents:row.documents.map(document=>{const deleteBlocker=purchaseDocumentDeleteBlocker(row,details,document,staff);return {...document,deleteAllowed:!deleteBlocker,deleteBlocker};})};
    });
  }
  async function deleteDocument({company,staff,requestId,input}){
    if(!documentService)throw Error('Document deletion is not connected.');
    return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{purchaseOrder:input},prepare:async()=>{
      const row=(await list(company,staff)).find(row=>row.id===input.id);
      if(!row||row.version!==input.version)throw Error('Purchase order changed. Refresh before saving; your input is retained.');
      const current=await store.read(PURCHASE_ORDER_COLLECTION,row.id),details=current?.details||{},document=details.documents?.find(doc=>doc.fileId===input.fileId);
      const blocker=purchaseDocumentDeleteBlocker(row,details,document,staff);if(blocker)throw Error(blocker);
      const reason=text(input.reason);if(!reason||reason.length>2000)throw Error('Please enter a reason.');
      return {expected:operationId(current),expectedVersion:row.version,document,taskIds:row.taskIds,startedAt:now().toISOString(),trash:{action:'TRASH',company,poId:row.id,fileId:document.fileId,sha256:document.sha256,name:document.name,type:document.type},event:{id:operationId(company,requestId,staff.memberId,'PO_DELETE_AUDIT'),action:'SUPPLIER_DOCUMENT_DELETED',actor:staff.staffName,actorStaffId:staff.staffId,result:'SAVED',message:reason,changes:{fileId:document.fileId,name:document.name,type:document.type,number:document.number,uploadedAt:document.uploadedAt,uploadedBy:document.uploadedBy,uploadedByStaffId:document.uploadedByStaffId,reason}}};
    },apply:async plan=>{
      let current=await store.read(PURCHASE_ORDER_COLLECTION,input.id);
      if(!current)throw Error('Purchase order changed while saving.');
      if(current.details.audit?.some(event=>event.id===plan.event.id))return {ok:true,company,requestId,poId:input.id};
      const pending=current.details.documentDeletion;
      if(!(pending?.requestId===requestId&&pending.fileId===input.fileId&&pending.byStaffId===staff.staffId)){
        const row=(await list(company,staff)).find(row=>row.id===input.id);
        if(operationId(current)!==plan.expected||row?.version!==plan.expectedVersion)throw Error('Purchase order changed while saving.');
        const blocker=purchaseDocumentDeleteBlocker(row,current.details,current.details.documents.find(doc=>doc.fileId===input.fileId),staff);if(blocker)throw Error(blocker);
        // Remove the financial association before the external side effect. The journal retains the exact file and request for recovery.
        const deletion={requestId,fileId:input.fileId,by:staff.staffName,byStaffId:staff.staffId,at:plan.startedAt};
        await store.update(PURCHASE_ORDER_COLLECTION,{...current,details:{...current.details,documentDeletion:deletion,documents:current.details.documents.map(doc=>doc.fileId===input.fileId?{...doc,linked:false,deletion:{...deletion,state:'PENDING'}}:doc)}});
      }
      const receipt=await documentService(plan.trash);
      if(receipt?.ok!==true||receipt.trashed!==true||receipt.fileId!==plan.trash.fileId||receipt.company!==company||receipt.poId!==input.id||receipt.sha256!==plan.trash.sha256||receipt.name!==plan.trash.name)throw Error('Document deletion could not be confirmed. Retry the same deletion.');
      current=await store.read(PURCHASE_ORDER_COLLECTION,input.id);
      if(current?.details.documentDeletion?.requestId!==requestId||current.details.documentDeletion.byStaffId!==staff.staffId)throw Error('Document deletion state changed. Contact Admin.');
      const at=now().toISOString(),event={...plan.event,time:at};
      await store.update(PURCHASE_ORDER_COLLECTION,{...current,details:{...current.details,documentDeletion:null,updatedAt:at,documents:current.details.documents.map(doc=>doc.fileId===input.fileId?{...doc,linked:false,deletion:{...doc.deletion,state:'DELETED',at}}:doc),audit:[...(current.details.audit||[]),event]}});
      return {ok:true,company,requestId,poId:input.id,savedAt:at};
    }});
  }
  async function save({company,staff,requestId,input}) {
    if(!names[company]||!input||!['DOCUMENT_ISSUE_RESPONSE','CHASE','TERM','DOCUMENT','DELETE_DOCUMENT','ACK_PAYMENT','REQUEST_PAYMENT','SUBMIT_FINANCE','WITHDRAW_FINANCE','REQUEST_RETURN'].includes(input.action))throw Error('Unsupported purchase order action.');
    if(input.action==='CHASE'){
      const key=operationId(company+'/PURCHASE',requestId,staff?.memberId);
      const prior=await store.read(names[company].activity,operationId(key,'RESULT')),prepared=await store.read(names[company].activity,key);
      if(!prior&&!prepared)throw Error('Please use Messages to contact Account. The old payment reminder has been retired.');
    }
    if(input.action==='DELETE_DOCUMENT')return deleteDocument({company,staff,requestId,input});
    let payload=null,journalInput=input;
    if(input.action==='DOCUMENT'){
      if(!documentService)throw Error('Document upload is not connected.');
      if(typeof input.base64!=='string'||input.base64.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw Error('Select a PDF up to 3 MiB.');
      const bytes=Buffer.from(input.base64,'base64');
      if(bytes.length<5||bytes.length>3*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.toString('base64')!==input.base64)throw Error('Select a valid PDF up to 3 MiB.');
      payload=input.base64;
      journalInput={id:input.id,version:input.version,action:'DOCUMENT',type:input.type,date:input.date,number:text(input.number),reason:text(input.reason),declaredCents:input.declaredCents,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,...(input.type==='CN'?{cnReason:text(input.cnReason),receiptCaseId:text(input.receiptCaseId),receiptCaseSignature:text(input.receiptCaseSignature),receiptDecisionRevision:text(input.receiptDecisionRevision)}:{}),...(input.issueId?{issueId:input.issueId}:{})};
    }
    return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{purchaseOrder:journalInput},prepare:async()=>{
      const rows=await list(company,staff),row=rows.find(row=>row.id===input.id);
      if(!row||row.version!==input.version)throw Error('Purchase order changed. Refresh before saving; your input is retained.');
      const current=await store.read(PURCHASE_ORDER_COLLECTION,row.id),before=current?.details||{};
      if(row.supplierAccount?.closed&&input.action!=='ACK_PAYMENT')throw Error('Purchase order changed. Ask Finance to reopen the closed supplier account before editing.');
      if(before.documentDeletion)throw Error('A document deletion is pending. Retry the original deletion.');
      const reason=text(input.reason);if(!reason||reason.length>2000)throw Error('Please enter a reason.');
      let patch;
      let upload;
      if(input.action==='DOCUMENT_ISSUE_RESPONSE'){
        const issue=(before.documentIssues||[]).find(item=>item.id===input.issueId);
        if(row.state==='HISTORY'||!issue||issue.status!=='OPEN'||!row.documents.some(doc=>doc.fileId===issue.fileId&&doc.sha256===issue.sha256&&!doc.superseded))throw Error('Purchase order changed. Select an open document issue.');
        patch={documentIssues:before.documentIssues.map(item=>item.id===issue.id?{...item,status:'AWAITING_REVIEW',response:{reason,at:now().toISOString(),by:staff.staffName,byStaffId:staff.staffId}}:item)};
      }else if(input.action==='REQUEST_PAYMENT'){
        const credits=row.documents.filter(doc=>doc.type==='CN'&&!doc.superseded);
        if(rows.some(other=>other.id!==row.id&&other.documents.some(doc=>doc.type==='CN'&&!doc.superseded&&credits.some(credit=>credit.fileId===doc.fileId||credit.sha256&&credit.sha256===doc.sha256))))throw Error('Payment request CN is also linked to another PO. Account must resolve its allocation.');
        const requestedRow={...row,termDays:input.termDays,paymentRequestRevision:requestId};
        patch={termDays:input.termDays,paymentRequestRevision:requestId,procurementHandoff:transitionProcurementHandoff(requestedRow,before,input,{at:now().toISOString(),by:staff.staffName,byStaffId:staff.staffId},'PURCHASE'),paymentHandoff:{...(before.paymentHandoff||{}),review:null}};
      }else if(['SUBMIT_FINANCE','WITHDRAW_FINANCE','REQUEST_RETURN'].includes(input.action)){
        patch={procurementHandoff:transitionProcurementHandoff(row,before,input,{at:now().toISOString(),by:staff.staffName,byStaffId:staff.staffId},'PURCHASE'),...(input.action==='SUBMIT_FINANCE'?{chasePayment:input.urgent===true}:{})};
      }else if(input.action==='DOCUMENT'){
        if(!row.supplierId)throw Error('Select a supplier before uploading documents.');
        if(input.type==='PO'&&procurementContentLock(before))throw Error(procurementContentLock(before));
        const issue=input.issueId?(before.documentIssues||[]).find(item=>item.id===input.issueId):null;
        if(input.issueId&&(row.state==='HISTORY'||!issue||issue.status!=='OPEN'||issue.type!==input.type||!row.documents.some(doc=>doc.fileId===issue.fileId&&doc.sha256===issue.sha256&&!doc.superseded)))throw Error('Purchase order changed. Select an open issue for this document type.');
        if(['INV','CN'].includes(input.type)&&(!Number.isSafeInteger(input.declaredCents)||input.declaredCents<=0||input.declaredCents>999999999999))throw Error('Enter the supplier document amount in MYR.');
        let cnMetadata={};
        if(input.type==='CN'){
          if(!['DISCOUNT_REBATE','SHORT_DELIVERY','GOODS_DAMAGED','GOODS_EXPIRED'].includes(input.cnReason))throw Error('Purchase order changed. Select one CN reason.');
          if(input.receiptCaseId){
            const required=row.cnRequirements.find(item=>item.caseId===input.receiptCaseId);
            if(input.cnReason==='DISCOUNT_REBATE'||!required||required.signature!==input.receiptCaseSignature||required.decisionRevision!==input.receiptDecisionRevision)throw Error('Purchase order changed. The CN shortfall decision changed. Refresh and select the current case.');
            cnMetadata={receiptCaseId:required.caseId,receiptCaseSignature:required.signature,receiptDecisionRevision:required.decisionRevision};
          }else if(input.receiptCaseSignature||input.receiptDecisionRevision)throw Error('Purchase order changed. Select the CN shortfall case.');
          cnMetadata.cnReason=input.cnReason;
        }
        const uploadDate=now().toISOString(),documentDate=uploadDate.slice(0,10);
        const name=purchaseDocumentName({date:documentDate,supplierShortName:row.supplierShortName,type:input.type,number:input.number});
        if(row.documents.some(doc=>doc.linked&&!doc.superseded&&doc.sha256===journalInput.sha256&&doc.type===input.type&&doc.number===text(input.number)))throw Error('This document is already linked to the purchase order.');
        const allocated=await documentService({action:'ALLOCATE',company});
        upload={action:'UPLOAD',company,poId:row.id,fileId:allocated.fileId,name,type:input.type,sha256:journalInput.sha256};
        const document={fileId:allocated.fileId,name,type:input.type,number:text(input.number),date:documentDate,...cnMetadata,size:journalInput.size,sha256:journalInput.sha256,linked:true,...(Number.isSafeInteger(input.declaredCents)?{declaredCents:input.declaredCents}:{}),uploadedAt:uploadDate,uploadedBy:staff.staffName,uploadedByStaffId:staff.staffId};
        if(['PO','PI','SO','INV','CN'].includes(input.type))document.procurementRevision=row.procurementRevision;
        if(input.type==='PO')document.contentVersion=row.contentVersion;
        if(issue){document.superseded=true;document.pendingIssueId=issue.id;}
        patch={documents:[...(before.documents||[]).map(doc=>input.type==='PO'&&!issue&&doc.type==='PO'&&doc.linked?{...doc,superseded:true,supersededBy:document.fileId}:doc),document],...(input.type==='INV'?{finalInvoiceComplete:true}:{}),...(issue?{documentIssues:before.documentIssues.map(item=>item.id===issue.id?{...item,status:'AWAITING_REVIEW',response:{reason,fileId:document.fileId,sha256:document.sha256,at:document.uploadedAt,by:staff.staffName,byStaffId:staff.staffId}}:item)}:{})};
      } else if(input.action==='ACK_PAYMENT'){
        const payment=row.finance.payments.find(payment=>payment.id===input.paymentId&&payment.confirmed&&payment.direction!=='REFUND'&&payment.proof?.linked);
        if(!payment)throw Error('Select an actual payment notification.');
        const acknowledgements=before.paymentHandoff?.acknowledgements||[];
        if(acknowledgements.some(entry=>entry.paymentId===payment.id&&entry.sha256===payment.proof.sha256))throw Error('This payment notification was already acknowledged.');
        patch={paymentHandoff:{...(before.paymentHandoff||{}),acknowledgements:[...acknowledgements,{paymentId:payment.id,sha256:payment.proof.sha256,by:staff.staffName,byStaffId:staff.staffId,at:now().toISOString()}]}};
      } else if(input.action==='CHASE'){
        if(before.procurementHandoff&&!row.procurementHandoff.submitted)throw Error('Procurement handoff must be submitted before chasing payment.');
        if(typeof input.enabled!=='boolean'||input.enabled===row.chasePayment)throw Error('Payment chase has not changed.');
        patch={chasePayment:input.enabled};
      } else {
        if(procurementContentLock(before))throw Error(procurementContentLock(before));
        if(before.procurementHandoff&&!row.procurementHandoff.editable)throw Error('Procurement handoff has locked payment terms. Request return before editing.');
        if(!Number.isSafeInteger(input.termDays)||input.termDays<0||input.termDays>3650)throw Error('Enter payment terms from 0 to 3650 days.');
        if(input.termDays===row.termDays)throw Error('Payment term has not changed.');
        patch={termDays:input.termDays};
      }
      const at=now().toISOString(),event={id:operationId(company,requestId,staff.memberId,'PO_AUDIT'),action:input.action==='ACK_PAYMENT'?'PAYMENT_NOTIFICATION_ACKNOWLEDGED':input.action==='DOCUMENT'?'SUPPLIER_DOCUMENT_UPLOADED':input.action==='CHASE'?'PAYMENT_CHASE_CHANGED':'PAYMENT_TERM_CHANGED',time:at,actor:staff.staffName,actorStaffId:staff.staffId,result:'SAVED',message:reason,changes:input.action==='DOCUMENT'?{type:input.type,number:text(input.number),date:patch.documents.at(-1).date,fileId:upload.fileId,name:upload.name,reason,...(input.type==='CN'?{cnReason:input.cnReason,receiptCaseId:text(input.receiptCaseId),receiptCaseSignature:text(input.receiptCaseSignature),receiptDecisionRevision:text(input.receiptDecisionRevision),date:patch.documents.at(-1).date}:{})}:{before:Object.fromEntries(Object.keys(patch).map(key=>[key,row[key]])),after:patch,reason}};
      const record={...(current||{}),_id:row.id,title:row.id,company,details:{...before,taskIds:row.taskIds,createdAt:row.createdAt,createdBy:row.createdBy,...patch,updatedAt:at,audit:[...(before.audit||[]),event]}};
      if('procurementHandoff' in patch&&patch.procurementHandoff)event.action='PROCUREMENT_'+input.action;
      if(input.action==='DOCUMENT_ISSUE_RESPONSE')event.action='SUPPLIER_DOCUMENT_ISSUE_RESPONSE';
      return {record,expected:current?operationId(current):null,expectedVersion:row.version,expectedBasis:procurementSubmissionVersion(row),event,...(upload?{upload}:{})};
    },apply:async plan=>{
      const current=await store.read(PURCHASE_ORDER_COLLECTION,plan.record._id);
      if(!current?.details?.audit?.some(event=>event.id===plan.event.id)) {
        if((current?operationId(current):null)!==plan.expected)throw Error('Purchase order changed while saving.');
        if(plan.expectedVersion){const latest=(await list(company,staff)).find(row=>row.id===plan.record._id);if(latest?.version!==plan.expectedVersion||plan.expectedBasis&&procurementSubmissionVersion(latest)!==plan.expectedBasis)throw Error('Purchase order changed while saving.');}
        if(plan.upload){
          const receipt=await documentService({...plan.upload,base64:payload});
          if(receipt.ok!==true||receipt.fileId!==plan.upload.fileId||receipt.sha256!==plan.upload.sha256||receipt.company!==company||receipt.poId!==plan.record._id||receipt.name!==plan.upload.name)throw Error('Document upload receipt mismatch.');
          // Persist association only after Drive confirms the exact preallocated file.
          const document=plan.record.details.documents.find(doc=>doc.fileId===receipt.fileId);
          document.url='https://drive.google.com/file/d/'+receipt.fileId+'/view';
        }
        if(current)await store.update(PURCHASE_ORDER_COLLECTION,plan.record);else await store.insert(PURCHASE_ORDER_COLLECTION,plan.record);
      }
      return {ok:true,company,requestId,poId:plan.record._id,savedAt:plan.event.time};
    }});
  }
  return {list,save};
}
