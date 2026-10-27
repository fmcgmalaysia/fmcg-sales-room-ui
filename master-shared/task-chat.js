(()=>{'use strict';
const department=document.querySelector('nav[aria-label="Account navigation"]')?'ACCOUNT':document.querySelector('nav[aria-label="Warehouse navigation"]')?'WAREHOUSE':document.title.includes('Support')?'SUPPORT':'PURCHASE';
const english=department==='ACCOUNT',copy=(en,zh)=>english?en:en+' '+zh,code={ACCOUNT:'ACC',PURCHASE:'P',WAREHOUSE:'W',SUPPORT:'S',SALES:'SALES'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const chatTimeFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
const time=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?chatTimeFormat.format(d):'';};
const companyValue=()=>document.querySelector('#companySelect,#company')?.value||'NCT';
const key=t=>[t.kind,t.taskId,t.peer,t.legacyOnly?'old':'new'].join('|');
let company=companyValue(),staffId='',threads=[],nextHistory=null,current=null,messages=[],before=null,pageReadOnly=false,pageState='loading',listBusy=false,pageBusy=false,generation=0,pageToken=0,pending=null,replyTo=null,observer=null,readQueue=Promise.resolve(),listPeer=null;
const requests=new Map(),drafts=new Map(),seen=new Set();
let paintQueued=false;
function queuePaint(){if(paintQueued)return;paintQueued=true;queueMicrotask(()=>{paintQueued=false;paintCells();});}
const dialog=document.createElement('dialog');dialog.className='tc-dialog';dialog.setAttribute('aria-label',copy('Messages','留言'));document.body.append(dialog);
const nav=document.createElement('button');nav.type='button';nav.className='tc-nav';nav.setAttribute('aria-label',copy('Messages','留言'));nav.innerHTML='<span aria-hidden="true">•••</span>'; // Task-row buttons remain the visible message entry points.
const salesInbox=document.createElement('button');salesInbox.type='button';salesInbox.className='tc-peer tc-sales-inbox';salesInbox.hidden=true;salesInbox.onclick=()=>{if(!pending&&!document.querySelector('dialog[open]')){renderList(null,'SALES');dialog.showModal();}};
function draftKey(){return [company,department,staffId,current?key(current):''].join('|');}
function remember(){const text=dialog.querySelector('textarea');if(current&&text)drafts.set(draftKey(),{body:text.value,replyTo});}
function notice(text){const el=dialog.querySelector('.tc-notice');if(el)el.textContent=text;}
function request(operation,extra={},id=crypto.randomUUID()){
 const envelope={type:'TASK_CHAT_'+operation+'_REQUEST',company,department,requestId:id,...extra};
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{requests.delete(id);reject(Error(copy('Not confirmed. Please retry.','尚未确认，请重试。')));},30000);requests.set(id,{resolve,reject,timer,company,operation});parent.postMessage(envelope,'*');});
}
window.addEventListener('message',event=>{if(event.source!==parent)return;const m=event.data||{},r=requests.get(m.requestId);if(!r||m.company!==r.company||m.department!==department||m.type!=='TASK_CHAT_'+r.operation+'_RESULT')return;clearTimeout(r.timer);requests.delete(m.requestId);if(!m.ok||m.result?.ok===false){const error=Error(m.result?.error||m.error||copy('Not confirmed. Please retry.','尚未确认，请重试。'));error.retryable=m.result?.retryable!==false;r.reject(error);}else r.resolve(m.result);});
function merge(rows){const map=new Map(threads.map(t=>[key(t),t]));for(const t of rows)map.set(key(t),t);threads=[...map.values()];}
async function refresh(older=false){
 if(listBusy)return;listBusy=true;const gen=generation;
 try{const result=await request('LIST',{historyCursor:older?nextHistory:null});if(gen!==generation)return;
  if(result.company!==company||result.department!==department||!Array.isArray(result.threads))throw Error(copy('Message identity could not be confirmed.','留言身份尚未确认。'));
  if(staffId&&staffId!==result.staff?.staffId){threads=[];current=null;messages=[];dialog.close();}staffId=result.staff?.staffId||'';
  merge([...result.threads,...(result.legacyArchive||[])]);nextHistory=result.nextHistory;paintCells();if(dialog.open&&!current)renderList(undefined,listPeer);
 }catch(error){if(gen===generation)notice(error.message);}finally{if(gen===generation)listBusy=false;}
}
function badge(n){return n?'<span class="tc-badge">'+(n>99?'99+':n)+'</span>':'';}
function button(t){return '<button type="button" class="tc-peer" data-tc-key="'+esc(key(t))+'" aria-label="'+esc(copy('Message','留言'))+' '+esc(code[t.peer])+'">'+esc(code[t.peer])+badge(t.unread)+'</button>';}
function paintCells(){
 document.querySelectorAll('[data-tc-cell]').forEach(el=>{const kind=el.dataset.tcKind||'PO',peer=el.dataset.tcPeer,ids=el.dataset.tcSources?JSON.parse(el.dataset.tcSources):null;
  const found=threads.filter(t=>!t.legacyOnly&&t.kind===kind&&(!peer||t.peer===peer)&&(ids?ids.some(id=>(t.sourceTaskIds||[t.sourceTaskId]).includes(id)):t.taskId===el.dataset.tcCell));
  const latest=found.map(t=>t.lastIncoming).filter(Boolean).sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0];
  const html='<span class="tc-snippet">'+esc(messagePreview(latest)||'—')+'</span><span class="tc-actions">'+(found.length>1&&ids?'<button class="tc-peer" data-tc-source-list="'+esc(JSON.stringify(ids))+'">W'+badge(found.reduce((n,t)=>n+(t.unread||0),0))+'</button>':found.map(button).join(''))+'</span>';
  if(el.innerHTML!==html)el.innerHTML=html;
 });
 nav.innerHTML='<span aria-hidden="true">•••</span>'+badge(threads.reduce((n,t)=>n+(t.unread||0),0));
 const sales=threads.filter(t=>t.peer==='SALES'&&(t.sequence||t.unread||t.lastIncoming));salesInbox.hidden=!sales.length;salesInbox.innerHTML=esc(copy('Sales messages','销售留言'))+badge(sales.reduce((n,t)=>n+(t.unread||0),0));const host=document.querySelector('main');if(host&&!host.contains(salesInbox))host.prepend(salesInbox);
}
function header(title,subtitle){return '<header><button type="button" data-tc-back aria-label="Back">‹</button><div><strong>'+esc(title)+'</strong><small>'+esc(subtitle)+'</small></div><button type="button" data-tc-close aria-label="Close">×</button></header>';}
function renderList(sourceIds,onlyPeer=null){
 listPeer=onlyPeer;
 observer?.disconnect();remember();current=null;replyTo=null;const rows=threads.filter(t=>(!onlyPeer||t.peer===onlyPeer)&&(!sourceIds||sourceIds.some(id=>(t.sourceTaskIds||[t.sourceTaskId]).includes(id)))&&(t.updatedAt||t.lastIncoming||t.unread||sourceIds));
 rows.sort((a,b)=>(b.unread||0)-(a.unread||0)||String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
 dialog.innerHTML=header(copy('Messages','留言'),company)+'<div class="tc-history tc-list">'+rows.map(t=>'<button class="tc-thread" data-tc-key="'+esc(key(t))+'"><strong>'+esc(t.number)+' · '+esc(code[t.peer])+badge(t.unread)+'</strong><small>'+esc(t.title)+(t.legacyOnly?' · '+esc(copy('History only','仅供查阅')):'')+'</small><span>'+esc(messagePreview(t.lastIncoming)||'—')+'</span></button>').join('')+(rows.length?'':'<p>'+esc(copy('No conversations yet. Open a task to start.','暂无对话，请从任务打开留言。'))+'</p>')+(nextHistory?'<button data-tc-more-threads>'+esc(copy('Earlier conversations','更早对话'))+'</button>':'')+'</div><div class="tc-notice" role="status"></div><footer><button data-tc-refresh>'+esc(copy('Refresh','刷新'))+'</button></footer>';
}
function open(taskId,peer,kind='PO'){
 if(pending)return;if(document.querySelector('dialog[open]')&&!dialog.open)return;
 remember();if(taskId){current=threads.find(t=>t.taskId===taskId&&t.kind===kind&&t.peer===(peer||(department==='PURCHASE'?'ACCOUNT':'PURCHASE'))&&!t.legacyOnly);if(!current){renderList();notice(copy('Task messages are loading. Please retry.','正在读取任务留言，请重试。'));refresh();}else startThread(current);}else renderList();if(!dialog.open)dialog.showModal();
}
function presets(){
 if(current?.peer==='SALES'){
  if(department==='PURCHASE')return ['We are still sourcing the goods. Please wait. 正在找货中，请耐心等待。','The target price cannot be met and may result in a loss. 价格无法满足需求，可能导致亏损。','The market is short of stock. Please choose to wait or split into a later shipment. 市场缺货，请选择继续等待或拆单，下次发货。'];
  if(department==='WAREHOUSE')return ['Please check the confirmed available quantity. 请核对已确认可发货数量。','The goods are being prepared. 货物正在备货中。','Please confirm the shipment instructions. 请确认发货指示。'];
  return ['Please confirm which shipment should be invoiced. 请确认本次应开票的发货批次。','The customer documents are being prepared. 正在准备客户文件。'];
 }
 if(department==='ACCOUNT')return ['Please upload the supplier invoice before payment. 付款前请补交供应商发票。','Please confirm the bank account details. 请确认收款银行资料。','We are reviewing this payment request. 我们正在审核这笔付款申请。'];
 if(department==='PURCHASE'&&current?.peer==='ACCOUNT')return ['Please confirm the expected payment date. 请确认预计付款日期。','Supplier documents have been uploaded. Please review. 供应商文件已上传，请审核。','The supplier is awaiting payment. Please advise. 供应商正在等待付款，请告知进度。'];
 if(department==='WAREHOUSE'&&current?.peer==='SUPPORT')return ['Please check the actual loaded quantity before invoicing. 请按实际装货数量核对开票。','Please confirm the delivery instructions. 请确认发货指示。'];
 if(department==='WAREHOUSE')return ['The received quantity differs from the P.O. Please advise. 实收数量与采购单不同，请告知处理方式。','Please confirm whether we should wait for the remaining goods. 请确认是否需要等待余货。'];
 if(department==='SUPPORT')return ['Please confirm the actual loaded quantity. 请确认实际装货数量。','Please confirm whether loading is complete. 请确认是否已完成装货。'];
 return ['Please confirm the receiving status. 请确认收货进度。','Please check the goods and advise. 请核对货物并回复。'];
}
function startThread(t){remember();current=t;pageBusy=false;pageToken++;messages=[];before=null;pageState='loading';pageReadOnly=!!t.legacyOnly;replyTo=drafts.get(draftKey())?.replyTo||null;renderThread();loadPage();}
function receipt(m){const rows=m.receipts||[];return rows.some(r=>r.kind==='ACK')?copy('Acknowledged','已确认收到'):rows.some(r=>r.kind==='READ')?copy('Read','已读'):copy('Sent','已发送');}
function bubble(m){const own=m.from===department,ack=(m.receipts||[]).some(r=>r.kind==='ACK'&&r.department===department&&r.byStaffId===staffId);return '<article class="tc-bubble '+(own?'out':'in')+'" data-tc-message="'+esc(m.id)+'"><small>'+esc(m.by)+' · '+esc(code[m.from]||m.from)+'</small>'+(m.replyTo?'<small class="tc-reply-marker">'+esc(copy('Reply','回复'))+'</small>':'')+'<p>'+esc(m.body)+'</p><div class="tc-meta"><time>'+esc(time(m.at))+'</time>'+(own?'<span>'+esc(receipt(m))+'</span>':'')+'</div>'+(!own&&m.requiresAck&&!ack&&!pageReadOnly?'<button data-tc-ack="'+esc(m.id)+'">'+esc(copy('Acknowledge','确认收到'))+'</button>':'')+(!pageReadOnly&&!m.legacy?'<button class="tc-reply" data-tc-reply="'+esc(m.id)+'">'+esc(copy('Reply','回复'))+'</button>':'')+'</article>';}
function renderThread(){
 observer?.disconnect();const draft=drafts.get(draftKey())?.body||'';
 dialog.innerHTML=header(current.number||current.title,({PURCHASE:'Purchase Dept.',ACCOUNT:'Finance Dept.',WAREHOUSE:'Warehouse',SUPPORT:'Support',SALES:'Sales Dept.'}[current.peer])+' · '+company+(current.peer==='SALES'?' · '+current.title+' · '+(current.orderId||''):''))+'<div class="tc-history">'+(before?'<button data-tc-earlier>'+esc(copy('Earlier messages','更早留言'))+'</button>':'')+'<div class="tc-bubbles"></div></div><div class="tc-notice" role="status"></div>'+(pageReadOnly?'<footer>'+esc(copy('History only','历史记录仅供查阅'))+'</footer>':'<footer><details class="tc-presets"><summary>'+esc(copy('Quick replies','预设留言'))+'</summary>'+presets().map((p,i)=>'<button type="button" data-tc-preset="'+i+'">'+esc(p)+'</button>').join('')+'</details><div class="tc-reply-context" '+(replyTo?'':'hidden')+'>'+esc(copy('Reply selected','已选择回复'))+' <button data-tc-cancel-reply>×</button></div><div class="tc-compose"><textarea maxlength="2000" rows="2" aria-label="'+esc(copy('Message','留言'))+'" placeholder="'+esc(copy('Type a message…','输入留言…'))+'">'+esc(draft)+'</textarea><button class="tc-send" data-tc-send>Send</button></div></footer>');
 renderBubbles();setBusy();
}
function messageBody(m){return m?(m.presentation==='MESSAGE'&&!english&&m.bodyZh?m.bodyZh+' '+m.body:m.body+(english?'':m.bodyZh?' '+m.bodyZh:'')):'';}
function messagePreview(m){return (m?.presentation==='MESSAGE'?'Purchaser Dept: ':'')+messageBody(m);}
function decisionBubble(m){return '<article class="tc-bubble '+(m.from===department?'out':'in')+'" '+(m.notify&&m.from===current.peer?'data-tc-system="'+esc(m.id)+'"':'')+'><small>'+esc('Purchaser Dept')+' · '+esc(m.by)+'</small><p>'+esc(messageBody(m))+'</p><div class="tc-meta"><time>'+esc(time(m.at))+'</time></div></article>';}
function renderBubbles(){
 const box=dialog.querySelector('.tc-bubbles');if(!box)return;
 const updates=(current.updates||[]).map(u=>({...u,system:true})),items=[...messages,...updates].sort((a,b)=>String(a.at||'').localeCompare(String(b.at||'')));
 box.innerHTML=items.map(m=>m.system&&m.presentation==='MESSAGE'?decisionBubble(m):m.system?'<div class="tc-system" '+(m.notify&&m.from===current.peer?'data-tc-system="'+esc(m.id)+'"':'')+'>'+esc(m.body+(english?'':m.bodyZh?' '+m.bodyZh:''))+' <time>'+esc(time(m.at))+'</time></div>':bubble(m)).join('')||(pageState==='loading'?'<p class="tc-empty" role="status">'+esc(copy('Loading messages…','正在读取留言…'))+'</p>':pageState==='error'?'<p class="tc-empty" role="status">'+esc(copy('Messages could not be loaded.','留言读取失败。'))+'</p>':'<p class="tc-empty" role="status">'+esc(copy('No messages yet.','暂无留言。'))+'</p>');observeRead();
}
async function loadPage(earlier=false){
 if(pageBusy||!current)return;pageBusy=true;const gen=generation,token=++pageToken,identity=key(current),oldHeight=dialog.querySelector('.tc-history')?.scrollHeight||0;
 try{const result=await request('PAGE',{input:{kind:current.kind,taskId:current.taskId,peer:current.peer,legacyOnly:!!current.legacyOnly,before:earlier?before:null}});if(gen!==generation||token!==pageToken||!current||key(current)!==identity)return;
  const map=new Map((earlier?messages:[]).map(m=>[m.id,m]));for(const m of result.messages||[])map.set(m.id,m);messages=[...map.values()].sort((a,b)=>String(a.at).localeCompare(String(b.at))||(a.sequence||0)-(b.sequence||0));before=result.before;pageReadOnly=!!result.readOnly;if(result.summary){Object.assign(current,result.summary);merge([current]);paintCells();}current.updates=result.updates||[];
  pageState='ready';remember();renderThread();const history=dialog.querySelector('.tc-history');history.scrollTop=earlier?history.scrollHeight-oldHeight:history.scrollHeight;
 }catch(error){if(gen===generation&&token===pageToken){pageState='error';renderBubbles();notice(error.message);}}finally{if(token===pageToken)pageBusy=false;}
}
function setBusy(){dialog.querySelectorAll('[data-tc-send],textarea,[data-tc-ack],[data-tc-back],[data-tc-preset]').forEach(el=>el.disabled=!!pending);const b=dialog.querySelector('[data-tc-send]');if(b)b.textContent=pending?copy('Saving…','保存中…'):'Send';}
async function savePending(){
 if(!pending||pending.inFlight)return;pending.inFlight=true;setBusy();notice(copy('Saving…','保存中…'));const record=pending;
 try{const result=await request('SAVE',{input:record.input},record.id);if(record!==pending)return;if(result.taskId!==record.input.taskId||result.peer!==record.input.peer)throw Error(copy('Save identity could not be confirmed.','保存身份尚未确认。'));
  pending=null;dialog.querySelector('[data-tc-retry]')?.remove();if(record.input.action==='SEND'){drafts.delete(record.draftKey);replyTo=null;const text=dialog.querySelector('textarea');if(text)text.value='';}notice('');await loadPage();refresh();
 }catch(error){if(record!==pending)return;record.inFlight=false;if(error.retryable===false)pending=null;notice(error.message);if(pending&&!dialog.querySelector('[data-tc-retry]'))dialog.querySelector('footer').insertAdjacentHTML('beforeend','<button data-tc-retry>'+esc(copy('Retry','重试'))+'</button>');}finally{setBusy();}
}
function enqueue(input){if(pending||!current||pageReadOnly)return;remember();pending={id:crypto.randomUUID(),draftKey:draftKey(),input:{kind:current.kind,taskId:current.taskId,peer:current.peer,...input},inFlight:false};savePending();}
function observeRead(){
 observer?.disconnect();if(!current||pageReadOnly)return;const identity=key(current),gen=generation;
 observer=new IntersectionObserver(entries=>{if(document.visibilityState!=='visible'||!dialog.open)return;for(const e of entries){if(!e.isIntersecting||e.intersectionRatio<1)continue;const systemId=e.target.dataset.tcSystem,m=systemId?(current.updates||[]).find(m=>m.id===systemId):messages.find(m=>m.id===e.target.dataset.tcMessage);if(!m||m.from===department||seen.has(company+'|'+identity+'|'+m.id)||m.byStaffId===staffId)continue;
  seen.add(company+'|'+identity+'|'+m.id);const input={kind:current.kind,taskId:current.taskId,peer:current.peer,...(systemId?{action:'SYSTEM_READ',messageId:m.id}:m.legacy?{action:'LEGACY_READ',messageId:m.id}:{action:'READ',sequence:m.sequence})};
  readQueue=readQueue.then(async()=>{if(gen!==generation)return;try{await request('SAVE',{input});refresh();}catch(_){seen.delete(company+'|'+identity+'|'+m.id);}});
 }},{root:dialog.querySelector('.tc-history'),threshold:1});dialog.querySelectorAll('[data-tc-message],[data-tc-system]').forEach(el=>observer.observe(el));
}
function close(){if(pending){notice(copy('Confirm the pending save before closing.','请先确认待保存留言。'));return;}remember();observer?.disconnect();dialog.close();}
dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('input',remember);
dialog.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-tc-close'))close();if(b.hasAttribute('data-tc-back')&&!pending)renderList();if(b.hasAttribute('data-tc-refresh'))refresh();if(b.hasAttribute('data-tc-more-threads'))refresh(true);if(b.hasAttribute('data-tc-earlier'))loadPage(true);if(b.hasAttribute('data-tc-retry'))savePending();
 if(b.dataset.tcKey&&!pending){const t=threads.find(t=>key(t)===b.dataset.tcKey);if(t)startThread(t);}
 if(b.hasAttribute('data-tc-preset')){dialog.querySelector('textarea').value=presets()[Number(b.dataset.tcPreset)]||'';dialog.querySelector('details').open=false;remember();}
 if(b.dataset.tcReply){const m=messages.find(m=>m.id===b.dataset.tcReply);if(m&&!m.legacy){replyTo={id:m.id,sequence:m.sequence};remember();dialog.querySelector('.tc-reply-context').hidden=false;dialog.querySelector('textarea').focus();}}
 if(b.hasAttribute('data-tc-cancel-reply')){replyTo=null;remember();dialog.querySelector('.tc-reply-context').hidden=true;}
 if(b.hasAttribute('data-tc-send')){const body=dialog.querySelector('textarea').value.trim();if(body)enqueue({action:'SEND',body,baseSequence:current.sequence||0,requiresAck:true,replyTo});}
 if(b.dataset.tcAck){const m=messages.find(m=>m.id===b.dataset.tcAck);if(m)enqueue({action:m.legacy?'LEGACY_ACK':'ACK',messageId:m.id,sequence:m.sequence});}
});
document.addEventListener('click',e=>{if(dialog.contains(e.target))return;const b=e.target.closest('[data-tc-key],[data-tc-source-list]');if(!b)return;if(b.dataset.tcSourceList){if(!pending){renderList(JSON.parse(b.dataset.tcSourceList));dialog.showModal();}}else{const t=threads.find(t=>key(t)===b.dataset.tcKey);if(t)open(t.taskId,t.peer,t.kind);}});nav.onclick=()=>open();
document.addEventListener('change',e=>{if(!['company','companySelect'].includes(e.target.id))return;if(pending){e.stopImmediatePropagation();e.target.value=company;notice(copy('Confirm the pending save first.','请先确认待保存留言。'));return;}remember();generation++;company=e.target.value;threads=[];staffId='';current=null;messages=[];listBusy=false;pageBusy=false;seen.clear();dialog.close();paintCells();refresh();},true);
window.addEventListener('beforeunload',e=>{if(pending||[...drafts.values()].some(d=>d.body.trim())){e.preventDefault();e.returnValue='';}});
function cell(row,fallback='',peer=department==='PURCHASE'?'ACCOUNT':'PURCHASE',kind='PO'){queuePaint();return '<div class="tc-cell" data-tc-cell="'+esc(row.id)+'" data-tc-kind="'+kind+'" data-tc-peer="'+peer+'"></div>';}
window.departmentMessages={cell,open,refresh,isBusy:()=>Boolean(pending||dialog.open||[...drafts.values()].some(d=>d.body.trim())||dialog.querySelector('textarea')?.value.trim()),hasUnread:id=>threads.some(t=>t.taskId===id&&t.unread),deliveryCell:row=>cell(row,'','PURCHASE','DELIVERY')+cell(row,'','SUPPORT','DELIVERY'),sourceCell:ids=>{queuePaint();return '<div class="tc-cell" data-tc-cell="sources" data-tc-kind="DELIVERY" data-tc-peer="WAREHOUSE" data-tc-sources="'+esc(JSON.stringify(ids))+'"></div>';}};
new MutationObserver(queuePaint).observe(document.querySelector('main'),{childList:true});
setInterval(()=>{if(document.visibilityState==='visible'&&!pending){refresh();if(dialog.open&&current&&!dialog.querySelector('textarea')?.value.trim())loadPage();}},30000);refresh();
})();
