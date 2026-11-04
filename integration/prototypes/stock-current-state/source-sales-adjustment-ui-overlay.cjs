'use strict';
module.exports=function adjustmentDurableOverlay(source){
 function once(before,after){if(source.split(before).length!==2)throw Error('Exact original Sales adjustment durable anchor changed: '+before.slice(0,80));source=source.replace(before,()=>after);}
 once("timer,mode='';","timer,mode='',serial=0;");
 once(' function status(text){',` function restoreCurrent(entry){
  if(entry?.ui?.kind!=='ADJUST'||entry.request.action!=='ADJUST'||entry.ui.selection?.company!==entry.request.company||entry.ui.selection?.customerId!==entry.request.customerId
   ||entry.ui.data?.line?.taskId!==entry.request.input.taskId)throw Error('Original order adjustment view requires review');
  ensureDialog();selection=entry.ui.selection;data=entry.ui.data;mode=entry.ui.mode;pending=entry.request;render();dialog.querySelector('[data-first]').value=String(pending.input.quantity);difference();lock(false);
  status('Original save retained. Retry the same adjustment. 原保存已保留，请重试同一次订单调整。');dialog.querySelector('[data-retry]').hidden=false;if(!dialog.open)dialog.showModal();
 }
 function resumeCurrent(entry){if(entry.ui.kind==='ADJUST')restoreCurrent(entry);else{window.sourceSalesCurrent.restore(entry);pending=null;dialog.close();}}
 function ensureDialog(){if(!dialog){dialog=document.createElement('dialog');dialog.className='order-adjustment-dialog';document.body.appendChild(dialog);dialog.addEventListener('cancel',event=>{if(saving||pending)event.preventDefault();});}}
 function recoveryError(error){lock(false);status(error?.message||'Original Sales save recovery unconfirmed 原销售保存恢复尚未确认');dialog.querySelector('[data-retry]').hidden=false;}
 function status(text){`);
 once("forEach(el=>el.disabled=value);}","forEach(el=>el.disabled=value);if(!value&&pending?.input?.stockCurrent){dialog.querySelectorAll('input,[data-close],[data-back],[data-save]').forEach(el=>el.disabled=true);dialog.querySelector('[data-retry]').disabled=false;}}");
 once('function transmit(){lock(true);',`function transmit(){if(pending?.input?.stockCurrent){try{window.sourceSalesCurrent.retain(pending,{kind:'ADJUST',selection,data,mode});}catch(error){recoveryError(error);return;}}
 const original=pending,attempt=++serial;lock(true);`);
 once('timer=setTimeout(()=>{lock(false);','timer=setTimeout(()=>{if(pending!==original||attempt!==serial)return;lock(false);');
 once("action,input:action==='ADJUST'&&data?.stockCurrent?{...input,stockCurrent:data.stockCurrent}:input};transmit();", "action,input:action==='ADJUST'&&data?.stockCurrent?JSON.parse(JSON.stringify({...input,stockCurrent:data.stockCurrent})):input};transmit();");
 once('  clearTimeout(timer);lock(false);','  clearTimeout(timer);serial++;lock(false);');
 once('  if(!message.ok){',`  if(!message.ok&&pending.action==='READ'){
   const original=pending;window.sourceSalesCurrent.recover(selection.company,selection.customerId).then(entry=>{if(pending!==original)return;if(entry)resumeCurrent(entry);else{status(message.error||'Read unconfirmed 读取尚未确认');dialog.querySelector('[data-retry]').hidden=false;}}).catch(error=>{if(pending===original)recoveryError(error);});return;
  }
  if(!message.ok){`);
 once('  const action=pending.action;pending=null;',`  if(pending.action==='READ'&&message.result?.stockCurrent){
   const original=pending;try{if(window.sourceSalesCurrent.checkRead(selection.company,selection.customerId,message.result.stockCurrent,entry=>{if(pending===original)resumeCurrent(entry);},error=>{if(pending===original)recoveryError(error);}))return;}catch(error){recoveryError(error);return;}
  }
  if(pending.action==='ADJUST'&&pending.input?.stockCurrent){try{window.sourceSalesCurrent.finish(pending,message.result);}catch(error){recoveryError(error);return;}}
  const action=pending.action;pending=null;`);
 once("  if(!dialog){dialog=document.createElement('dialog');dialog.className='order-adjustment-dialog';document.body.appendChild(dialog);dialog.addEventListener('cancel',event=>{if(saving||pending)event.preventDefault();});}","  ensureDialog();");
 once('timer=setTimeout(transmit,250);',"{const original=pending,attempt=serial;timer=setTimeout(()=>{if(pending===original&&serial===attempt)transmit();},250);}");
 once(' window.salesOrderAdjustment='," window.sourceSalesCurrent.register('ADJUST',restoreCurrent);\n window.addEventListener('beforeunload',event=>{if(pending?.input?.stockCurrent){event.preventDefault();event.returnValue='';}});\n window.salesOrderAdjustment=");
 return source;
};
