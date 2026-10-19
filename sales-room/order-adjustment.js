(()=>{
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let dialog,selection,data,pending,saving=false,timer;
 function status(text){dialog.querySelector('[data-status]').textContent=text;}
 function lock(value){saving=value;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=value);}
 function transmit(){lock(true);status(pending.action==='READ'?'Loading 读取中…':'Saving 保存中…');parent.postMessage(pending,'*');clearTimeout(timer);timer=setTimeout(()=>{lock(false);status('Not confirmed 尚未确认，请重试同一次操作。');dialog.querySelector('[data-retry]').hidden=false;},30000);}
 function send(action,input){pending={type:'SALES_ROOM_SHIPMENT_REQUEST',requestId:crypto.randomUUID(),company:selection.company,customerId:selection.customerId,action,input};transmit();}
 function difference(){const original=data?.line.requested??selection.quantity,first=Number(dialog.querySelector('[data-first]').value);dialog.querySelector('[data-next]').textContent=Number.isSafeInteger(first)&&first>0&&first<original?(original-first).toLocaleString('en-US'):'—';}
 function render(){
  const original=data?.line.requested??selection.quantity,prior=data?.plan?.batches[0]?.lines.find(line=>line.taskId===data.line.taskId)?.quantity;
  dialog.innerHTML='<div class="adjustment-head"><h2>Order Adjustment<small>订单调整</small></h2><button data-close aria-label="Close">×</button></div><div class="adjustment-body"><b>'+esc(selection.name)+'</b><small>'+esc(selection.barcode)+'</small><div class="adjustment-row"><span>Original Qty 原数量</span><strong>'+original.toLocaleString('en-US')+'</strong></div><label class="adjustment-row"><span>This shipment 本次发货</span><input data-first type="number" min="1" max="'+(original-1)+'" step="1" inputmode="numeric" value="'+(prior||'')+'" placeholder="Enter qty"></label><div class="adjustment-row"><span>Next shipment 下次发货</span><strong data-next>—</strong></div><p data-status role="status"></p></div><div class="adjustment-actions"><button data-retry hidden>Retry 重试</button><button data-close>Cancel 取消</button><button class="primary" data-save>Save 保存</button></div>';
  dialog.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>{if(!saving&&!pending)dialog.close();});dialog.querySelector('[data-first]').oninput=difference;
  dialog.querySelector('[data-retry]').onclick=()=>{if(pending&&!saving)transmit();};
  dialog.querySelector('[data-save]').onclick=()=>{
   if(pending||!data)return;const first=Number(dialog.querySelector('[data-first]').value),total=data.line.requested;
   if(!Number.isSafeInteger(first)||first<=0||first>=total){status('Enter a whole number between 1 and '+(total-1)+' 请填写有效整箱数量。');return;}
   const batches=(data.plan?.batches||[{label:'This shipment',lines:[]},{label:'Next shipment',lines:[]}]).map(batch=>({...batch,lines:batch.lines.filter(line=>line.taskId!==data.line.taskId)}));
   while(batches.length<2)batches.push({label:'Next shipment',lines:[]});
   batches[0].lines.push({taskId:data.line.taskId,quantity:first});batches[1].lines.push({taskId:data.line.taskId,quantity:total-first});
   send('PLAN',{version:data.version,customerId:selection.customerId,orderId:selection.orderId,reason:'Sales split '+total+' into '+first+' + '+(total-first),batches:batches.filter(batch=>batch.lines.length)});
  };difference();
 }
 window.salesOrderAdjustment={open(value){
  if(pending)return;if(!['NCT','GHR'].includes(value.company)){alert('Order destination is unavailable. Please refresh the order.');return;}
  if(!dialog){dialog=document.createElement('dialog');dialog.className='order-adjustment-dialog';document.body.appendChild(dialog);dialog.addEventListener('cancel',event=>{if(saving||pending)event.preventDefault();});}
  selection=value;data=null;render();dialog.showModal();send('READ');
 }};
 window.addEventListener('message',event=>{
  const message=event.data;if(event.source!==parent||!pending||message?.type!=='SALES_ROOM_SHIPMENT_RESULT'||message.requestId!==pending.requestId||message.company!==selection.company)return;
  clearTimeout(timer);lock(false);
  if(!message.ok){status(message.error||'Save not confirmed 保存尚未确认');if(/changed|Enter |Select |must |already|before |authorized|preserve/i.test(message.error||'')){pending=null;dialog.querySelector('[data-save]').disabled=true;}else dialog.querySelector('[data-retry]').hidden=false;return;}
  const action=pending.action;pending=null;
  if(action==='READ'){
   const result=message.result,line=result?.lines?.find(line=>line.orderId===selection.orderId&&line.sourceLineId===selection.lineId);
   if(!line||line.requested<2){status('This line cannot be split 此行无法拆单');dialog.querySelector('[data-save]').disabled=true;return;}
   data={line,version:result.planVersion,plan:result.plans.find(plan=>plan.orderId===selection.orderId)};render();
  }else{dialog.close();window.customerShipmentBatches.notify(selection.company);window.dispatchEvent(new CustomEvent('sales-order-split-saved',{detail:{customerId:selection.customerId}}));}
 });
})();
