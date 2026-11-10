const assert = require('node:assert/strict');
const build = '20261111-warehouse-receipt-evidence-v1';

function once(source, before, after) {
  assert.equal(source.split(before).length, 2, `Expected one anchor: ${before.slice(0, 100)}`);
  return source.replace(before, () => after);
}

function patchApp(source) {
  source = once(source, 'timestamp(row.createdAt,true)', "timestamp(row.createdAt,(row.workroomStatus||row.status)!=='COMPLETE')");
  source = once(source, "$('entryPo').textContent=selected.number+' · '+selected.customerName;", "$('entryPo').textContent=selected.number;receiptPhotos.clear();");
  source = once(source, "${selected.customers?.length>1?'<span class=\"product-code receipt-customer\">'+esc(line.customerName||line.customerId||'')+'</span>':''}<span class=\"product-code\">", '<div class="receipt-product">${receiptThumbnail(line)}<div><span class="product-code">');
  source = once(source, '${esc(line.packing)}</span><div class="receipt-quantities">', '${esc(line.packing)}</span>${line.accepted?\'<small class="receipt-prior">Previously received 已收：\'+line.accepted+\'</small>\':\'\'}</div></div><div class="receipt-quantities">');
  source = once(source, '${line.accepted?\'<small class="receipt-prior">Previously received 已收：\'+line.accepted+\'</small>\':\'\'}<div class="receipt-reason">', '${receiptPhotoField(line)}<div class="receipt-reason">');
  source = once(source, '${esc(line.reason)}</p>`', '${esc(line.reason)}${receiptPhotoLink(line.photo)}</p>`');
  source = once(source, 'function openEntry(id){', receiptControls + '\nfunction openEntry(id){');
  source = once(source, "section.querySelector('.receipt-reason').hidden=true;", "section.querySelector('.receipt-reason').hidden=true;section.querySelector('.receipt-evidence').hidden=true;");
  source = once(source, "$('saveReceipt').disabled=value;", "$('saveReceipt').disabled=value||receiptPhotoReading;");
  source = once(source, "$('entryLines').querySelectorAll('input,select').forEach(element=>element.disabled=value||!!pending);", "$('entryLines').querySelectorAll('input,select,[data-receipt-remove]').forEach(element=>element.disabled=value||!!pending);receiptPhotoLocks();");
  source = once(source, 'if(saving||selected.lines.every', 'if(saving||receiptPhotoReading||selected.lines.every');
  source = once(source, "if(!correcting&&!accepted&&!rejected&&kind==='DELIVERY')continue;", "const photo=correcting?undefined:receiptPhotos.get(line.taskId);if(!correcting&&!accepted&&!rejected&&kind==='DELIVERY'){if(photo){$('entryError').textContent='Enter the receipt quantity or shortage for the row with a photo. 请填写该照片对应的收货数量或少货原因。';return;}continue;}");
  source = once(source, "resolveIssue:value('resolveIssue')?.checked===true});", "resolveIssue:value('resolveIssue')?.checked===true,...(photo?{photo}:{})});");
  source = once(source, "if(saving)return;if(pending){$('entryError')", "if(saving||receiptPhotoReading)return;if(pending){$('entryError')");
  source = once(source, "const select=field('kind'),reason=field('reason');select.hidden=correcting||waiting===0;", "const select=field('kind'),reason=field('reason');section.querySelector('.receipt-reason').hidden=!correcting&&waiting===0;select.hidden=correcting||waiting===0;select.required=!select.hidden;receiptPhotoLocks(section);");
  source = once(source, "$('entryLines').addEventListener('change',receiptHints);", "$('entryLines').addEventListener('change',receiptHints);\n$('entryLines').addEventListener('change',selectReceiptPhoto);\n$('entryLines').addEventListener('click',removeReceiptPhoto);\nwindow.addEventListener('beforeunload',event=>{if(receiptPhotoReading||pending?.input.lines.some(line=>line.photo)){event.preventDefault();event.returnValue='';}});");
  return patchReceiptLocks(source);
}

