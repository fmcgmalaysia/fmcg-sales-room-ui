'use strict';
const fs=require('node:fs'),path=require('node:path');
let source=fs.readFileSync(path.join(__dirname,'../../../warehouse-room/dispatch.js'),'utf8').replace(/\r\n/g,'\n');
function once(before,after){if(source.split(before).length!==2)throw Error('Exact original dispatch UI anchor changed: '+before.slice(0,80));source=source.replace(before,()=>after);}
once(' function request(){',` let currentDispatchStaff=null,dispatchSerial=0,dispatchRecovery=0;
 function resumeCurrentDispatch(staff,request){
  if(!request||pending||saving||dialog?.open)return;pending=JSON.parse(JSON.stringify(request));currentDispatchStaff=staff;
  if(!dialog){dialog=document.createElement('dialog');dialog.style.width='480px';document.body.appendChild(dialog);dialog.addEventListener('cancel',event=>{if(pending||saving)event.preventDefault();});}
  dialog.innerHTML='<div class="dialog-header"><h2>Pending Dispatch 待确认出库</h2></div><div class="dialog-body"><p>'+esc(request.input.id)+'</p><p>'+esc(request.requestId)+'</p><p>Retry the original save. Do not register the same dispatch again.<br>请重试原保存，不要重复登记同一次出库。</p><p data-error role="alert"></p></div><footer><button data-save class="primary">Retry same dispatch 重试原出库</button></footer>';
  dialog.querySelector('[data-save]').onclick=send;dialog.showModal();
 }
 function recoverCurrentDispatch(){
  if(pending||saving||dialog?.open||!window.warehouseCurrentDispatch)return;const selected=company,attempt=++dispatchRecovery;
  window.warehouseCurrentDispatch.recover(company).then(result=>{if(company===selected&&attempt===dispatchRecovery)resumeCurrentDispatch(result.staff,result.request);})
   .catch(()=>{if(company===selected&&attempt===dispatchRecovery&&host)host.querySelector('[data-dispatch-error]').textContent='Original dispatch recovery unconfirmed. Keep this tab and check login. 原出库恢复尚未确认，请保留此页并核对登录。';});
 }
 function currentDispatchResult(message){
  if(pending?.stockProtocol!==1)return false;const original=pending,result=message.result;
  if(message.ok&&result?.ok===false&&result.pending===true&&result.requestId===original.requestId&&saving&&['BEFORE','APPLY','VERIFY'].includes(result.phase)&&Number.isSafeInteger(result.completedCount)&&Number.isSafeInteger(result.totalRecords)&&result.totalRecords>0&&result.completedCount>=0&&result.completedCount<=result.totalRecords){
   saving=false;dialog.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);dialog.querySelector('[data-error]').textContent='Saving dispatch 保存出库中… '+result.completedCount+' / '+result.totalRecords;const serial=dispatchSerial;
   setTimeout(()=>{if(pending===original&&!saving&&serial===dispatchSerial)send();},250);return true;
  }
  dispatchSerial++;saving=false;dialog.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);
  if(!(message.ok&&result?.ok===true&&result.requestId===original.requestId&&result.company===company&&result.shipmentId===original.input.id&&result.status==='DISPATCHED'&&Number.isSafeInteger(result.stockGeneration)&&result.stockGeneration>original.stockGeneration)){
   dialog.querySelector('[data-error]').textContent='Dispatch result unconfirmed. Retry the original save. 出库结果尚未确认，请重试原保存。';return true;
  }
  try{window.warehouseCurrentDispatch.clear(original,currentDispatchStaff);}catch(_){dialog.querySelector('[data-error]').textContent='Dispatch confirmed; cache cleanup pending. Retry original save. 出库已确认，暂存清理待核对，请重试原保存。';return true;}
  pending=null;data=null;dialog.close();paint();request();return true;
 }
 window.addEventListener('beforeunload',event=>{if(pending?.stockProtocol===1){event.preventDefault();event.returnValue='';}});
 function request(){`);
once("input:{action:'DISPATCH',id:row.id,version:data.version,reference,reason}};", "input:{action:'DISPATCH',id:row.id,version:data.version,reference,reason}};if(data.stockCurrent)pending=JSON.parse(JSON.stringify({...pending,stockProtocol:1,stockBuild:data.stockCurrent.stockBuild,stockGeneration:data.stockCurrent.stockGeneration,stockIdentity:{staffId:data.staff.staffId,memberId:data.staff.memberId}}));");
once('function open(id){const row=',"function open(id){if(pending?.stockProtocol===1){if(!dialog.open)dialog.showModal();return;}const row=");
once('function request(){if(saving||pending)return;', 'function request(){if(saving||pending||data?.stockCurrent&&dialog?.open)return;');
once(' function send(){saving=true;',` function send(){if(saving||!pending)return;
  if(pending.stockProtocol===1){try{window.warehouseCurrentDispatch.retain(pending,currentDispatchStaff);}catch(_){dialog.querySelector('[data-error]').textContent='Dispatch not sent: cache confirmation required. 出库尚未发送，请核对浏览器暂存。';return;}}
  saving=true;`);
once('const current=pending;setTimeout(()=>{if(pending===current){','const current=pending,serial=++dispatchSerial;setTimeout(()=>{if(pending===current&&(pending.stockProtocol!==1||serial===dispatchSerial)){');
once("if(m.ok){data=m.result;paint();}else if(host)host.querySelector('[data-dispatch-error]').textContent=m.error||'Read failed';",`if(m.ok){
  if(pending?.stockProtocol===1||data?.stockCurrent&&dialog?.open)return;
  if(m.result?.stockCurrent!==undefined){const meta=m.result.stockCurrent;
   if(meta.schema!=='CURRENT_STOCK_V2'||meta.stockProtocol!==1||!meta.stockBuild||!Number.isSafeInteger(meta.stockGeneration)||meta.stockGeneration<0||!m.result.staff?.staffId||!m.result.staff.memberId){if(host)host.querySelector('[data-dispatch-error]').textContent='Current dispatch workspace unconfirmed 当前出库资料尚未确认';return;}
   currentDispatchStaff=m.result.staff;dispatchRecovery++;
   try{const cached=window.warehouseCurrentDispatch.pending(company,currentDispatchStaff);if(cached)resumeCurrentDispatch(currentDispatchStaff,cached);}catch(_){if(host)host.querySelector('[data-dispatch-error]').textContent='Original dispatch cache unavailable. Do not register again. 原出库暂存无法核对，请勿重新登记。';return;}
  }else currentDispatchStaff=null;
  data=m.result;paint();
 }else{if(host)host.querySelector('[data-dispatch-error]').textContent=m.error||'Read failed';recoverCurrentDispatch();}`);
once("m.requestId===pending?.requestId){saving=false;", "m.requestId===pending?.requestId){if(currentDispatchResult(m))return;saving=false;");
new Function(source);const target=path.join(__dirname,'warehouse-ui/dispatch.js');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Current Warehouse dispatch UI differs');}else fs.writeFileSync(target,source);
process.stdout.write('Original Warehouse dispatch current UI '+(process.argv.includes('--check')?'verified':'built')+'; production unchanged\n');
