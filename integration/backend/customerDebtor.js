import { readCustomerAccountDocuments } from 'backend/customerAccountLedger.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
// Customer receivables only. Supplier CN and supplier payments never enter this ledger.
export function projectCustomerDebtors({company,activity,customers=[]}){
 const invoices=readCustomerShipments(activity).filter(row=>row.company===company&&['INVOICED','DISPATCHED'].includes(row.status));
 return invoices.map(row=>({id:row.id,company,customerId:row.customerId,customerName:customers.find(item=>item.id===row.customerId)?.name||row.customerId,number:row.invoice.number,date:row.invoice.date,currency:row.invoice.currency,amountCents:row.invoice.amountCents,at:row.invoice.at,by:row.invoice.by,quantity:row.lines.reduce((sum,line)=>sum+line.quantity,0),paymentStatus:'UNRECONCILED'}));
}

export function projectCustomerAccount({company,activity,customers=[]}){
 const docs=readCustomerAccountDocuments(activity).filter(row=>row.company===company),invoices=projectCustomerDebtors({company,activity,customers});
 const entries=invoices.map(row=>({...row,type:'SALES_INV',signedCents:row.amountCents,documents:docs.filter(doc=>doc.type==='SALES_INV'&&doc.shipmentId===row.id)}));
 for(const doc of docs.filter(row=>row.type!=='SALES_INV'))entries.push({...doc,customerName:customers.find(row=>row.id===doc.customerId)?.name||doc.customerName||doc.customerId,signedCents:(doc.type==='DEBIT_NOTE'?1:-1)*doc.amountCents,documents:[doc]});
 const balances=new Map();for(const row of entries){const key=JSON.stringify([row.customerId,row.currency]);if(!balances.has(key))balances.set(key,{customerId:row.customerId,customerName:row.customerName,currency:row.currency,invoiceCents:0,debitCents:0,creditCents:0,receiptCents:0,balanceCents:0});const balance=balances.get(key);balance[{SALES_INV:'invoiceCents',DEBIT_NOTE:'debitCents',SALES_CN:'creditCents',CUSTOMER_RECEIPT:'receiptCents'}[row.type]]+=row.amountCents;balance.balanceCents+=row.signedCents;if(!Number.isSafeInteger(balance.balanceCents))throw Error('Customer balance exceeds supported precision.');}
 return {entries:entries.sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.at).localeCompare(String(a.at))),balances:[...balances.values()]};
}