function patchReceiptLocks(source) {
  const start=source.indexOf(" $('entryLines').innerHTML=selected.lines.map");
  const end=source.indexOf("\n $('entryWarning').textContent='';$('entryHistory')",start);
  assert.ok(start>0&&end>start,'Expected receipt rows and history');
  const template=source.slice(start,end);
  let rows=once(template," $('entryLines').innerHTML=selected.lines.map((line,index)=>`<section", 'function receiptRowMarkup(line,index){const editable=receiptEditable(index);return `<section');
  rows=once(rows,'${line.accepted?\'<small class="receipt-prior">Previously received 已收：\'+line.accepted+\'</small>\':\'\'}', '${editable&&!correcting&&line.accepted?\'<small class="receipt-prior">Previously received 已收：\'+line.accepted+\'</small>\':\'\'}${receiptRowActions(line,index)}');
  rows=once(rows,'<label>This Receipt 本次收货<input data-field="accepted" aria-label="Accepted ${esc(line.barcode)}" type="number" min="0" max="${line.remaining}" step="1" value="0"></label>', '${editable?`<label>${correcting?\'Correct Total 更正累计\':\'This Receipt 本次收货\'}<input data-field="accepted" aria-label="Accepted ${esc(line.barcode)}" type="number" min="0" max="${correcting?line.planned:line.remaining}" step="1" value="${correcting?line.accepted:0}"></label>`:`<div class="readonly">Received 已收<b>${line.accepted}</b></div>`}');
  rows=once(rows,'<label data-rejected-label hidden>', '${editable?`<label data-rejected-label hidden>');
  rows=once(rows,'max="9999" step="1" value="0"></label></div>${receiptPhotoField(line)}<div class="receipt-reason">', 'max="9999" step="1" value="${correcting?line.rejected:0}"></label>`:\'\'}</div>${editable&&!correcting?receiptPhotoField(line):\'\'}${editable?`<div class="receipt-reason">');
  rows=once(rows,'<select data-field="kind" aria-label="Waiting reason ${esc(line.barcode)}">', '<select data-field="kind" aria-label="Waiting reason ${esc(line.barcode)}" ${correcting?\'disabled\':\'\'}>');
  rows=once(rows,'</div>${line.issue?\'<label class="resolve" hidden><input type="checkbox" data-field="resolveIssue">Resolve Issue 解决原收货异常</label>\':\'\'}</section>`).join(\'\');', '</div>${line.issue?\'<label class="resolve" hidden><input type="checkbox" data-field="resolveIssue">Resolve Issue 解决原收货异常</label>\':\'\'}`:\'\'}${line.receivingStoppedWaiting&&!entryReadOnly?\'<p class="receipt-stopped-note">Purchase has confirmed: do not wait for the remaining goods.<br>采购员已明确指示：无需等待剩余未到的货。</p>\':\'\'}</section>`;}');
  source=once(source,template,' renderReceiptRows();');
  source=once(source,'function openEntry(id){selected=rows.find(row=>row.id===id);pending=null;correcting=false;$(\'receiptDetails\').open=false;$(\'correctReceipt\').checked=false;$(\'correctReceipt\').disabled=selected.correctionAllowed===false||selected.lines.every(line=>line.receivingStoppedWaiting);$(\'correctionTools\').hidden=!selected.history.length;',receiptLockControls+'\n'+rows+'\nfunction renderReceiptRows(){\n $(\'entryLines\').innerHTML=selected.lines.map(receiptRowMarkup).join(\'\');\n setSaving(false);receiptHints();\n}\nfunction openEntry(id){const order=rows.find(row=>row.id===id);if(!order||pending||saving||receiptPhotoReading||$(\'entry\').open)return;selected=order;correcting=false;correctionLine=-1;$(\'receiptDetails\').open=false;\n entryReadOnly=view===\'history\'||view===\'receiving\'&&receivingFilter===\'complete\'||selected.status===\'COMPLETE\'||selected.workroomStatus===\'COMPLETE\';\n savedReceiptTasks=new Set(selected.history.flatMap(event=>event.lines.map(line=>line.taskId)));receiptRows.clear();\n if(!entryReadOnly)selected.lines.forEach((line,index)=>{if(!hasSavedReceipt(line)&&line.remaining>0&&!line.receivingStoppedWaiting)receiptRows.add(index);});');
  source=once(source,"$('saveReceipt').disabled=selected.status==='COMPLETE';receiptHints();$('entry').showModal();", "$('cancelEntry').textContent=entryReadOnly?'Close 关闭':'Cancel';$('entry').showModal();");
  const lockStart=source.indexOf('function lockStoppedReceipts(){'),lockEnd=source.indexOf('function save(){',lockStart);
  assert.ok(lockStart>0&&lockEnd>lockStart);
  source=once(source,source.slice(lockStart,lockEnd),`function setSaving(value){
 saving=value;
 const busy=value||receiptPhotoReading;
 const button=$('saveReceipt');
 button.hidden=entryReadOnly||(!pending&&!$('entryLines').querySelector('[data-field="accepted"]'));
 button.disabled=busy||button.hidden;
 button.textContent=value?'Saving…':pending?'Retry':'Confirm';
 $('entryLines').querySelectorAll('input,select,[data-receipt-remove],[data-receipt-action]').forEach(element=>element.disabled=busy||Boolean(pending)||(correcting&&element.dataset.field==='kind'));
 receiptPhotoLocks();$('cancelEntry').disabled=busy;$('closeEntry').disabled=busy;
}
`);
  source=once(source,'if(saving||receiptPhotoReading||selected.lines.every','if(entryReadOnly||saving||receiptPhotoReading||selected.lines.every');
  source=once(source,"const line=selected.lines[Number(section.dataset.line)],value=field=>", "const index=Number(section.dataset.line);if(!receiptEditable(index))continue;const line=selected.lines[index],value=field=>");
  source=once(source,"const line=selected.lines[Number(section.dataset.line)],field=name=>", "const index=Number(section.dataset.line);if(!receiptEditable(index))return;const line=selected.lines[index],field=name=>");
  source=once(source,"const line=selected.lines[Number(section.dataset.line)];if(line.receivingStoppedWaiting)return true;", "const index=Number(section.dataset.line);if(!receiptEditable(index))return true;const line=selected.lines[index];");
  source=once(source,' lockStoppedReceipts();\n const localErrors=', ' const localErrors=');
  source=once(source,"const field=item.querySelector('[data-receipt-photo]'),hidden=", "const field=item.querySelector('[data-receipt-photo]');if(!field)continue;const hidden=");
  source=once(source,"receiptPhotoReading=true;receiptPhotoLocks();$('saveReceipt').disabled=true;$('correctReceipt').disabled=true;", "receiptPhotoReading=true;setSaving(false);");
  source=once(source,"$('entryLines').addEventListener('click',removeReceiptPhoto);", "$('entryLines').addEventListener('click',removeReceiptPhoto);\n$('entryLines').addEventListener('click',chooseReceiptAction);");
  const toggleStart=source.indexOf("$('correctReceipt').onchange="),toggleEnd=source.indexOf("$('closeEntry').onclick=close;",toggleStart);
  assert.ok(toggleStart>0&&toggleEnd>toggleStart);
  return once(source,source.slice(toggleStart,toggleEnd),'');
}

