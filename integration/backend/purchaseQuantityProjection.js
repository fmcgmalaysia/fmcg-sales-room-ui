// Read-only customer projection. Supplier, cost, warehouse and staff membership data never leave Master.
export function projectPurchaseQuantities({customerId,requests,orders,tasks,activity}) {
  if(typeof customerId!=='string'||!customerId||!Array.isArray(requests)||!requests.length||requests.length>100)throw Error('Invalid quantity request.');
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
      lines.push({lineId:task.imageAltText,barcode:order.description,committedQtyCtn:quantity,quantityEdited:history.length>0,quantityUpdatedAt:history.at(-1)?.at||new Date(order.masterReceivedTime||receipt.activityTime).toISOString(),history});
    }
    output.push({orderId:request.orderId,submissionId:request.submissionId,lines});
  }
  return {ok:true,customerId,orders:output};
}
