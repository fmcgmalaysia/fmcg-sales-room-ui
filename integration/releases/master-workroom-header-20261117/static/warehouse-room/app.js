(()=>{'use strict';
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={box:'M3 7l9-4 9 4v11l-9 4-9-4z M3 7l9 4 9-4 M12 11v11',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v6l4 2',issue:'M12 3L2 21h20z M12 9v5 M12 17v1',good:'M7 10v11H3V10z M7 11l5-8h2v7h6l1 2-3 9H7',bad:'M7 14V3H3v11z M7 13l5 8h2v-7h6l1-2-3-9H7',entry:'M14 4l6 6 M4 20l4-1L21 6l-5-5L3 14z'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]}"></path></svg>`;
const labels={WAITING:['Awaiting Delivery','等待到货'],PARTIAL:['Partially Received','分批到货'],ISSUE:['Receiving Issue','收货异常'],COMPLETE:['Received','收货完成']};
let company='NCT',view='receiving',receivingFilter='progress',rows=[],customerLines=[],deliveryTasks=[],selected=null,pending=null,saving=false,correcting=false,readRequest='',readTimer;
const month=value=>{if(!value)return '';const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit'}).formatToParts(new Date(value));return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;};
function timestamp(value,relative=false){if(!value)return '—';const date=new Date(value);if(!Number.isFinite(date.getTime()))return '—';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));const days=Math.floor((Date.now()+28800000)/86400000)-Math.floor((date.getTime()+28800000)/86400000);return relative&&days>=0&&days<2?(days?'Yesterday':'Today'):relative&&days>=2?`${days} Days ago`:`${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}`;}
function notice(message,error=false){$('notice').hidden=!message;$('notice').textContent=message;$('notice').classList.toggle('error',error);}
let staffConfirmed=false;
function request(quiet=false){
 if(view==='issues'){window.masterStockExceptions?.open();return;}
 if(view==='customers'&&window.warehousePackingTab){window.warehousePackingTab.refresh();if(quiet===true)return;}
 if(view==='stock'){window.warehouseStockTab?.refresh();return;}if(view==='dispatch'){window.warehouseDispatch.refresh();return;}if(saving||$('entry').open)return;
 readRequest=crypto.randomUUID();const packet={type:'WAREHOUSE_ORDERS_REQUEST',company,requestId:readRequest};let attempts=0;
 if(quiet!==true)notice('Loading receiving orders 正在读取收货订单…');
 function send(){
  attempts++;$('refresh').disabled=true;$('refresh').hidden=true;parent.postMessage(packet,'*');clearTimeout(readTimer);
  readTimer=setTimeout(()=>{
   if(readRequest!==packet.requestId||company!==packet.company||!$('refresh').disabled)return;
   const safe=view==='receiving'&&!document.hidden&&!saving&&!pending&&!$('entry').open&&!document.querySelector('dialog[open]')&&!document.activeElement?.matches?.('input,select,textarea');
   if(attempts<3&&safe){notice('Reconnecting… 正在恢复连接…');send();return;}
   $('refresh').disabled=false;if(!staffConfirmed)$('staff').textContent='Data unavailable 资料待连接';
   $('refresh').hidden=false;notice('Read timed out. Existing records are retained. 读取超时，现有记录保留。',true);
  },30000);
 }
 send();
}
function filtered(){const query=$('search').value.trim().toLowerCase(),supplier=$('supplier').value;return rows.filter(row=>(!supplier||row.supplierId===supplier)&&(!query||[row.number,row.supplierName,row.supplierShortName,row.customerName].join(' ').toLowerCase().includes(query)));}
function table(data,title){if(window.warehouseWorkroom)return window.warehouseWorkroom.incoming(data,title);return `<section class="warehouse-section panel"><h2>${title} · ${data.length}</h2><div class="table-scroll"><table class="warehouse-table"><colgroup>${'<col>'.repeat(7)}</colgroup><thead><tr><th>Since</th><th>Supplier / P.O.</th><th>For Customer</th><th>Items</th><th>Entry</th><th>Status</th><th>Message</th></tr></thead><tbody>${data.length?data.map(row=>`<tr><td>${esc(timestamp(row.createdAt,(row.workroomStatus||row.status)!=='COMPLETE'))}<small>by ${esc(row.createdBy||'—')}</small></td><td><strong>${esc(row.supplierShortName||row.supplierName)}</strong><small>${esc(row.number)}</small></td><td>${esc(row.customerName)}${row.lines.some(line=>line.expectedExtra>0)?'<small>+ Re-Allocation 多采购库存</small>':''}</td><td><span class="item-count ${row.status==='COMPLETE'?'done':''}">${row.status==='COMPLETE'?row.itemCount:row.pendingItems}</span></td><td><button class="account-icon" data-entry="${esc(row.id)}" aria-label="Open ${esc(row.number)}">${icon('entry')}</button></td><td><span class="status ${row.status}" aria-description="${labels[row.status].join(' / ')}">${icon(row.status==='COMPLETE'?'good':row.status==='ISSUE'?'bad':'clock')}</span><small>${labels[row.status][1]}</small></td><td>${window.departmentMessages?.cell(row)||''}</td></tr>`).join(''):'<tr><td colspan="7" class="empty-cell">No orders 暂无订单</td></tr>'}</tbody></table></div></section>`;}
function customerTable(){const query=$('search').value.trim().toLowerCase(),supplier=$('supplier').value,customer=$('customer').value,lines=customerLines.filter(row=>(!supplier||row.supplierId===supplier)&&(!customer||row.customerId===customer)&&(!query||[row.barcode,row.name,row.customerName,row.supplierName,row.po].join(' ').toLowerCase().includes(query))),required=lines.reduce((sum,row)=>sum+(row.requiredQty||0),0),allocated=lines.reduce((sum,row)=>sum+(row.allocatedQty||0),0);$('customerQty').innerHTML='<span class="item-count '+(required===allocated?'done':'')+'">'+required+' | '+allocated+'</span>';return '<section class="warehouse-section panel"><h2>Customer Readiness 客户备货 · '+lines.length+'</h2><div class="table-scroll"><table class="customer-readiness"><thead><tr><th>Customer 客户</th><th>Supplier 供应商</th><th>Barcode · Item 产品</th><th>P.O. No.</th><th>Required | Allocated 待交 | 已分配</th><th>Feedback 反馈</th></tr></thead><tbody>'+lines.map(row=>'<tr><td>'+esc(row.customerName)+'<small>Est. Shipment 预计发货: '+esc(row.estimatedShipmentDate?row.estimatedShipmentDate.slice(8,10)+'-'+row.estimatedShipmentDate.slice(5,7)+'-'+row.estimatedShipmentDate.slice(2,4):'—')+'</small></td><td>'+esc(row.supplierName||'—')+'</td><td>'+esc(row.barcode)+'<br><b>'+esc(row.name)+'</b><small>'+esc(row.packing)+'</small></td><td>'+esc(row.po||'—')+'</td><td class="center"><span class="item-count '+(row.requiredQty===row.allocatedQty?'done':'')+'">'+esc(row.requiredQty)+' | '+esc(row.allocatedQty??'—')+'</span></td><td>'+esc(row.fulfilment?({WAIT:'Awaiting balance 等待补货',STOP:'No further delivery 不再补货',PENDING:'Pending decision 待采购决定'}[row.fulfilment.decision]||''):'')+'<small>'+esc(row.fulfilment?.message||'')+'</small></td></tr>').join('')+(lines.length?'':'<tr><td colspan="6" class="empty-cell">No customer tasks 暂无客户任务</td></tr>')+'</tbody></table></div></section>';}
function render(){const issues=view==='issues';$('warehouseStockIssues').hidden=!issues;$('tables').hidden=issues;if(issues){document.querySelector('.title-row').hidden=true;document.querySelector('.filters').hidden=true;$('track').hidden=true;$('notice').hidden=true;$('taskSignals').hidden=true;return;}const packing=Boolean(view==='customers'&&window.warehousePackingTab),legacyTasks=packing?deliveryTasks.filter(row=>row.prepared||row.loaded>0||row.photos?.length):deliveryTasks;window.warehouseWorkroom?.setData({orders:rows,deliveryTasks:legacyTasks},company,{render,refresh:request});document.querySelector('.title-row').hidden=view==='stock'||packing;$('taskSignals').hidden=view==='stock'||packing;if(view==='stock'||packing)$('notice').hidden=true;$('track').hidden=view==='dispatch'||view==='stock'||packing;document.querySelector('.filters').hidden=view==='dispatch'||view==='stock'||packing;if(packing){window.warehousePackingTab.render($('tables'),company,legacyTasks.length?window.warehouseWorkroom?.delivery()||'':'');window.warehouseWorkroom?.hydrate();return;}if(view==='stock'){window.warehouseStockTab.render($('tables'),company);return;}if(view==='dispatch'){window.warehouseDispatch.render($('tables'),company);return;}window.masterTaskSignals?.mount($('taskSignals'),'WAREHOUSE',{orders:rows},entry=>{if(!saving)openEntry(entry.id);});const current=month(new Date());
 const receivingOnly=view==='receiving',statusFilter=document.querySelector('.receiving-status-filter');statusFilter.hidden=!receivingOnly;
 $('receivingProgress').setAttribute('aria-pressed',String(receivingFilter==='progress'));$('receivingComplete').setAttribute('aria-pressed',String(receivingFilter==='complete'));
 $('track').innerHTML=['WAITING','PARTIAL','ISSUE','COMPLETE'].map((status,index)=>`<div class="track-item ${status}" data-count="${rows.filter(row=>row.status===status&&(status!=='COMPLETE'||month(row.completedAt)===current)).length}"><span class="track-capsule">${icon(['box','clock','issue','good'][index])}<b>${rows.filter(row=>row.status===status&&(status!=='COMPLETE'||month(row.completedAt)===current)).length}</b></span><p>${status==='COMPLETE'?'Received This Month':labels[status][0]}<small>${status==='COMPLETE'?'本月完成收货':labels[status][1]}</small></p></div>`).join('');
 if(window.warehouseWorkroom)$('track').innerHTML=window.warehouseWorkroom.cards(view);const data=filtered();$('tables').innerHTML=view==='customers'?(window.warehouseWorkroom?window.warehouseWorkroom.delivery():customerTable()):view==='history'?table(data.filter(row=>(row.workroomStatus||row.status)==='COMPLETE'&&month(row.workroomCompletedAt||row.completedAt||row.history.at(-1)?.at)===$('month').value),'Receiving History 收货历史'):table(data.filter(row=>receivingFilter==='progress'?(row.workroomStatus||row.status)!=='COMPLETE':(row.workroomStatus||row.status)==='COMPLETE'&&month(row.workroomCompletedAt||row.completedAt||row.history.at(-1)?.at)===current),receivingFilter==='progress'?'In Progress 进行中':'Completed Tasks 本月完成');
 $('receivingProgressCount').textContent=data.filter(row=>(row.workroomStatus||row.status)!=='COMPLETE').length;
 $('receivingCompleteCount').textContent=data.filter(row=>(row.workroomStatus||row.status)==='COMPLETE'&&month(row.workroomCompletedAt||row.completedAt||row.history.at(-1)?.at)===current).length;
 $('tables').querySelectorAll('[data-entry]').forEach(button=>button.onclick=()=>openEntry(button.dataset.entry));window.warehouseWorkroom?.hydrate();}
const receiptPhotos=new Map();
let receiptPhotoReading=false;
function receiptThumbnail(line){
 const url=/^https:\/\/[^\s<>"']+$/i.test(line.productImageUrl||'')?line.productImageUrl:'';
 return url?'<img class="receipt-thumb" src="'+esc(url)+'" alt="" width="54" height="54">':'<span class="receipt-thumb" aria-hidden="true">'+icon('box')+'</span>';
}
function receiptPhotoField(line){return '<div class="receipt-evidence"><div class="receipt-photo-actions"><label class="receipt-camera" title="Camera 拍照"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/></svg><input type="file" data-receipt-photo capture="environment" accept="image/*" aria-label="Photo '+esc(line.barcode)+'"></label><label class="receipt-camera" title="Gallery 手机相册"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg><input type="file" data-receipt-photo accept="image/jpeg,image/png,image/webp" aria-label="Choose photo from gallery '+esc(line.barcode)+'"></label></div><div data-receipt-preview></div></div>';}
function receiptPhotoLink(photo){return /^[A-Za-z0-9_-]{10,200}$/.test(photo?.fileId||'')?' · <a href="https://drive.google.com/file/d/'+encodeURIComponent(photo.fileId)+'/view" target="_blank" rel="noopener">View photo 查看照片</a>':'';}
function receiptPhotoLocks(section){
 const sections=section?[section]:$('entryLines').querySelectorAll('[data-line]');
 for(const item of sections){const fields=item.querySelectorAll('[data-receipt-photo]');if(!fields.length)continue;const hidden=correcting||selected.status==='COMPLETE'||selected.lines[Number(item.dataset.line)].receivingStoppedWaiting;item.querySelector('.receipt-evidence').hidden=hidden;for(const field of fields)field.disabled=hidden||saving||Boolean(pending)||receiptPhotoReading;}
}
function renderReceiptPhoto(section,line){
 const photo=receiptPhotos.get(line.taskId),preview=section.querySelector('[data-receipt-preview]');
 section.querySelector('.receipt-photo-actions').hidden=Boolean(photo);
 preview.innerHTML=photo?'<button type="button" class="receipt-preview-button" data-receipt-zoom aria-label="Enlarge receipt photo 放大收货照片"><img src="data:image/jpeg;base64,'+photo.base64+'" alt=""></button><button type="button" class="receipt-remove" data-receipt-remove aria-label="Remove receipt photo 移除收货照片">×</button>':'';
}
function zoomReceiptPhoto(event){
 const trigger=event.target.closest('[data-receipt-zoom]');
 if(!trigger)return;
 const line=selected.lines[Number(trigger.closest('[data-line]').dataset.line)];
 const image=$('receiptPhotoImage');
 $('receiptPhotoTitle').textContent=line.name;
 image.src=trigger.querySelector('img').src;
 $('receiptPhotoViewer').showModal();
}
async function selectReceiptPhoto(event){
 const input=event.target;if(!input.matches('[data-receipt-photo]')||!input.files?.length||receiptPhotoReading||pending||saving)return;
 const section=input.closest('[data-line]'),line=selected.lines[Number(section.dataset.line)],file=input.files[0];
 input.value='';
 if(!receiptPhotos.has(line.taskId)&&receiptPhotos.size>=3){$('entryError').textContent='Up to three product photos per receipt. 每次收货最多三张商品照片。';return;}
 receiptPhotoReading=true;setSaving(false);$('entryError').textContent='';
 try{const photo=await window.warehouseWorkroom.preparePhoto(file);receiptPhotos.set(line.taskId,photo);renderReceiptPhoto(section,line);section.querySelector('[data-receipt-zoom]').focus();}
 catch(error){$('entryError').textContent=error.message;}
 finally{receiptPhotoReading=false;setSaving(false);}
}
function removeReceiptPhoto(event){
 const button=event.target.closest('[data-receipt-remove]');if(!button||pending||saving||receiptPhotoReading)return;
 const section=button.closest('[data-line]'),line=selected.lines[Number(section.dataset.line)];receiptPhotos.delete(line.taskId);renderReceiptPhoto(section,line);section.querySelector('[data-receipt-photo]').focus();
}
let entryReadOnly=false,correctionLine=-1,savedReceiptTasks=new Set();
const receiptRows=new Set();
const hasSavedReceipt=line=>Boolean(line.updatedAt||line.accepted>0||line.rejected>0||savedReceiptTasks.has(line.taskId));
const receiptEditable=index=>!entryReadOnly&&!selected.lines[index].receivingStoppedWaiting&&(correcting?index===correctionLine:receiptRows.has(index));
const canCorrectReceipt=line=>!entryReadOnly&&!line.receivingStoppedWaiting&&selected.correctionAllowed!==false&&hasSavedReceipt(line);
function receiptRowActions(line,index){
 if(entryReadOnly||correcting||line.receivingStoppedWaiting||receiptEditable(index))return '';
 const pencil=canCorrectReceipt(line)?'<button type="button" class="receipt-pencil" data-receipt-action="correct" aria-label="Correct saved quantity 更正已收数量" title="Correct saved quantity 更正已收数量">'+icon('entry')+'</button>':'';
 const balance=line.remaining>0?'<button type="button" data-receipt-action="receive">Receive Balance 继续收货</button>':'';
 return pencil||balance?'<div class="receipt-row-actions">'+pencil+balance+'</div>':'';
}
function chooseReceiptAction(event){
 const button=event.target.closest('[data-receipt-action]');
 if(!button||entryReadOnly||correcting||saving||pending||receiptPhotoReading)return;
 const section=button.closest('[data-line]'),index=Number(section.dataset.line),line=selected.lines[index];
 if(!line||line.receivingStoppedWaiting||receiptEditable(index))return;
 if(button.dataset.receiptAction==='receive'&&line.remaining>0){
  receiptRows.add(index);
  section.outerHTML=receiptRowMarkup(line,index);
  setSaving(false);receiptHints();return;
 }
 if(button.dataset.receiptAction!=='correct'||!canCorrectReceipt(line))return;
 const hasDraft=receiptPhotos.size||[...$('entryLines').querySelectorAll('[data-field="accepted"],[data-field="rejected"],[data-field="kind"]')].some(input=>input.dataset.field==='kind'?input.value!=='DELIVERY':input.validity.badInput||(input.dataset.field==='accepted'?input.value.trim()!=='':Number(input.value)!==0));
 if(hasDraft){$('entryError').textContent='Save or cancel this receipt before correcting a saved quantity. 请先保存或取消本次收货，再更正已收数量。';return;}
 correcting=true;correctionLine=index;
 $('entryError').textContent='';$('entryWarning').textContent='Correct total 更正累计数量 · Reason required 必须填写原因';
 renderReceiptRows();
}
function receiptRowMarkup(line,index){const editable=receiptEditable(index);return `<section class="receive-line" data-line="${index}"><span class="receipt-line-number">${String(index+1).padStart(2,'0')}</span><div class="receipt-product">${receiptThumbnail(line)}<div><span class="product-code">${esc(line.barcode)}</span><strong class="product-name">${esc(line.name)}</strong><span class="product-packing">${esc(line.packing)}</span>${editable&&!correcting&&line.accepted?'<small class="receipt-prior">Previously received 已收：'+line.accepted+'</small>':''}${receiptRowActions(line,index)}</div></div><div class="receipt-quantities"><div class="readonly"><span class="receipt-qty-label">Expected 应收</span><b>${line.planned}</b></div>${editable?`<label><span class="receipt-qty-label">${correcting?'Correct Total 更正累计':'This Receipt 本次收货'}</span><input data-field="accepted" aria-label="Accepted ${esc(line.barcode)}" type="number" inputmode="numeric" min="0" max="${correcting?line.planned:line.remaining}" step="1" value="${correcting?line.accepted:''}"></label>`:`<div class="readonly"><span class="receipt-qty-label receipt-qty-saved">Received 已收</span><b>${line.accepted}</b></div>`}<div class="readonly"><span class="receipt-qty-label">Pending 待收</span><b data-waiting>${line.remaining}</b></div>${editable?`<label data-rejected-label hidden>Rejected 拒收<input data-field="rejected" aria-label="Rejected ${esc(line.barcode)}" type="number" inputmode="numeric" min="0" max="9999" step="1" value="${correcting?line.rejected:0}"></label>`:''}</div>${editable&&!correcting?receiptPhotoField(line):''}${editable?`<div class="receipt-reason"><label data-reason-label>Pending reason 待收原因</label><select data-field="kind" aria-label="Pending reason ${esc(line.barcode)}" ${correcting?'disabled':''}><option value="DELIVERY">Select reason 选择原因</option><option value="SHORT">Short delivery 供应商少发货</option><option value="DAMAGED">Damaged goods rejected 货物损坏，拒收</option><option value="WRONG">Wrong goods supplied 供应商发错货</option></select><input data-field="reason" maxlength="1000" aria-label="Reason ${esc(line.barcode)}" hidden><span data-receipt-normal hidden></span></div>${line.issue?'<label class="resolve" hidden><input type="checkbox" data-field="resolveIssue">Resolve Issue 解决原收货异常</label>':''}`:''}${line.receivingStoppedWaiting&&!entryReadOnly?'<p class="receipt-stopped-note">Purchase has confirmed: do not wait for the remaining goods.<br>采购员已明确指示：无需等待剩余未到的货。</p>':''}</section>`;}
function renderReceiptRows(){
 $('entryLines').innerHTML=selected.lines.map(receiptRowMarkup).join('');
 setSaving(false);receiptHints();
}
function openEntry(id){const order=rows.find(row=>row.id===id);if(!order||pending||saving||receiptPhotoReading||$('entry').open)return;selected=order;correcting=false;correctionLine=-1;$('receiptDetails').open=false;
 entryReadOnly=view==='history'||view==='receiving'&&receivingFilter==='complete'||selected.status==='COMPLETE'||selected.workroomStatus==='COMPLETE';
 savedReceiptTasks=new Set(selected.history.flatMap(event=>event.lines.map(line=>line.taskId)));receiptRows.clear();
 if(!entryReadOnly)selected.lines.forEach((line,index)=>{if(!hasSavedReceipt(line)&&line.remaining>0&&!line.receivingStoppedWaiting)receiptRows.add(index);});$('entryError').textContent='';$('entrySupplier').textContent=selected.supplierName;$('entryPo').textContent=selected.number;receiptPhotos.clear();
 renderReceiptRows();
 $('entryWarning').textContent='';$('entryHistory').innerHTML=selected.history.length?selected.history.slice().reverse().map(event=>`<div class="account-history"><b>${timestamp(event.at)}</b><small>by ${esc(event.by)}</small>${event.lines.map(line=>`<p>${esc(selected.lines.find(item=>item.taskId===line.taskId)?.barcode)} · ${line.accepted-line.beforeAccepted>=0?'+':''}${line.accepted-line.beforeAccepted} CTN · ${esc(line.reason)}${receiptPhotoLink(line.photo)}</p>`).join('')}</div>`).join(''):'No receipts 暂无收货记录';$('cancelEntry').textContent=entryReadOnly?'Close 关闭':'Cancel';$('entry').showModal();}
function setSaving(value){
 saving=value;
 const busy=value||receiptPhotoReading;
 const button=$('saveReceipt');
 button.hidden=entryReadOnly||(!pending&&!$('entryLines').querySelector('[data-field="accepted"]'));
 button.disabled=busy||button.hidden;
 button.textContent=value?'Saving…':pending?'Retry':'Confirm';
 $('entryLines').querySelectorAll('input,select,[data-receipt-remove],[data-receipt-action]').forEach(element=>element.disabled=busy||Boolean(pending)||(correcting&&element.dataset.field==='kind'));
 receiptPhotoLocks();$('cancelEntry').disabled=busy;$('closeEntry').disabled=busy;
}
let receiptRecovery=null;
const receiptRecoveryDelays=[5000,15000,45000];
const receiptConfirming='Confirming receiving record. Your input is retained. 正在确认收货记录，已保留输入。';
function finishReceipt(){
 clearTimeout(receiptRecovery?.timer);
 receiptRecovery=null;pending=null;setSaving(false);$('entry').close();request();
}
function scheduleReceiptCheck(){
 const state=receiptRecovery;
 if(!state||pending!==state.original)return;
 clearTimeout(state.timer);
 state.lookupId=null;
 if(state.checks>receiptRecoveryDelays.length){
  receiptRecovery=null;setSaving(false);
  $('entryError').textContent='Receiving is still unconfirmed. Your input is retained. 收货仍未确认，已保留输入。';
  return;
 }
 if(document.hidden||navigator.onLine===false)return;
 state.timer=setTimeout(checkReceipt,receiptRecoveryDelays[state.checks-1]);
}
function checkReceipt(){
 const state=receiptRecovery;
 if(!state||pending!==state.original||document.hidden||navigator.onLine===false||state.lookupId)return;
 clearTimeout(state.timer);
 state.lookupId=crypto.randomUUID();
 state.checks++;
 const {requestId,company,input}=state.original;
 state.timer=setTimeout(scheduleReceiptCheck,20000);
 parent.postMessage({type:'WAREHOUSE_RECEIPT_STATUS_REQUEST',company,requestId:state.lookupId,saveRequestId:requestId,poId:input.id},'*');
}
function recoverReceipt(original){
 if(pending!==original||receiptRecovery)return;
 receiptRecovery={original,lookupId:null,timer:null,checks:0};
 setSaving(true);$('entryError').textContent=receiptConfirming;
 checkReceipt();
}
window.addEventListener('online',checkReceipt);
document.addEventListener('visibilitychange',checkReceipt);
function save(){if(entryReadOnly||saving||receiptPhotoReading||selected.lines.every(line=>line.receivingStoppedWaiting))return;if(!pending){const changes=[];for(const section of $('entryLines').querySelectorAll('[data-line]')){const index=Number(section.dataset.line);if(!receiptEditable(index))continue;const line=selected.lines[index],value=field=>section.querySelector(`[data-field="${field}"]`),accepted=Number(value('accepted').value),rejected=Number(value('rejected').value),kind=value('kind').value,reason=value('reason').value.trim();if(line.receivingStoppedWaiting)continue;if(value('accepted').validity.badInput){entryError.textContent='Enter whole cartons. 请输入整数箱数。';return;}if(value('accepted').value.trim()===''){if(correcting||receiptPhotos.has(line.taskId)){entryError.textContent='Enter the receipt quantity. 请输入本次收货数量。';return;}continue;}if(correcting&&accepted===line.accepted&&rejected===line.rejected)continue;const photo=correcting?undefined:receiptPhotos.get(line.taskId);if(!Number.isSafeInteger(accepted)||!Number.isSafeInteger(rejected)||accepted<0||rejected<0||accepted>(correcting?line.planned:line.remaining)){$('entryError').textContent='Enter whole cartons within the task quantity. If more cartons arrived, contact Purchase immediately and enter no more than the task allows. 请输入任务范围内的整数箱数。若实际到货超量，请立即联系采购员，最多输入本任务允许的数量。';return;}if((correcting||accepted<line.remaining||rejected>0||kind!=='DELIVERY'||line.issue)&&!reason){$('entryError').textContent='请填写分批到货、少货、拒收或解决异常的原因。';return;}if(!correcting&&accepted<line.remaining&&kind==='DELIVERY'){$('entryError').textContent='尚未收齐，请选择分批送货或少货原因。';return;}changes.push({taskId:line.taskId,accepted,rejected,kind,reason,resolveIssue:value('resolveIssue')?.checked===true,...(photo?{photo}:{})});}if(!changes.length){$('entryError').textContent='请先填写本次收货数量或异常。';return;}pending={type:'WAREHOUSE_RECEIPT_REQUEST',company,requestId:crypto.randomUUID(),input:{action:correcting?'CORRECT':'RECEIVE',id:selected.id,version:selected.version,lines:changes}};}
 setSaving(true);$('entryError').textContent='';
 const original=pending;
 setTimeout(()=>{if(saving&&pending===original)recoverReceipt(original);},30000);
 parent.postMessage(original,'*');}
window.addEventListener('message',event=>{if(event.source!==parent)return;const message=event.data||{};if(message.type==='WAREHOUSE_LOGIN_RESULT'){if(message.ok)request();return;}if(message.company!==company)return;
 if(message.type==='WAREHOUSE_ORDERS_RESULT'&&message.requestId===readRequest){clearTimeout(readTimer);$('refresh').disabled=false;if(!message.ok){const error=message.error||'Data could not be read. 资料读取失败。',loginRequired=/^Please sign in with your approved Master staff account\./.test(error);$('login').hidden=!loginRequired;if(!staffConfirmed)$('staff').textContent=loginRequired?'Sign in required 请登录':'Access or data unavailable 权限或资料待确认';$('refresh').hidden=loginRequired||/access denied|not authorized|no access/i.test(error);notice(error,true);return;}const result=message.result;if(result?.company!==company||!Array.isArray(result.orders)){$('refresh').hidden=false;notice('收货数据不完整，请重试。',true);return;}rows=result.orders;deliveryTasks=Array.isArray(result.deliveryTasks)?result.deliveryTasks:[];customerLines=Array.isArray(result.customerLines)?result.customerLines:[];const selectedCustomer=$('customer').value,customers=new Map(customerLines.map(row=>[row.customerId,row.customerName]));$('customer').innerHTML='<option value="">All Customers 全部客户</option>'+[...customers].map(([id,name])=>'<option value="'+esc(id)+'">'+esc(name)+'</option>').join('');$('customer').value=customers.has(selectedCustomer)?selectedCustomer:'';staffConfirmed=Boolean(result.staff?.staffName);$('staff').textContent=result.staff?.staffName||'';$('readAt').textContent='Master CMS · '+timestamp(result.readAt);const chosen=$('supplier').value,suppliers=new Map(rows.map(row=>[row.supplierId,row.supplierShortName||row.supplierName]));$('supplier').innerHTML='<option value="">All Suppliers 全部供应商</option>'+[...suppliers].map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');$('supplier').value=suppliers.has(chosen)?chosen:'';$('login').hidden=Boolean(result.staff?.staffName);notice('');render();}
 if(message.type==='WAREHOUSE_RECEIPT_STATUS_RESULT'&&receiptRecovery?.lookupId===message.requestId&&receiptRecovery){
  const result=message.result;
  if(message.ok&&result?.ok===true&&result.company===pending.company&&result.requestId===pending.requestId&&result.poId===pending.input.id)finishReceipt();
  else scheduleReceiptCheck();
  return;
 }
 if(message.type==='WAREHOUSE_RECEIPT_RESULT'&&pending?.requestId===message.requestId){
  if(message.ok&&message.result?.ok===true){finishReceipt();return;}
  if(message.result?.retryable===false){
   clearTimeout(receiptRecovery?.timer);receiptRecovery=null;pending=null;setSaving(false);
   $('entryError').textContent=message.result.error||message.error||'Receiving could not be saved. 收货未保存。';
   return;
  }
  recoverReceipt(pending);
 }
});
function close(){if(saving||receiptPhotoReading)return;if(pending){$('entryError').textContent='这次保存尚未确认，请先重试以免重复登记。';return;}$('entry').close();}
if(window.departmentMessages)window.departmentMessages.onIssue=issue=>{if(saving)return false;if(issue.kind==='STOCK'){document.querySelector('[data-view="issues"]').click();return view==='issues';}if(!rows.some(r=>r.id===issue.poId))return false;openEntry(issue.poId);return true;};
function receiptHints(){
 $('entryLines').querySelectorAll('[data-line]').forEach(section=>{
  const index=Number(section.dataset.line);if(!receiptEditable(index))return;const line=selected.lines[index],field=name=>section.querySelector('[data-field="'+name+'"]'),input=field('accepted'),accepted=Number(input.value),waiting=Math.max(0,line.remaining-accepted);
  section.querySelector('[data-waiting]').textContent=correcting?Math.max(0,line.planned-accepted):waiting;
  section.querySelector('[data-rejected-label]').hidden=!correcting;
  const select=field('kind'),reason=field('reason'),blank=input.value.trim()==='',over=!blank&&accepted>(correcting?line.planned:line.remaining);const needsReason=!blank&&!over&&waiting>0;section.querySelector('.receipt-reason').hidden=!correcting&&!needsReason;select.hidden=correcting||!needsReason;select.required=!select.hidden;input.setAttribute('aria-invalid',String(over));receiptPhotoLocks(section);section.querySelector('[data-reason-label]').hidden=select.hidden;
  const warning='More than the task quantity. Contact Purchase and enter at most '+input.max+' CTN. 超过任务箱数，请联系采购并输入不超过 '+input.max+' 箱。';
  if(over){section.dataset.receiptWarning=warning;}
  else delete section.dataset.receiptWarning;
  if(correcting){reason.hidden=false;return;}
  reason.hidden=true;
  if(blank||over){field('rejected').value=0;const resolve=field('resolveIssue');if(resolve)resolve.checked=false;return;}
  if(waiting===0){select.value='DELIVERY';reason.value=line.issue?'Balance delivery completed 补货收齐':'';}
  else{reason.value=select.value==='DELIVERY'?'':select.selectedOptions[0].textContent;}
  field('rejected').value=waiting>0&&['DAMAGED','WRONG'].includes(select.value)?waiting:0;
  const resolve=field('resolveIssue');if(resolve)resolve.checked=waiting===0;
 });
 const excess=$('entryLines').querySelector('[data-receipt-warning]');
 const warning=$('entryWarning');
 if(excess){warning.dataset.excess='1';warning.textContent=excess.dataset.receiptWarning;}
 else if(warning.dataset.excess){delete warning.dataset.excess;warning.textContent=correcting?'Correct total 更正累计数量 · Reason required 必须填写原因':'';}
 const localErrors=['请填写分批到货、少货、拒收或解决异常的原因。','尚未收齐，请选择分批送货或少货原因。'];
 if(!pending&&!saving&&!correcting&&localErrors.includes($('entryError').textContent)&&[...$('entryLines').querySelectorAll('[data-line]')].every(section=>{
  const index=Number(section.dataset.line);if(!receiptEditable(index))return true;const line=selected.lines[index];
  const field=name=>section.querySelector('[data-field="'+name+'"]'),accepted=Number(field('accepted').value),rejected=Number(field('rejected').value),kind=field('kind').value;
  if(!Number.isSafeInteger(accepted)||!Number.isSafeInteger(rejected)||accepted<0||rejected<0||accepted>line.remaining)return false;
  if(field('accepted').value.trim()==='')return true;
  return !((accepted<line.remaining||rejected>0||kind!=='DELIVERY'||line.issue)&&!field('reason').value.trim())&&!(accepted<line.remaining&&kind==='DELIVERY');
 }))$('entryError').textContent='';
}
$('entryLines').addEventListener('focusin',event=>{const field=event.target;if(!field.matches('input[type="number"][data-field]')||field.disabled||field.readOnly)return;if(!correcting&&field.dataset.field==='accepted'&&field.value==='0'){field.select();return;}field.dataset.beforeFocus=field.value;field.value='';});
$('entryLines').addEventListener('focusout',event=>{const field=event.target;if(!field.matches('input[type="number"][data-field]'))return;if(field.value===''&&!field.validity.badInput&&Number(field.dataset.beforeFocus)>0)field.value=field.dataset.beforeFocus;delete field.dataset.beforeFocus;receiptHints();});
$('entryLines').addEventListener('keydown',event=>{
      if((event.key==='ArrowUp'||event.key==='ArrowDown')&&event.target.matches('.receipt-quantities input[type="number"]'))event.preventDefault();
    });
    $('entryLines').addEventListener('input',receiptHints);$('entryLines').addEventListener('change',receiptHints);
$('entryLines').addEventListener('change',selectReceiptPhoto);
$('entryLines').addEventListener('click',removeReceiptPhoto);
$('entryLines').addEventListener('click',zoomReceiptPhoto);
$('receiptPhotoViewer').addEventListener('keydown',event=>{
 if(event.key!=='Escape')return;
 event.preventDefault();
 $('receiptPhotoViewer').close();
});
$('receiptPhotoViewer').addEventListener('close',()=>$('receiptPhotoImage').removeAttribute('src'));
$('entryLines').addEventListener('click',chooseReceiptAction);
window.addEventListener('beforeunload',event=>{if(receiptPhotoReading||pending?.input.lines.some(line=>line.photo)){event.preventDefault();event.returnValue='';}});
$('closeEntry').onclick=close;$('cancelEntry').onclick=close;$('entry').addEventListener('cancel',event=>{event.preventDefault();close();});$('saveReceipt').onclick=save;$('refresh').onclick=request;$('login').onclick=()=>parent.postMessage({type:'WAREHOUSE_LOGIN_REQUEST'},'*');$('search').oninput=render;$('supplier').onchange=render;
 $('receivingProgress').onclick=()=>{receivingFilter='progress';window.warehouseWorkroom?.resetFilter();render();};
 $('receivingComplete').onclick=()=>{receivingFilter='complete';window.warehouseWorkroom?.resetFilter();render();};$('customer').onchange=render;$('month').value=month(new Date());$('month').onchange=render;
$('company').onchange=()=>{if(window.masterStockExceptions?.hasDraft()){ $('company').value=company; notice('Save or go back in Stock Issues before switching company. 请先保存或返回库存异常列表。',true); return; }if(window.masterStockExceptions?.isBusy()||window.warehousePackingTab?.isBusy()||window.warehouseStockTab?.isBusy()||window.warehouseDispatch?.isBusy()||window.warehouseWorkroom?.isBusy()||$('entry').open||saving||pending){$('company').value=company;notice('请先完成或关闭发货窗口。',true);return;}company=$('company').value;receivingFilter='progress';rows=[];customerLines=[];deliveryTasks=[];window.warehouseWorkroom?.resetFilter();$('customer').value='';$('supplier').innerHTML='<option value="">All Suppliers 全部供应商</option>';render();request();};document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{if(window.masterStockExceptions?.isBusy()||window.warehousePackingTab?.isBusy()||window.warehouseStockTab?.isBusy()||window.warehouseDispatch?.isBusy()||window.warehouseWorkroom?.isBusy()||$('entry').open||saving||pending){notice('请先完成或关闭发货窗口。',true);return;}const leavingStock=view==='stock';view=button.dataset.view;if(view==='customers')window.warehousePackingTab?.openActive();window.warehouseWorkroom?.resetFilter();document.querySelectorAll('[data-view]').forEach(item=>item.classList.toggle('active',item===button));$('month').hidden=view!=='history';$('customer').hidden=true;$('customerQty').hidden=true;$('title').textContent=view==='dispatch'?'Customer Dispatch 客户发货':view==='customers'?'Delivery Tasks 发货任务':view==='history'?'Receiving History 收货历史':'Incoming Tasks 入库任务';render();if(view==='issues'||leavingStock&&view!=='stock')request();});render();request();
function refreshSplitTasks(refreshReceiving=false){if((view==='customers'||refreshReceiving&&view==='receiving')&&!document.hidden&&!saving&&!pending&&!$('refresh').disabled&&$('staff').textContent&&!document.querySelector('dialog[open]')&&!window.warehousePackingTab?.isBusy()&&!window.warehouseDispatch?.isBusy()&&!window.warehouseWorkroom?.isBusy())request(true);}
setInterval(refreshSplitTasks,10000);window.addEventListener('focus',()=>refreshSplitTasks(true));document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSplitTasks(true);});
window.addEventListener('customer-shipment-plan-changed',event=>{if(event.detail.company===company)refreshSplitTasks();});
const historyMenu=document.querySelector('.wh-history-menu');
document.querySelector('[data-delivery-history]').onclick=()=>{if(saving||pending||document.querySelector('dialog[open]')||window.masterStockExceptions?.isBusy()||window.warehousePackingTab?.isBusy())return;document.querySelector('nav [data-view="customers"]').click();window.warehousePackingTab?.openHistory();historyMenu.open=false;};
document.querySelector('nav [data-view="history"]').addEventListener('click',()=>{historyMenu.open=false;});
document.addEventListener('click',event=>{
  if(historyMenu.open&&!historyMenu.contains(event.target))historyMenu.open=false;
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!historyMenu.open||document.querySelector('dialog[open]'))return;
  historyMenu.open=false;
  if(historyMenu.contains(event.target))historyMenu.querySelector('summary').focus();
});
})();