const receiptLockControls=String.raw`let entryReadOnly=false,correctionLine=-1,savedReceiptTasks=new Set();
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
 const hasDraft=receiptPhotos.size||[...$('entryLines').querySelectorAll('[data-field="accepted"],[data-field="rejected"],[data-field="kind"]')].some(input=>input.dataset.field==='kind'?input.value!=='DELIVERY':Number(input.value)!==0||input.validity.badInput);
 if(hasDraft){$('entryError').textContent='Save or cancel this receipt before correcting a saved quantity. 请先保存或取消本次收货，再更正已收数量。';return;}
 correcting=true;correctionLine=index;
 $('entryError').textContent='';$('entryWarning').textContent='Correct total 更正累计数量 · Reason required 必须填写原因';
 renderReceiptRows();
}`;

const receiptControls = String.raw`const receiptPhotos=new Map();
let receiptPhotoReading=false;
function receiptThumbnail(line){
 const url=/^https:\/\/[^\s<>"']+$/i.test(line.productImageUrl||'')?line.productImageUrl:'';
 return url?'<img class="receipt-thumb" src="'+esc(url)+'" alt="" width="54" height="54">':'<span class="receipt-thumb" aria-hidden="true">'+icon('box')+'</span>';
}
function receiptPhotoField(line){return '<div class="receipt-evidence"><label class="receipt-camera">Camera 拍照<input type="file" data-receipt-photo capture="environment" accept="image/*" aria-label="Photo '+esc(line.barcode)+'"></label><span data-receipt-preview></span></div>';}
function receiptPhotoLink(photo){return /^[A-Za-z0-9_-]{10,200}$/.test(photo?.fileId||'')?' · <a href="https://drive.google.com/file/d/'+encodeURIComponent(photo.fileId)+'/view" target="_blank" rel="noopener">View photo 查看照片</a>':'';}
function receiptPhotoLocks(section){
 const sections=section?[section]:$('entryLines').querySelectorAll('[data-line]');
 for(const item of sections){const field=item.querySelector('[data-receipt-photo]'),hidden=correcting||selected.status==='COMPLETE'||selected.lines[Number(item.dataset.line)].receivingStoppedWaiting;item.querySelector('.receipt-evidence').hidden=hidden;field.disabled=hidden||saving||Boolean(pending)||receiptPhotoReading;}
}
function renderReceiptPhoto(section,line){
 const photo=receiptPhotos.get(line.taskId),preview=section.querySelector('[data-receipt-preview]');
 preview.innerHTML=photo?'<img src="data:image/jpeg;base64,'+photo.base64+'" alt="Receipt photo 收货照片"><button type="button" data-receipt-remove aria-label="Remove receipt photo">×</button>':'';
}
async function selectReceiptPhoto(event){
 const input=event.target;if(!input.matches('[data-receipt-photo]')||!input.files?.length||receiptPhotoReading||pending||saving)return;
 const section=input.closest('[data-line]'),line=selected.lines[Number(section.dataset.line)],file=input.files[0];
 input.value='';
 if(!receiptPhotos.has(line.taskId)&&receiptPhotos.size>=3){$('entryError').textContent='Up to three product photos per receipt. 每次收货最多三张商品照片。';return;}
 receiptPhotoReading=true;receiptPhotoLocks();$('saveReceipt').disabled=true;$('correctReceipt').disabled=true;$('entryError').textContent='';
 try{const photo=await window.warehouseWorkroom.preparePhoto(file);receiptPhotos.set(line.taskId,photo);renderReceiptPhoto(section,line);}
 catch(error){$('entryError').textContent=error.message;}
 finally{receiptPhotoReading=false;setSaving(false);}
}
function removeReceiptPhoto(event){
 const button=event.target.closest('[data-receipt-remove]');if(!button||pending||saving||receiptPhotoReading)return;
 const section=button.closest('[data-line]'),line=selected.lines[Number(section.dataset.line)];receiptPhotos.delete(line.taskId);renderReceiptPhoto(section,line);
}`;

