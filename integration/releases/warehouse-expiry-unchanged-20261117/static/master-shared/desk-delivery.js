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
 function summaryPill(summary,quantity){return '<span class="dd-status '+(summary?.issue?'dd-issue':summary?.pending?'dd-waiting':'dd-stable')+'">'+number(quantity)+'</span>';}
 const resolutionPending=new Map();let resolutionDialog=null;
 const resolutionKey=(company,listId,taskId)=>company+'|'+listId+'|'+taskId;
 function openResolution(context,list,line){
  if(!resolutionDialog){resolutionDialog=document.createElement('dialog');resolutionDialog.className='dd-modal';resolutionDialog.setAttribute('aria-label','Resolve remaining cartons 处理剩余数量');document.body.append(resolutionDialog);}
  const key=resolutionKey(context.company,list.id,line.taskId),pending=resolutionPending.get(key),remaining=line.resolution?.remaining||pending?.input.parts.reduce((n,part)=>n+part.quantity,0)||0;
  resolutionDialog.innerHTML='<header><strong>'+esc(list.customerName)+' · Desk '+list.desk.number+'</strong><button type="button" data-resolution-close>×</button></header><div class="dd-modal-body"><strong>'+esc(line.name)+'</strong><p>Loaded 已装 <b>'+number(line.loaded)+'</b> · Remaining 剩余 <b>'+number(remaining)+'</b> CTN</p><fieldset '+(pending?'disabled':'')+'><label>Continue this loading 继续补装<input data-resolution-continue type="number" min="0" max="'+remaining+'" step="1" value="'+remaining+'"></label><label>Next shipment 转下次出货<input data-resolution-transfer type="number" min="0" max="'+remaining+'" step="1" value="0"></label><label>Destination Desk 目标工作台<select data-resolution-desk>'+[0,1,2,3].filter(desk=>desk!==list.desk.number).map(desk=>'<option value="'+desk+'">'+(desk?'Desk '+desk:'Awaiting arrangement 待安排')+'</option>').join('')+'</select></label></fieldset><p>Enter a total of '+remaining+' CTN. 已装数量保留，以上合计须为 '+remaining+' 箱。</p><p data-resolution-error role="alert">'+esc(pending?.error||'')+'</p></div><footer><button type="button" data-resolution-close>Cancel 取消</button><button type="button" class="dd-action" data-resolution-confirm>'+(pending?'Retry same decision 重试本次处理':'Confirm 确认')+'</button></footer>';
  if(pending)for(const [mode,field] of [['CONTINUE','continue'],['TRANSFER','transfer']])resolutionDialog.querySelector('[data-resolution-'+field+']').value=pending.input.parts.find(part=>part.mode===mode)?.quantity||0;
  if(pending?.input.parts.some(part=>part.mode==='TRANSFER'))resolutionDialog.querySelector('[data-resolution-desk]').value=String(pending.input.parts.find(part=>part.mode==='TRANSFER').desk);
  resolutionDialog.querySelectorAll('[data-resolution-close]').forEach(button=>button.onclick=()=>{if(!resolutionPending.get(key)?.running){resolutionDialog.close();if(resolutionDialog.dataset.refresh==='yes')context.invalidate();}});
  resolutionDialog.oncancel=event=>{if(resolutionPending.get(key)?.running)event.preventDefault();};
  const confirm=resolutionDialog.querySelector('[data-resolution-confirm]'),notice=resolutionDialog.querySelector('[data-resolution-error]');
  resolutionDialog.dataset.refresh='';confirm.disabled=Boolean(pending?.running);confirm.onclick=async()=>{
   let operation=resolutionPending.get(key);if(operation?.running)return;
   if(!operation){const parts=[['CONTINUE','continue'],['TRANSFER','transfer']].map(([mode,field])=>({mode,quantity:Number(resolutionDialog.querySelector('[data-resolution-'+field+']').value),...(mode==='TRANSFER'?{desk:Number(resolutionDialog.querySelector('[data-resolution-desk]').value)}:{})}));if(parts.some(part=>!Number.isSafeInteger(part.quantity)||part.quantity<0)||parts.reduce((n,part)=>n+part.quantity,0)!==remaining){notice.textContent='The quantities must add up to '+remaining+' CTN. 数量合计不符。';return;}
    operation={requestId:crypto.randomUUID(),input:{action:'DESK_RESOLVE',version:context.model.delivery.version,id:list.id,revision:list.revision,taskId:line.taskId,deskRevision:context.model.desks.find(row=>row.customerId===list.customerId)?.revision||'',resolutionRevision:line.resolution?.revision||'',parts:parts.filter(part=>part.quantity>0)}};resolutionPending.set(key,operation);
   }
   operation.running=true;confirm.disabled=true;resolutionDialog.querySelector('fieldset').disabled=true;notice.textContent='Confirming 确认中…';
   try{const result=await context.send('PACKING_SAVE_REQUEST',operation.input,operation.requestId);if(result.company!==context.company||result.requestId!==operation.requestId||result.id!==list.id||result.taskId!==line.taskId||!result.resolutionId)throw Error('Decision is unconfirmed. Retry the same decision.');resolutionPending.delete(key);resolutionDialog.close();notify(context.company,list);context.invalidate();}
   catch(error){operation.error=error.message;notice.textContent=error.message;if(error.retryable===false){resolutionPending.delete(key);operation.blocked=true;resolutionDialog.dataset.refresh='yes';}else confirm.textContent='Retry same decision 重试本次处理';}
   finally{operation.running=false;confirm.disabled=Boolean(operation.blocked);}
  };if(!resolutionDialog.open)resolutionDialog.showModal();
 }
 const photoLinks=photos=>photos?.length?'<details class="dd-saved-photos"><summary>Photos 照片 · '+photos.length+'</summary>'+photos.map(photo=>'<a target="_blank" rel="noopener" href="https://drive.google.com/file/d/'+encodeURIComponent(photo.fileId)+'/view">'+esc(photo.at||photo.name||'View photo 查看照片')+'</a>').join('')+'</details>':'';
 function supportKey(context){return context.company+'|'+context.customerId+'|'+context.desk;}
 function mountSupport(context){
  supportContext=context;const {model,root,company,customerId,desk}=context;
  const packing=document.getElementById('packing');if(packing)packing.style.display='none';
  root.querySelector('.dd-support-actions')?.remove();if(!desk||!model)return;
  const delivery=model.delivery,lists=delivery?.lists||[],active=lists.find(list=>list.customerId===customerId&&list.desk?.number===desk&&['SENT','PROCESSING'].includes(list.status));
  for(const pending of delivery?.pendingResolutions||[]){const key=resolutionKey(company,pending.input.id,pending.input.taskId);if(!resolutionPending.has(key))resolutionPending.set(key,{...pending,error:'Earlier decision is unconfirmed. Resume the same decision. 上次处理未确认，请继续核对。'});}
  const key=supportKey(context),restored=delivery?.pendingAuthorizations?.find(row=>row.input.customerId===customerId&&row.input.desk===desk);if(restored&&!supportPending.has(key))supportPending.set(key,{...restored,error:'Earlier authorization is unconfirmed. Resume the same request. 上次授权未确认，请继续核对。'});
  const pending=supportPending.get(key),lines=context.lines.filter(line=>Number.isSafeInteger(line.orderQty)&&Number.isSafeInteger(line.loadedQty)&&line.orderQty>line.loadedQty).map(line=>({taskId:line.taskId,quantity:line.orderQty-line.loadedQty}));
  const bar=document.createElement('div');bar.className='dd-support-actions';bar.innerHTML='<button type="button" class="dd-action" '+(delivery?.deskDeliveryVersion!==2||!context.canSend||(!active&&!lines.length)||pending?.running?'disabled':'')+'>'+(pending?'Retry same task 重试本次任务':active?'Task Opened · Recall':'Open Task to Warehouse')+'</button><span class="dd-support-notice" role="status">'+esc(pending?.error||(!delivery?.deskDeliveryVersion?'Loading task authorization…':active?'Desk '+desk+' authorized to Warehouse':'All Desk tasks will be visible. Loading requires allocated, received stock. 整张任务先开放，配货到货后才可装货。'))+'</span>';
  if(active&&context.showOpenedTime&&!pending){
   const date=new Date(active.sentAt),valid=Boolean(active.sentAt)&&Number.isFinite(date.getTime());
   const parts=valid?Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value])):null;
   const opened=document.createElement('span');opened.className='dd-opened-status';opened.textContent=parts?'Task Opened on '+parts.day+'-'+parts.month+'-'+parts.year+' '+parts.hour+':'+parts.minute:'Task Opened';
   const action=bar.querySelector('button');action.hidden=true;action.before(opened);bar.querySelector('[role="status"]').textContent='';
  }
  const slot=root.querySelector('.shipment-delivery-actions'),anchor=root.querySelector('.shipment-task-count');if(slot)slot.append(bar);else if(anchor)anchor.after(bar);else root.prepend(bar);
  const button=bar.querySelector('button'),notice=root.querySelector('.shipment-authorization-status')||bar.querySelector('[role="status"]');if(active)button.classList.add('dd-opened');if(active?.lines.some(line=>line.loaded>0))button.disabled=true;if(pending?.error)notice.textContent=pending.error;const unresolved=lists.some(list=>list.customerId===customerId&&list.desk?.number===desk&&list.status==='COMPLETED'&&list.lines.some(line=>line.resolution?.remaining>0));if(unresolved&&!active){button.disabled=true;notice.textContent='Resolve or complete the existing remainder below. 请先处理或完成下方剩余数量。';}
  button.onclick=async()=>{
   if(pending?.running||(active&&context.showOpenedTime&&!supportPending.has(key)))return;
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
   const taskLists=lists.filter(list=>list.customerId===customerId&&list.desk?.number===desk&&list.status!=='CANCELLED'&&list.lines.some(item=>item.taskId===taskId)),entry=taskLists.map(list=>({list,line:list.lines.find(item=>item.taskId===taskId)})).find(item=>item.line.resolution?.issue||resolutionPending.has(resolutionKey(company,item.list.id,taskId)));
   if(taskLists.length&&line&&row.cells.length>6){const states=taskLists.map(list=>list.lines.find(item=>item.taskId===taskId).resolution);row.cells[6].innerHTML=summaryPill({issue:states.some(item=>item?.issue),pending:states.some(item=>item?.pending)||taskLists.some(list=>list.lines.some(item=>item.taskId===taskId&&!item.loadedConfirmedAt))},line.loadedQty)+photoLinks(taskLists.flatMap(list=>list.lines.filter(item=>item.taskId===taskId).flatMap(item=>item.photos||[])));}
   if(Number.isSafeInteger(line?.portionDesk)){const select=row.querySelector('select[data-desk-task]');if(select){select.value=String(line.portionDesk);for(const option of select.options)if(option.value!=='SPLIT'&&option.value!==select.value)option.disabled=true;}}
   if(entry&&context.canSend){const button=document.createElement('button');button.type='button';button.className='dd-resolve';button.textContent='Resolve '+number(entry.line.resolution?.remaining||0)+' 处理';button.onclick=()=>openResolution(context,entry.list,entry.line);row.cells[6].append(button);}
  }
 }
 function createWarehouse(sender=sendParent){
  const state={company:'',container:null,lists:[],completedLists:[],history:false,month:'',staff:'',loaded:false,reading:false,generation:0,selected:'',queue:[],running:false,notice:'',failed:new Map()};
  const dialog=document.createElement('dialog');dialog.className='dd-modal dd-execution-modal';document.body.append(dialog);
  const previews=new Map();let editing=null,preparing=false;
  const date=value=>{if(!value)return '—';const day=String(value).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(day)?day.slice(8)+'-'+day.slice(5,7)+'-'+day.slice(2,4):'—';};
  const expiryDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(2,4):'—';
  const stamp=value=>{if(!value||!Number.isFinite(Date.parse(value)))return '—';return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)).replaceAll('/','-').replace(',','');};
  const period=value=>{if(!value||!Number.isFinite(Date.parse(value)))return '';return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit'}).format(new Date(value));};
  const pendingFor=(id,taskId)=>state.queue.find(item=>item.listId===id&&item.taskId===taskId);
  const activePage=()=>Boolean(state.container?.isConnected&&document.querySelector('nav[aria-label="Warehouse navigation"] [data-view="customers"].active'));
  const busy=()=>dialog.open||preparing||Boolean(state.queue.length);
  const age=value=>{const start=period(value);if(!start)return '';const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Kuala_Lumpur'}),then=new Date(value).toLocaleDateString('sv-SE',{timeZone:'Asia/Kuala_Lumpur'}),days=Math.max(0,Math.round((Date.parse(today)-Date.parse(then))/86400000));return days===0?'Today':days===1?'Yesterday':days+' Days ago';};
  function canLoadLine(line){
   if(!(line.readyQuantity>0)||line.resolution?.resolved)return false;
   if(!line.loadedConfirmedAt)return true;
   const maximum=line.resolution?.maximum??line.quantity;
   return Boolean(line.resolution?.pending||(line.resolution?.issue??line.loaded!==maximum));
  }
  function deliveryStatus(list){
   if(list.awaitingDeskArchive)return ["Awaiting Support archive","pending"];
   const lines=list.lines;
   if(lines.some(line=>line.resolution?.issue))return ['Support review','review'];
   if(!list.batchComplete&&lines.some(canLoadLine))return ['Ready for loading','ready'];
   if(!lines.length||lines.every(line=>!line.quantity&&!line.resolution?.resolved))return ['Pending allocation','pending'];
   if(lines.every(line=>line.resolution?.resolved||Boolean(line.loadedConfirmedAt)&&line.loaded>=(line.resolution?.maximum??line.quantity))){
    const loaded=lines.some(line=>line.loadedConfirmedAt&&line.loaded>0);
    return loaded?['Loaded','ready']:['Closed · 0 loaded','closed'];
   }
   return ['Waiting for stock','pending'];
  }
  const image=line=>/^https:\/\//i.test(line.productImageUrl||'')?'<img class="dd-zoom-image" src="'+esc(line.productImageUrl)+'" alt="'+esc(line.name)+'" loading="lazy">':'<span class="dd-image-empty" aria-label="No product image">□</span>';
  const pill=(value,tone)=>'<span class="dd-qty '+tone+'">'+number(value)+'</span>';
  function render(){
   if(!activePage())return;
   const source=state.history?state.completedLists:state.lists.filter(list=>list.status!=='CANCELLED'&&list.currentAuthorization!==false),months=[...new Set(state.completedLists.map(list=>period(list.completedAt||list.updatedAt||list.sentAt)).filter(Boolean))].sort().reverse();
   if(!state.month)state.month=months[0]||period(new Date().toISOString());
   const active=state.history?source.filter(list=>period(list.completedAt||list.updatedAt||list.sentAt)===state.month):source,selected=active.find(list=>list.id===state.selected);
   const caption=document.getElementById("whCompanyCaption")?.textContent;
   let html='<section class="dd-workspace"><div class="dd-heading"><div><h2>'+(state.history?'Delivery History 发货历史':'Delivery Task 发货任务')+'</h2>'+(caption?'<p class="dd-company-caption">'+esc(caption)+'</p>':'')+'</div>';
   if(state.history)html+='<label class="dd-month-label">Month <input type="month" data-dd-month value="'+esc(state.month)+'"></label>';
   else if(active.length)html+='<select data-dd-select aria-label="Customer and Desk"><option value="">All Desks 全部任务</option>'+active.map(list=>'<option value="'+esc(list.id)+'" '+(list.id===state.selected?'selected':'')+'>'+esc(list.customerName)+' · Desk '+list.desk.number+'</option>').join('')+'</select>';
   html+='</div>'+(state.notice?'<p class="dd-notice" role="status">'+esc(state.notice)+'</p>':'');
   if(!state.loaded)html+='<p class="dd-empty">Loading Desk tasks… 正在读取任务</p>';
   else if(!selected){
    const cards=active.map(list=>{
     const shipment=list.currentDesk?.shipment??list.desk.shipment;
     const status=deliveryStatus(list);
     const opened=list.sentAt?age(list.sentAt):"";
     const timing=state.history?stamp(list.completedAt||list.updatedAt||list.sentAt):opened;
     return `<button type="button" class="dd-customer" data-dd-open="${esc(list.id)}"><span class="dd-list-name"><strong>${esc(list.customerName)}</strong><b>Desk ${esc(list.desk.number)}</b></span><span class="dd-list-meta"><span>ETD <strong>${esc(date(shipment?.date))}</strong></span><span>${number(list.lines.length)} ${list.lines.length===1?"item":"items"}</span></span><span class="dd-list-state">${state.history?"":`<span class="dd-list-status ${status[1]}">${status[0]}</span>`}${timing?`<small>${esc(timing)}</small>`:""}</span><span class="dd-list-arrow" aria-hidden="true">→</span></button>`;
    });
    html+='<div class="dd-customers">'+(cards.join('')||'<p class="dd-empty">No tasks 暂无任务</p>')+'</div>';
   }
   else{
    const shipment=selected.currentDesk?.shipment??selected.desk.shipment;
    const loadedLines=selected.lines.filter(line=>line.loadedConfirmedAt&&line.loaded>0);
    const loadedCartons=loadedLines.reduce((sum,line)=>sum+line.loaded,0);
    const allocatedCartons=selected.lines.reduce((sum,line)=>sum+(line.resolution?.maximum??line.quantity??0),0);
    const loadedCbm=loadedLines.every(line=>Number.isFinite(line.cbm)&&line.cbm>0)?loadedLines.reduce((sum,line)=>sum+line.loaded*line.cbm,0):null;
    const elapsed=selected.sentAt&&!state.history?age(selected.sentAt):'';
    const totals='<dl class="dd-totals"><div><dt>Total CTN</dt><dd>'+number(allocatedCartons)+' <small>Alloc</small> · '+number(loadedCartons)+' <small>Loaded</small></dd></div><div><dt>Total CBM</dt><dd>'+(loadedCbm===null?'—':loadedCbm.toFixed(4))+' <small>Loaded</small></dd></div></dl>';
    html+='<header class="dd-customer-header"><div class="dd-customer-title"><h3>'+esc(selected.customerName)+' <span>Desk '+selected.desk.number+'</span></h3>'+(elapsed?'<strong class="dd-task-age">Opened '+esc(elapsed)+'</strong>':'')+'</div><div class="dd-desk-overview">'+
    '<div class="dd-shipment"><span>Logistic <b>'+esc(({LAND:'Land delivery',SEA_20FT:'Sea 20ft',SEA_40FT:'Sea 40ft',OTHER:'Other'})[shipment?.transport]||shipment?.transport||'—')+'</b></span><span>ETD <b>'+date(shipment?.date)+'</b></span><span>Last Gate In <b>'+esc(shipment?.lastGateIn?date(shipment.lastGateIn)+' '+shipment.lastGateIn.slice(11,16):'—')+'</b></span></div>'+totals+'</div></header>';
    html+='<div class="dd-container-photos"><strong>Container photos 整柜照片 <span>'+(selected.photos?.length||0)+' / 30</span></strong>'+(state.history||selected.awaitingDeskArchive?'':'<label class="dd-photo-add" title="Add container photos 添加整柜照片">+<input data-dd-photos type="file" accept="image/jpeg,image/png,image/webp" multiple '+((selected.photos?.length||0)>=30||state.queue.length||preparing?'disabled':'')+'></label>')+'<div class="dd-photo-strip">'+(selected.photos||[]).map(photo=>{const preview=previews.get(photo.fileId);return preview?'<button type="button" data-dd-preview="'+esc(photo.fileId)+'" title="'+esc(stamp(photo.at))+'"><img src="'+esc(preview)+'" alt="Container photo"></button>':'<a href="https://drive.google.com/file/d/'+encodeURIComponent(photo.fileId)+'/view" target="_blank" rel="noopener" title="'+esc(stamp(photo.at))+'">▧</a>';}).join('')+'</div></div>';
    html+='<div class="dd-table-scroll"><table class="dd-task-table"><thead><tr>'+['No.','Image','Descriptions','Alloc Qty','Loaded Qty','P.I.C','Line CBM','Expiry','Message'].map(label=>'<th>'+label+'</th>').join('')+'</tr></thead><tbody>';
    html+=selected.lines.map((line,index)=>{const pending=pendingFor(selected.id,line.taskId),confirmed=Boolean(line.loadedConfirmedAt),maximum=line.resolution?.maximum??line.quantity,difference=confirmed&&(line.resolution?.issue??line.loaded!==maximum),message=window.departmentMessages?.cell?.({...line,id:line.chatContexts?.[0]?.id||line.taskId},'','SUPPORT','DELIVERY')||'',failed=state.failed.get(selected.id+'|'+line.taskId);
     const canLoad=!state.history&&!selected.awaitingDeskArchive&&!selected.batchComplete&&!pending&&canLoadLine(line);
     const loaded=confirmed?pill(line.loaded,difference?'dd-qty-problem':'dd-qty-done'):'<span class="dd-load-icon" aria-hidden="true">⇧</span>';
     return '<tr><td class="dd-row-no">'+String(index+1).padStart(3,'0')+'</td><td class="dd-product-image">'+image(line)+'</td><td class="dd-description"><small>'+esc(line.barcode)+'</small><strong>'+esc(line.name)+'</strong><small>'+esc(line.packing)+'</small></td><td class="dd-number">'+(maximum?pill(maximum,'dd-qty-done'):'<span class="dd-muted">Pending</span>')+'</td><td class="dd-number">'+(canLoad?'<button type="button" class="dd-loaded-action" data-dd-load="'+esc(line.taskId)+'" aria-label="Confirm Loaded '+esc(line.name)+'">'+loaded+'</button>':confirmed?loaded:maximum?pill(line.loaded,'dd-qty-pending'):'<span class="dd-muted">Pending</span>')+(pending?'<small>Saving…</small>':'')+(failed?'<small class="dd-input-error">'+esc(failed.error)+'</small>':'')+'</td><td class="dd-pic"><span>'+esc(selected.sentBy||'—')+'</span><small>'+esc(stamp(selected.sentAt))+'</small></td><td class="dd-number">'+number(Number.isFinite(line.cbm)?line.cbm*(confirmed?line.loaded:maximum):null)+'</td><td class="dd-expiry">'+(state.history||selected.awaitingDeskArchive?expiryDay(line.expiryDate):'<button type="button" class="'+(line.expiryDate?'dd-expiry-date':'')+'" data-dd-expiry="'+esc(line.taskId)+'" aria-label="Edit expiry '+esc(line.name)+'" '+(state.queue.length?'disabled':'')+'>'+(line.expiryDate?expiryDay(line.expiryDate):'✎')+'</button>')+'</td><td>'+message+'</td></tr>';}).join('');
    html+='</tbody></table></div>';
   }
   const uncertain=state.queue[0]?.uncertain;
   if(uncertain)html+='<div class="dd-save-warning"><span>'+esc(state.queue[0].error)+'</span><button type="button" data-dd-retry>Retry same save 重试本次保存</button></div>';
   state.container.querySelector(".dd-image-preview")?.remove();
   state.container.innerHTML=html+'</section>';
   for(const thumbnail of state.container.querySelectorAll(".dd-zoom-image")){
    thumbnail.onpointermove=event=>{
     if(event.pointerType!=="mouse"||!thumbnail.complete||!thumbnail.naturalWidth)return;
     let preview=state.container.querySelector(".dd-image-preview");
     if(!preview){
      preview=document.createElement("div");preview.className="dd-image-preview";preview.setAttribute("aria-hidden","true");
      const image=thumbnail.cloneNode();image.removeAttribute("loading");image.alt="";preview.append(image);state.container.append(preview);
     }
     const {width,height}=preview.getBoundingClientRect(),gap=14,edge=10;
     const left=event.clientX+gap+width>innerWidth-edge?event.clientX-width-gap:event.clientX+gap;
     const top=event.clientY+gap+height>innerHeight-edge?event.clientY-height-gap:event.clientY+gap;
     preview.style.left=Math.max(edge,left)+"px";preview.style.top=Math.max(edge,top)+"px";
    };
    thumbnail.onpointerleave=()=>state.container.querySelector(".dd-image-preview")?.remove();
   }
   state.container.querySelector('[data-dd-select]')?.addEventListener('change',event=>{state.selected=event.target.value;render();});
   state.container.querySelector('[data-dd-month]')?.addEventListener('change',event=>{state.month=event.target.value;state.selected='';render();});
   state.container.querySelectorAll('[data-dd-open]').forEach(button=>button.onclick=()=>{state.selected=button.dataset.ddOpen;render();});
   state.container.querySelectorAll('[data-dd-load]').forEach(button=>button.onclick=()=>open(selected,selected.lines.find(line=>line.taskId===button.dataset.ddLoad)));
   state.container.querySelectorAll('[data-dd-expiry]').forEach(button=>button.onclick=()=>openExpiry(selected,selected.lines.find(line=>line.taskId===button.dataset.ddExpiry)));
   state.container.querySelectorAll('[data-dd-preview]').forEach(button=>button.onclick=()=>openPhoto(previews.get(button.dataset.ddPreview)));
   state.container.querySelector('[data-dd-photos]')?.addEventListener('change',event=>addPhotos(selected,Array.from(event.target.files)));
   state.container.querySelector('[data-dd-retry]')?.addEventListener('click',()=>{state.queue[0].uncertain=false;pump();});
  }
  async function refresh(manual=false){
   if(state.reading||busy()||document.hidden&&!manual||!activePage())return;
   const company=state.company,generation=++state.generation;state.reading=true;
   let changed=false;
   try{
    const result=await sender('PACKING_READ_REQUEST',company);
    if(company!==state.company||generation!==state.generation||busy())return;
    if(result.company!==company||result.deskDeliveryVersion!==2)throw Error('Desk task service is not ready.');
    const lists=result.lists.filter(list=>list.desk);
    const completed=(result.completedLists||[]).filter(list=>list.desk&&list.batchComplete);
    const staff=result.staff?.staffName||'';
    const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Kuala_Lumpur'});
    changed=manual||!state.loaded||Boolean(state.notice)||staff!==state.staff||day!==state.refreshDay||
      JSON.stringify([lists,completed])!==JSON.stringify([state.lists,state.completedLists]);
    if(changed){state.lists=lists;state.completedLists=completed;state.staff=staff;state.loaded=true;state.notice='';state.refreshDay=day;}
   }catch(error){
    if(generation===state.generation){changed=error.message!==state.notice;state.notice=error.message;}
   }finally{if(generation===state.generation){state.reading=false;if(changed&&!busy())render();}}
  }
  function modal(title,body,confirm){
   dialog.setAttribute('aria-label',title);dialog.innerHTML='<header><strong>'+esc(title)+'</strong><button type="button" data-dd-close aria-label="Close">×</button></header><div class="dd-modal-body">'+body+'<p id="dd-error" role="alert"></p></div><footer><button type="button" data-dd-close>Cancel 取消</button><button type="button" id="dd-confirm" class="dd-action">Confirm 确认</button></footer>';
   dialog.querySelectorAll('[data-dd-close]').forEach(button=>button.onclick=()=>{if(!preparing)dialog.close();});dialog.querySelector('#dd-confirm').onclick=confirm;if(!dialog.open)dialog.showModal();
  }
  function open(list,line){
   if(state.history||!list||!line||list.awaitingDeskArchive||list.batchComplete||list.currentAuthorization===false||line.resolution?.resolved||!(line.readyQuantity>0)||pendingFor(list.id,line.taskId))return;
   const retained=state.failed.get(list.id+'|'+line.taskId)?.draft;editing={listId:list.id,taskId:line.taskId,action:'DESK_LOAD'};const maximum=line.resolution?.maximum??line.quantity;
   const available=Math.min(maximum,line.loaded+line.readyQuantity);
   modal('Loaded Qty 实装数量','<strong>'+esc(line.name)+'</strong><p class="dd-allocation-hint">Alloc '+number(maximum)+' CTN'+(available<maximum?' · Available '+number(available):'')+'</p><label>Loaded<input type="number" id="dd-loaded-input" min="'+line.loaded+'" max="'+available+'" step="1" value="'+(retained?.loaded??available)+'"></label><div class="dd-reasons" hidden>'+Object.entries(reasonNames).map(([value,label])=>'<label><input type="checkbox" value="'+value+'" '+((retained?.reasonCodes||line.reasonCodes)?.includes(value)?'checked':'')+'>'+label+'</label>').join('')+'</div>',()=>{
    const input=dialog.querySelector('#dd-loaded-input'),loaded=Number(input.value),codes=Array.from(dialog.querySelectorAll('.dd-reasons input:checked'),node=>node.value),error=dialog.querySelector('#dd-error');
    if(!input.value.trim()||!Number.isSafeInteger(loaded)||loaded<line.loaded||loaded>available){error.textContent='Enter cumulative Loaded within '+line.loaded+'–'+available+' CTN.';return;}
    if(loaded!==maximum&&!codes.length){error.textContent='Select a shortfall reason 请选择少装原因';return;}
    queue(list,line,{loaded,reasonCodes:loaded===maximum?[]:codes,note:''});
   });
   const input=dialog.querySelector('#dd-loaded-input');input.oninput=()=>dialog.querySelector('.dd-reasons').hidden=Number(input.value)===maximum;input.oninput();input.select();
  }
  function expiryInputDate(value){
   const match=/^(\d{2})\/(\d{2})\/(\d{2})$/.exec(value);
   return match?'20'+match[3]+'-'+match[2]+'-'+match[1]:'';
  }
  function openExpiry(list,line){
   if(state.history||list?.awaitingDeskArchive||!line||state.queue.length)return;editing={listId:list.id,taskId:line.taskId,action:'DESK_EXPIRY'};
   modal('Expiry 有效日期','<label class="dd-expiry-entry">DD / MM / YY<input id="dd-expiry-input" inputmode="numeric" maxlength="8" placeholder="DD/MM/YY" value="'+(line.expiryDate?line.expiryDate.slice(8)+'/'+line.expiryDate.slice(5,7)+'/'+line.expiryDate.slice(2,4):'')+'"></label>',()=>{
    const iso=expiryInputDate(dialog.querySelector('#dd-expiry-input').value);
    if(iso===(line.expiryDate||''))return;
    if(!iso||!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString().slice(0,10)!==iso){dialog.querySelector('#dd-error').textContent='Enter a valid DD/MM/YY date.';return;}queue(list,line,{expiryDate:iso});
   });
   const input=dialog.querySelector('#dd-expiry-input'),button=dialog.querySelector('#dd-confirm');
   const update=()=>{const iso=expiryInputDate(input.value);button.disabled=!iso||iso===line.expiryDate||!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString().slice(0,10)!==iso;};
   input.oninput=event=>{const value=event.target.value.replace(/\D/g,'').slice(0,6);event.target.value=value.slice(0,2)+(value.length>2?'/'+value.slice(2,4):'')+(value.length>4?'/'+value.slice(4):'');update();};
   update();input.focus();
  }
  function openPhoto(url){
   dialog.setAttribute('aria-label','Container photo');dialog.innerHTML='<header><strong>Container photo 整柜照片</strong><button type="button" data-dd-close aria-label="Close photo">×</button></header><img class="dd-photo-full" src="'+esc(url)+'" alt="Container photo">';dialog.querySelector('[data-dd-close]').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();
  }
  function queue(list,line,draft){
   const action=editing.action;state.generation++;state.reading=false;state.failed.delete(list.id+'|'+line.taskId);state.queue.push({listId:list.id,taskId:line.taskId,authorized:line.quantity,membershipVersion:line.membershipVersion||'',action,requestId:crypto.randomUUID(),draft,packet:null,uncertain:false});dialog.close();editing=null;state.notice='Saving… You can continue with another item. 正在保存，可继续其他产品。';render();pump();
  }
  async function addPhotos(list,files){
   if(!files.length||preparing||state.queue.length||state.history||list.awaitingDeskArchive)return;
   if(files.length+(list.photos?.length||0)>30){state.notice='Choose at most '+(30-(list.photos?.length||0))+' more container photos.';render();return;}
   preparing=true;state.generation++;state.reading=false;state.notice='Preparing photos 正在处理照片…';render();
   try{
    // Compression bounds each image. Save three at a time through the existing journal.
    const evidence=[];for(const file of files)evidence.push(await window.warehouseWorkroom.preparePhoto(file));
    for(let index=0;index<evidence.length;index+=3)state.queue.push({listId:list.id,action:'DESK_PHOTOS',requestId:crypto.randomUUID(),draft:{photos:evidence.slice(index,index+3)},photoProgress:{confirmed:Math.min(index+3,evidence.length),total:evidence.length},packet:null,uncertain:false});
    state.notice='Photos queued 照片正在保存';
   }catch(error){state.notice=error.message;}
   finally{preparing=false;render();pump();}
  }
  async function readDeliveryReceipt(command,error){
   if(error.retryable===false)throw error;
   for(const delay of [0,5000,15000,45000]){
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    if(state.queue[0]!==command||document.hidden||navigator.onLine===false)break;
    try{
     const receipt=await sender('PACKING_WAREHOUSE_STATUS_REQUEST',state.company,{saveRequestId:command.requestId,listId:command.listId});
     if(receipt?.ok===true&&receipt.company===state.company&&receipt.requestId===command.requestId&&receipt.id===command.listId)return receipt;
    }catch(_){}
   }
   throw error;
  }
  async function pump(){
   if(state.running||!state.queue.length||state.queue[0].uncertain)return;
   const command=state.queue[0],list=state.lists.find(row=>row.id===command.listId),line=list?.lines.find(row=>row.taskId===command.taskId);state.running=true;
   try{
    if(command.action==='DESK_PHOTOS'&&!command.packet&&!list){
     state.queue=state.queue.filter(row=>row.action!=='DESK_PHOTOS'||row.listId!==command.listId);
     const confirmed=command.photoProgress.confirmed-command.draft.photos.length;
     state.notice='Desk no longer available. '+confirmed+'/'+command.photoProgress.total+' photos confirmed. Reopen the correct Desk before selecting the remaining photos again. 原任务已不可用，请重新打开正确的任务后再选择尚未保存的照片。';
     return;
    }
    if(!command.packet){if(!list||command.action!=='DESK_PHOTOS'&&(!line||line.quantity!==command.authorized||(line.membershipVersion||'')!==command.membershipVersion)){const error=Error('Authorized task changed. Refresh and confirm again.');error.retryable=false;throw error;}command.packet={action:command.action,id:list.id,revision:list.revision,...(command.taskId?{taskId:command.taskId,...(command.membershipVersion?{membershipVersion:command.membershipVersion}:{})}:{}),...(command.action==='DESK_LOAD'?{resolutionRevision:line.resolution?.revision||''}:{}),...command.draft};}
    let result;
    try{result=await sender('PACKING_SAVE_REQUEST',state.company,command.packet,command.requestId);}
    catch(error){state.notice='Confirming the original save. Your input is retained. 正在确认原保存，已保留输入。';render();result=await readDeliveryReceipt(command,error);}
    const saved=result.list;
    if(!saved?.desk||result.company!==state.company||saved.company!==state.company||saved.id!==command.listId||result.id!==command.listId||result.requestId!==command.requestId||command.action==='DESK_LOAD'&&saved.lines.find(row=>row.taskId===command.taskId)?.loaded!==command.draft.loaded||command.action==='DESK_EXPIRY'&&saved.lines.find(row=>row.taskId===command.taskId)?.expiryDate!==command.draft.expiryDate||command.action==='DESK_PHOTOS'&&command.draft.photos.some(photo=>!saved.photos?.some(item=>item.sha256===photo.sha256)))throw Error('Delivery receipt is unconfirmed. Retry the same save.');
    if(command.action==='DESK_PHOTOS')for(const photo of command.draft.photos){const item=saved.photos.find(row=>row.sha256===photo.sha256);previews.set(item.fileId,'data:'+photo.mimeType+';base64,'+photo.base64);}
    state.lists=state.lists.map(row=>row.id===saved.id?{...saved,lines:row.lines.map(previous=>{const line=saved.lines.find(item=>item.taskId===previous.taskId)||previous;return {...line,readyQuantity:Math.max(0,(previous.readyQuantity||0)-Math.max(0,line.loaded-(previous.loaded||0))),chatContexts:previous.chatContexts||[]};}),currentAuthorization:row.currentAuthorization,currentDesk:row.currentDesk}:row);state.queue.shift();
    const progress=command.photoProgress;
    if(!progress)state.notice='Saved 保存成功';
    else if(progress.confirmed<progress.total)state.notice='Photos confirmed '+progress.confirmed+'/'+progress.total+' · Uploading… 正在保存';
    else state.notice='All '+progress.total+' photos saved 照片已全部保存';
    notify(state.company,saved);
   }catch(error){
    state.notice=error.message;
    if((error.retryable===false||error.message.includes('Authorized task changed.'))&&command.action!=='DESK_PHOTOS'){
     for(const retained of state.queue){retained.error=error.message;state.failed.set(retained.listId+'|'+retained.taskId,retained);}
     state.queue=[];state.notice+=' Input retained. Reopen the affected row after refresh.';
    }else{command.uncertain=true;command.error=error.message;}
   }
   finally{state.running=false;render();if(state.queue.length&&!state.queue[0].uncertain)pump();}
  }
  dialog.addEventListener('cancel',event=>{if(preparing)event.preventDefault();});
  document.getElementById('company')?.addEventListener('change',event=>{if(state.queue.length||preparing){event.stopImmediatePropagation();event.target.value=state.company;state.notice='Confirm pending saves before changing company.';render();}},true);
  window.addEventListener('beforeunload',event=>{if(state.queue.length||preparing){event.preventDefault();event.returnValue='';}});
  return {render(container,company){state.container=container;if(company!==state.company){state.company=company;state.lists=[];state.completedLists=[];state.history=false;state.failed.clear();previews.clear();state.selected='';state.loaded=false;state.reading=false;state.generation++;}render();if(!state.loaded&&!state.reading)refresh();},openHistory(){state.history=true;state.selected='';render();refresh(true);},openActive(){state.history=false;state.selected='';render();refresh(true);},refresh:()=>refresh(),isBusy:busy,state};
 }

 function decoratePurchase(){
  purchaseQueued=false;if(!purchaseModel)return;const root=document.getElementById('app');if(!root)return;
  for(const table of root.querySelectorAll('table')){const headers=Array.from(table.querySelectorAll('thead th')),index=headers.findIndex(cell=>/Alloc Qty/.test(cell.textContent));if(index<0)continue;for(const row of table.querySelectorAll('tr[data-id]')){const summary=purchaseModel.deskDeliveries?.find(item=>item.taskId===row.dataset.id);if(!summary||!row.cells[index])continue;const signature=JSON.stringify(summary),old=row.cells[index].querySelector('.dd-purchase-loaded');if(old?.dataset.signature===signature)continue;old?.remove();const node=document.createElement('small');node.className='dd-purchase-loaded';node.dataset.signature=signature;node.innerHTML='Loaded '+summaryPill(summary.loadedQty===0?{...summary,pending:true}:summary,summary.loadedQty);row.cells[index].append(node);}}
 }
 const queuePurchase=()=>{if(!purchaseQueued){purchaseQueued=true;queueMicrotask(decoratePurchase);}};
 const purchaseRoot=document.getElementById('app');if(purchaseRoot)new MutationObserver(queuePurchase).observe(purchaseRoot,{childList:true,subtree:true});
 if(channel)channel.onmessage=event=>{const message=event.data;if(!message||!['NCT','GHR'].includes(message.company))return;if(supportContext?.company===message.company&&!document.querySelector('dialog[open]'))supportContext.invalidate?.();if(window.warehousePackingTab?.state.company===message.company&&document.querySelector('nav[aria-label="Warehouse navigation"] [data-view="customers"].active'))window.warehousePackingTab.refresh();};
 const api={mountSupport,createWarehouse,invalidate(company,customerId,desk){channel?.postMessage({company,customerId,desk});},setPurchase(model){purchaseModel=model;queuePurchase();},supportPending:()=>supportPending.size>0||resolutionPending.size>0||Boolean(resolutionDialog?.open)};window.DeskDelivery=api;
 if(document.querySelector('nav[aria-label="Warehouse navigation"]')){window.warehousePackingTab=createWarehouse();window.warehouseDeskDelivery=true;}
 window.addEventListener('beforeunload',event=>{if(supportPending.size||resolutionPending.size){event.preventDefault();event.returnValue='';}});
})();
