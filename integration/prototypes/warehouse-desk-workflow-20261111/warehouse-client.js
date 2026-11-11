 function createWarehouse(sender=sendParent){
  const state={company:'',container:null,lists:[],completedLists:[],history:false,month:'',staff:'',loaded:false,reading:false,generation:0,selected:'',queue:[],running:false,notice:'',failed:new Map()};
  const dialog=document.createElement('dialog');dialog.className='dd-modal dd-execution-modal';document.body.append(dialog);
  const previews=new Map();let editing=null,preparing=false;
  const date=value=>{if(!value)return '—';const day=String(value).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(day)?day.slice(8)+'-'+day.slice(5,7)+'-'+day.slice(2,4):'—';};
  const stamp=value=>{if(!value||!Number.isFinite(Date.parse(value)))return '—';return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)).replaceAll('/','-').replace(',','');};
  const period=value=>{if(!value||!Number.isFinite(Date.parse(value)))return '';return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit'}).format(new Date(value));};
  const pendingFor=(id,taskId)=>state.queue.find(item=>item.listId===id&&item.taskId===taskId);
  const activePage=()=>Boolean(state.container?.isConnected&&document.querySelector('nav[aria-label="Warehouse navigation"] [data-view="customers"].active'));
  const busy=()=>dialog.open||preparing||Boolean(state.queue.length);
  const age=value=>{const start=period(value);if(!start)return '';const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Kuala_Lumpur'}),then=new Date(value).toLocaleDateString('sv-SE',{timeZone:'Asia/Kuala_Lumpur'}),days=Math.max(0,Math.round((Date.parse(today)-Date.parse(then))/86400000));return days===0?'Today':days===1?'Yesterday':days+' Days ago';};
  const image=line=>/^https:\/\//i.test(line.productImageUrl||'')?'<img src="'+esc(line.productImageUrl)+'" alt="'+esc(line.name)+'" loading="lazy">':'<span class="dd-image-empty" aria-label="No product image">□</span>';
  const pill=(value,tone)=>'<span class="dd-qty '+tone+'">'+number(value)+'</span>';
  function render(){
   if(!activePage())return;
   const source=state.history?state.completedLists:state.lists.filter(list=>list.status!=='CANCELLED'&&list.currentAuthorization!==false),months=[...new Set(state.completedLists.map(list=>period(list.completedAt||list.updatedAt||list.sentAt)).filter(Boolean))].sort().reverse();
   if(!state.month)state.month=months[0]||period(new Date().toISOString());
   const active=state.history?source.filter(list=>period(list.completedAt||list.updatedAt||list.sentAt)===state.month):source,selected=active.find(list=>list.id===state.selected);
   let html='<section class="dd-workspace"><div class="dd-heading"><h2>'+(state.history?'Delivery History 发货历史':'Delivery Task 发货任务')+'</h2>';
   if(state.history)html+='<label class="dd-month-label">Month <input type="month" data-dd-month value="'+esc(state.month)+'"></label>';
   else if(active.length)html+='<select data-dd-select aria-label="Customer and Desk"><option value="">All Desks 全部任务</option>'+active.map(list=>'<option value="'+esc(list.id)+'" '+(list.id===state.selected?'selected':'')+'>'+esc(list.customerName)+' · Desk '+list.desk.number+'</option>').join('')+'</select>';
   html+='</div>'+(state.notice?'<p class="dd-notice" role="status">'+esc(state.notice)+'</p>':'');
   if(!state.loaded)html+='<p class="dd-empty">Loading Desk tasks… 正在读取任务</p>';
   else if(!selected)html+='<div class="dd-customers">'+active.map(list=>'<button type="button" class="dd-customer" data-dd-open="'+esc(list.id)+'"><strong>'+esc(list.customerName)+'</strong><b>Desk '+list.desk.number+'</b><span>'+list.lines.length+' items</span><small>'+esc(state.history?stamp(list.completedAt||list.updatedAt):list.lines.some(line=>line.resolution?.issue)?'Support review 待处理':list.lines.some(line=>!line.quantity)?'Pending 待配货':'Ready for loading 待装货')+'</small></button>').join('')+(active.length?'':'<p class="dd-empty">No tasks 暂无任务</p>')+'</div>';
   else{
    const shipment=selected.currentDesk?.shipment??selected.desk.shipment;
    html+='<header class="dd-customer-header"><div class="dd-customer-title"><h3>'+esc(selected.customerName)+' <span>Desk '+selected.desk.number+'</span></h3><small>Task opened '+esc(state.history?'':age(selected.sentAt)+' · ')+esc(stamp(selected.sentAt))+(selected.sentBy?' · by '+esc(selected.sentBy):'')+'</small></div><div class="dd-shipment"><span>Logistic <b>'+esc(({LAND:'Land delivery',SEA_20FT:'Sea 20ft',SEA_40FT:'Sea 40ft',OTHER:'Other'})[shipment?.transport]||shipment?.transport||'—')+'</b></span><span>ETD <b>'+date(shipment?.date)+'</b></span><span>Last Gate In <b>'+esc(shipment?.lastGateIn?date(shipment.lastGateIn)+' '+shipment.lastGateIn.slice(11,16):'—')+'</b></span></div></header>';
    html+='<div class="dd-container-photos"><strong>Container photos 整柜照片 <span>'+(selected.photos?.length||0)+' / 30</span></strong>'+(state.history?'':'<label class="dd-photo-add" title="Add container photos 添加整柜照片">+<input data-dd-photos type="file" accept="image/jpeg,image/png,image/webp" multiple '+((selected.photos?.length||0)>=30||state.queue.length||preparing?'disabled':'')+'></label>')+'<div class="dd-photo-strip">'+(selected.photos||[]).map(photo=>{const preview=previews.get(photo.fileId);return preview?'<button type="button" data-dd-preview="'+esc(photo.fileId)+'" title="'+esc(stamp(photo.at))+'"><img src="'+esc(preview)+'" alt="Container photo"></button>':'<a href="https://drive.google.com/file/d/'+encodeURIComponent(photo.fileId)+'/view" target="_blank" rel="noopener" title="'+esc(stamp(photo.at))+'">▧</a>';}).join('')+'</div></div>';
    html+='<div class="dd-table-scroll"><table class="dd-task-table"><thead><tr>'+['No.','Image','Descriptions','Alloc Qty','Loaded Qty','P.I.C','Line CBM','Expiry','Message'].map(label=>'<th>'+label+'</th>').join('')+'</tr></thead><tbody>';
    html+=selected.lines.map((line,index)=>{const pending=pendingFor(selected.id,line.taskId),confirmed=Boolean(line.loadedConfirmedAt),maximum=line.resolution?.maximum??line.quantity,difference=confirmed&&(line.resolution?.issue??line.loaded!==maximum),message=window.departmentMessages?.cell?.({...line,id:line.chatContexts?.[0]?.id||line.taskId},'','SUPPORT','DELIVERY')||'',failed=state.failed.get(selected.id+'|'+line.taskId);
     const canLoad=!state.history&&line.readyQuantity>0&&!line.resolution?.resolved&&!pending&&(!confirmed||difference||line.resolution?.pending);
     const loaded=confirmed?pill(line.loaded,difference?'dd-qty-problem':'dd-qty-done'):'<span class="dd-load-icon" aria-hidden="true">⇧</span>';
     return '<tr><td class="dd-row-no">'+String(index+1).padStart(3,'0')+'</td><td class="dd-product-image">'+image(line)+'</td><td class="dd-description"><small>'+esc(line.barcode)+'</small><strong>'+esc(line.name)+'</strong><small>'+esc(line.packing)+'</small></td><td class="dd-number">'+(maximum?pill(maximum,'dd-qty-done'):'<span class="dd-muted">Pending</span>')+'</td><td class="dd-number">'+(canLoad?'<button type="button" class="dd-loaded-action" data-dd-load="'+esc(line.taskId)+'" aria-label="Confirm Loaded '+esc(line.name)+'">'+loaded+'</button>':confirmed?loaded:maximum?pill(line.loaded,'dd-qty-pending'):'<span class="dd-muted">Pending</span>')+(pending?'<small>Saving…</small>':'')+(failed?'<small class="dd-input-error">'+esc(failed.error)+'</small>':'')+'</td><td class="dd-pic"><span>'+esc(stamp(line.loadedConfirmedAt||line.lastLoadedAt))+'</span><small>'+(line.loadedConfirmedBy?'by '+esc(line.loadedConfirmedBy):'')+'</small></td><td class="dd-number">'+number(Number.isFinite(line.cbm)?line.cbm*(confirmed?line.loaded:maximum):null)+'</td><td class="dd-expiry">'+(line.expiryDate?date(line.expiryDate):'—')+(state.history?'':'<button type="button" data-dd-expiry="'+esc(line.taskId)+'" aria-label="Edit expiry '+esc(line.name)+'" '+(state.queue.length?'disabled':'')+'>✎</button>')+'</td><td>'+message+'</td></tr>';}).join('');
    html+='</tbody></table></div>';
   }
   const uncertain=state.queue[0]?.uncertain;
   if(uncertain)html+='<div class="dd-save-warning"><span>'+esc(state.queue[0].error)+'</span><button type="button" data-dd-retry>Retry same save 重试本次保存</button></div>';
   state.container.innerHTML=html+'</section>';
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
   try{const result=await sender('PACKING_READ_REQUEST',company);if(company!==state.company||generation!==state.generation)return;if(result.company!==company||result.deskDeliveryVersion!==2)throw Error('Desk task service is not ready.');state.lists=result.lists.filter(list=>list.desk);state.completedLists=(result.completedLists||[]).filter(list=>list.desk&&list.batchComplete);state.staff=result.staff?.staffName||'';state.loaded=true;state.notice='';}
   catch(error){if(generation===state.generation)state.notice=error.message;}
   finally{if(generation===state.generation){state.reading=false;render();}}
  }
  function modal(title,body,confirm){
   dialog.setAttribute('aria-label',title);dialog.innerHTML='<header><strong>'+esc(title)+'</strong><button type="button" data-dd-close aria-label="Close">×</button></header><div class="dd-modal-body">'+body+'<p id="dd-error" role="alert"></p></div><footer><button type="button" data-dd-close>Cancel 取消</button><button type="button" id="dd-confirm" class="dd-action">Confirm 确认</button></footer>';
   dialog.querySelectorAll('[data-dd-close]').forEach(button=>button.onclick=()=>{if(!preparing)dialog.close();});dialog.querySelector('#dd-confirm').onclick=confirm;if(!dialog.open)dialog.showModal();
  }
  function open(list,line){
   if(state.history||!list||!line||list.batchComplete||list.currentAuthorization===false||line.resolution?.resolved||!(line.readyQuantity>0)||pendingFor(list.id,line.taskId))return;
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
  function openExpiry(list,line){
   if(state.history||!line||state.queue.length)return;editing={listId:list.id,taskId:line.taskId,action:'DESK_EXPIRY'};
   modal('Expiry 有效日期','<label class="dd-expiry-entry">DD / MM / YY<input id="dd-expiry-input" inputmode="numeric" maxlength="8" placeholder="DD/MM/YY" value="'+(line.expiryDate?line.expiryDate.slice(8)+'/'+line.expiryDate.slice(5,7)+'/'+line.expiryDate.slice(2,4):'')+'"></label>',()=>{
    const value=dialog.querySelector('#dd-expiry-input').value,match=/^(\d{2})\/(\d{2})\/(\d{2})$/.exec(value),iso=match?'20'+match[3]+'-'+match[2]+'-'+match[1]:'';
    if(!iso||!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString().slice(0,10)!==iso){dialog.querySelector('#dd-error').textContent='Enter a valid DD/MM/YY date.';return;}queue(list,line,{expiryDate:iso});
   });
   const input=dialog.querySelector('#dd-expiry-input');input.oninput=event=>{const value=event.target.value.replace(/\D/g,'').slice(0,6);event.target.value=value.slice(0,2)+(value.length>2?'/'+value.slice(2,4):'')+(value.length>4?'/'+value.slice(4):'');};input.focus();
  }
  function openPhoto(url){
   dialog.setAttribute('aria-label','Container photo');dialog.innerHTML='<header><strong>Container photo 整柜照片</strong><button type="button" data-dd-close aria-label="Close photo">×</button></header><img class="dd-photo-full" src="'+esc(url)+'" alt="Container photo">';dialog.querySelector('[data-dd-close]').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();
  }
  function queue(list,line,draft){
   const action=editing.action;state.generation++;state.reading=false;state.failed.delete(list.id+'|'+line.taskId);state.queue.push({listId:list.id,taskId:line.taskId,authorized:line.quantity,action,requestId:crypto.randomUUID(),draft,packet:null,uncertain:false});dialog.close();editing=null;state.notice='Saving… You can continue with another item. 正在保存，可继续其他产品。';render();pump();
  }
  async function addPhotos(list,files){
   if(!files.length||preparing||state.queue.length||state.history)return;
   if(files.length+(list.photos?.length||0)>30){state.notice='Choose at most '+(30-(list.photos?.length||0))+' more container photos.';render();return;}
   preparing=true;state.generation++;state.reading=false;state.notice='Preparing photos 正在处理照片…';render();
   try{
    // Compression bounds each image. Save three at a time through the existing journal.
    const evidence=[];for(const file of files)evidence.push(await window.warehouseWorkroom.preparePhoto(file));
    for(let index=0;index<evidence.length;index+=3)state.queue.push({listId:list.id,action:'DESK_PHOTOS',requestId:crypto.randomUUID(),draft:{photos:evidence.slice(index,index+3)},packet:null,uncertain:false});
    state.notice='Photos queued 照片正在保存';
   }catch(error){state.notice=error.message;}
   finally{preparing=false;render();pump();}
  }
  async function pump(){
   if(state.running||!state.queue.length||state.queue[0].uncertain)return;
   const command=state.queue[0],list=state.lists.find(row=>row.id===command.listId),line=list?.lines.find(row=>row.taskId===command.taskId);state.running=true;
   try{
    if(!command.packet){if(!list||command.action!=='DESK_PHOTOS'&&(!line||line.quantity!==command.authorized)){const error=Error('Authorized task changed. Refresh and confirm again.');error.retryable=false;throw error;}command.packet={action:command.action,id:list.id,revision:list.revision,...(command.taskId?{taskId:command.taskId}:{}),...(command.action==='DESK_LOAD'?{resolutionRevision:line.resolution?.revision||''}:{}),...command.draft};}
    const result=await sender('PACKING_SAVE_REQUEST',state.company,command.packet,command.requestId),saved=result.list;
    if(!saved?.desk||result.company!==state.company||saved.company!==state.company||saved.id!==command.listId||result.id!==command.listId||result.requestId!==command.requestId||command.action==='DESK_LOAD'&&saved.lines.find(row=>row.taskId===command.taskId)?.loaded!==command.draft.loaded||command.action==='DESK_EXPIRY'&&saved.lines.find(row=>row.taskId===command.taskId)?.expiryDate!==command.draft.expiryDate||command.action==='DESK_PHOTOS'&&command.draft.photos.some(photo=>!saved.photos?.some(item=>item.sha256===photo.sha256)))throw Error('Delivery receipt is unconfirmed. Retry the same save.');
    if(command.action==='DESK_PHOTOS')for(const photo of command.draft.photos){const item=saved.photos.find(row=>row.sha256===photo.sha256);previews.set(item.fileId,'data:'+photo.mimeType+';base64,'+photo.base64);}
    state.lists=state.lists.map(row=>row.id===saved.id?{...saved,lines:saved.lines.map(line=>{const previous=row.lines.find(item=>item.taskId===line.taskId);return {...line,readyQuantity:Math.max(0,(previous?.readyQuantity||0)-Math.max(0,line.loaded-(previous?.loaded||0))),chatContexts:previous?.chatContexts||[]};}),currentAuthorization:row.currentAuthorization,currentDesk:row.currentDesk}:row);state.queue.shift();state.notice='Saved 保存成功';notify(state.company,saved);
   }catch(error){
    state.notice=error.message;
    if(error.retryable===false&&command.action!=='DESK_PHOTOS'){
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
