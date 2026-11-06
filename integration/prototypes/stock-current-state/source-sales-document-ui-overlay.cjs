'use strict';
module.exports=function documentOverlay(source){
 function once(before,after){if(source.split(before).length!==2)throw Error('Exact original Source document UI anchor changed: '+before.slice(0,90));source=source.replace(before,()=>after);}
 once('pending=null,saving=false;','pending=null,saving=false,sending=false,timer=null,serial=0,retainedView=null;');
 once('function status(value){',`function ensureDialog(){if(!dialog){dialog=document.createElement('dialog');dialog.className='master-shipment-dialog customer-document-dialog';document.body.appendChild(dialog);dialog.addEventListener('cancel',event=>{if(saving||pending?.action==='DOCUMENT')event.preventDefault();else pending=null;});}}
function restoreCurrent(entry){if(entry?.ui?.kind!=='DOCUMENT'||entry.request.action!=='DOCUMENT'||entry.ui.company!==entry.request.company||entry.ui.customer!==entry.request.customerId)throw Error('Original file view requires review');
 ensureDialog();company=entry.ui.company;customer=entry.ui.customer;data=entry.ui.data;pending=entry.request;retainedView=entry.ui;saving=false;sending=false;render();
 dialog.querySelector('[data-type]').value=pending.input.type;dialog.querySelector('[data-invoice]').value=pending.input.shipmentId||'';typeChanged();
 for(const key of ['number','date','currency','reason'])dialog.querySelector('[data-'+key+']').value=pending.input[key];dialog.querySelector('[data-amount]').value=(pending.input.amountCents/100).toFixed(2);
 lock();status('Original PDF retained: '+retainedView.file.name+'. Retry the same upload 原 PDF 已保留，请重试同一次上传。');if(!dialog.open)dialog.showModal();
}
function resumeCurrent(entry){if(entry.ui.kind==='DOCUMENT')restoreCurrent(entry);else{window.sourceSalesCurrent.restore(entry);pending=null;dialog.close();}}
function recoveryError(error){saving=false;sending=false;lock();status(error?.message||'Original file save unconfirmed 原文件保存尚未确认');}
function status(value){`);
 once('action,requestId:crypto.randomUUID(),input};transmit();',"action,requestId:crypto.randomUUID(),input:action==='DOCUMENT'&&data?.stockCurrent?JSON.parse(JSON.stringify({...input,stockCurrent:data.stockCurrent})):input};if(pending.input?.stockCurrent){const file=dialog.querySelector('[data-file]').files[0];retainedView={kind:'DOCUMENT',company,customer,data,file:{name:file.name,size:file.size,type:file.type||''}};}transmit();");
 once('function transmit(){saving=true;',"function transmit(){if(sending)return;if(pending?.input?.stockCurrent){try{window.sourceSalesCurrent.retain(pending,retainedView);}catch(error){recoveryError(error);return;}}sending=true;saving=true;");
 once('const request=pending;setTimeout(()=>{if(pending===request){saving=false;',"const request=pending,attempt=++serial;clearTimeout(timer);timer=setTimeout(()=>{if(pending===request&&attempt===serial){sending=false;saving=false;");
 once("if(!dialog){dialog=document.createElement('dialog');dialog.className='master-shipment-dialog customer-document-dialog';document.body.appendChild(dialog);dialog.addEventListener('cancel',event=>{if(saving||pending?.action==='DOCUMENT')event.preventDefault();else pending=null;});}customer=id;","ensureDialog();customer=id;");
 once("return;saving=false;if(!m.ok||m.result?.ok===false){",`return;clearTimeout(timer);serial++;sending=false;saving=false;
 if(pending.action==='READ'&&!m.ok){const original=pending;window.sourceSalesCurrent.recover(company,customer).then(entry=>{if(pending!==original)return;if(entry)resumeCurrent(entry);else recoveryError(Error(m.error||'Read unconfirmed 读取尚未确认'));}).catch(error=>{if(pending===original)recoveryError(error);});return;}
 if(pending.input?.stockCurrent&&m.ok){const result=m.result;if(result?.ok===false&&result.pending===true&&result.requestId===pending.requestId&&['BEFORE','APPLY','VERIFY'].includes(result.phase)&&Number.isSafeInteger(result.completedCount)&&Number.isSafeInteger(result.totalRecords)&&result.totalRecords>0&&result.completedCount>=0&&result.completedCount<=result.totalRecords){
  saving=true;sending=true;lock();status('Saving 保存中… '+result.completedCount+' / '+result.totalRecords);const original=pending,attempt=serial;timer=setTimeout(()=>{if(pending===original&&serial===attempt){sending=false;transmit();}},250);return;}
  if(result?.ok!==true||result.requestId!==pending.requestId||!Number.isSafeInteger(result.stockGeneration)||result.stockGeneration<=pending.input.stockCurrent.stockGeneration){recoveryError(Error('Original file save unconfirmed. Retry the same upload 原文件保存尚未确认，请重试同一次上传。'));return;}}
 if(!m.ok||m.result?.ok===false){`);
 once("if(pending.action==='READ'||/changed|Enter |already|not authorized|must match|Select a valid|Select a PDF/.test(error))pending=null;","if(!pending.input?.stockCurrent&&(pending.action==='READ'||/changed|Enter |already|not authorized|must match|Select a valid|Select a PDF/.test(error)))pending=null;");
 once('const action=pending.action;pending=null;',`if(pending.action==='READ'&&m.result?.stockCurrent!==undefined){const original=pending;try{if(window.sourceSalesCurrent.checkRead(company,customer,m.result.stockCurrent,entry=>{if(pending===original)resumeCurrent(entry);},error=>{if(pending===original)recoveryError(error);}))return;}catch(error){recoveryError(error);return;}}
 if(pending.input?.stockCurrent){try{window.sourceSalesCurrent.finish(pending,m.result);}catch(error){recoveryError(error);return;}}const action=pending.action;pending=null;retainedView=null;`);
 once('window.customerSalesDocuments=',"window.sourceSalesCurrent.register('DOCUMENT',restoreCurrent);\nwindow.addEventListener('beforeunload',event=>{if(pending?.input?.stockCurrent){event.preventDefault();event.returnValue='';}});\nwindow.customerSalesDocuments=");
 return source;
};
