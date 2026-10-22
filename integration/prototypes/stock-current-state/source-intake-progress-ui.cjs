'use strict';
// Existing Source order and feedback dialog, no browser business-record cache.
module.exports = function overlay(source) {
  const once = (before, after) => { if (source.split(before).length !== 2) throw Error('Exact original intake progress UI anchor changed'); source = source.replace(before, () => after); };
  once("function submitOrderToNct(order,destination='NCT'){", `function sendOriginalNctPhase(pending){
  if(pendingNctSubmit!==pending)return;
  const serial=(pending.segmentSerial||0)+1;pending.segmentSerial=serial;pending.phase='SUBMIT';
  // This is only a transport correlation ID. MASTER command identity and Source
  // immutable submission/order lock remain exactly the original server identities.
  pending.transportRequestId=serial===1?pending.requestId:pending.requestId+'-phase-'+serial;
  window.parent.postMessage({type:'SALES_ROOM_SUBMIT_ORDER',orderId:pending.order.orderId,destination:pending.destination,requestId:pending.transportRequestId},'*');
  setTimeout(()=>{if(pendingNctSubmit!==pending||pending.segmentSerial!==serial||pending.phase!=='SUBMIT')return;
    if(document.getElementById('orderDetailArea')?.dataset.nctOrderId!==pending.order.orderId)return;checkNctReceipt(pending);
  },45000);
}
function submitOrderToNct(order,destination='NCT'){`);
  once(`  window.parent.postMessage({type:'SALES_ROOM_SUBMIT_ORDER',orderId:order.orderId,destination,requestId},'*');
  setTimeout(()=>{if(pendingNctSubmit?.requestId!==requestId||pendingNctSubmit.phase!=='SUBMIT')return;
    if(document.getElementById('orderDetailArea')?.dataset.nctOrderId!==order.orderId)return;
    checkNctReceipt(pendingNctSubmit);
  },45000);`, '  sendOriginalNctPhase(pendingNctSubmit);');
  once('message.requestId!==pendingNctSubmit.requestId||message.orderId!==pendingNctSubmit.order.orderId', 'message.requestId!==(pendingNctSubmit.transportRequestId||pendingNctSubmit.requestId)||message.orderId!==pendingNctSubmit.order.orderId');
  once("  salesQtyBusy(false);const status=document.getElementById('salesQtyStatus');", `  if(message.pending===true){
    if(pending.phase!=='SUBMIT')return;
    const valid=message.ok===false&&message.destination===pending.destination&&message.submissionId===pending.destination+'-'+order.orderId
      &&['BEFORE','APPLY','VERIFY'].includes(message.phase)&&Number.isSafeInteger(message.completedCount)&&Number.isSafeInteger(message.totalRecords)
      &&message.totalRecords>0&&message.completedCount>=0&&message.completedCount<=message.totalRecords;
    if(!valid){pending.error='Master intake progress is unconfirmed. Original order retained.';checkNctReceipt(pending);return;}
    pending.continuations=(pending.continuations||0)+1;
    if(pending.continuations>64){pending.error='Automatic progress paused. Retry only this same order.';finishNctUncertainty(pending);return;}
    pending.phase='CONTINUE';salesQtyBusy(true);
    const text='Master receiving 正在接收订单 · '+message.phase+' · '+message.completedCount+' / '+message.totalRecords;
    const status=document.getElementById('salesQtyStatus');if(status)status.textContent=text;
    showNctSubmissionFeedback('Submitting to '+pending.destination+' · 正在交单',text,order.orderId,null,true);
    const serial=pending.segmentSerial;setTimeout(()=>{if(pendingNctSubmit===pending&&pending.segmentSerial===serial&&pending.phase==='CONTINUE')sendOriginalNctPhase(pending);},250);return;
  }
  salesQtyBusy(false);const status=document.getElementById('salesQtyStatus');`);
  return source;
};