function patchWorkroom(source) {
  source = once(source, "last=r.history.at(-1),date=r.workroomCompletedAt||last?.at||r.createdAt;", "last=r.history.findLast(event=>event.lines.some(line=>line.kind!=='CORRECTION'&&(line.accepted>line.beforeAccepted||line.rejected>line.beforeRejected)));\n  const docTone={MISSING:'orange',AVAILABLE:'blue',PROBLEM:'red'}[r.documentState]||'gray';");
  source = once(source, "'Status','D.O.'", "'Received','D.O.'");
  source = once(source, "<b>'+esc(relative(r.createdAt))+'</b><small>'+esc(stamp(r.createdAt))+'</small>", "'+(r.status==='COMPLETE'?'<b>'+esc(stamp(r.createdAt))+'</b>':'<b>'+esc(relative(r.createdAt))+'</b><small>'+esc(stamp(r.createdAt))+'</small>')+'<small>'+(r.createdBy?'by '+esc(r.createdBy):'—')+'</small>");
  source = once(source, "<td data-label=\"Status\"><span class=\"wh-state '+(issue?'red-text':r.status==='COMPLETE'?'blue-text':'orange-text')+'\">'+icon(issue?'issue':r.status==='COMPLETE'?'thumb':'box')+'<small>'+esc(stamp(date))+'</small></span></td>", "<td data-label=\"Received\">'+(last?'<b>'+(last.by?'By '+esc(last.by):'—')+'</b><small>'+esc(stamp(last.at))+'</small>':'—')+'</td>");
  source = once(source, "(r.documents?.some(d=>d.type==='DO'&&d.linked&&!d.superseded)?'blue':'gray')", 'docTone');
  return once(source, 'window.warehouseWorkroom={incoming,cards,delivery,hydrate,', 'window.warehouseWorkroom={incoming,cards,delivery,hydrate,preparePhoto:compress,');
}

