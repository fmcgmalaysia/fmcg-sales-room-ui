import { readCustomerShipments } from 'backend/r2customerShipmentLedger.js';
export function customerCompletion(taskId,activity,purchaseOrders){
 const shipments=readCustomerShipments(activity).filter(row=>['INVOICED','DISPATCHED'].includes(row.status)&&row.lines.some(line=>line.taskId===taskId));
 if(!shipments.length)return null;
 const invoices=shipments.map(shipment=>{const line=shipment.lines.find(row=>row.taskId===taskId);const completedQty=shipment.status==='DISPATCHED'?line.sources.reduce((sum,source)=>{const matches=purchaseOrders.filter(po=>po.taskIds.includes(source.sourceTaskId));return sum+(matches.length===1&&matches[0].invoiceChecked&&matches[0].paymentCompleted&&matches[0].finance?.receiptResolved?source.quantity:0);},0):0;return {sellingPriceCtn:line.sellingPriceCtn,number:shipment.invoice.number,date:shipment.invoice.date,quantity:line.quantity,completedQty,dispatchedQty:shipment.status==='DISPATCHED'?line.quantity:0,at:shipment.invoice.at,shippedAt:shipment.dispatch?.at||null};});
 return {invoices,invoicedQty:invoices.reduce((n,row)=>n+row.quantity,0),completedQty:invoices.reduce((n,row)=>n+row.completedQty,0),dispatchedQty:invoices.reduce((n,row)=>n+row.dispatchedQty,0)};
}
