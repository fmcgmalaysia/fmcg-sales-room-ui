import { readCustomerAccountDocuments } from 'backend/customerAccountLedger.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readSupportDocuments } from 'backend/supportDocuments.js';
import { customerInvoiceFacts, projectInvoicePayments } from 'backend/customerInvoicePayments.js';
// Customer receivables only. Supplier CN and supplier payments never enter this ledger.
export function projectCustomerDebtors({company,activity,customers=[]}){
 return customerInvoiceFacts(company,readCustomerShipments(activity),readCustomerAccountDocuments(activity)).map(row=>({...row,customerName:customers.find(item=>item.id===row.customerId)?.name||row.customerName||row.customerId,paymentStatus:'UNRECONCILED'}));
}

export function projectCustomerAccount({company,activity,customers=[]}){
 const docs=readCustomerAccountDocuments(activity).filter(row=>row.company===company),invoices=projectCustomerDebtors({company,activity,customers}),supportDocs=invoices.length?readSupportDocuments(activity,company):[];
 const entries=invoices.map(row=>({...row,type:row.kind==='CHARGE'?'CHARGE_INV':'SALES_INV',signedCents:row.amountCents,documents:[...new Map([...(row.kind==='CHARGE'?[row]:[]),...docs.filter(doc=>doc.type==='SALES_INV'&&doc.shipmentId===row.id),...supportDocs.filter(doc=>doc.code==='SI'&&doc.invoiceId===row.id&&doc.customerId===row.customerId)].map(doc=>[doc.fileId,doc])).values()]}));
 for(const doc of docs.filter(row=>!['SALES_INV','CHARGE_INV'].includes(row.type)))entries.push({...doc,customerName:customers.find(row=>row.id===doc.customerId)?.name||doc.customerName||doc.customerId,signedCents:(doc.type==='DEBIT_NOTE'?1:-1)*doc.amountCents,documents:[doc]});
 const balances=new Map();for(const row of entries){const key=JSON.stringify([row.customerId,row.currency]);if(!balances.has(key))balances.set(key,{customerId:row.customerId,customerName:row.customerName,currency:row.currency,invoiceCents:0,debitCents:0,creditCents:0,receiptCents:0,balanceCents:0});const balance=balances.get(key);balance[{SALES_INV:'invoiceCents',CHARGE_INV:'invoiceCents',DEBIT_NOTE:'debitCents',SALES_CN:'creditCents',CUSTOMER_RECEIPT:'receiptCents'}[row.type]]+=row.amountCents;balance.balanceCents+=row.signedCents;if(!Number.isSafeInteger(balance.balanceCents))throw Error('Customer balance exceeds supported precision.');}
 return {entries:entries.sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.at).localeCompare(String(a.at))),balances:[...balances.values()],invoicePayments:projectInvoicePayments({company,documents:docs,invoices,activity})};
}
