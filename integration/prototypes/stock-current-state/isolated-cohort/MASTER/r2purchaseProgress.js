import { readCustomerShipments } from 'backend/r2customerShipmentLedger.js';
import { customerCompletion } from 'backend/r2customerCompletionProjection.js';

// Read-only workflow projection. Stored intake stages and all operational facts remain unchanged.
export function applyPurchaseProgress(workspace, activity, purchaseOrders) {
 const shipments=readCustomerShipments(activity).filter(row=>row.company===workspace.company);
 for(const row of workspace.tasks){
  const ownPo=purchaseOrders.find(po=>po.taskIds.includes(row.id));
  const sourceLines=shipments.filter(shipment=>['INVOICED','DISPATCHED'].includes(shipment.status)).map(shipment=>({shipment,quantity:shipment.lines.flatMap(line=>line.sources).filter(source=>source.sourceTaskId===row.id).reduce((sum,source)=>sum+source.quantity,0)}));
  const completion=customerCompletion(row.id,activity,purchaseOrders);
  const sourceRequired=row.warehouse?.stock?.usableReceived??row.warehouse?.accepted??0;
  const required=row.procurementSource?sourceRequired:row.shortage?.customerDecision==='STOP'?(row.inc||0):row.ord;
  const invoiced=row.procurementSource?sourceLines.reduce((sum,line)=>sum+line.quantity,0):(completion?.invoicedQty||0);
  const dispatched=row.procurementSource?sourceLines.filter(line=>line.shipment.status==='DISPATCHED').reduce((sum,line)=>sum+line.quantity,0):(completion?.dispatchedQty||0);
  const ownFinanceClosed=Boolean(ownPo?.invoiceChecked&&ownPo.paymentCompleted&&ownPo.finance?.receiptResolved);
  row.progressFacts={sourceRequired,sourceDispatchedQty:sourceLines.filter(line=>line.shipment.status==='DISPATCHED').reduce((sum,line)=>sum+line.quantity,0),receiptResolved:Boolean(ownPo?.invoiceChecked&&ownPo.finance?.receiptResolved)};
  const completed=row.procurementSource?(ownFinanceClosed?dispatched:0):(completion?.completedQty||0);
  row.archived=required>0&&completed===required&&ownFinanceClosed;
  for(const item of row.quantityCases||[])if(item.kind==='RECEIPT'&&ownPo?.invoiceChecked){item.status='RESOLVED';item.owner=null;item.checkedBy=ownPo.invoiceCheck?.by;item.checkedAt=ownPo.invoiceCheck?.at;}
  if(required>0&&dispatched===required){
   row.stage=row.archived?'SHIPPED':ownPo?.paymentCompleted?'WAITING_FOR_ACC_REVIEW':'WAITING_FOR_PAYMENT';
   continue;
  }
  if(required>0&&invoiced===required){row.stage='WAITING_FOR_SHIPMENT';continue;}
  const received=row.warehouse?.hasPhysicalReceipt===true;
  if(received){
   const stillWaiting=row.shortage?.customerDecision==='WAIT'||row.shortage?.customerDecision==='PENDING';
   const receiptSettled=row.warehouse.accepted===row.procurement?.totalCtn&&!row.warehouse.issue||ownPo?.finance?.receiptResolved;
   row.stage=receiptSettled&&!stillWaiting?'WAITING_FOR_REPACKING':'WAITING_FOR_GOODS';
   continue;
  }
  if(!ownPo){row.stage='WAITING_FOR_PO';continue;}
  const docs=ownPo.documents.filter(doc=>doc.linked&&!doc.superseded&&['PI','SO','INV'].includes(doc.type));
  if(!docs.length){row.stage='WAITING_FOR_SUPPLIER_INV';continue;}
  const handoff=ownPo.paymentHandoff;
  // Supplier credit terms permit receiving before payment. Due payments remain in Account's queue.
  if(ownPo.termDays>0&&docs.some(doc=>doc.type==='INV')){row.stage='WAITING_FOR_GOODS';continue;}
  if(handoff?.status==='PAID'||ownPo.paymentCompleted){row.stage=handoff?.unreadCount>0?'WAITING_FOR_PURCHASE_NOTED':'WAITING_FOR_GOODS';continue;}
  row.stage=handoff?.review?'WAITING_FOR_PAYMENT':'WAITING_FOR_ACC_REVIEW';
 }
 return workspace;
}
