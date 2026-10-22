'use strict';
// Mechanical second seam in the existing Warehouse candidate builder. Source
// production is never written; original POINTBASE modal and legacy path remain.
module.exports=function currentCbmOverlay(source){
 function once(before,after){if(source.split(before).length!==2)throw Error('Exact original CBM UI anchor changed: '+before.slice(0,80));source=source.replace(before,()=>after);}
 once('function restorePreparation(staff,request){',`let cbmRetained=false,cbmSerial=0,cbmStaff=null;
function restoreCbm(staff,request){
 if(!request||pending||saving||dialog.open||cbmRetained)return;
 cbmRequest=JSON.parse(JSON.stringify(request));cbmStaff=staff;cbmRetained=true;
 modal('Pending CBM 待确认体积','Resume CBM 继续核对','<p id="whCbmValue">CBM: —</p><p>Retry the original request. Do not capture again.<br>请重试原请求，不要重复抓取。</p>','Retry 重试',fetchCbm);dialog.classList.add('wh-cbm');
}
function currentCbmResult(message){
 if(cbmRequest?.stockProtocol!==1)return false;
 const original=cbmRequest,result=message.result;
 if(message.ok&&result?.ok===false&&result.pending===true&&result.requestId===original.requestId&&saving&&['BEFORE','APPLY','VERIFY'].includes(result.phase)&&Number.isSafeInteger(result.completedCount)&&Number.isSafeInteger(result.totalRecords)&&result.totalRecords>0&&result.completedCount>=0&&result.completedCount<=result.totalRecords){
  clearTimeout(cbmTimer);saving=false;setBusy();$('whInfo').textContent='Saving 保存中… '+result.completedCount+' / '+result.totalRecords;const segment=cbmSerial;
  setTimeout(()=>{if(cbmRequest===original&&!saving&&segment===cbmSerial)fetchCbm();},250);return true;
 }
 clearTimeout(cbmTimer);cbmSerial++;saving=false;setBusy();
 if(!(message.ok&&result?.ok===true&&result.requestId===original.requestId&&result.company===original.company&&result.taskId===original.taskId&&validCbm(result.cbmPerCtn)&&Number.isSafeInteger(result.stockGeneration)&&(result.retained===true?result.stockGeneration>=original.stockGeneration:result.stockGeneration>original.stockGeneration))){
  error('CBM result unconfirmed. Retry the original request. 体积结果尚未确认，请重试原请求。');$('whInfo').textContent='';return true;
 }
 try{window.warehouseCurrentCbm.clear(original,cbmStaff);}catch(_){error('CBM confirmed; cache cleanup pending. Retry original request. 体积已确认，暂存清理待核对，请重试原请求。');return true;}
 cbmRetained=false;preparationConfirmedGeneration=result.stockGeneration;return false;
}
function restorePreparation(staff,request){`);
 once('callbacks=handlers;restorePreparation(result.staff,result.request);','callbacks=handlers;if(result.request)restorePreparation(result.staff,result.request);else restoreCbm(result.staff,window.warehouseCurrentCbm?.pending(value,result.staff));');
 once('function modal(title,subtitle,body,saveLabel,save){',"function modal(title,subtitle,body,saveLabel,save){if(cbmRetained&&save!==fetchCbm){error('Confirm the original CBM request first. 请先核对原体积请求。');return;}");
 once('function close(){if(saving||pending){','function close(){if(saving||pending||cbmRetained){');
 once(' if(saving||pending)return;const item=data.deliveryTasks.find(i=>i.id===id);',` if(saving||pending||cbmRetained)return;
 if(preparationConfirmedGeneration!==null){modal('CBM confirmed 体积已确认','Refresh required 请刷新资料','<p>Wait for the updated Warehouse workspace.<br>请先刷新货仓资料。</p>');return;}
 const item=data.deliveryTasks.find(i=>i.id===id);`);
 once(" cbmRequest={type:'WAREHOUSE_CBM_REQUEST',company,taskId:item.taskId,requestId:crypto.randomUUID()};",` cbmRequest={type:'WAREHOUSE_CBM_REQUEST',company,taskId:item.taskId,requestId:crypto.randomUUID()};
 if(currentPreparation){cbmRequest={...cbmRequest,stockProtocol:1,stockBuild:currentPreparation.stockBuild,stockGeneration:currentPreparation.stockGeneration,stockIdentity:{staffId:preparationStaff.staffId,memberId:preparationStaff.memberId}};cbmStaff=preparationStaff;}`);
 once(" if(saving||!cbmRequest)return;saving=true;",` if(saving||!cbmRequest)return;
 if(cbmRequest.stockProtocol===1){try{window.warehouseCurrentCbm.retain(cbmRequest,cbmStaff);cbmRetained=true;}catch(_){error('CBM not sent: cache confirmation required. 体积请求尚未发送，请核对浏览器暂存。');return;}}
 const original=cbmRequest,segment=++cbmSerial;saving=true;`);
 once('cbmTimer=setTimeout(()=>{saving=false;',"cbmTimer=setTimeout(()=>{if(cbmRequest!==original||segment!==cbmSerial)return;saving=false;");
 once(" clearTimeout(cbmTimer);saving=false;setBusy();\n if(m.ok&&m.result?.ok&&validCbm(m.result.cbmPerCtn)){",` const wasCurrent=cbmRequest.stockProtocol===1;if(currentCbmResult(m))return;
 clearTimeout(cbmTimer);saving=false;setBusy();
 if(m.ok&&m.result?.ok&&validCbm(m.result.cbmPerCtn)){`);
 once('cbmRequest=null;callbacks.render();','cbmRequest=null;callbacks.render();if(wasCurrent)callbacks.refresh();');
 once("window.addEventListener('beforeunload',e=>{if(pending||saving){","window.addEventListener('beforeunload',e=>{if(pending||saving||cbmRetained){");
 once('setData(result,value,handlers){data=', 'setData(result,value,handlers){if(cbmRequest?.stockProtocol===1&&(dialog.open||cbmRetained))return;data=');
 once('if(cached)restorePreparation(preparationStaff,cached);','if(cached)restorePreparation(preparationStaff,cached);else restoreCbm(preparationStaff,window.warehouseCurrentCbm?.pending(company,preparationStaff));');
 return source;
};
