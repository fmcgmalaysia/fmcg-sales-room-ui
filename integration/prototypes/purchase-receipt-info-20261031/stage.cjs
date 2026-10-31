'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const previous=require('../purchase-active-clarity-20261031/stage.cjs'),root=path.resolve(__dirname,'../../..'),build='20261031-purchase-receipt-info-v1';
const style=`
/* Active Orders: cumulative receipt total, real batches, confirmed allocation sources. */
.active-order-table .purchase-info-link{border:0;background:transparent;color:#2563eb;text-decoration:underline;text-underline-offset:2px;font:inherit;font-size:10px;padding:2px 0 2px 6px;cursor:pointer;vertical-align:middle}
.active-order-table .purchase-info-note{display:block;margin-top:3px;font-size:10px;line-height:15px;color:#526b80;white-space:normal;font-weight:400}
.active-order-table .purchase-info-pending{background:#fff0d8;color:#895000}
.active-order-table .purchase-info-source{display:inline-block;color:#24549b}.active-order-table .purchase-info-source.loan{background:#fff0d8;color:#895000;padding:0 3px;border-radius:3px}
.active-order-table th .purchase-info-caption{display:block;font-size:10px;font-weight:400;color:#526b80}
dialog.purchase-info-dialog{width:620px;max-width:calc(100vw - 32px);padding:0;border:1px solid #b8cddd;border-radius:6px;color:#17364d;background:#fff;font:11px/1.5 Inter,'Segoe UI',Arial,sans-serif}dialog.purchase-info-dialog::backdrop{background:#17364d66}
.purchase-info-dialog .dialoghead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:12px 16px;background:#dcebf7}.purchase-info-dialog h2{margin:0 0 3px;font-size:15px}.purchase-info-dialog small{display:block;font-size:10px;color:#526b80}
.purchase-info-dialog .dialogbody{padding:12px 16px;max-height:55vh;overflow:auto}.purchase-info-dialog .dialogfoot{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid #cbdceb}.purchase-info-dialog .purchase-info-close{border:0;background:transparent;color:#17364d;font-size:22px;cursor:pointer}.purchase-info-dialog .rowlist{width:100%;border-collapse:collapse;font-size:11px}.purchase-info-dialog th,.purchase-info-dialog td{padding:7px 6px;text-align:left;border-bottom:1px solid #d5e2ec;overflow-wrap:anywhere}.purchase-info-dialog th{background:#edf3f8}.purchase-info-dialog .purchase-info-balance{margin:8px 0 0}
`;
function once(source,before,after){assert.equal(source.split(before).length,2,'Info hunk: '+before.slice(0,90));return source.replace(before,()=>after);}
let cached;
function plan(){
 if(cached)return cached;
 const baseline=new Map(previous.plan().assets),assets=new Map(baseline);
 let grid=assets.get('purchase-live/task-grid.js').toString();
 grid=once(grid,'    const roots = rows.filter(row=>!row.procurementSource)',"    if(active)window.purchaseTaskInfo?.setContext({tasks,allocations,allocationContext,customers});\n    const roots = rows.filter(row=>!row.procurementSource)");
 assets.set('purchase-live/task-grid.js',Buffer.from(grid));
 let layout=assets.get('purchase-live/active-layout.js').toString();
 layout=once(layout,'const widths=[48,40,76,128,null,96,180,118,88,96,120];','const widths=[48,40,76,128,null,96,180,118,126,166,120];');
 layout=once(layout,"receipt.querySelectorAll('button').forEach(button=>button.remove());","receipt.querySelectorAll('button:not([data-purchase-info])').forEach(button=>button.remove());");
 layout=once(layout,"  table.classList.add('draft-column-layout');","  window.purchaseTaskInfo?.decorate(table);\n  table.classList.add('draft-column-layout');");
 assets.set('purchase-live/active-layout.js',Buffer.from(layout));
 assets.set('purchase-live/task-info.js',fs.readFileSync(path.join(__dirname,'task-info.js')));
 assets.set('purchase-live/task-grid.css',Buffer.from(assets.get('purchase-live/task-grid.css').toString()+style));
 let index=assets.get('purchase-live/index.html').toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);
 index=once(index,'<script src="task-grid.js','<script src="task-info.js?v='+build+'"></script><script src="task-grid.js');
 for(const file of ['task-grid.js','task-grid.css','active-layout.js'])index=index.replace(new RegExp('('+file.replace('.','\\.')+'\\?v=)[^"&]+'),'$1'+build);
 assets.set('purchase-live/index.html',Buffer.from(index));
 const changed=[...assets].filter(([file,b])=>!baseline.has(file)||!b.equals(baseline.get(file))).map(([file])=>file).sort();
 assert.equal(assets.size,98);assert.deepEqual(changed,['purchase-live/active-layout.js','purchase-live/index.html','purchase-live/task-grid.css','purchase-live/task-grid.js','purchase-live/task-info.js']);
 return cached={assets,baseline,changed,build};
}
function stage(destination){const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const report={build,changed:p.changed,resources:[...p.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')})),backendFilesIncluded:false,recovery:'e8e988a static and exact purchaseWorkspace-before.js'};fs.writeFileSync(path.join(target,'receipt-info-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,changed:p.changed,resources:p.resources.length}));}module.exports={plan,stage};
