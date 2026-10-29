(() => {
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const number=value=>Number.isFinite(value)?value.toLocaleString('en-GB',{maximumFractionDigits:3}):'—';
 const reasonNames={DAMAGED:'Damaged goods 货有坏',INSUFFICIENT:'Not enough stock 不够货',OTHER:'Other 其他'};
 const requests=new Map();let parentOrigin='';
 try{const origin=new URL(location.ancestorOrigins?.[0]||document.referrer);if(['fmcg999.wixstudio.com','fmcg999-master.editor.wix.com'].includes(origin.hostname))parentOrigin=origin.origin;}catch(_){}
 function sendParent(type,company,input,requestId=crypto.randomUUID()){
  if(parent===window||!parentOrigin)return Promise.reject(Error('Open Delivery Task from MASTER.'));
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{requests.delete(requestId);const error=Error('Confirmation is unknown. Retry the same request.');error.retryable=true;reject(error);},30000);requests.set(requestId,{company,type:type.replace('_REQUEST','_RESULT'),resolve,reject,timer});parent.postMessage({type,company,requestId,...(input?{input}:{})},parentOrigin);});
 }
 window.addEventListener('message',event=>{if(event.source!==parent||event.origin!==parentOrigin)return;const message=event.data||{},request=requests.get(message.requestId);if(!request||message.company!==request.company||message.type!==request.type)return;clearTimeout(request.timer);requests.delete(message.requestId);if(message.ok!==true||message.result?.ok===false){const error=Error(message.error||message.result?.error||'Confirmation is unknown. Retry the same request.');error.retryable=message.result?.retryable!==false;request.reject(error);}else request.resolve(message.result);});
 let channel=null;try{channel=new BroadcastChannel('master-desk-delivery-invalidate');}catch(_){}
 const notify=(company,list)=>channel?.postMessage({company,customerId:list.customerId,desk:list.desk.number});
 const supportPending=new Map();let supportContext=null,purchaseModel=null,purchaseQueued=false;
 function summaryPill(summary,quantity){return '<span class="dd-status '+(summary?.issue?'dd-issue':'dd-stable')+'">'+number(quantity)+'</span>';}
 const photoLinks=photos=>photos?.length?'<details class="dd-saved-photos"><summary>Photos 照片 · '+photos.length+'</summary>'+photos.map(photo=>'<a target="_blank" rel="noopener" href="https://drive.google.com/file/d/'+encodeURIComponent(photo.fileId)+'/view">'+esc(photo.at||photo.name||'View photo 查看照片')+'</a>').join('')+'</details>':'';
 function supportKey(context){return context.company+'|'+context.customerId+'|'+context.desk;}
 function mountSupport(context){
  supportContext=context;const {model,root,company,customerId,desk}=context;
  const packing=document.getElementById('packing');if(packing)packing.style.display='none';
  root.querySelector('.dd-support-actions')?.remove();if(!desk||!model)return;
  const delivery=model.delivery,lists=delivery?.lists||[],active=lists.find(list=>list.customerId===customerId&&list.desk?.number===desk&&['SENT','PROCESSING'].includes(list.status));
  const key=supportKey(context),restored=delivery?.pendingAuthorizations?.find(row=>row.input.customerId===customerId&&row.input.desk===desk);if(restored&&!supportPending.has(key))supportPending.set(key,{...restored,error:'Earlier authorization is unconfirmed. Resume the same request. 上次授权未确认，请继续核对。'});
  const pending=supportPending.get(key),lines=context.lines.filter(line=>Number.isSafeInteger(line.allocQty)&&Number.isSafeInteger(line.loadedQty)&&line.allocQty>line.loadedQty).map(line=>({taskId:line.taskId,quantity:line.allocQty-line.loadedQty}));
  const bar=document.createElement('div');bar.className='dd-support-actions';bar.innerHTML='<button type="button" class="dd-action" '+(delivery?.deskDeliveryVersion!==1||!context.canSend||(!active&&!lines.length)||pending?.running?'disabled':'')+'>'+(pending?'Retry same task 重试本次任务':active?'Recall task 撤回任务':'Send to Warehouse 发送货仓任务')+'</button><span class="dd-support-notice" role="status">'+esc(pending?.error||(!delivery?.deskDeliveryVersion?'Loading task authorization…':active?'Desk '+desk+' authorized to Warehouse':'Only allocated cartons in this Desk will be authorized. 仅授权本 Desk 已分配货物。'))+'</span>';
  const anchor=root.querySelector('.shipment-task-count');if(anchor)anchor.after(bar);else root.prepend(bar);
  const button=bar.querySelector('button'),notice=bar.querySelector('[role="status"]');
  button.onclick=async()=>{
   if(pending?.running)return;
   let operation=supportPending.get(key);
   if(!operation){const state=model.desks.find(row=>row.customerId===customerId);operation={requestId:crypto.randomUUID(),input:active?{action:'DESK_RECALL',id:active.id,revision:active.revision,reason:'Support recalled the Desk task'}:{action:'DESK_SEND',customerId,desk,deskRevision:state?.revision||'',lines}};supportPending.set(key,operation);}
   operation.running=true;button.disabled=true;notice.textContent='Sending… Existing quantities remain unchanged until confirmed.';
   try{const result=await context.send('PACKING_SAVE_REQUEST',operation.input,operation.requestId);if(!result.list?.desk||result.company!==company)throw Error('Desk task receipt is unconfirmed. Retry the same task.');supportPending.delete(key);context.applyReceipt(result);notify(company,result.list);}
   catch(error){operation.error=error.message;if(error.retryable===false)supportPending.delete(key);notice.textContent=error.message;button.textContent=error.retryable===false?'Refresh quantities and try again':'Retry same task 重试本次任务';}
   finally{operation.running=false;button.disabled=false;}
  };
  for(const row of root.querySelectorAll('tr[data-task]')){
   const taskId=row.dataset.task,summary=delivery?.deskSummaries?.find(item=>item.taskId===taskId),line=context.lines.find(item=>item.taskId===taskId);
   if(summary?.confirmed&&line&&row.cells.length>6)row.cells[6].innerHTML=summaryPill(summary,line.loadedQty)+photoLinks(lists.flatMap(list=>list.lines.filter(item=>item.taskId===taskId).flatMap(item=>item.photos||[])));
   const held=model.desks.find(item=>item.customerId===customerId)?.deliveryHolds?.some(hold=>hold.taskIds.includes(taskId)&&!lists.some(list=>list.id===hold.listId&&list.status==='CANCELLED'));
   if(held){const select=row.querySelector('select[data-desk-task]'),drag=row.querySelector('[data-drag-task]');if(select)select.disabled=true;if(drag){drag.disabled=true;drag.draggable=false;}}
  }
 }
 function createWarehouse(sender=sendParent){
  const state={company:'',container:null,lists:[],staff:'',loaded:false,reading:false,generation:0,selected:'',queue:[],running:false,notice:'',failed:new Map()};
  const dialog=document.createElement('dialog');dialog.className='dd-modal';dialog.setAttribute('aria-label','Confirm Loaded 确认实装');document.body.append(dialog);
  let editing=null,preparing=false;
  const pendingFor=(id,taskId)=>state.queue.find(item=>item.listId===id&&item.taskId===taskId);
  function render(){
   if(!state.container?.isConnected)return;
   const active=state.lists.filter(list=>list.status!=='CANCELLED'&&list.currentAuthorization!==false),selected=active.find(list=>list.id===state.selected);
   let html='<section class="dd-workspace"><div class="dd-heading"><h2>Delivery Task 发货任务</h2><button type="button" class="dd-refresh" data-dd-refresh>Refresh 刷新</button></div><p class="dd-notice" role="status">'+esc(state.notice)+'</p>';
   if(!state.loaded)html+='<p class="dd-empty">'+(state.reading?'Loading authorized Desk tasks… 正在读取已授权任务':'No authorized tasks loaded.')+'</p>';
   else if(!selected)html+='<div class="dd-customers">'+active.map(list=>'<button type="button" class="dd-customer" data-dd-open="'+esc(list.id)+'"><strong>'+esc(list.customerName)+'</strong><b>Desk '+list.desk.number+'</b><span>'+list.lines.length+' tasks</span><small>'+esc(list.status==='COMPLETED'?'Confirmed 已确认':'To load 待装货')+'</small></button>').join('')+(active.length?'':'<p class="dd-empty">No authorized tasks. 暂无 Support 授权的货仓任务。</p>')+'</div>';
   else{
    const refs=selected.currentDesk?.references??selected.desk.references,shipment=selected.currentDesk?.shipment??selected.desk.shipment;
    html+='<button class="dd-back" type="button" data-dd-back>‹ Customers 客户</button><header class="dd-customer-header"><h3>'+esc(selected.customerName)+' <span>Desk '+selected.desk.number+'</span></h3><div><span>SO No. <b>'+esc(refs?.soNo||'—')+'</b></span><span>PO No. <b>'+esc(refs?.poNo||'—')+'</b></span><span>Shipment Date <b>'+esc(shipment?.date||'—')+'</b></span></div></header><div class="dd-table-scroll"><table class="dd-task-table"><thead><tr>'+['','Desk','Descriptions','Price','Order Qty','Alloc Qty','Loaded Qty','Line CBM','Line Amount','Expiry','Message'].map(label=>'<th>'+label+'</th>').join('')+'</tr></thead><tbody>';
    html+=selected.lines.map(line=>{const pending=pendingFor(selected.id,line.taskId),confirmed=Boolean(line.loadedConfirmedAt),difference=confirmed&&line.loaded!==line.quantity,tone=difference?'dd-problem':confirmed?'dd-done':'dd-pending',message=window.departmentMessages?.cell?.({...line,id:line.chatContexts?.[0]?.id||line.taskId},'','SUPPORT','DELIVERY')||'';
     return '<tr><td></td><td>'+selected.desk.number+'</td><td class="dd-description"><small>'+esc(line.barcode)+'</small><strong>'+esc(line.name)+'</strong><small>'+esc(line.packing)+'</small></td><td class="dd-number"><span>'+number(line.pricePc)+'</span><small>'+number(line.priceCtn)+'</small></td><td class="dd-number">'+number(line.orderQty)+'</td><td class="dd-number">'+number(line.quantity)+'</td><td class="dd-number"><button type="button" class="dd-loaded '+tone+'" data-dd-load="'+esc(line.taskId)+'" '+(pending?'disabled':'')+'>'+number(confirmed?line.loaded:line.quantity)+'</button><small>'+(pending?(pending.uncertain?'Unconfirmed 尚未确认':'Confirming 确认中'):confirmed?(difference?'Short '+number(line.quantity-line.loaded):'Confirmed 已确认'):'Pending 待确认')+'</small>'+(pending?.uncertain?'<button type="button" class="dd-retry" data-dd-retry="'+esc(line.taskId)+'">Retry same save 重试本次</button>':'')+'</td><td class="dd-number">'+number(Number.isFinite(line.cbm)?line.cbm*line.loaded:null)+'</td><td class="dd-number">'+number(Number.isFinite(line.priceCtn)?line.priceCtn*line.loaded:null)+'</td><td>—</td><td>'+message+'</td></tr>';}).join('');
    html+='</tbody></table></div>';
   }
   state.container.innerHTML=html+'</section>';
   state.container.querySelector('[data-dd-refresh]')?.addEventListener('click',()=>refresh(true));
   state.container.querySelector('[data-dd-back]')?.addEventListener('click',()=>{state.selected='';render();});
   state.container.querySelectorAll('[data-dd-open]').forEach(button=>button.onclick=()=>{state.selected=button.dataset.ddOpen;render();});
   state.container.querySelectorAll('[data-dd-load]').forEach(button=>button.onclick=()=>open(selected,selected.lines.find(line=>line.taskId===button.dataset.ddLoad)));
   state.container.querySelectorAll('[data-dd-retry]').forEach(button=>button.onclick=()=>{const pending=pendingFor(state.selected,button.dataset.ddRetry);if(pending){pending.uncertain=false;pending.error='';pump();}});
  }
  async function refresh(manual=false){
   if(state.reading||state.queue.length||dialog.open||preparing||document.hidden&&!manual)return;
   const company=state.company,generation=++state.generation;state.reading=true;if(!state.loaded)state.notice='';render();
   try{const result=await sender('PACKING_READ_REQUEST',company);if(company!==state.company||generation!==state.generation)return;if(result.company!==company||result.deskDeliveryVersion!==1)throw Error('Desk task service is not ready. Please refresh after installation.');state.lists=result.lists.filter(list=>list.desk);state.staff=result.staff?.staffName||'';state.loaded=true;state.notice='Only Support-authorized customer and Desk tasks are shown. 仅显示 Support 已授权任务。';}
   catch(error){if(generation===state.generation)state.notice=error.message;}
   finally{if(generation===state.generation){state.reading=false;render();}}
  }
  function open(list,line){
   if(!list||!line||pendingFor(list.id,line.taskId))return;const retained=state.failed.get(list.id+'|'+line.taskId)?.draft;editing={listId:list.id,taskId:line.taskId,quantity:line.quantity,photos:retained?.photos||[]};
   const initial=retained?.loaded??(line.loadedConfirmedAt?line.loaded:line.quantity);
   dialog.innerHTML='<header><strong>'+esc(list.customerName)+' · Desk '+list.desk.number+'</strong><button type="button" data-dd-close aria-label="Close">×</button></header><div class="dd-modal-body"><strong>'+esc(line.name)+'</strong><small>'+esc(line.barcode)+' · '+esc(line.packing)+'</small><p>Authorized Alloc Qty 已授权数量 <b>'+line.quantity+'</b></p><label>Loaded Qty 实装数量<input type="number" id="dd-loaded-input" min="'+line.loaded+'" max="'+line.quantity+'" step="1" value="'+initial+'"></label><p id="dd-undelivered"></p><div class="dd-reasons">'+Object.entries(reasonNames).map(([value,label])=>'<label><input type="checkbox" value="'+value+'" '+(line.reasonCodes?.includes(value)?'checked':'')+'>'+label+'</label>').join('')+'</div><label>Note 说明<textarea id="dd-note" maxlength="1000">'+esc(line.note||'')+'</textarea></label><label>Photos 照片<input id="dd-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><small>Up to 3 photos, total 2 MB. 最多3张，共2 MB。</small>'+photoLinks(line.photos)+'<p id="dd-error" role="alert"></p></div><footer><button type="button" data-dd-close>Cancel 取消</button><button type="button" id="dd-confirm" class="dd-action">Confirm 确认</button></footer>';
   dialog.querySelectorAll('[data-dd-close]').forEach(button=>button.onclick=()=>{if(!preparing)dialog.close();});
   if(retained){dialog.querySelector('#dd-note').value=retained.note;dialog.querySelectorAll('.dd-reasons input').forEach(input=>input.checked=retained.reasonCodes.includes(input.value));dialog.querySelector('#dd-error').textContent='Previous input retained. '+editing.photos.length+' photos retained in this window. 上次输入及照片已保留。';}
   const input=dialog.querySelector('#dd-loaded-input'),hint=()=>{const loaded=input.value.trim()===''?null:Number(input.value);dialog.querySelector('#dd-undelivered').textContent='Undelivered 未交付 '+number(loaded===null?null:Math.max(0,line.quantity-loaded))+' CTN';};input.oninput=hint;hint();dialog.querySelector('#dd-confirm').onclick=enqueue;if(!dialog.open)dialog.showModal();
  }
  async function photos(files){
   if(files.length>3||files.reduce((sum,file)=>sum+file.size,0)>2*1024*1024)throw Error('Choose up to 3 photos, total 2 MB.');
   return Promise.all(files.map(async file=>{if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose JPEG, PNG or WebP photos.');const bytes=await file.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes),sha256=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join(''),base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});return {mimeType:file.type,base64,sha256};}));
  }
  async function enqueue(){
   if(preparing||!editing)return;const loaded=Number(dialog.querySelector('#dd-loaded-input').value),reasonCodes=Array.from(dialog.querySelectorAll('.dd-reasons input:checked'),input=>input.value),note=dialog.querySelector('#dd-note').value.trim(),list=state.lists.find(row=>row.id===editing.listId),line=list?.lines.find(row=>row.taskId===editing.taskId),error=dialog.querySelector('#dd-error');
   if(!line||dialog.querySelector('#dd-loaded-input').value.trim()===''||!Number.isSafeInteger(loaded)||loaded<line.loaded||loaded>line.quantity){error.textContent='Enter cumulative Loaded within the authorized quantity.';return;}
   if(loaded!==line.quantity&&!reasonCodes.length||reasonCodes.includes('OTHER')&&!note){error.textContent='Select a shortfall reason; explain Other. 请选择未交付原因。';return;}
   preparing=true;dialog.querySelector('#dd-confirm').disabled=true;
   try{const files=Array.from(dialog.querySelector('#dd-photos').files),evidence=files.length?await photos(files):editing.photos;state.failed.delete(list.id+'|'+line.taskId);state.queue.push({listId:list.id,taskId:line.taskId,authorized:line.quantity,requestId:crypto.randomUUID(),draft:{loaded,reasonCodes,note,photos:evidence},packet:null,uncertain:false});dialog.close();editing=null;state.notice='Confirmation queued. You can continue with another task. 已提交，可继续处理其他任务。';render();pump();}
   catch(failure){error.textContent=failure.message;dialog.querySelector('#dd-confirm').disabled=false;}
   finally{preparing=false;}
  }
  async function pump(){
   if(state.running||!state.queue.length||state.queue[0].uncertain)return;const command=state.queue[0],list=state.lists.find(row=>row.id===command.listId),line=list?.lines.find(row=>row.taskId===command.taskId);state.running=true;
   try{
    if(!command.packet){if(!line||line.quantity!==command.authorized){const error=Error('Authorized task changed. Refresh and confirm again.');error.retryable=false;throw error;}command.packet={action:'DESK_LOAD',id:list.id,revision:list.revision,taskId:command.taskId,...command.draft};}
    const result=await sender('PACKING_SAVE_REQUEST',state.company,command.packet,command.requestId);
    if(!result.list?.desk||result.company!==state.company||result.list.company!==state.company||result.list.id!==command.listId||result.id!==command.listId||result.requestId!==command.requestId||result.list.lines.find(row=>row.taskId===command.taskId)?.loaded!==command.draft.loaded)throw Error('Delivery receipt is unconfirmed. Retry the same save.');
    state.lists=state.lists.map(row=>row.id===result.list.id?{...result.list,lines:result.list.lines.map(line=>({...line,chatContexts:row.lines.find(item=>item.taskId===line.taskId)?.chatContexts||[]})),currentAuthorization:row.currentAuthorization,currentDesk:row.currentDesk}:row);state.queue.shift();state.notice='Saved 已确认';notify(state.company,result.list);
   }catch(error){state.notice=error.message;if(error.retryable===false){for(const retained of state.queue)state.failed.set(retained.listId+'|'+retained.taskId,retained);state.queue=[];state.notice+=' Inputs retained; refresh and reopen the affected rows. 输入及照片已保留，请刷新后重开对应行。';}else{command.uncertain=true;command.error=error.message;}}
   finally{state.running=false;render();if(state.queue.length&&!state.queue[0].uncertain)pump();}
  }
  dialog.addEventListener('cancel',event=>{if(preparing)event.preventDefault();});
  const companySelect=document.getElementById('company');companySelect?.addEventListener('change',event=>{if(state.queue.length||preparing){event.stopImmediatePropagation();event.target.value=state.company;state.notice='Confirm pending delivery saves before changing company. 请先确认待保存的发货记录。';render();}},true);
  window.addEventListener('beforeunload',event=>{if(state.queue.length||preparing){event.preventDefault();event.returnValue='';}});
  return {render(container,company){state.container=container;if(company!==state.company){state.company=company;state.lists=[];state.failed.clear();state.selected='';state.loaded=false;state.reading=false;state.generation++;}render();if(!state.loaded&&!state.reading)refresh();},refresh:()=>refresh(),isBusy:()=>dialog.open||preparing,state};
 }
 function decoratePurchase(){
  purchaseQueued=false;if(!purchaseModel)return;const root=document.getElementById('app');if(!root)return;
  for(const table of root.querySelectorAll('table')){const headers=Array.from(table.querySelectorAll('thead th')),index=headers.findIndex(cell=>/Alloc Qty/.test(cell.textContent));if(index<0)continue;for(const row of table.querySelectorAll('tr[data-id]')){const summary=purchaseModel.deskDeliveries?.find(item=>item.taskId===row.dataset.id);if(!summary||!row.cells[index])continue;const signature=JSON.stringify(summary),old=row.cells[index].querySelector('.dd-purchase-loaded');if(old?.dataset.signature===signature)continue;old?.remove();const node=document.createElement('small');node.className='dd-purchase-loaded';node.dataset.signature=signature;node.innerHTML='Loaded Qty '+summaryPill(summary,summary.loadedQty);row.cells[index].append(node);}}
 }
 const queuePurchase=()=>{if(!purchaseQueued){purchaseQueued=true;queueMicrotask(decoratePurchase);}};
 const purchaseRoot=document.getElementById('app');if(purchaseRoot)new MutationObserver(queuePurchase).observe(purchaseRoot,{childList:true,subtree:true});
 if(channel)channel.onmessage=event=>{const message=event.data;if(!message||!['NCT','GHR'].includes(message.company))return;if(supportContext?.company===message.company&&!document.querySelector('dialog[open]'))supportContext.invalidate?.();};
 const api={mountSupport,createWarehouse,setPurchase(model){purchaseModel=model;queuePurchase();},supportPending:()=>supportPending.size>0};window.DeskDelivery=api;
 if(document.querySelector('nav[aria-label="Warehouse navigation"]')){window.warehousePackingTab=createWarehouse();window.warehouseDeskDelivery=true;}
 window.addEventListener('beforeunload',event=>{if(supportPending.size){event.preventDefault();event.returnValue='';}});
})();
