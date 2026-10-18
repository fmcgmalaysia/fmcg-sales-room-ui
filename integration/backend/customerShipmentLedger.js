import { operationId } from 'backend/purchaseOperationJournal.js';
const qty=value=>Number.isSafeInteger(value)&&value>0&&value<=9999;
export const FULFILMENT_ACTION='CUSTOMER_SHIPMENT_CHANGED';
export function readCustomerShipments(activity){
 const pending=activity.filter(event=>event.action===FULFILMENT_ACTION&&event.result==='SAVED'),shipments=new Map();
 while(pending.length){
  const next=pending.filter(event=>(shipments.get(event.description)?.revision||'')===event.details?.beforeRevision);
  if(!next.length||new Set(next.map(event=>event.description)).size!==next.length)throw Error('Shipment history requires review.');
  for(const event of next){const row=event.details?.shipment,prior=shipments.get(event.description);if(!row||row.id!==event.description||!row.customerId||!['NCT','GHR'].includes(row.company)||!['REQUESTED','CANCELLED','INVOICED','DISPATCHED'].includes(row.status)||!Array.isArray(row.lines)||!row.lines.length||new Set(row.lines.map(line=>line.taskId)).size!==row.lines.length||row.lines.some(line=>!qty(line.quantity)||!Array.isArray(line.sources)||new Set(line.sources.map(source=>source.sourceTaskId)).size!==line.sources.length||line.sources.some(source=>!source.sourceTaskId||!qty(source.quantity))||line.sources.reduce((sum,source)=>sum+source.quantity,0)!==line.quantity)||!event.title||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Shipment identity requires review.');
   if(!prior&&row.status!=='REQUESTED'||prior&&(prior.customerId!==row.customerId||prior.company!==row.company||operationId(prior.lines.map(line=>[line.taskId,line.quantity,line.sources]))!==operationId(row.lines.map(line=>[line.taskId,line.quantity,line.sources]))||!({REQUESTED:['INVOICED','CANCELLED'],INVOICED:['DISPATCHED']}[prior.status]||[]).includes(row.status)))throw Error('Shipment transition requires review.');
   if(['INVOICED','DISPATCHED'].includes(row.status)&&(!row.invoice?.number||!Number.isSafeInteger(row.invoice.amountCents)||row.invoice.amountCents<=0||row.invoice.currency!==row.currency||!Number.isFinite(row.invoice.rateToMyr)||row.invoice.rateToMyr<=0))throw Error('Invoice snapshot requires review.');
   if(prior?.invoice&&(operationId(prior.invoice)!==operationId(row.invoice)||operationId(prior.lines)!==operationId(row.lines)))throw Error('Invoice snapshot cannot change during dispatch.');
   shipments.set(row.id,{...row,revision:event.title,updatedAt:new Date(event.activityTime).toISOString(),updatedBy:event.initiatedByStaffName});pending.splice(pending.indexOf(event),1);
  }
 }
 return [...shipments.values()];
}
export function reservedCartons(taskId,activity){return readCustomerShipments(activity).filter(row=>row.status!=='CANCELLED').reduce((sum,row)=>sum+(row.lines.find(line=>line.taskId===taskId)?.quantity||0),0);}
