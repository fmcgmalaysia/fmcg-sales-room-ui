'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),previous=require('../master-save-continuity-20261028/stage.cjs');
const build='20261028-stock-loaded-v1',recovery='e71bf4934f8c5347b13dd0802f9da227b5ccf83b';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function plan(){
 const assets=new Map(previous.plan().assets),baseline=new Map(assets);assert.equal(assets.size,99);
 const replace=(file,before,after,count=1)=>{const text=assets.get(file).toString();assert.equal(text.split(before).length-1,count,file+' exact patch');assets.set(file,Buffer.from(text.split(before).join(after)));};
 replace('warehouse-room/workroom.js','Loading does not mean dispatched. Confirm actual dispatch after the Sales Invoice is issued.<br>装柜不代表已发货。销售发票开出后，仍须确认实际发货。','Confirmed Loaded cartons leave stock once. Invoice and Dispatch record the same goods without another deduction.<br>Loaded 保存成功即扣一次库存；开票与 Dispatch 沿用同批货，不再扣量。');
 replace('warehouse-room/workroom.js','Enter actual loaded cartons. Loading does not confirm dispatch.<br>填写实际上车或入柜箱数。装货登记不代表已发货。','Enter cumulative actual loaded cartons. A successful save removes them from stock once. A decrease requires supervised correction.<br>填写累计实装箱数，保存成功即扣一次库存；减少已出库数量须经主管更正。');
 replace('warehouse-room/packing-list-link.js',"['20261021-packing-v1','20261021-packing-company-v1']","['20261021-packing-v1','20261021-packing-company-v1','20261027-support-order-progress-v2']");
 replace('warehouse-room/packing-list-link.js','packing-workbench.html?v=20261021-packing-company-v1','packing-workbench.html?v='+build);
 // Keep the existing host allowlist and event.source check. Same-frame navigation
 // changes document.referrer to the previous child; the real parent stays Wix.
 replace('support-room/packing-transport.js','new URL(document.referrer)','new URL(location.ancestorOrigins?.[0]||document.referrer)');
 replace('support-room/workroom.js','packing-workbench.html?v=20261028-master-save-continuity-v1','packing-workbench.html?v='+build,2);
 replace('support-room/workroom.js',"dataset.supportBuild='20261028-master-save-continuity-v1'","dataset.supportBuild='"+build+"'");
 const model=fs.readFileSync(path.join(root,'support-room/packing-model-browser.js'),'utf8').replace(/\r\n/g,'\n');
 const domain=fs.readFileSync(path.join(root,'integration/backend/packingListModel.js'),'utf8').replace(/\r\n/g,'\n').replace(/^export /gm,'');assert(model.includes(domain));assets.set('support-room/packing-model-browser.js',Buffer.from(model));
 replace('support-room/packing-workbench.js','Both planned and actual quantities remain visible. 两部门共用同一备货单，保留计划与实装数量。','Loaded cartons leave stock once; invoices do not deduct again. 两部门共用同一备货单；实装保存扣一次库存，开票不再扣量。');
 for(const file of ['purchase-live/index.html','account-room/index.html','warehouse-room/index.html','support-room/index.html','support-room/workroom.html','support-room/packing-workbench.html']){
  const text=assets.get(file).toString();assert.equal((text.match(/<meta name="build" content="[^"]+">/g)||[]).length,1);assets.set(file,Buffer.from(text.replace(/(<meta name="build" content=")[^"]+(">)/,'$1'+build+'$2')));
 }
 for(const [file,names] of [['warehouse-room/index.html',['workroom.js','packing-list-link.js']],['support-room/workroom.html',['workroom.js']],['support-room/packing-workbench.html',['packing-model-browser.js','packing-transport.js','packing-workbench.js']]]){
  let text=assets.get(file).toString();for(const name of names){const pattern=new RegExp('('+name.replaceAll('.','\\.')+'\\?v=)[^"&]+','g');assert.equal((text.match(pattern)||[]).length,1,file+' '+name);text=text.replace(pattern,'$1'+build);}assets.set(file,Buffer.from(text));
 }
 const changed=[...assets].filter(([name,bytes])=>hash(bytes)!==hash(baseline.get(name))).map(([name])=>name);
 const allowed=new Set(['warehouse-room/workroom.js','warehouse-room/packing-list-link.js','support-room/packing-transport.js','support-room/packing-model-browser.js','support-room/packing-workbench.js','support-room/workroom.js','purchase-live/index.html','account-room/index.html','warehouse-room/index.html','support-room/index.html','support-room/workroom.html','support-room/packing-workbench.html']);
 assert(changed.every(name=>allowed.has(name)));assert.equal(changed.length,12);
 return {assets,baseline,changed};
}
function stage(destination){const {assets,changed}=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&!target.startsWith(root+path.sep)&&target!==root&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const [name,bytes]of assets){const file=path.join(target,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
 const report={build,codeCommit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),productionRecovery:recovery,resources:[...assets].map(([name,bytes])=>({path:name,sha256:hash(bytes)})),changed,protectedResources:99-changed.length,backendFilesIncluded:false,wixCodeChangeRequired:true};fs.writeFileSync(path.join(target,'stock-loaded-release.json'),JSON.stringify(report,null,2)+'\n');return report;}
if(require.main===module){const result=stage(process.argv[2]);console.log(JSON.stringify({build:result.build,resources:result.resources.length,changed:result.changed,protectedResources:result.protectedResources}));}
module.exports={plan,stage};
