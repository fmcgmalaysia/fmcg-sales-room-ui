'use strict';
module.exports=function shipmentDurableOverlay(source){
 function once(before,after){if(source.split(before).length!==2)throw Error('Exact original Sales shipment durable anchor changed: '+before.slice(0,80));source=source.replace(before,()=>after);}
 once(' function send(action,input){',` function ensureDialog(){if(!dialog){dialog=document.createElement('dialog');dialog.className='master-shipment-dialog';document.body.appendChild(dialog);dialog.addEventListener('cancel',event=>{if(saving||pending)event.preventDefault();});}}
 function holdCurrent(){if(!pending?.input?.stockCurrent)return;dialog.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=true);dialog.querySelector('[data-retry]').disabled=false;}
 function recoveryError(error){saving=false;holdCurrent();dialog.querySelector('[data-status]').textContent=error?.message||'Original shipment save recovery unconfirmed 原发货安排恢复尚未确认';dialog.querySelector('[data-retry]').hidden=false;}
 function restoreCurrent(entry){if(entry?.ui?.kind!=='SHIPMENT'||!['SELECT','CANCEL','PLAN'].includes(entry.request.action)||entry.ui.company!==entry.request.company||entry.ui.customer!==entry.request.customerId)throw Error('Original shipment view requires review');
  ensureDialog();company=entry.ui.company;customer=entry.ui.customer;data=entry.ui.data;pending=entry.request;saving=false;render();renderSplitPlan();
  if(pending.action==='SELECT'){for(const row of dialog.querySelectorAll('[data-task]')){const chosen=pending.input.lines.find(line=>line.taskId===row.dataset.task);row.querySelector('[data-select]').checked=Boolean(chosen);if(chosen)row.querySelector('[data-qty]').value=String(chosen.quantity);}}
  if(pending.action==='PLAN'){for(const row of dialog.querySelectorAll('[data-plan-task]')){const first=pending.input.batches[0].lines.find(line=>line.taskId===row.dataset.planTask),second=pending.input.batches[1].lines.find(line=>line.taskId===row.dataset.planTask);row.querySelector('[data-plan-select]').checked=Boolean(first&&second);if(first&&second){row.querySelector('[data-first]').value=String(first.quantity);row.querySelector('[data-second]').value=String(second.quantity);}}dialog.querySelector('[data-plan-reason]').value=pending.input.reason;}
  dialog.querySelector('[data-reason]').value=pending.input.reason;holdCurrent();dialog.querySelector('[data-status]').textContent='Original save retained. Retry the same shipment arrangement. 原保存已保留，请重试同一次发货安排。';dialog.querySelector('[data-retry]').hidden=false;if(!dialog.open)dialog.showModal();
 }
 function resumeCurrent(entry){if(entry.ui.kind==='SHIPMENT')restoreCurrent(entry);else{window.sourceSalesCurrent.restore(entry);pending=null;dialog.close();}}
 function send(action,input){`);
 once('function transmit(){saving=true;',"function transmit(){if(pending?.input?.stockCurrent){try{window.sourceSalesCurrent.retain(pending,{kind:'SHIPMENT',company,customer,data});}catch(error){recoveryError(error);return;}}saving=true;");
 const unlocked="dialog.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=false);";
 if(source.split(unlocked).length!==3)throw Error('Original shipment unlock anchors changed');
 source=source.replaceAll(unlocked,unlocked+'holdCurrent();');
 once("if(!message.ok){dialog.querySelector('[data-status]')",`if(!message.ok&&pending.action==='READ'){const original=pending;window.sourceSalesCurrent.recover(company,customer).then(entry=>{if(pending!==original)return;if(entry)resumeCurrent(entry);else recoveryError(Error(message.error||'Read unconfirmed 读取尚未确认'));}).catch(error=>{if(pending===original)recoveryError(error);});return;}if(!message.ok){dialog.querySelector('[data-status]')`);
 once('const action=pending.action;pending=null;',`if(pending.action==='READ'&&message.result?.stockCurrent){const original=pending;try{if(window.sourceSalesCurrent.checkRead(company,customer,message.result.stockCurrent,entry=>{if(pending===original)resumeCurrent(entry);},error=>{if(pending===original)recoveryError(error);}))return;}catch(error){recoveryError(error);return;}}
 if(pending.input?.stockCurrent){try{window.sourceSalesCurrent.finish(pending,message.result);}catch(error){recoveryError(error);return;}}const action=pending.action;pending=null;`);
 once("if(!dialog){dialog=document.createElement('dialog');dialog.className='master-shipment-dialog';document.body.appendChild(dialog);dialog.addEventListener('cancel',event=>{if(saving||pending)event.preventDefault();});}customer=customerId;","ensureDialog();customer=customerId;");
 once('timer=setTimeout(transmit,250);',"{const original=pending,attempt=serial;timer=setTimeout(()=>{if(pending===original&&serial===attempt)transmit();},250);}");
 once(' window.masterShipments='," window.sourceSalesCurrent.register('SHIPMENT',restoreCurrent);\n window.masterShipments=");
 return source;
};
