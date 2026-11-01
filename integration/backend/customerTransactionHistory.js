import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { projectCustomerAccount } from 'backend/customerDebtor.js';
import { readSupportDocuments, customerFileReady } from 'backend/supportDocuments.js';
import { readLoadedInvoiceRecords } from 'backend/customerLoadedRecords.js';

// Read model only. Shipment, money and attachment ledgers remain the authorities.
const publicCodes = new Set(['SO', 'BC', 'SI', 'DO', 'CN', 'DN', 'PL', 'INS', 'CF', 'BL', '$']);
const file = (document, ready) => {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(document.fileId || '')) throw Error('Customer file requires review.');
  return { id: document.id, fileId: document.fileId,
    ready, url: ready ? 'https://drive.google.com/file/d/' + document.fileId + '/view' : null,
    name: document.name || document.number || document.reference || '',
    at: document.at || '', code: document.code || ({ SALES_INV: 'SI', SALES_CN: 'CN',
      CUSTOMER_RECEIPT: 'RECEIPT', DEBIT_NOTE: 'DN' })[document.type],
    number: document.number || document.reference || '', scope: document.scope || 'ACCOUNT',
    orderId: document.orderId || '', invoiceId: document.invoiceId || document.shipmentId || '',
    ...(document.desk ? { desk: document.desk } : {}) };
};

export function projectCustomerTransactionHistory(context, customerId) {
  const { company, activity } = context;
  if (!['NCT', 'GHR'].includes(company) || typeof customerId !== 'string' || !customerId || customerId.length > 100) {
    throw Error('Customer history identity is required.');
  }
  const shipments = readCustomerShipments(activity).filter(row => row.company === company && row.customerId === customerId);
  const account = projectCustomerAccount(context);
  const entries = account.entries.filter(row => row.company === company && row.customerId === customerId);
  const supportDocuments=readSupportDocuments(activity,company),delivered=new Set(supportDocuments.filter(d=>d.customerId===customerId&&customerFileReady(activity,d,company)).map(d=>d.fileId));
  const publicFile=d=>file(d,delivered.has(d.fileId)||customerFileReady(activity,d,company));
  const knownOrders = new Set((context.tasks || []).filter(row => row.customerId === customerId).map(row => row.orderId));
  shipments.forEach(row => row.lines.forEach(line => knownOrders.add(line.orderId)));
  const supportFiles = supportDocuments
    .filter(row => row.customerId === customerId && !row.superseded && publicCodes.has(row.code) && (row.scope==='CUSTOMER'||knownOrders.has(row.orderId)))
    .filter(row => !row.invoiceId || shipments.some(shipment => shipment.id === row.invoiceId &&
      shipment.lines.some(line => line.orderId === row.orderId) &&
      (row.scope !== 'DESK' || shipment.desk === row.desk)))
    .map(publicFile);
  const accountFiles = entries.flatMap(row => row.documents.map(publicFile));
  // The same Drive file may be linked by both existing ledgers; never duplicate it in the customer library.
  const documents = [...new Map([...supportFiles, ...accountFiles].map(row => [row.fileId, row])).values()]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.id.localeCompare(b.id));
  return { company, customerId,
    shipments: readLoadedInvoiceRecords(activity,shipments).map(row => ({
      id: row.id, company, customerId, desk: row.desk || null, recordedAt: row.invoice.at || row.invoice.date,
      number: row.invoice.number, date: row.invoice.date,
      currency: row.invoice.currency, amountCents: row.invoice.amountCents,
      lines: row.lines.map(line => ({ taskId: line.taskId, orderId: line.orderId,
        sourceLineId: line.sourceLineId, barcode: line.barcode, name: line.name,
        packing: line.packing, quantity: line.quantity, sellingPriceCtn: line.sellingPriceCtn,
        // Old invoice snapshots have no immutable weight/volume. Do not substitute current catalogue data.
        cbm: null, netKg: null, grossKg: null })),
      documents: documents.filter(document => document.invoiceId === row.id ||
        !document.invoiceId && document.scope === 'ORDER' && row.lines.some(line => line.orderId === document.orderId) ||
        !document.invoiceId && document.scope === 'DESK' && document.desk === row.desk && row.lines.some(line => line.orderId === document.orderId))
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
      invoiceMatching: 'NOT_RECORDED'
    }, documents };
}
