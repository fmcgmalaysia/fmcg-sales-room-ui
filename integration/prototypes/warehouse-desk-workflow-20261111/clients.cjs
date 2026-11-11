const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const supportSplitBuild = '20261111-support-split-quantity-v1';

function one(source, before, after) {
  assert.equal(source.split(before).length, 2, before.slice(0, 160));
  return source.replace(before, () => after);
}

function purchaseAllocation(source) {
  source = one(source, "+' · '+(root.transactionCurrency||'')", '');
  source = one(source,
    `position===9?action:'<span class="allocation-readonly">'+esc(value)+'</span>'`,
    `position===9?action:'<span class="allocation-readonly">'+esc(value)+'</span>'+(position===2&&row.mode==='FOC'?'<small class="allocation-foc-caption">» '+esc(row.paid)+' FOC '+esc(row.free)+'</small>':'')`);
  source = one(source,
    `+(row.mode==='FOC'?'<tr class="allocation-detail"><td></td><td colspan="13">付费 CTN '+esc(row.paid)+' ＋ 赠送 CTN '+esc(row.free)+'</td></tr>':'')`,
    '');
  source = one(source, 'const row=candidates[0];if(!row){state.running=false;',
    'const row=candidates[0];if(!row){const closeAfterSave=!state.saveKey;state.running=false;');
  source = one(source,
    "state.reopen=false;api.cache();if(api.modal().classList.contains('supplier-allocation-dialog'))render();api.status(state.issue);return;}",
    "state.reopen=false;api.cache();if(closeAfterSave&&api.modal().open)api.modal().close();else if(api.modal().classList.contains('supplier-allocation-dialog'))render();api.status(state.issue);return;}");
  return one(source,
    "+(state.rows.some(row=>receiptQuantityLocked(workspace().tasks.find(item=>item.id===row.taskId)))?'<p class=\"allocation-lock-notice\">🔒 Qty locked after receipt 收货后采购数量已锁定</p>':'')",
    '');
}

function receivingApp(source) {
  // Row numbering uses display order, without changing task identity.
  source = one(source, '<div class="receipt-product">${receiptThumbnail(line)}',
    '<span class="receipt-line-number">'+ '${String(index+1).padStart(2,\'0\')}' +'</span><div class="receipt-product">${receiptThumbnail(line)}');
  source = one(source, 'Waiting 待收</span><b data-waiting>', 'Pending 待收</span><b data-waiting>');
  source = source.replaceAll('Waiting reason','Pending reason');
  source = one(source, 'class="receipt-camera" title="Camera 拍照">拍照<input',
    'class="receipt-camera" title="Camera 拍照"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/></svg><input');
  source = source.replace(/(data-field="(?:accepted|rejected)"[^>]+type="number")/g, '$1 inputmode="numeric"');
  source = one(source, "$('entryLines').addEventListener('input',receiptHints);",
    `$('entryLines').addEventListener('keydown',event=>{
      if((event.key==='ArrowUp'||event.key==='ArrowDown')&&event.target.matches('.receipt-quantities input[type="number"]'))event.preventDefault();
    });
    $('entryLines').addEventListener('input',receiptHints);`);
  return source;
}

function receivingIndex(source, build) {
  source = one(source, '<div class="receipt-columns" aria-hidden="true"><span>Product',
    '<div class="receipt-columns" aria-hidden="true"><span>No.</span><span>Product');
  source = one(source, '<span>Waiting <small>待收</small></span>', '<span>Pending <small>待收</small></span>');
  source=one(source,'<button data-view="history">History</button>','<details class="wh-history-menu"><summary>History</summary><div><button data-view="history">Incoming 入库历史</button><button data-delivery-history>Delivery 发货历史</button></div></details>');
  return versions(source,build);
}

function receivingWorkroom(source) {
  const oldMarkup = `<td data-label="D.O."><button class="wh-square '+docTone+'" data-wh-do="'+esc(r.id)+'" aria-label="View supplier delivery note">DO</button></td>`;
  const nextMarkup = `<td data-label="D.O."><span class="wh-square wh-do-status '+docTone+'" role="img" aria-label="'+esc(({MISSING:'Supplier D.O. pending upload',AVAILABLE:'Supplier D.O. uploaded',PROBLEM:'Supplier D.O. needs review'})[r.documentState]||'Supplier D.O. status unavailable')+'">DO</span></td>`;
  source = one(source, oldMarkup, nextMarkup);
  source=one(source,
    "document.querySelectorAll('[data-wh-review]').forEach(b=>b.onclick=()=>review(b.dataset.whReview));document.querySelectorAll('[data-wh-do]').forEach(b=>b.onclick=()=>documents(b.dataset.whDo));",
    "document.querySelectorAll('[data-wh-review]').forEach(b=>b.onclick=()=>review(b.dataset.whReview));");
  const start=source.indexOf('function documents(id){'),end=source.indexOf('\nfunction evidence()',start);
  assert.ok(start>=0&&end>start);return source.slice(0,start)+source.slice(end);
}

