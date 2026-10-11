export const PURCHASE_DOCUMENT_ROOTS=Object.freeze({
  NCT:'12gCZmqioYGZyRmgW3CsWyobBBcUnCFUS',
  GHR:'18w4I96N3PSCTv2Qxs_mycy-PMu-lth9w'
});
export const PURCHASE_DOCUMENT_TYPES=Object.freeze(['INV','CN','SO','PI']);
export function purchaseDocumentName({date,supplierShortName,type,number}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Enter the supplier document date.');
  if(!PURCHASE_DOCUMENT_TYPES.includes(type))throw Error('Select INV, CN, SO or PI.');
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