function patchIndex(source) {
  source = once(source, '<summary>History · Correction 记录与更正</summary><label id="correctionTools" hidden><input type="checkbox" id="correctReceipt">Correct Total 更正累计收货</label>', '<summary>Receipt History 收货记录</summary>');
  source = once(source, 'name="build" content="20261103-warehouse-read-recovery-v1"', `name="build" content="${build}"`);
  for(const [file,old] of [['app.js','20261103-warehouse-read-recovery-v1'],['workroom.js','20261029-stock-loaded-v2'],['workroom.css','20261027-support-order-progress-v2']]){
    source = once(source, `${file}?v=${old}`, `${file}?v=${build}`);
  }
  return source;
}

function patchCss(source) {
  return source + `
#entry{width:min(1040px,calc(100vw - 24px));max-width:calc(100vw - 24px)}
#entry .receive-line{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,360px);align-items:center;gap:6px 18px;padding-block:10px}
#entry .receipt-product{display:flex;gap:10px;align-items:center;min-width:0}
#entry .receipt-thumb{width:54px;height:54px;flex:none;object-fit:contain;display:grid;place-items:center;background:#f2f6fa;border-radius:5px}
#entry .receipt-thumb svg{width:22px;height:22px;fill:none;stroke:#6b849e;stroke-width:1.5}
#entry .receipt-quantities{margin:0;gap:8px}
#entry .receipt-quantities .readonly{min-height:0}
#entry .receipt-quantities .readonly b{line-height:34px}
#entry .receipt-quantities input{height:34px}
#entry .receipt-evidence{display:flex;gap:8px;align-items:center;min-height:27px}
#entry .receipt-evidence[hidden],#entry .receipt-reason[hidden]{display:none!important}
#entry .receipt-camera{position:relative;display:inline-block;padding:4px 8px;border:1px solid #b9cbe0;border-radius:4px;color:#235890;font-size:11px;cursor:pointer}
#entry .receipt-camera input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}
#entry .receipt-camera:focus-within{outline:2px solid #2563eb}
#entry [data-receipt-preview]{display:flex;gap:4px;align-items:center}
#entry [data-receipt-preview] img{width:32px;height:26px;object-fit:cover;border-radius:4px}
#entry .receipt-reason{margin:0}
#entry .receipt-reason select{min-height:34px}
#entry .receipt-stopped-note{grid-column:1/-1}
#entry #saveReceipt[hidden]{display:none!important}
#entry .receipt-row-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:4px}
#entry .receipt-row-actions button{display:inline-flex;align-items:center;justify-content:center;min-height:24px;padding:2px 7px;border:1px solid #b9cbe0;border-radius:4px;background:#fff;color:#235890;font:600 11px var(--master-font,Arial,sans-serif);cursor:pointer}
#entry .receipt-row-actions button:disabled{opacity:.5;cursor:default}
#entry .receipt-pencil svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.6}
@media(max-width:690px){#entry .receive-line{grid-template-columns:minmax(0,1fr)}#entry .receipt-quantities{grid-row:auto}}
`;
}

function patchFinance(source) {
  return once(source, "<td><span class=\"acc-request-age\">'+esc(relativeDay(at,data?.readAt||new Date().toISOString()))+'</span><small>", "<td>'+(isClosed(row)?'':'<span class=\"acc-request-age\">'+esc(relativeDay(at,data?.readAt||new Date().toISOString()))+'</span>')+'<small>");
}

function patchPurchase(source) {
  return once(source, "<td class=\"po-created\"><b>'+esc(requestAge(at))+'</b><small>", "<td class=\"po-created\">'+(row.state==='HISTORY'||row.supplierAccount?.closed?'':'<b>'+esc(requestAge(at))+'</b>')+'<small>");
}

module.exports={build,patchApp,patchWorkroom,patchIndex,patchCss,patchFinance,patchPurchase};
