/* Display customer shipment batches without creating purchase or stock records. */
(()=>{
 const take=(total,offset,quantity)=>Math.min(quantity,Math.max(0,(Number(total)||0)-offset));
 function lines(line){
  const batches=line.shipmentBatches||[];if(!batches.length)return [line];
  let offset=0;
  return batches.map((batch,index)=>{
   const quantity=batch.quantity,completed=take(line.completedQtyCtn,offset,quantity),received=batch.metrics?.received??take(line.receivedQtyCtn,offset,quantity);
   const item={...line,shipmentBatches:[],splitBatch:{...batch,index,total:batches.length},splitOriginalLine:line,
    requestedQtyCtn:quantity,effectiveRequestedQtyCtn:quantity,quantityCtn:quantity,committedQtyCtn:batch.metrics?.committed??take(line.committedQtyCtn,offset,quantity),
    completedQtyCtn:completed,dispatchedQtyCtn:take(line.dispatchedQtyCtn,offset,quantity),invoicedQtyCtn:take(line.invoicedQtyCtn,offset,quantity),closedUnfulfilledQtyCtn:take(line.closedUnfulfilledQtyCtn,offset,quantity),
    ...(Number.isSafeInteger(line.receivedQtyCtn)?{receivedQtyCtn:received,goodsReceivedAt:received===quantity?line.receivedUpdatedAt||line.goodsReceivedAt:null}:{}),
    ...(line.warehousePreparation?{warehousePreparation:{...line.warehousePreparation,packedQty:take(line.warehousePreparation.packedQty,offset,quantity),loadedQty:take(line.warehousePreparation.loadedQty,offset,quantity)}}:{})};
   offset+=quantity;return item;
  });
 }
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('fmcg-shipment-plans-v1'):null;
 if(channel)channel.onmessage=event=>{if(event.data?.type==='SPLIT_SAVED'&&['NCT','GHR'].includes(event.data.company))window.dispatchEvent(new CustomEvent('customer-shipment-plan-changed',{detail:{company:event.data.company}}));};
 window.customerShipmentBatches={lines,notify:company=>channel?.postMessage({type:'SPLIT_SAVED',company})};
})();
