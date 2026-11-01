/* Display customer shipment batches without creating purchase or stock records. */
(()=>{
 const take=(total,offset,quantity)=>Math.min(quantity,Math.max(0,(Number(total)||0)-offset));
 function lines(line){
  if(line.quantityContract===2&&Array.isArray(line.deskCommitments)){
   const grouped=new Map();for(const batch of line.deskCommitments){const row=grouped.get(batch.desk)||{desk:batch.desk,quantity:0,loaded:0,at:batch.at};row.quantity+=batch.quantity;row.loaded+=batch.loaded;if(batch.at>row.at)row.at=batch.at;grouped.set(batch.desk,row);}
   // Old Loaded evidence with no Desk reference is retained as one historical row.
   if(!grouped.size&&line.committedQtyCtn>0)return [line];
   const result=[...grouped.values()].sort((a,b)=>a.desk-b.desk).map(batch=>{
    const invoices=(line.masterCompletedInvoices||[]).filter(invoice=>invoice.desk===batch.desk),sum=key=>invoices.reduce((n,row)=>n+(row[key]||0),0),received=line.deskPhysical?.find(row=>row.desk===batch.desk)?.receivedQtyCtn;
    return {...line,shipmentBatches:[],deskCommitments:[],splitBatch:{id:'DESK:'+batch.desk,label:'Desk '+batch.desk,desk:batch.desk},splitOriginalLine:line,requestedQtyCtn:batch.quantity,effectiveRequestedQtyCtn:batch.quantity,quantityCtn:batch.quantity,committedQtyCtn:batch.quantity,uncommittedQtyCtn:0,completedQtyCtn:sum('completedQty'),invoicedQtyCtn:sum('quantity'),dispatchedQtyCtn:sum('dispatchedQty'),closedUnfulfilledQtyCtn:0,masterCompletedInvoices:invoices,...(Number.isSafeInteger(received)?{receivedQtyCtn:received,goodsReceivedAt:received>=batch.quantity?line.receivedUpdatedAt:null}:{receivedQtyCtn:null,goodsReceivedAt:null}),warehousePreparation:{...line.warehousePreparation,loadedQty:batch.loaded}};
   });
   const quantity=line.uncommittedQtyCtn||0;if(quantity)result.push({...line,shipmentBatches:[],deskCommitments:[],splitBatch:{id:'UNARRANGED',label:'Awaiting arrangement'},splitOriginalLine:line,requestedQtyCtn:quantity,effectiveRequestedQtyCtn:quantity,quantityCtn:quantity,committedQtyCtn:0,uncommittedQtyCtn:quantity,completedQtyCtn:0,invoicedQtyCtn:0,dispatchedQtyCtn:0,closedUnfulfilledQtyCtn:0,masterCompletedInvoices:[],receivedQtyCtn:line.deskPhysical?.find(row=>row.desk===0)?.receivedQtyCtn??null,goodsReceivedAt:null,packedAt:null,warehousePreparation:{ready:false,issue:false,packedQty:0,loadedQty:0}});
   return result.length?result:[line];
  }
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
