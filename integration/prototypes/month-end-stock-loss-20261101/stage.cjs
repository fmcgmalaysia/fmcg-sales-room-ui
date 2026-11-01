'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process');
const previous=require('../purchase-read-efficiency-20261101/stage.cjs'),manifest=require('./baseline.json'),root=path.resolve(__dirname,'../../..'),build='20261101-month-end-stock-loss-v1';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function version(html,name){const pattern=new RegExp('('+name.replace(/[.]/g,'\\.')+'\\?v=)[^"&]+','g');assert(pattern.test(html),name);return html.replace(pattern,'$1'+build);}
let cached;
function plan(){
 if(cached)return cached;
 const baseline=new Map(previous.plan().assets);
 // The historic Stock List composer reads this working file. Pin its recovery
 // bytes before comparing the entire published cohort, then apply this patch.
 baseline.set('warehouse-room/stock-control-app.js',Buffer.from(cp.execFileSync('git',['show','c844f39:warehouse-room/stock-control-app.js'],{cwd:root,encoding:'utf8'}).replace(/\r?\n/g,'\r\n')));
 assert.equal(baseline.size,99);for(const row of manifest.resources){
  const bytes=baseline.get(row.path);
  if(hash(bytes)!==row.sha256&&/\.(?:js|css|html)$/.test(row.path)){
   // Restore only a line-ending variant whose exact bytes match the frozen
   // production hash. Any content change still fails the original assertion.
   const text=bytes.toString();for(const normalized of [text.replace(/\r\n/g,'\n'),text.replace(/\r?\n/g,'\r\n')]){const candidate=Buffer.from(normalized);if(hash(candidate)===row.sha256){baseline.set(row.path,candidate);break;}}
  }
  assert.equal(hash(baseline.get(row.path)),row.sha256,'Recovery resource: '+row.path);
 }
 const assets=new Map(baseline);
 for(const file of ['master-shared/stock-exceptions.js','master-shared/stock-exceptions.css','warehouse-room/stock-control-app.js'])assets.set(file,Buffer.from(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')));
 const planner=fs.readFileSync(path.join(root,'integration/backend/customerAllocationPlan.js'),'utf8').replace(/\r\n/g,'\n').replace(/^export /gm,'');
 const exported=['quoteCustomerAllocation','planCustomerAllocation','planCustomerRepayment','planCustomerReturn','planCustomerReconciliation'];
 assets.set('purchase-live/customer-allocation-plan.js',Buffer.from('(()=>{\n'+planner+'\nwindow.customerAllocationPlan={'+exported.join(',')+'};\n})();\n'));
 for(const room of ['purchase-live','account-room','warehouse-room']){
  let html=assets.get(room+'/index.html').toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);
  for(const file of ['stock-exceptions.js','stock-exceptions.css'])html=version(html,file);
  html=version(html,room==='purchase-live'?'customer-allocation-plan.js':room==='account-room'?'stock-list-link.js':'stock-control-link.js');
  assets.set(room+'/index.html',Buffer.from(html));
 }
 for(const [file,child]of [['account-room/stock-list-link.js','stock-list.html'],['warehouse-room/stock-control-link.js','stock-control.html']])assets.set(file,Buffer.from(version(assets.get(file).toString(),child)));
 for(const file of ['account-room/stock-list.html','warehouse-room/stock-control.html'])assets.set(file,Buffer.from(version(assets.get(file).toString(),'stock-control-app.js')));
 const finance=assets.get('account-room/stock-list.html').toString();assert(finance.includes('until their disposition is confirmed.'));
 assets.set('account-room/stock-list.html',Buffer.from(finance.replace('until their disposition is confirmed.','until Finance records month-end loss. Written-off goods awaiting disposal are shown separately.')));
 const changed=[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file).sort();assert.equal(changed.length,11);
 return cached={assets,baseline,build,changed};
}
function stage(destination){const target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);const p=plan();fs.mkdirSync(target,{recursive:true});for(const[file,bytes]of p.assets){const output=path.join(target,file);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);}const report={build,changed:p.changed,resources:[...p.assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)})),backendFilesIncluded:false,recovery:'c844f39 exact 99-resource production cohort'};fs.writeFileSync(path.join(target,'month-end-stock-loss-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,resources:p.resources.length,changed:p.changed}));}module.exports={plan,stage,build};
