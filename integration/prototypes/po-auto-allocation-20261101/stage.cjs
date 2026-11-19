'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),build='20261101-po-auto-allocation-v1',hash=b=>crypto.createHash('sha256').update(b).digest('hex');
let preserved;
function baselineAssets(){
 if(preserved)return new Map(preserved);
 const bytes=fs.readFileSync(path.join(__dirname,'public-baseline-8815ddd.json.gz'));assert.equal(hash(bytes),'ecbb2a34651d0f4d5d79adf077fbf63abd29a3e2aec83af3363cd0eb6b6f5dcb');
 const record=JSON.parse(zlib.gunzipSync(bytes));assert.equal(record.commit,'8815ddd');assert.equal(record.assets.length,99);
 preserved=new Map(record.assets.map(row=>{let b=row.gitPath?cp.execFileSync('git',['show',record.commit+':'+row.gitPath],{cwd:root,maxBuffer:8000000}):Buffer.from(row.base64,'base64');if(row.lf)b=Buffer.from(b.toString().replace(/\r\n/g,'\n'));assert.equal(hash(b),row.sha256,row.path+' immutable public baseline');return[row.path,b];}));return new Map(preserved);
}
function plan(){
 const baseline=baselineAssets(),assets=new Map(baseline),files=['index.html','purchase-live/app.js','purchase-live/supplier-allocation.js','purchase-live/task-grid.js','purchase-live/task-info.js','purchase-live/active-layout.js','purchase-live/active-orders.css','master-shared/desk-delivery.js','master-shared/shipment-batches.js','sales-room/order-adjustment.js','sales-room/shipment-ui.js','support-room/workroom.js','support-room/workroom-model.js','support-room/workroom.css'];
 for(const file of files){assert(baseline.has(file));assets.set(file,Buffer.from(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')));}
 const domain=fs.readFileSync(path.join(root,'integration/backend/customerAllocationPlan.js'),'utf8').replace(/\r\n/g,'\n').replace(/^export /gm,'');
 assets.set('purchase-live/customer-allocation-plan.js',Buffer.from('(()=>{\n'+domain+'\nwindow.customerAllocationPlan={quoteCustomerAllocation,planCustomerAllocation,planCustomerRepayment,planCustomerReturn,planCustomerReconciliation};\n})();\n'));
 // Keep the approved modern public dialog; the unrelated inherited raw file is excluded.
 let allocation=baseline.get('purchase-live/customer-allocation.js').toString();
 const patch=(a,b)=>{assert.equal(allocation.split(a).length,2,a);allocation=allocation.replace(a,b);};
 patch("card('Reserved','本客户已预留',quote.assigned,'reserved')","card('Covered','已覆盖',quote.assigned,'reserved')");
 patch('Allocate now<small>本次分配方案</small>','After change<small>调整后覆盖</small>');
 patch("<p>Free stock 可调用库存 <strong>","<p>Incoming 待到货 <strong>'+quantity(quote.waiting||0)+' CTN</strong></p><p>Free stock 可调用库存 <strong>");
 patch("(quote.useFree>0||context.sources.some(source=>source.implicit&&source.targets.some(target=>target.taskId===taskId&&target.quantity>0)))","quote.useFree>0");
 assets.set('purchase-live/customer-allocation.js',Buffer.from(allocation));
 let dashboard=baseline.get('purchase-live/dashboard.js').toString();const dashboardAnchor='const entry=receiptReviewEntry(original,task,po);';assert.equal(dashboard.split(dashboardAnchor).length,2);
 dashboard=dashboard.replace(dashboardAnchor,dashboardAnchor+"\n      const root=task?.procurementSource?data.tasks.find(row=>row.id===task.customerDemandTaskId):task;if(entry.action==='allocate'&&root?.supplyAllocation)return;");assets.set('purchase-live/dashboard.js',Buffer.from(dashboard));
 let support=assets.get('support-room/workroom.js').toString();assert.match(support,/dataset\.supportBuild='[^']+'/);support=support.replace(/dataset\.supportBuild='[^']+'/,'dataset.supportBuild=\''+build+'\'');assets.set('support-room/workroom.js',Buffer.from(support));
 const changedScripts=[...assets].filter(([name,b])=>!b.equals(baseline.get(name))).map(([name])=>name);
 const entries=['index.html','buyer-room.html','purchase-live/index.html','support-room/workroom.html','support-room/packing-workbench.html','warehouse-room/index.html'];
 for(const file of entries){let html=assets.get(file).toString();html=html.replace(/(<meta name="build" content=")[^"]+/,'$1'+build);for(const changed of changedScripts){const relative=path.posix.relative(path.posix.dirname(file),changed);const escaped=relative.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');html=html.replace(new RegExp('('+escaped+'\\?v=)[^"&]+','g'),'$1'+build);}assets.set(file,Buffer.from(html));}
 const changed=[...assets].filter(([f,b])=>!b.equals(baseline.get(f))).map(([f])=>f).sort();assert.equal(assets.size,99);assert(changed.every(f=>[...files,...entries,'purchase-live/customer-allocation-plan.js','purchase-live/customer-allocation.js','purchase-live/dashboard.js'].includes(f)));
 return{baseline,assets,changed,build};
}
function stage(destination){const target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);const p=plan();for(const[f,b]of p.assets){const out=path.join(target,f);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const report={build,baseline:'8815ddd',changed:p.changed,resources:[...p.assets].map(([f,b])=>({path:f,sha256:hash(b)}))};fs.writeFileSync(path.join(target,'po-auto-allocation-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const r=stage(process.argv[2]);console.log(JSON.stringify({build,resources:r.resources.length,changed:r.changed}));}module.exports={plan,stage,build,baselineAssets};
