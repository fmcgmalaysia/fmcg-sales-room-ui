export const PURCHASE_DOCUMENT_ROOTS=Object.freeze({
  NCT:'12gCZmqioYGZyRmgW3CsWyobBBcUnCFUS',
  GHR:'18w4I96N3PSCTv2Qxs_mycy-PMu-lth9w'
});
export const PURCHASE_DOCUMENT_TYPES=Object.freeze(['PO','INV','CN','SO','PI','DO']);
export function effectivePurchaseDocuments(documents,revision,contentVersion,history){
 const linked=documents.filter(doc=>doc.linked===true);
 const projected=linked.map(doc=>{
  if(doc.type!=='PO'||doc.superseded)return {...doc};
  const dated=Number.isFinite(Date.parse(doc.uploadedAt));
  const stale=doc.procurementRevision?doc.procurementRevision!==revision||doc.contentVersion!==contentVersion:!dated||history.some(event=>!Number.isFinite(Date.parse(event.time))||Date.parse(event.time)>Date.parse(doc.uploadedAt));
  return stale?{...doc,superseded:true,invalidated:true,deleteAllowed:false,invalidatedReason:'PO content changed. Upload the current PO.'}:{...doc};
 });
 // Ambiguous legacy duplicates require one explicit replacement; never guess which file is valid.
 if(projected.filter(doc=>doc.type==='PO'&&!doc.superseded).length>1)return projected.map(doc=>doc.type==='PO'&&!doc.superseded?{...doc,superseded:true,invalidated:true,invalidatedReason:'Multiple PO files require one current replacement.'}:doc);
 return projected;
}
export function purchaseDocumentStates(documents,issues=[],cnRequirements=[]){
 return Object.fromEntries(['PO','PI','DO','INV','CN'].map(type=>{
  const types=type==='PI'?['PI','SO']:[type],current=documents.filter(doc=>types.includes(doc.type)&&doc.linked&&!doc.superseded&&doc.fileId);
  const problem=current.some(doc=>doc.requiresProcurementReview)||issues.some(issue=>types.includes(issue.type)&&issue.status!=='RESOLVED')||type==='PO'&&!current.length&&documents.some(doc=>doc.type==='PO'&&doc.invalidated)||type==='CN'&&cnRequirements.some(item=>item.pending);
  return [type,{state:problem?'PROBLEM':current.length?'AVAILABLE':'MISSING',count:current.length}];
 }));
}
export function purchaseDocumentReview(documents,revision,history){
 return documents.filter(doc=>doc.linked&&!doc.superseded&&['PI','SO','INV','CN'].includes(doc.type)).filter(doc=>doc.procurementRevision?doc.procurementRevision!==revision:!Number.isFinite(Date.parse(doc.uploadedAt))||history.some(event=>!Number.isFinite(Date.parse(event.time))||Date.parse(event.time)>Date.parse(doc.uploadedAt))).map(doc=>doc.fileId);
}
export function purchaseDocumentName({date,supplierShortName,type,number}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Enter the supplier document date.');
  if(!PURCHASE_DOCUMENT_TYPES.includes(type))throw Error('Select PO, INV, CN, SO, PI or DO.');
  const clean=value=>String(value||'').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,120);
  const supplier=clean(supplierShortName),no=clean(number);
  if(!supplier||!no)throw Error('Supplier short name and document number are required.');
  return `${date} ${supplier} ${type} ${no}.pdf`;
}
export function purchaseDocumentState(documents,finalInvoiceComplete=false) {
  const valid=documents.filter(row=>row.fileId&&row.linked===true&&row.superseded!==true);
  if(finalInvoiceComplete&&valid.some(row=>row.type==='INV'))return 'COMPLETE';
  if(valid.some(row=>['INV','SO','PI'].includes(row.type)))return 'PROVISIONAL';
  return 'MISSING';
}
export function purchaseInvoiceDueDate(invoiceDate,termDays) {
  if(!invoiceDate||!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)||!Number.isSafeInteger(termDays)||termDays<0||termDays>3650)return null;
  const at=new Date(invoiceDate);if(!Number.isFinite(at.getTime())||at.toISOString().slice(0,10)!==invoiceDate)return null;
  at.setUTCDate(at.getUTCDate()+termDays);return at.toISOString().slice(0,10);
}
export function purchaseArchiveEligible({warehouseClosed,paymentCompleted,accountVerified,documentsComplete}) {
  return [warehouseClosed,paymentCompleted,accountVerified,documentsComplete].every(value=>value===true);
}
