import { invoiceDeskSnapshots } from 'backend/supportDesk.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { projectCustomerAccount } from 'backend/customerDebtor.js';
import { readSupportDocuments, customerFileReady, supportDocumentMatchesShipment } from 'backend/supportDocuments.js';
import { readLoadedInvoiceRecords } from 'backend/customerLoadedRecords.js';
import { operationId } from 'backend/purchaseOperationJournal.js';

// Read model only. Shipment, money and attachment ledgers remain the authorities.
const publicCodes = new Set(['SO', 'BC', 'SI', 'DO', 'CN', 'DN', 'PL', 'INS', 'CF', 'BL', '$']);
const file = (document, ready) => {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(document.fileId || '')) throw Error('Customer file requires review.');
  return { id: document.id, fileId: document.fileId,
    ready, url: ready ? 'https://drive.google.com/file/d/' + document.fileId + '/view' : null,
    name: document.name || document.number || document.reference || '',
    at: document.at || '', code: document.code || ({ SALES_INV: 'SI', SALES_CN: 'CN',
      CUSTOMER_RECEIPT: 'RECEIPT', DEBIT_NOTE: 'DN', CHARGE_INV: 'SI' })[document.type],
    number: document.number || document.reference || '', scope: document.scope || 'ACCOUNT',
    orderId: document.orderId || '', invoiceId: document.invoiceId || document.shipmentId || '',
    ...(document.desk ? { desk: document.desk, ...(document.batchId?{batchId:document.batchId}:{}) } : {}) };
};

