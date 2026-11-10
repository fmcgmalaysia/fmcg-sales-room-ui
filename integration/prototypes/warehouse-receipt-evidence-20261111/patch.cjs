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
  return source;
}

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