function versions(source,build){
  return source.replace(/(<meta name="build(?:-version)?" content=")[^"]+/,(_,prefix)=>prefix+build).replaceAll(/((?:["']|\/)(?:supplier-allocation\.js|workroom\.js|workroom\.css|desk-delivery\.js|desk-delivery\.css|style\.css|app\.js))\?v=[^"'<>\s]+/g,(_,file)=>file+'?v='+build);
}
function deliveryClient(source){
  const start=source.indexOf(' function createWarehouse(sender=sendParent){'),end=source.indexOf(' function decoratePurchase(){',start);
  assert.ok(start>=0&&end>start);source=source.slice(0,start)+fs.readFileSync(path.join(__dirname,'warehouse-client.js'),'utf8')+'\n'+source.slice(end);
  source=one(source,'Number.isSafeInteger(line.allocQty)&&Number.isSafeInteger(line.loadedQty)&&line.allocQty>line.loadedQty).map(line=>({taskId:line.taskId,quantity:line.allocQty-line.loadedQty}))','Number.isSafeInteger(line.orderQty)&&Number.isSafeInteger(line.loadedQty)&&line.orderQty>line.loadedQty).map(line=>({taskId:line.taskId,quantity:line.orderQty-line.loadedQty}))');
  return one(source,'Only allocated cartons in this Desk will be authorized. 仅授权本 Desk 已分配货物。','All Desk tasks will be visible. Loading requires allocated, received stock. 整张任务先开放，配货到货后才可装货。');
}
function deliveryNavigation(source){
  source=one(source,"view=button.dataset.view;window.warehouseWorkroom?.resetFilter();","view=button.dataset.view;if(view==='customers')window.warehousePackingTab?.openActive();window.warehouseWorkroom?.resetFilter();");
  const end=source.lastIndexOf('})();');assert.ok(end>0);
  return source.slice(0,end)+`document.querySelector('[data-delivery-history]').onclick=()=>{if(saving||pending||document.querySelector('dialog[open]')||window.warehousePackingTab?.isBusy())return;document.querySelector('nav [data-view="customers"]').click();window.warehousePackingTab?.openHistory();document.querySelector('.wh-history-menu').open=false;};\ndocument.querySelector('nav [data-view="history"]').addEventListener('click',()=>{document.querySelector('.wh-history-menu').open=false;});\n`+source.slice(end);
}
function supportSplit(source){
  const start=source.indexOf('  function openDeskSplit(taskId){'),end=source.indexOf('  async function saveDeskChange(',start);assert.ok(start>=0&&end>start);
  return source.slice(0,start)+fs.readFileSync(path.join(__dirname,'support-split.js'),'utf8')+source.slice(end);
}
function customerExpiry(source,kind,build){
  const className=kind==='SALES'?'sales-item-expiry':'track-expiry-value';
  const placeholder=kind==='SALES'?'<div class="num sales-item-expiry">-</div>':'<div class="num track-expiry-value">-</div>';
  const dates="(line.expiryDates||[]).map(value=>esc(value.slice(8)+'-'+value.slice(5,7)+'-'+value.slice(2,4))).join('<br>')||'—'";
  const value=kind==='SALES'?"'+("+dates+")+'":'${'+dates+'}';
  return one(source,placeholder,'<div class="num '+className+'">'+value+'</div>').replace(/(<meta name="build-version" content=")[^"]+/,(_,prefix)=>prefix+build);
}

module.exports = {
  one,
  supportSplitBuild,
  transforms: {
    'purchase-live/supplier-allocation.js': purchaseAllocation,
    'purchase-live/index.html': versions,
    'purchase-live/style.css': source => source + '\n' + fs.readFileSync(path.join(__dirname, 'purchase-layout.css'), 'utf8'),
    'warehouse-room/app.js': source=>deliveryNavigation(receivingApp(source)),
    'warehouse-room/index.html': receivingIndex,
    'warehouse-room/workroom.js': receivingWorkroom,
    'warehouse-room/workroom.css': source => source + '\n' + fs.readFileSync(path.join(__dirname, 'receiving-layout.css'), 'utf8'),
    'master-shared/desk-delivery.js':deliveryClient,
    'master-shared/desk-delivery.css':source=>source+'\n'+fs.readFileSync(path.join(__dirname,'delivery-layout.css'),'utf8'),
    'support-room/workroom.js':supportSplit,
    'support-room/workroom.html':(source,build)=>versions(source,build)
      .replace('name="build" content="'+build+'"','name="build" content="'+supportSplitBuild+'"')
      .replace('href="workroom.css?v='+build+'"','href="workroom.css?v='+supportSplitBuild+'"')
      .replace('src="workroom.js?v='+build+'"','src="workroom.js?v='+supportSplitBuild+'"'),
    'support-room/workroom.css':source=>source+`
.desk-split-dialog .split-quantities{margin-top:12px}
.desk-split-dialog .split-quantity-row{display:grid;grid-template-columns:minmax(45px,1fr) repeat(2,minmax(0,1.5fr));align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #dce8f2}
.desk-split-dialog .split-quantity-row>:not(:first-child){justify-self:end;text-align:right}
.desk-split-dialog .split-quantity-head{font-size:12px;font-weight:600}
.desk-split-dialog :is(.split-quantity-head,.split-pending) small{display:block;color:#536c85;font-size:11px;font-weight:400}
.desk-split-dialog .split-quantity-row input{box-sizing:border-box;max-width:100%}
.desk-split-dialog .split-pending{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;padding:9px 10px;background:#edf4fa;border-radius:4px}
.desk-split-dialog #split-status{margin:8px 0 0}
.desk-split-dialog #split-status:empty{display:none}
`,
    'index.html':(source,build)=>customerExpiry(source,'SALES',build),
    'buyer-room.html':(source,build)=>customerExpiry(source,'BUYER',build)
  }
};
