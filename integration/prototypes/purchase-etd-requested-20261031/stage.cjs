'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const previous=require('../purchase-receipt-info-20261031/stage.cjs'),root=path.resolve(__dirname,'../../..'),build='20261031-purchase-etd-requested-v1';
function once(source,before,after){assert.equal(source.split(before).length,2,'Presentation hunk: '+before.slice(0,90));return source.replace(before,()=>after);}
const ageHelper=`  function purchaseCreatedAge(value,now=Date.now()){
    if(!value||!Number.isFinite(new Date(value).getTime()))return '';
    const day=stamp=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(stamp)).map(part=>[part.type,part.value]));return Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day));};
    const days=Math.round((day(now)-day(value))/86400000);
    return days===0?'Today':days===1?'Yesterday':days>1?days+' Days Ago':'';
  }
`;
const style=`
/* Purchase PO presentation only; original request and document handlers remain intact. */
#app .po-submission-workspace .po-ledger :is(th,td):nth-child(4){text-align:right;padding-right:36px}
.po-submission-workspace .po-ledger :is(th,td):nth-child(5){text-align:left;padding-left:14px;padding-right:6px}
.po-submission-workspace .po-created-age{display:block;font-size:11px;font-weight:600;line-height:14px}
.po-submission-workspace .po-request-payment.po-requested-capsule{width:auto;min-width:78px;height:22px;padding:0 10px;border-radius:11px;font:600 10px/22px var(--master-font);vertical-align:middle}
.po-submission-workspace .po-ledger .po-requested-time{display:block;white-space:nowrap;margin-top:3px;font-size:10px;line-height:13px;color:var(--master-muted);cursor:default}
`;
let cached;
function plan(){
 if(cached)return cached;
 const baseline=new Map(previous.plan().assets),assets=new Map(baseline);
 let app=assets.get('purchase-live/app.js').toString();
 app=once(app,'Customer shipment ETA">ETA: ','Customer shipment ETD">ETD: ');
 app=once(app,'  function purchasePaymentCell(row){',ageHelper+'  function purchasePaymentCell(row){');
 app=once(app,`    if(row.procurementHandoff?.submitted)return '<button class="po-request-payment submitted" data-po-request="'+esc(row.id)+'" aria-label="Payment Request '+esc(row.number)+'"><span aria-hidden="true">$</span></button>';`,
 `    if(row.procurementHandoff?.submitted){const at=row.procurementHandoff.submission?.at;return '<button class="po-request-payment submitted po-requested-capsule" data-po-request="'+esc(row.id)+'" aria-label="Payment Request '+esc(row.number)+'">Requested</button>'+(at&&Number.isFinite(new Date(at).getTime())?'<small class="po-requested-time">'+esc(shortTime(at).replace(' ','T '))+'</small>':'');}`);
 app=once(app,':[9,21,13,9,16,9,23]',':[10,20,13,9,20,12,16]');
 app=once(app,`(row.createdAt?esc(shortTime(row.createdAt)):'—')+'<small>'`, `(row.createdAt?'<span class="po-created-age">'+esc(purchaseCreatedAge(row.createdAt))+'</span>'+esc(shortTime(row.createdAt)):'—')+'<small>'`);
 assets.set('purchase-live/app.js',Buffer.from(app));
 assets.set('purchase-live/task-grid.js',Buffer.from(once(assets.get('purchase-live/task-grid.js').toString(),'">ETA: ','">ETD: ')));
 assets.set('purchase-live/style.css',Buffer.from(assets.get('purchase-live/style.css').toString()+style));
 let index=assets.get('purchase-live/index.html').toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);
 for(const file of ['app.js','task-grid.js','style.css'])index=index.replace(new RegExp('('+file.replace('.','\\.')+'\\?v=)[^"&]+'),'$1'+build);
 assets.set('purchase-live/index.html',Buffer.from(index));
 const changed=[...assets].filter(([file,b])=>!b.equals(baseline.get(file))).map(([file])=>file).sort();
 assert.equal(assets.size,98);assert.deepEqual(changed,['purchase-live/app.js','purchase-live/index.html','purchase-live/style.css','purchase-live/task-grid.js']);
 return cached={assets,baseline,changed,build};
}
function stage(destination){const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const report={build,changed:p.changed,resources:[...p.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')})),backendFilesIncluded:false,recovery:'7f80f70 Info v2 and exact Wix Purchase page'};fs.writeFileSync(path.join(target,'purchase-presentation-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,changed:p.changed,resources:p.resources.length}));}module.exports={plan,stage};
