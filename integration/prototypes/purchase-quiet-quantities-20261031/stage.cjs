'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const previous=require('../purchase-etd-requested-20261031/stage.cjs'),{once,patchGrid,patchInfo}=require('./patch.cjs'),root=path.resolve(__dirname,'../../..'),build='20261031-purchase-quiet-quantities-v1';
const style=`
/* Purchase: normal quantities stay quiet; only differences expose detail. */
#app .purchase-tasks.active-order-table.draft-column-layout .received-quantity .quantity-reference.purchase-info-total,#app .purchase-tasks.active-order-table.draft-column-layout .allocated-quantity .quantity-reference.purchase-info-total{background:#e8f1ff!important;color:#1652aa!important;border:0;border-radius:12px;padding:2px 8px;font-weight:600;white-space:nowrap}
#app .purchase-tasks.active-order-table.draft-column-layout .allocated-quantity .quantity-reference.purchase-info-total.purchase-info-pending{background:#fff0d8!important;color:#895000!important}
#app .purchase-tasks.active-order-table.draft-column-layout .received-quantity>span.purchase-info-total:empty{display:none!important}
.active-order-table .purchase-info-note{margin-top:3px;line-height:13px}
.active-order-table .purchase-info-note .purchase-info-link{padding:0;font-size:10px;line-height:13px}
.active-order-table .allocated-quantity[data-purchase-info-settled] .dd-purchase-loaded{display:none}
`;
let cached;
function plan(){
 if(cached)return cached;const baseline=new Map(previous.plan().assets),assets=new Map(baseline);
 assets.set('purchase-live/app.js',Buffer.from(once(assets.get('purchase-live/app.js').toString(),'render({rows:shown,tasks:data.tasks,allocations:','render({rows:shown,tasks:data.tasks,deskDeliveries:data.deskDeliveries||[],allocations:')));
 assets.set('purchase-live/task-grid.js',Buffer.from(patchGrid(assets.get('purchase-live/task-grid.js').toString())));
 assets.set('purchase-live/task-info.js',Buffer.from(patchInfo(assets.get('purchase-live/task-info.js').toString())));
 let layout=assets.get('purchase-live/active-layout.js').toString();
 layout=once(layout,'const widths=[48,40,76,128,null,96,180,118,126,166,120];','const widths=[48,40,76,128,null,96,180,118,110,118,120];');
 layout=once(layout,' const count=cell=>{const match='," const count=cell=>{const total=cell?.getAttribute('data-purchase-receipt-total');if(total!==null&&total!==undefined&&/^\\d+$/.test(total))return Number(total);const match=");
 assets.set('purchase-live/active-layout.js',Buffer.from(layout));
 assets.set('purchase-live/task-grid.css',Buffer.from(assets.get('purchase-live/task-grid.css').toString()+style));
 let index=assets.get('purchase-live/index.html').toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);
 for(const file of ['app.js','task-grid.js','task-info.js','active-layout.js','task-grid.css'])index=index.replace(new RegExp('('+file.replace('.','\\.')+'\\?v=)[^"&]+'),'$1'+build);
 assets.set('purchase-live/index.html',Buffer.from(index));
 const changed=[...assets].filter(([file,b])=>!b.equals(baseline.get(file))).map(([file])=>file).sort();assert.equal(assets.size,98);assert.equal(changed.length,6);
 return cached={assets,baseline,changed,build};
}
function stage(destination){const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const report={build,changed:p.changed,resources:[...p.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')})),backendFilesIncluded:false,recovery:'8463397 runtime /62520e8 record/ETD Requested v1'};fs.writeFileSync(path.join(target,'quiet-quantities-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,changed:p.changed,resources:p.resources.length}));}module.exports={plan,stage};
