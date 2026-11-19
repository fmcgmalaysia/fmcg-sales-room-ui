'use strict';
module.exports=function dateOverlay(source){
 function once(before,after){if(source.split(before).length!==2)throw Error('Exact original Source date UI anchor changed: '+before.slice(0,90));source=source.replace(before,()=>after);}
 once("window.parent.postMessage({type:'SALES_ROOM_ORDER_PLANNING_UPDATE',orderId:target.orderId,customerPoNumber:po.value.trim(),estimatedShipmentDate:date.value,expectedRevision:pendingSalesPlanning.expectedRevision,expectedShipmentRevision:pendingSalesPlanning.expectedShipmentRevision,requestId:pendingSalesPlanning.requestId},'*')",
  "window.sourceSalesDates.send({type:'SALES_ROOM_ORDER_PLANNING_UPDATE',orderId:target.orderId,customerPoNumber:po.value.trim(),estimatedShipmentDate:date.value,expectedRevision:pendingSalesPlanning.expectedRevision,expectedShipmentRevision:pendingSalesPlanning.expectedShipmentRevision,requestId:pendingSalesPlanning.requestId},target,'PROGRESS',pendingSalesPlanning)");
 once("window.parent.postMessage({type:'SALES_ROOM_ORDER_PLANNING_UPDATE',orderId:order.orderId,customerPoNumber:po.value.trim(),estimatedShipmentDate:date.value,expectedRevision:pending.expectedRevision,expectedShipmentRevision:pending.expectedShipmentRevision,requestId:pending.requestId},'*')",
  "window.sourceSalesDates.send({type:'SALES_ROOM_ORDER_PLANNING_UPDATE',orderId:order.orderId,customerPoNumber:po.value.trim(),estimatedShipmentDate:date.value,expectedRevision:pending.expectedRevision,expectedShipmentRevision:pending.expectedShipmentRevision,requestId:pending.requestId},order,'REVIEW',pending)");
 once("message.requestId!==pendingSalesPlanning.requestId)return;const area=", "message.requestId!==pendingSalesPlanning.requestId)return;if(!window.sourceSalesDates.accept(message,event))return;const area=");
 once("message.requestId!==pending.requestId)return;const status=document.getElementById('salesQtyStatus');if(!message.ok){pending.saving=false;salesQtyBusy(false);document.getElementById('salesCustomerPo').oninput();",
  "message.requestId!==pending.requestId)return;if(!window.sourceSalesDates.accept(message,event))return;const status=document.getElementById('salesQtyStatus');if(!message.ok){pending.saving=false;salesQtyBusy(false);document.getElementById('salesCustomerPo').oninput();");
 once('function renderSalesOrderProgress(payload){',"function renderSalesOrderProgress(payload){if(window.sourceSalesDates?.isViewBusy('PROGRESS'))return;");
 once('function renderOrderDetail(o){',"function renderOrderDetail(o){if(window.sourceSalesDates?.isViewBusy('REVIEW'))return;");
 return source;
};
