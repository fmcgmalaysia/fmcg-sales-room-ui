/* Candidate original inline date forms. No direct backend, credentials or grants.
   Free presentation bindings below are the ORIGINAL Source index.html functions
   and pending form variables, not a second authority for orders or inventory. */
(()=>{'use strict';
 const copy=value=>JSON.parse(JSON.stringify(value));let active=null,loading=null,view='',busy=false,timer=null,serial=0;
 function controls(scope=view){return scope==='PROGRESS'?{po:'salesPlanningPo',date:'salesPlanningDate',save:'saveSalesPlanning',cancel:'cancelSalesPlanning',status:'salesPlanningStatus'}
  :{po:'salesCustomerPo',date:'salesReviewShipment',save:'saveReviewPlanning',cancel:'cancelReviewPlanning',status:'salesQtyStatus'};}
 const node=id=>document.getElementById(id);
 function message(text){const el=node(controls().status);if(el)el.textContent=text;}
 function lock(wait){const names=controls();for(const key of ['po','date','cancel']){const el=node(names[key]);if(el){el.disabled=true;el.readOnly=true;}}
  const save=node(names.save);if(save){save.disabled=wait;save.textContent=wait?'Saving 保存中…':'Retry 重试';save.onclick=()=>{if(active&&!busy)transmit();};}}
 function error(error){busy=false;lock(false);message(error?.message||'Original date save unconfirmed. Retry the same save 原日期保存尚未确认，请重试同一次保存。');}
 function releaseRead(record,error){if(loading!==record)return;loading=null;view=record.scope;const names=controls();record.pending.saving=false;
  for(const key of ['po','date','save','cancel']){const el=node(names[key]);if(el)el.disabled=false;}
  const po=node(names.po),date=node(names.date);if(po)po.readOnly=true;if(date)date.readOnly=false;if(date?.oninput)date.oninput();
  message(error?.message||'Original date form unavailable 日期资料尚未确认');}
 function abandonRead(record){if(loading!==record)return;loading=null;record.pending.saving=false;record.pending.dirty=false;
  if(record.scope==='PROGRESS'&&pendingSalesPlanning===record.pending){pendingSalesPlanning=null;const editor=node('salesPlanningEditor');if(editor)editor.hidden=true;}
  if(record.scope==='REVIEW'&&pendingSalesPoEdit===record.pending){const names=controls('REVIEW');node(names.po).value=record.order.customerPoNumber||'';node(names.date).value=record.order.estimatedShipmentDate||'';node(names.date).oninput();}}
 function restore(entry){if(entry?.ui?.kind!=='DATE'||entry.request.type!=='SALES_ROOM_ORDER_PLANNING_UPDATE'||entry.request.orderId!==entry.ui.order?.orderId)throw Error('Original date view requires review');
  if(active)throw Error('Original date save is already open');
  // A resumed date is shown in the existing Order Review, including the original
  // customer/product context. No new popup or parallel editor is introduced.
  if(pendingSalesQtyEdit||pendingSalesPlanning?.dirty||pendingSalesPlanning?.saving||pendingSalesPoEdit?.dirty||pendingSalesPoEdit?.saving)throw Error('Save the current Source edit before resuming its original date request');
  salesProgressCustomerId=entry.request.customerId;showView('orders');renderOrderDetail(copy(entry.ui.order));
  const request=entry.request;node('salesCustomerPo').value=request.customerPoNumber;node('salesReviewShipment').value=request.estimatedShipmentDate;
  Object.assign(pendingSalesPoEdit,{requestId:request.requestId,expectedRevision:request.expectedRevision,expectedShipmentRevision:request.expectedShipmentRevision,dirty:true,saving:true,reviewPlanning:true});
  active=copy(entry);view='REVIEW';busy=false;lock(false);message('Original date save retained. Retry the same save 原日期保存已保留，请重试同一次保存。');
 }
 async function resumeOwned(record,entry){abandonRead(record);window.sourceSalesCurrent.restore(entry);}
 async function send(original,order,scope,pending){
  if(!['NCT','GHR'].includes(order?.destination)||!order.masterReceipt?.submissionId){window.parent.postMessage(original,'*');return;}
  if(active||loading){message('Complete the original date request first 请先完成原日期保存');return;}
  const record={scope,pending,order:copy(order)};loading=record;view=scope;
  try{
   let read;
   try{read=await window.sourceSalesCurrent.readCurrent(order.destination,order.customerId);}
   catch(readError){const retained=await window.sourceSalesCurrent.recover(order.destination,order.customerId);if(loading!==record)return;if(retained){await resumeOwned(record,retained);return;}throw readError;}
   if(loading!==record)return;
   if(read.stockCurrent===undefined){loading=null;window.parent.postMessage(original,'*');return;}
   const resumed=await new Promise((resolve,reject)=>{if(!window.sourceSalesCurrent.checkRead(order.destination,order.customerId,read.stockCurrent,
    entry=>{resumeOwned(record,entry).then(()=>resolve(true),reject);},reject))resolve(false);});
   if(resumed||loading!==record)return;
   const request=copy({...original,company:order.destination,customerId:order.customerId,stockCurrent:read.stockCurrent}),entry={schema:1,request,ui:{kind:'DATE',scope,order:record.order}};
   window.sourceSalesCurrent.retain(request,entry.ui);loading=null;active=entry;transmit();
  }catch(cause){if(active)error(cause);else releaseRead(record,cause);}
 }
 function transmit(){if(!active||busy)return;try{window.sourceSalesCurrent.retain(active.request,active.ui);}catch(cause){error(cause);return;}
  busy=true;lock(true);message('Saving shipment date 正在保存预计发货日期…');const current=active,attempt=++serial;clearTimeout(timer);
  window.parent.postMessage(copy(active.request),'*');timer=setTimeout(()=>{if(active===current&&serial===attempt)error(Error('Date save not confirmed. Retry the same save 日期保存尚未确认，请重试同一次保存。'));},30000);
 }
 function accept(result,event){if(!active)return true;if(result.requestId!==active.request.requestId||event?.source!==window.parent)return false;
  clearTimeout(timer);serial++;busy=false;const request=active.request;
  if(result.ok===false&&result.pending===true&&result.company===request.company&&result.orderId===request.orderId&&['BEFORE','APPLY','VERIFY'].includes(result.phase)
   &&Number.isSafeInteger(result.completedCount)&&Number.isSafeInteger(result.totalRecords)&&result.totalRecords>0&&result.completedCount>=0&&result.completedCount<=result.totalRecords){
   busy=true;lock(true);message('Saving 保存中… '+result.completedCount+' / '+result.totalRecords);const current=active,attempt=serial;
   timer=setTimeout(()=>{if(active===current&&serial===attempt){busy=false;transmit();}},250);return false;
  }
  try{window.sourceSalesCurrent.finish(request,result);}catch(cause){error(Error(result.error||cause.message));return false;}
  const save=node(controls().save);if(save)save.textContent=view==='PROGRESS'?'Save':'Save 保存';active=null;busy=false;return true;
 }
 window.sourceSalesCurrent.register('DATE',restore);
 window.addEventListener('beforeunload',event=>{if(active){event.preventDefault();event.returnValue='';}});
 window.sourceSalesDates={send,accept,isViewBusy:scope=>Boolean(active||loading)&&view===scope};
})();
