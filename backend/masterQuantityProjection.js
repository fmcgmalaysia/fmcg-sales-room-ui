// Source-site backend only. Invoke after existing customer authorization; never mutate the original order.
export function applyMasterQuantities(customerId,orders,reply){
  if(reply?.ok!==true||reply.customerId!==customerId||!Array.isArray(reply.orders)||reply.orders.length!==orders.length)throw Error('Master quantity response is incomplete.');
  return orders.map(order=>{const matches=reply.orders.filter(item=>item.orderId===order.orderId&&item.submissionId===order.masterReceipt?.submissionId);if(matches.length!==1)throw Error('Master order identity mismatch.');
    const current=matches[0],source=order.lines||[],history=[];if(!Array.isArray(current.lines)||new Set(current.lines.map(line=>line.lineId)).size!==current.lines.length)throw Error('Master lines are ambiguous.');
    const lines=source.map(line=>{const found=current.lines.filter(item=>item.lineId===line.lineId);if(!found.length){const qty=line.effectiveRequestedQtyCtn??line.requestedQtyCtn??line.quantityCtn;if(qty===0)return line;throw Error('Master line is missing.');}if(found.length!==1||found[0].barcode!==line.barcode)throw Error('Master line identity mismatch.');
      const update=found[0];if(!Number.isSafeInteger(update.committedQtyCtn)||update.committedQtyCtn<0)throw Error('Master quantity is invalid.');
      for(const event of update.history||[])if(event.orderId===order.orderId&&event.customerId===customerId&&event.detail?.lineId===line.lineId)history.push(event);else throw Error('Master history identity mismatch.');
      return {...line,committedQtyCtn:update.committedQtyCtn,lastQuantityEditAt:update.quantityUpdatedAt,masterSubmittedAt:order.submittedAt};});
    if(current.lines.some(item=>!source.some(line=>line.lineId===item.lineId)))throw Error('Master returned an unexpected line.');
    return {...order,lines,masterQuantityHistory:history};
  });
}
