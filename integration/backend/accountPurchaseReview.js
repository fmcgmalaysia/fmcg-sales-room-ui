import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { purchaseDocumentState } from 'backend/purchaseDocumentPolicy.js';
const text=value=>String(value??'').trim();
export function requireAccountStaff(member,records) {
  const email=text(member?.loginEmail).toLowerCase();
  if(!member?._id||!email||member.status!=='APPROVED')throw Error('Please sign in with your approved Master staff account.');
  const matches=records.filter(row=>text(row.staffEmail).toLowerCase()===email);
  if(matches.length!==1)throw Error('Master staff access is not configured.');
  const row=matches[0],role=text(row.role).toUpperCase(),departments=Array.isArray(row.departments)?row.departments.map(value=>text(value).toUpperCase()):[];
  if(!text(row.title)||text(row.description)!==member._id||!text(row.staffName)||text(row.staffStatus).toUpperCase()!=='ACTIVE'||!(departments.includes('ACCOUNT')||role==='SUPER ADMIN'||role==='TOP MANAGEMENT'))throw Error('Account access is not authorized.');
  return {staffId:text(row.title),staffName:text(row.staffName),role,memberId:member._id};
}
export function invoiceReviewVersion(row) {
  const documents=row.documents.filter(doc=>doc.linked===true&&doc.superseded!==true).map(doc=>[doc.fileId,doc.type,doc.sha256,doc.number,doc.date]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return operationId(row.company,row.id,row.number,row.supplierId,row.taskIds,row.contentVersion,row.amount,documents);
}
export function projectInvoiceReview(row,details) {
  const hasInvoice=row.documents.some(doc=>doc.type==='INV'&&doc.fileId&&doc.linked===true&&!doc.superseded);
  // Whole-transaction review replaces the unpublished invoice-only candidate.
  // No authoritative warehouse closure or financial reconciliation writer exists yet.
  // A legacy flag or a browser request must never stand in for those records.
  const checked=false;
  return {invoiceChecked:checked,invoiceCheck:details.invoiceCheck?{...details.invoiceCheck}:null,
    canCheck:false,checkBlocker:'等待仓库实收及财务对账接通 / Warehouse receipts and financial reconciliation are not connected.',
    creditorActive:hasInvoice,documentStatus:purchaseDocumentState(row.documents,checked)};
}
export function createAccountReviewOperations({store,listOrders,names,now=()=>new Date()}) {
  const journal=createOperationJournal({store,now});
  async function save({company,staff,requestId,input}) {
    if(!names[company]||input?.action!=='INVOICE_CHECK'||typeof input.enabled!=='boolean')throw Error('Unsupported Account action.');
    return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{accountReview:input},prepare:async()=>{
      const row=(await listOrders(company,staff)).find(row=>row.id===input.id);
      if(!row||row.version!==input.version)throw Error('Purchase order changed. Refresh before saving; your input is retained.');
      if(input.enabled===row.invoiceChecked)throw Error('Invoice check has not changed.');
      if(input.enabled&&!row.documents.some(doc=>doc.type==='INV'&&doc.linked===true&&!doc.superseded))throw Error('Final supplier Invoice is required before checking.');
      if(input.enabled)throw Error('Warehouse receipts and financial reconciliation are not connected.');
      if(input.enabled&&row.amount===null)throw Error('Purchase amount is incomplete. Review the purchase order first.');
      const reason=text(input.reason);if(reason.length>2000||(!input.enabled&&!reason))throw Error('Please enter a reason to cancel the invoice check.');
      const current=await store.read('PurchaseOrders',row.id),before=current?.details||{},at=now().toISOString();
      const check={enabled:input.enabled,reviewVersion:invoiceReviewVersion(row),checkedAt:at,checkedBy:staff.staffName,checkedByStaffId:staff.staffId};
      const event={id:operationId(company,requestId,staff.memberId,'ACCOUNT_REVIEW'),action:'SUPPLIER_INVOICE_CHECK_CHANGED',time:at,actor:staff.staffName,actorStaffId:staff.staffId,result:'SAVED',message:reason||'Final supplier Invoice checked',changes:{before:row.invoiceChecked,after:input.enabled,reviewVersion:check.reviewVersion,reason}};
      const record={...(current||{}),_id:row.id,title:row.id,company,details:{...before,taskIds:row.taskIds,createdAt:row.createdAt,createdBy:row.createdBy,invoiceCheck:check,updatedAt:at,audit:[...(before.audit||[]),event]}};
      return {record,expected:current?operationId(current):null,event};
    },apply:async plan=>{
      const current=await store.read('PurchaseOrders',plan.record._id);
      if(!current?.details?.audit?.some(event=>event.id===plan.event.id)){
        if((current?operationId(current):null)!==plan.expected)throw Error('Purchase order changed while saving.');
        // Recheck task costs/quantity/file state before recording the approval.
        const row=(await listOrders(company,staff)).find(row=>row.id===plan.record._id);
        if(!row||invoiceReviewVersion(row)!==plan.record.details.invoiceCheck.reviewVersion)throw Error('Purchase order changed while saving.');
        if(current)await store.update('PurchaseOrders',plan.record);else await store.insert('PurchaseOrders',plan.record);
      }
      return {ok:true,company,requestId,poId:plan.record._id,savedAt:plan.event.time};
    }});
  }
  return {save};
}
