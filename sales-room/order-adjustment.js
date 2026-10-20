(()=>{
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let dialog,selection,data,pending,saving=false,timer,mode='';
 function status(text){dialog.querySelector('[data-status]').textContent=text;}
 function lock(value){saving=value;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=value);}
 function transmit(){lock(true);status(pending.action==='READ'?'Loading 读取中…':'Saving 保存中…');parent.postMessage(pending,'*');clearTimeout(timer);timer=setTimeout(()=>{lock(false);status('Not confirmed 尚未确认，请重试同一次操作。');dialog.querySelector('[data-retry]').hidden=false;},30000);}
 function send(action,input){pending={type:'SALES_ROOM_SHIPMENT_REQUEST',requestId:crypto.randomUUID(),company:selection.company,customerId:selection.customerId,action,input};transmit();}
 const modes={INCREASE:{title:'Increase Order Qty',zh:'增加订货量',input:'Additional Qty 增加数量',result:'New Total Qty 新总数量',button:'Confirm Increase 确认加单'},SPLIT:{title:'Split Shipment',zh:'改成分批发货',input:'This Shipment 本次发货',result:'Next Shipment 下次发货',button:'Confirm Split 确认分批'},REDUCE:{title:'Cancel Partial Qty',zh:'取消部分数量',input:'Qty to Cancel 取消数量',result:'Remaining Qty 保留数量',button:'Confirm Cancellation 确认取消'}};
 function difference(){if(!mode)return;const original=data?.quantity??selection.quantity,input=dialog.querySelector('[data-first]'),n=Number(input.value),valid=Number.isSafeInteger(n)&&n>0&&(mode==='INCREASE'?(data?.line.requested??original)+n<=9999:n<original);dialog.querySelector('[data-next]').textContent=valid?(mode==='INCREASE'?original+n:original-n).toLocaleString('en-US'):'—';input.setAttribute('aria-invalid',String(input.value!==''&&!valid));dialog.querySelector('[data-save]').disabled=!data||!valid||Boolean(pending)||saving;}
 function render(){
  const original=data?.quantity??selection.quantity,choice=modes[mode];
  const home='<div class="adjustment-row"><span>Current Qty 当前数量</span><strong>'+original.toLocaleString('en-US')+'</strong></div>'+Object.entries(modes).map(([key,value])=>'<button class="adjustment-choice" data-mode="'+key+'" '+(!data?'disabled':'')+'><span><b>'+value.title+'</b><small>'+value.zh+'</small></span><span aria-hidden="true">›</span></button>').join('');
  const detail=choice?'<div class="adjustment-row"><span>Original Qty 原数量</span><strong>'+original.toLocaleString('en-US')+'</strong></div><label class="adjustment-row"><span>'+choice.input+'</span><input data-first type="number" min="1" max="'+(mode==='INCREASE'?9999-(data?.line.requested??original):original-1)+'" step="1" inputmode="numeric" placeholder="0"></label><div class="adjustment-row"><span>'+choice.result+'</span><strong data-next>—</strong></div>':'';
  dialog.innerHTML='<div class="adjustment-head"><h2>'+(choice?choice.title:'Order Adjustment')+'<small>'+(choice?choice.zh:'订单调整')+'</small></h2><button data-close aria-label="Close 关闭">×</button></div><div class="adjustment-body"><b>'+esc(selection.name)+'</b><small>'+esc(selection.barcode)+'</small>'+(choice?detail:home)+'<p data-status role="status"></p></div><div class="adjustment-actions"><button data-retry hidden>Retry 重试</button>'+(choice?'<button data-back>Back 返回</button><button class="primary" data-save disabled>'+choice.button+'</button>':'<button data-close>Cancel 取消</button>')+'</div>';
  dialog.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>{if(!saving&&!pending)dialog.close();});dialog.querySelector('[data-retry]').onclick=()=>{if(pending&&!saving)transmit();};dialog.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{if(!data||pending||saving)return;mode=button.dataset.mode;render();dialog.querySelector('[data-first]').focus();});if(!choice)return;
  dialog.querySelector('[data-back]').onclick=()=>{if(!saving&&!pending){mode='';render();}};dialog.querySelector('[data-first]').oninput=difference;
  dialog.querySelector('[data-retry]').onclick=()=>{if(pending&&!saving)transmit();};
  dialog.querySelector('[data-save]').onclick=()=>{
   if(pending||!data)return;difference();if(dialog.querySelector('[data-save]').disabled)return;
   send('ADJUST',{version:data.version,customerId:selection.customerId,orderId:selection.orderId,taskId:data.line.taskId,batchId:selection.batchId||'',mode,quantity:Number(dialog.querySelector('[data-first]').value)});
  };difference();
 }
 window.salesOrderAdjustment={open(value){
  if(pending)return;if(!['NCT','GHR'].includes(value.company)){alert('Order destination is unavailable. Please refresh the order.');return;}
  if(!dialog){dialog=document.createElement('dialog');dialog.className='order-adjustment-dialog';document.body.appendChild(dialog);dialog.addEventListener('cancel',event=>{if(saving||pending)event.preventDefault();});}
  selection=value;data=null;mode='';render();dialog.showModal();send('READ');
 }};
 window.addEventListener('message',event=>{
  const message=event.data;if(event.source!==parent||!pending||message?.type!=='SALES_ROOM_SHIPMENT_RESULT'||message.requestId!==pending.requestId||message.company!==selection.company)return;
  clearTimeout(timer);lock(false);
  if(!message.ok){status(message.error||'Save not confirmed 保存尚未确认');if(/changed|Enter |Select |must |already|before |authorized|preserve/i.test(message.error||'')){pending=null;if(dialog.querySelector('[data-save]'))dialog.querySelector('[data-save]').disabled=true;}else dialog.querySelector('[data-retry]').hidden=false;return;}
  const action=pending.action;pending=null;
  if(action==='READ'){
   const result=message.result,line=result?.lines?.find(line=>line.orderId===selection.orderId&&line.sourceLineId===selection.lineId);
   if(!line||(line.originalRequested??line.requested)<1||!result.adjustmentVersion){status('Current adjustment data is unavailable 请重新打开订单调整');return;}
   const plan=result.plans.find(plan=>plan.orderId===selection.orderId),batch=selection.batchId?plan?.batches.find(batch=>plan.id+'|'+batch.sequence===selection.batchId)?.lines.find(entry=>entry.taskId===line.taskId):null;
   if(selection.batchId&&!batch){status('Shipment row changed 请刷新订单后重试');return;}
   data={line:{...line,requested:line.originalRequested??line.requested},quantity:batch?.quantity??line.originalRequested??line.requested,version:result.adjustmentVersion,plan};render();
  }else{dialog.close();window.customerShipmentBatches.notify(selection.company);window.dispatchEvent(new CustomEvent('sales-order-split-saved',{detail:{customerId:selection.customerId}}));}
 });
})();
