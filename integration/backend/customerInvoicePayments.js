// Invoice matching is a relation over the existing account ledger, never another cash balance.
const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=999999999999;
export const CUSTOMER_ALLOCATION_ACTION='CUSTOMER_ACCOUNT_ALLOCATION_SAVED';
export function normalizeChargeLines(value){
 if(!Array.isArray(value)||!value.length||value.length>20)throw Error('Enter one to twenty charge lines.');
 return value.map(row=>{const description=String(row?.description||'').trim();if(!description||description.length>200||!Number.isSafeInteger(row.amountCents)||row.amountCents<0||row.amountCents>999999999999)throw Error('Enter a charge description and valid amount.');return {description,amountCents:row.amountCents};});
}
export function customerInvoiceFacts(company,shipments,documents){
 return shipments.filter(row=>row.company===company&&['INVOICED','DISPATCHED'].includes(row.status)).map(row=>({id:row.id,company,customerId:row.customerId,number:row.invoice.number,date:row.invoice.date,currency:row.invoice.currency,amountCents:row.invoice.amountCents,at:row.invoice.at,by:row.invoice.by,quantity:row.lines.reduce((n,line)=>n+line.quantity,0),kind:'GOODS'})).concat(documents.filter(row=>row.company===company&&row.type==='CHARGE_INV').map(row=>({...row,quantity:null,kind:'CHARGE'})));
}
export function normalizeInvoiceAllocations(value=[]){
 if(!Array.isArray(value)||value.length>200)throw Error('Select at most 200 invoice allocations.');
 const rows=value.map(row=>{if(!row||typeof row.invoiceId!=='string'||!row.invoiceId||row.invoiceId.length>100||!positive(row.amountCents))throw Error('Enter an invoice and positive allocation amount.');return {invoiceId:row.invoiceId,amountCents:row.amountCents};});
 if(new Set(rows.map(row=>row.invoiceId)).size!==rows.length)throw Error('An invoice can appear only once in a payment allocation.');
 return rows.sort((a,b)=>a.invoiceId.localeCompare(b.invoiceId));
}
export function readInvoiceAllocationStates(documents,activity,company){
 const states=new Map(documents.filter(row=>row.company===company&&['CUSTOMER_RECEIPT','SALES_CN','DEBIT_NOTE'].includes(row.type)).map(row=>[row.id,{documentId:row.id,revision:row.id,allocations:normalizeInvoiceAllocations(row.allocations)}]));
 const pending=activity.filter(row=>row.action===CUSTOMER_ALLOCATION_ACTION&&row.result==='SAVED');
 const seen=new Set();
 while(pending.length){
  const next=pending.filter(row=>states.get(row.description)?.revision===row.details?.beforeRevision);
  if(!next.length||new Set(next.map(row=>row.description)).size!==next.length)throw Error('Customer invoice matching history requires review.');
  for(const event of next){const state=states.get(event.description),document=documents.find(row=>row.id===event.description);
   if(!event.title||seen.has(event.title)||event.details.company!==company||document.customerId!==event.details.customerId||!event.initiatedByStaffId||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Customer invoice matching identity requires review.');
   seen.add(event.title);states.set(state.documentId,{documentId:state.documentId,revision:event.title,requestId:event.details.requestId||'',allocations:normalizeInvoiceAllocations(event.details.allocations)});pending.splice(pending.indexOf(event),1);
  }
 }
 return states;
}
export function projectInvoicePayments({company,documents,invoices,activity}){
 const docs=documents.filter(row=>row.company===company),states=readInvoiceAllocationStates(docs,activity,company),matched=new Map();
 for(const invoice of invoices){if(invoice.company!==company||!positive(invoice.amountCents)||matched.has(invoice.id))throw Error('Customer invoice identity requires review.');matched.set(invoice.id,{...invoice,payments:[],adjustments:[],paidCents:0,creditCents:0,debitCents:0});}
 const unapplied=[];
 for(const doc of docs.filter(row=>['CUSTOMER_RECEIPT','SALES_CN','DEBIT_NOTE'].includes(row.type))){
  const state=states.get(doc.id);let used=0;
  for(const allocation of state.allocations){
   const invoice=matched.get(allocation.invoiceId);
   if(!invoice||invoice.customerId!==doc.customerId||invoice.currency!==doc.currency)throw Error('Invoice allocations must belong to the same company, customer and currency.');
   used+=allocation.amountCents;if(!Number.isSafeInteger(used)||used>doc.amountCents)throw Error('Invoice allocations exceed the available document amount.');
   const entry={documentId:doc.id,number:doc.number,date:doc.date,at:doc.at||'',type:doc.type,amountCents:allocation.amountCents,totalAmountCents:doc.amountCents,fileId:doc.fileId};
   if(doc.type==='CUSTOMER_RECEIPT'){invoice.paidCents+=allocation.amountCents;invoice.payments.push(entry);}
   else{invoice[doc.type==='SALES_CN'?'creditCents':'debitCents']+=allocation.amountCents;invoice.adjustments.push(entry);}
  }
  unapplied.push({documentId:doc.id,company,customerId:doc.customerId,currency:doc.currency,type:doc.type,amountCents:doc.amountCents-used,allocatedCents:used,revision:state.revision,matchingRequestId:state.requestId||'',allocations:state.allocations});
 }
 for(const row of matched.values()){
  row.dueCents=row.amountCents+row.debitCents-row.creditCents-row.paidCents;
  if(!Number.isSafeInteger(row.dueCents)||row.dueCents<0)throw Error('Payment or credit allocations exceed this invoice outstanding amount.');
  row.payments.sort((a,b)=>b.date.localeCompare(a.date)||b.at.localeCompare(a.at)||b.documentId.localeCompare(a.documentId));
  row.lastPayment=row.payments[0]||null;
 }
 return {invoices:[...matched.values()],unapplied};
}