export function projectCustomerTransactionHistory(context, customerId) {
  const { company, activity } = context,deskSnapshots=invoiceDeskSnapshots(activity);
  if (!['NCT', 'GHR'].includes(company) || typeof customerId !== 'string' || !customerId || customerId.length > 100) {
    throw Error('Customer history identity is required.');
  }
  const shipments = readCustomerShipments(activity).filter(row => row.company === company && row.customerId === customerId);
  const shipmentsById = new Map();
  for(const shipment of shipments)if(!shipmentsById.has(shipment.id))shipmentsById.set(shipment.id,shipment);
  const account = projectCustomerAccount(context);
  const entries = account.entries.filter(row => row.company === company && row.customerId === customerId);
  const supportDocuments=readSupportDocuments(activity,company),delivered=new Set(supportDocuments.filter(d=>d.customerId===customerId&&customerFileReady(activity,d,company)).map(d=>d.fileId));
  const publicFile=d=>file(d,delivered.has(d.fileId)||customerFileReady(activity,d,company));
  const knownOrders = new Set((context.tasks || []).filter(row => row.customerId === customerId).map(row => row.orderId));
  shipments.forEach(row => row.lines.forEach(line => knownOrders.add(line.orderId)));
  const supportFiles = supportDocuments
    .filter(row => row.customerId === customerId && !row.superseded && row.invoiceKind!=='STANDALONE_DN' && publicCodes.has(row.code) && (row.scope==='CUSTOMER'||knownOrders.has(row.orderId)))
    .filter(row => {
      const shipment=shipmentsById.get(row.invoiceId);
      return !row.invoiceId || shipment &&
        shipment.lines.some(line => line.orderId === row.orderId) &&
        (row.scope !== 'DESK' || shipment.desk === row.desk);
    })
    .map(publicFile);
  const accountFiles = entries.flatMap(row => row.documents.map(document=>publicFile(row.type==='CHARGE_INV'||row.invoiceKind==='STANDALONE_DN'?{...document,shipmentId:row.id}:document)));
  // The same Drive file may be linked by both existing ledgers; never duplicate it in the customer library.
  const documents = [...new Map([...supportFiles, ...accountFiles].map(row => [row.fileId, row])).values()]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.id.localeCompare(b.id));
  const documentsByFile = new Map(documents.map(row => [row.fileId, row]));
  const documentsByInvoice = new Map(), documentsByOrder = new Map(), documentRank = new Map();
  documents.forEach((document,index)=>{
    documentRank.set(document.fileId,index);
    for(const [key,map] of [[document.invoiceId,documentsByInvoice],[document.orderId,documentsByOrder]]){
      if(!key)continue;
      if(!map.has(key))map.set(key,[]);
      map.get(key).push(document);
    }
  });
  function invoiceFiles(id,shipment){
    const candidates=new Set(documentsByInvoice.get(id)||[]);
    for(const line of shipment?.lines||[])for(const document of documentsByOrder.get(line.orderId)||[])candidates.add(document);
    return [...candidates].sort((a,b)=>documentRank.get(a.fileId)-documentRank.get(b.fileId))
      .filter(doc=>doc.invoiceId===id||shipment&&supportDocumentMatchesShipment({...doc,company,customerId},shipment,activity,deskSnapshots.get(id)||null));
  }
  const loadedRecords=readLoadedInvoiceRecords(activity,shipments),loadedIds=new Set(loadedRecords.map(row=>row.id));
  const invoices=account.invoicePayments.invoices.filter(row=>row.customerId===customerId);
  const savedInputs=new Set(activity.map(event=>JSON.stringify([event.title,event.description]))),preparedByNumber=new Map();
  for(const event of activity)if(event.action==='SUPPORT_INVOICE_PREPARED'&&event.image===customerId&&event.details?.invoice?.number&&event.details?.customerDetails){const number=event.details.invoice.number,list=preparedByNumber.get(number)||[];list.push(event);preparedByNumber.set(number,list);}
  const transactions=invoices.filter(row=>row.kind==='CHARGE'||loadedIds.has(row.id)).map(row=>{
    const source=shipmentsById.get(row.id),invoiceDocuments=invoiceFiles(row.id,source);
    const related=entry=>({...entry,documents:documentsByFile.has(entry.fileId)?[documentsByFile.get(entry.fileId)]:[]});
    const prepared=(preparedByNumber.get(row.number)||[]).filter(event=>savedInputs.has(JSON.stringify([operationId(event._id,'SUPPORT_INVOICE_INPUT_SAVED'),row.id])));
    if(prepared.length>1)throw Error('Invoice shipment details require review.');
    const snapshot=prepared[0]?.details.customerDetails;
    return {id:row.id,company,customerId,kind:row.kind,number:row.number,date:row.date,currency:row.currency,amountCents:row.amountCents,quantity:row.quantity,paidCents:row.paidCents,creditCents:row.creditCents,debitCents:row.debitCents,dueCents:row.dueCents,lastPayment:row.lastPayment?related(row.lastPayment):null,payments:row.payments.map(related),adjustments:row.adjustments.map(related),documents:invoiceDocuments,
      lines:row.kind==='CHARGE'?row.chargeLines.map(line=>({description:line.description,amountCents:line.amountCents})):source.lines.map(line=>({name:line.name,packing:line.packing,quantity:line.quantity,sellingPriceCtn:line.sellingPriceCtn})),
      transport:source?.invoice?.transport||snapshot?.transport||'',departureDate:source?.invoice?.departureDate||snapshot?.departureDate||''};
  }).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
  return { company, customerId, transactions,
    shipments: loadedRecords.map(row => ({
      id: row.id, company, customerId, desk: row.desk || null, recordedAt: row.invoice.at || row.invoice.date,
      number: row.invoice.number, date: row.invoice.date,
      currency: row.invoice.currency, amountCents: row.invoice.amountCents,
      lines: row.lines.map(line => ({ taskId: line.taskId, orderId: line.orderId,
        sourceLineId: line.sourceLineId, barcode: line.barcode, name: line.name,
        packing: line.packing, quantity: line.quantity, sellingPriceCtn: line.sellingPriceCtn,
        // Old invoice snapshots have no immutable weight/volume. Do not substitute current catalogue data.
        cbm: null, netKg: null, grossKg: null })),
      documents: invoiceFiles(row.id,row)
    })).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)) || a.id.localeCompare(b.id)),
    account: {
      balances: account.balances.filter(row => row.customerId === customerId).map(row => ({
        company, customerId, currency: row.currency, invoiceCents: row.invoiceCents,
        debitCents: row.debitCents, creditCents: row.creditCents, receiptCents: row.receiptCents,
        balanceCents: row.balanceCents
      })),
      entries: entries.map(row => ({ id: row.id, company, customerId, type: row.type,
        number: row.number, date: row.date, currency: row.currency, amountCents: row.amountCents,
        signedCents: row.signedCents, at: row.at, documents: row.documents.map(publicFile) })),
      // Existing receipts are customer/currency postings, not invoice allocations or bank confirmations.
      invoiceMatching: 'EXPLICIT_ALLOCATIONS',
      unapplied:account.invoicePayments.unapplied.filter(row=>row.customerId===customerId)
    }, documents };
}
