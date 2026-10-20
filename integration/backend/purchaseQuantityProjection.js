// Read-only customer projection. Only customer-allocated receipt quantities leave Master.
import { readWarehouseTask } from 'backend/warehouseReceiving.js';
import { customerCompletion } from 'backend/customerCompletionProjection.js';
import { readSalesShipmentDate, shipmentDateLocked, readShipmentPlans } from 'backend/customerShipmentPlan.js';
import { readShortage } from 'backend/purchaseShortage.js';
import { preparationSummary } from 'backend/warehousePreparation.js';
export function projectPurchaseQuantities({customerId,requests,orders,tasks,activity,purchaseOrders=[],workspace=null}) {
  if(typeof customerId!=='string'||!customerId||!Array.isArray(requests)||!requests.length||requests.length>100)throw Error('Invalid quantity request.');
  if(activity.some(event=>event.action==='PURCHASE_QUANTITY_CASE_DECIDED'&&event.result==='SAVED')&&!workspace)throw Error('Current quantity case feedback is required.');
  const output=[];
  for(const request of requests){
    if(!request.orderId||!request.submissionId)throw Error('Accepted order identity is required.');
    const receipts=activity.filter(row=>row.description===request.orderId&&row.action==='ORDER_RECEIVED'&&row.result==='ACCEPTED'&&row.details?.submissionId===request.submissionId);
    if(receipts.length!==1||!Array.isArray(receipts[0].details.taskIds))throw Error('Master receipt is unavailable.');
    const receipt=receipts[0],lines=[];
    for(const taskId of receipt.details.taskIds){
      const matches=tasks.filter(row=>row.title===taskId&&row.description===request.orderId&&!row.specialPurchase);
      if(matches.length!==1)throw Error('Master task identity is incomplete.');
      const task=matches[0],source=orders.filter(row=>row.title===request.orderId&&row.sourceLineId===task.imageAltText&&row.submissionId===request.submissionId&&row.customerId===customerId);
      if(source.length!==1)throw Error('Customer/order identity mismatch.');
      const order=source[0],events=activity.filter(row=>row.imageAltText===taskId&&row.description===request.orderId&&row.action==='PURCHASE_QTY_REDUCED'&&row.result==='SAVED');
      let quantity=order.orderQtyInCtn;const remaining=[...events],history=[];
      while(remaining.length){const next=remaining.filter(row=>row.details?.before===quantity);if(next.length!==1)throw Error('Quantity history requires review.');const event=next[0],detail=event.details;
        if(!Number.isSafeInteger(detail.after)||detail.after<0||detail.after>=quantity||!detail.reason)throw Error('Invalid quantity change.');
        history.push({auditId:event.title,action:'PURCHASE_QTY_REDUCED',orderId:request.orderId,customerId,at:new Date(event.activityTime).toISOString(),actorName:event.initiatedByStaffName,detail:{lineId:task.imageAltText,originalQuantityCtn:order.orderQtyInCtn,previousQuantityCtn:quantity,newQuantityCtn:detail.after,reason:detail.reason}});
        quantity=detail.after;remaining.splice(remaining.indexOf(event),1);
      }
      if(!Number.isSafeInteger(quantity)||quantity<0||task.purchaseQtyInCtn!==quantity)throw Error('Quantity save is still being confirmed.');
      const warehouse=readWarehouseTask(task,activity),decision=workspace?.tasks.find(row=>row.id===task.title)?.shortage||readShortage(task.title,activity),completion=customerCompletion(task.title,activity,purchaseOrders);if(completion&&(completion.invoicedQty>quantity||completion.invoicedQty>(warehouse?.customerReceived||0)))throw Error('Invoice quantities require review.');
      const preparation=workspace?preparationSummary(task.title,{...workspace,activity}):null;
      const shipmentPlan=readShipmentPlans(activity).find(plan=>plan.customerId===customerId&&plan.orderId===request.orderId&&plan.batches.some(batch=>batch.lines.some(line=>line.taskId===task.title)));
      const shipmentBatches=shipmentPlan?shipmentPlan.batches.flatMap(batch=>{const line=batch.lines.find(line=>line.taskId===task.title);return line?[{id:shipmentPlan.id+'|'+batch.sequence,label:batch.label,quantity:line.quantity,at:shipmentPlan.at,by:shipmentPlan.by}]:[];}):[];
      lines.push({lineId:task.imageAltText,barcode:order.description,committedQtyCtn:quantity,shipmentBatches,quantityEdited:history.length>0,quantityUpdatedAt:history.at(-1)?.at||new Date(order.masterReceivedTime||receipt.activityTime).toISOString(),history,...(preparation?{preparation}:{}),...(completion?{completion:{...completion,closedUnfulfilledQty:decision?.customerDecision==='STOP'&&completion.completedQty===(warehouse?.customerReceived||0)?Math.max(0,quantity-completion.completedQty):0}}:{}),...(decision?{fulfilment:{decision:decision.customerDecision,message:decision.customerMessage,expectedDate:decision.expectedDate,at:decision.at}}:{}),...(warehouse?{receivedQtyCtn:warehouse.customerReceived,receivedUpdatedAt:warehouse.allocationAt||warehouse.at}:{})});
    }
    const ownedOrders=orders.filter(row=>row.title===request.orderId&&row.customerId===customerId&&row.submissionId===request.submissionId);const date=readSalesShipmentDate(request.orderId,customerId,request.submissionId,ownedOrders[0]?.estimatedShipmentDate,activity);
    output.push({orderId:request.orderId,submissionId:request.submissionId,lines,shipmentDate:{...date,locked:workspace?shipmentDateLocked(workspace.tasks.filter(row=>row.orderId===request.orderId&&row.customerId===customerId)):false}});
  }
  return {ok:true,customerId,orders:output};
}
