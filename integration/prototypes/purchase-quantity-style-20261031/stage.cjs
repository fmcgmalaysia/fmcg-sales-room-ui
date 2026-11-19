'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const previous=require('../purchase-payment-message-20261031/stage.cjs'),root=path.resolve(__dirname,'../../..'),build='20261031-purchase-quantity-style-v1';
function once(s,a,b){assert.equal(s.split(a).length,2,'Quantity style hunk: '+a.slice(0,100));return s.replace(a,()=>b);}
const style=`
/* Quantity presentation uses the existing Purchase font and one19px capsule. */
#app .purchase-tasks.active-order-table .extra-stock-badge{background:transparent;padding:0;border:0;border-radius:0;line-height:18px}
#app .purchase-tasks.active-order-table.draft-column-layout :is(.received-quantity,.allocated-quantity)>span.quantity-reference.purchase-info-total,#app .purchase-tasks.active-order-table .dd-purchase-loaded .dd-status{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:19px;min-width:28px;padding:0 8px;border-radius:12px;font-family:var(--master-font);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;font-feature-settings:normal;line-height:19px;letter-spacing:normal;white-space:nowrap}
#app .purchase-tasks.active-order-table .dd-purchase-loaded .dd-status.dd-stable{background:#e8f1ff;color:#1652aa}
#app .purchase-tasks.active-order-table.draft-column-layout :is(.received-quantity,.allocated-quantity)>span.quantity-reference.purchase-info-total.purchase-quantity-zero{background:#fff0d8!important;color:#895000!important}
#app .purchase-tasks.active-order-table .purchase-receipt-date{font-family:var(--master-font);font-size:10px;font-weight:400;font-variant-numeric:normal;font-feature-settings:normal;letter-spacing:normal;word-spacing:normal;line-height:13px;color:#63758a}
#app .purchase-tasks.active-order-table .stock-source-icon{display:inline-block;flex:none;width:16px;height:16px;background:#2563eb;-webkit-mask:url('source-stock.png') center/contain no-repeat;mask:url('source-stock.png') center/contain no-repeat}
`;
let cached;
function plan(){
 if(cached)return cached;const baseline=new Map(previous.plan().assets),assets=new Map(baseline);
 let info=assets.get('purchase-live/task-info.js').toString();
 info=once(info,"    const value=split?m.receipts.map(row=>qty(row.received)).join(' + '):qty(m.received);","    const defaultZero=m.received===null&&!m.receipts.length&&m.group.every(row=>row.warehouse?.hasPhysicalReceipt!==true);\n    const value=defaultZero?'0':split?m.receipts.map(row=>qty(row.received)).join(' + '):qty(m.received);");
 info=once(info,'return {value,info,date:day};','return {value,info,date:day,defaultZero};');
 info=once(info,'    return {info:!m.consistent||outstanding,settled:',"    const defaultZero=m.allocated==null&&m.sources.length===0;\n    return {value:defaultZero?'0':qty(m.allocated),defaultZero,info:!m.consistent&&!defaultZero||outstanding,settled:");
 info=once(info,"if(receipt)receipt.textContent='RCV Qty'","if(receipt)receipt.textContent='Rcv Qty'");
 info=once(info,'if(receipt&&m.group.some(task=>task.po||task.warehouse?.hasPhysicalReceipt)){','if(receipt){');
 info=once(info,"const view=receiptView(m,row.dataset.draftHasSources==='true');","const view=receiptView(m,row.dataset.draftHasSources==='true');\n        receipt.dataset.purchaseQuantityEmpty=String(view.defaultZero);");
 info=once(info,"primary.textContent=view.value;primary.dataset.purchaseReceiptTotal=String(m.received);","primary.textContent=view.value;primary.dataset.purchaseReceiptTotal=String(m.received);primary.dataset.purchaseQuantityEmpty=String(view.defaultZero);primary.classList.toggle('purchase-quantity-zero',view.value==='0');");
 info=once(info,"value.className='quantity-reference purchase-info-total';value.textContent=view.value;","value.className='quantity-reference purchase-info-total'+(view.value==='0'?' purchase-quantity-zero':'');value.dataset.purchaseQuantityEmpty=String(view.defaultZero);value.textContent=view.value;");
 info=once(info,"else if(view.date){const line=document.createElement('small');line.className='purchase-info-note';","else if(view.date){const line=document.createElement('small');line.className='purchase-info-note purchase-receipt-date task-received-date';");
 info=once(info,'      if(rootId&&allocated){',"      if(rootId&&allocated){\n        const view=allocationView(m);allocated.dataset.purchaseQuantityEmpty=String(view.defaultZero);");
 info=once(info,"!allocated.querySelector('.purchase-info-total')&&Number.isSafeInteger(m.allocated)","!allocated.querySelector('.purchase-info-total')&&view.value!==''");
 info=once(info,'value.textContent=qty(m.allocated);allocated.prepend(value);','value.textContent=view.value;allocated.prepend(value);');
 info=once(info,'        const view=allocationView(m);allocated.toggleAttribute',"        allocated.querySelectorAll('span.purchase-info-total').forEach(value=>{value.classList.toggle('purchase-quantity-zero',view.value==='0');value.dataset.purchaseQuantityEmpty=String(view.defaultZero);});allocated.toggleAttribute");
 assets.set('purchase-live/task-info.js',Buffer.from(info));
 let layout=assets.get('purchase-live/active-layout.js').toString();layout=once(layout,"const count=cell=>{const total=","const count=cell=>{if(cell?.getAttribute('data-purchase-quantity-empty')==='true')return null;const total=");assets.set('purchase-live/active-layout.js',Buffer.from(layout));
 let grid=assets.get('purchase-live/task-grid.js').toString();const old=grid.split('\n').find(line=>line.includes('const box='));assert(old);grid=once(grid,old,"    const box='<span class=\"stock-source-icon\" aria-hidden=\"true\"></span>';");assets.set('purchase-live/task-grid.js',Buffer.from(grid));
 assets.set('purchase-live/task-grid.css',Buffer.from(assets.get('purchase-live/task-grid.css').toString()+style));
 assets.set('purchase-live/source-stock.png',fs.readFileSync(path.join(root,'purchase-live/source-stock.png')));
 let index=assets.get('purchase-live/index.html').toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);for(const file of ['task-grid.js','task-info.js','active-layout.js','task-grid.css'])index=index.replace(new RegExp('('+file.replace('.','\\.')+'\\?v=)[^"&]+'),'$1'+build);assets.set('purchase-live/index.html',Buffer.from(index));
 const changed=[...assets].filter(([file,b])=>!baseline.has(file)||!b.equals(baseline.get(file))).map(([file])=>file).sort();assert.equal(assets.size,99);assert.equal(changed.length,6);return cached={assets,baseline,changed,build};
}
function stage(destination){const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const report={build,changed:p.changed,resources:[...p.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')})),backendFilesIncluded:false,recovery:'6eb562b runtime /fdacfa8 record/payment message v1'};fs.writeFileSync(path.join(target,'quantity-style-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,changed:p.changed,resources:p.resources.length}));}module.exports={plan,stage};
