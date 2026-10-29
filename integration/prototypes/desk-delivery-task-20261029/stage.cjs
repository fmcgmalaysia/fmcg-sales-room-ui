'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),previous=require('../stock-loaded-contract-20261028/stage.cjs'),hooks=require('./hooks.cjs');
const build='20261029-desk-delivery-v1',hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const retired=['support-room/app.js','support-room/style.css','support-room/draft-app.js','support-room/invoice-draft-model.js','support-room/packing-workbench.js','support-room/packing-workbench.css','support-room/packing-model-browser.js','support-room/packing-transport.js','warehouse-room/packing-list-link.js'];
const redirects=['support-room/index.html','support-room/draft.html','support-room/packing-workbench.html'];
function redirect(){return Buffer.from('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="build" content="'+build+'"><title>MASTER Support</title></head><body><p>Open the current Desk workroom.</p><a id="desk-entry" href="workroom.html?live=1&amp;department=SUPPORT">Open MASTER Support</a><script>(()=>{const company=new URLSearchParams(location.search).get("company")==="GHR"?"GHR":"NCT";const target=parent===window?"https://fmcg999.wixstudio.com/master/support-department":"workroom.html?v='+build+'&live=1&department=SUPPORT&company="+company;document.getElementById("desk-entry").href=target;location.replace(target);})();</script></body></html>');}
function plan(){
 const baseline=previous.plan('9fb69be3ed20684e0bd9c64581b2c53091a4dacf').assets;
 for(const [file,bytes]of baseline)if(/\.(html|js)$/.test(file)){let source=bytes.toString().replaceAll('20261029-stock-loaded-v3','20261029-stock-loaded-v2');if(file==='support-room/workroom.js')source=source.replace('new URL(location.ancestorOrigins?.[0]||document.referrer)','new URL(document.referrer)');baseline.set(file,Buffer.from(source));}
 const frozen=JSON.parse(fs.readFileSync(path.join(__dirname,'baseline.json'),'utf8'));assert.equal(frozen.codeCommit,'9fb69be3ed20684e0bd9c64581b2c53091a4dacf');for(const row of frozen.resources)assert.equal(hash(baseline.get(row.path)),row.sha256,'Frozen v2 '+row.path);
 const assets=new Map(baseline);assert.equal(assets.size,99);
 const replace=(file,before,after)=>{const source=assets.get(file).toString();assert.equal(source.split(before).length-1,1,file+' exact patch');assets.set(file,Buffer.from(source.replace(before,after)));};
 replace('support-room/workroom.js','new URL(document.referrer)','new URL(location.ancestorOrigins?.[0]||document.referrer)');
 for(const file of new Set(hooks.hooks.map(row=>row[0])))assets.set(file,Buffer.from(hooks.apply(file,assets.get(file).toString())));
 replace('support-room/workroom.css','.orders-tab{height:42px;display:inline-flex','.orders-tab{height:42px;display:none');
 for(const file of ['support-room/workroom.html','purchase-live/index.html','warehouse-room/index.html']){
  replace(file,'</head>','<link rel="stylesheet" href="../master-shared/desk-delivery.css?v='+build+'"></head>');
  const anchor=file.startsWith('support')?'workroom.js': 'app.js',source=assets.get(file).toString(),pattern=new RegExp('<script src="'+anchor.replace('.','\\.')+'\\?v=[^"]+"></script>');assert.equal((source.match(new RegExp(pattern.source,'g'))||[]).length,1);
  assets.set(file,Buffer.from(source.replace(pattern,match=>'<script src="../master-shared/desk-delivery.js?v='+build+'"></script>'+match)));
 }
 const warehouse=assets.get('warehouse-room/index.html').toString();assert.equal((warehouse.match(/<script src="packing-list-link\.js\?v=[^"]+"><\/script>/g)||[]).length,1);assets.set('warehouse-room/index.html',Buffer.from(warehouse.replace(/<script src="packing-list-link\.js\?v=[^"]+"><\/script>/,'')));
 replace('warehouse-room/index.html','>Delivery Tasks</button>','>Delivery Task</button>');
 const supportHtml=assets.get('support-room/workroom.html').toString(),oldLink=/<a id="packing"[^>]+>Packing Lists ↗<\/a>/g;assert.equal((supportHtml.match(oldLink)||[]).length,1);assets.set('support-room/workroom.html',Buffer.from(supportHtml.replace(oldLink,'')));
 for(const name of ['desk-delivery.js','desk-delivery.css'])assets.set('master-shared/'+name,Buffer.from(fs.readFileSync(path.join(root,'master-shared',name),'utf8').replace(/\r\n/g,'\n')));
 for(const file of redirects){assert(assets.has(file));assets.set(file,redirect());}
 for(const file of retired){assert(assets.has(file));assets.delete(file);}
 for(const file of ['support-room/workroom.html','warehouse-room/index.html','purchase-live/index.html']){
  let source=assets.get(file).toString();source=source.replace(/(<meta name="build" content=")[^"]+(" >|">)/,'$1'+build+'$2');
  for(const name of file.startsWith('support')?['workroom.js','workroom-model.js','workroom.css']:file.startsWith('purchase')?['app.js']:[])source=source.replace(new RegExp('('+name.replaceAll('.','\\.')+'\\?v=)[^"&]+','g'),'$1'+build);
  assets.set(file,Buffer.from(source));
 }
 assets.set('support-room/workroom.js',Buffer.from(assets.get('support-room/workroom.js').toString().replaceAll('20261029-stock-loaded-v2',build)));
 const references=[];
 for(const [file,bytes] of assets)if(/\.(html|js|css)$/.test(file))for(const match of bytes.toString().matchAll(/["'(]([^"'\s<>]+?\.(?:html|js|css))(?:[?#][^"'\s<>)]*)?["')]/g)){let target;try{target=new URL(match[1],'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/'+file).pathname.replace(/^\/fmcg-sales-room-ui\//,'');}catch(_){continue;}if(retired.includes(target))references.push({file,target});}
 assert.deepEqual(references,[]);assert.equal(assets.size,92);
 const changed=[...assets].filter(([name,bytes])=>!baseline.has(name)||hash(bytes)!==hash(baseline.get(name))).map(([name])=>name);
 return {assets,baseline,retired,redirects,changed,references,build};
}
function stage(destination){const result=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&!target.startsWith(root+path.sep)&&target!==root&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const [file,bytes]of result.assets){const name=path.join(target,file);fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,bytes);}const report={build,codeCommit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),resources:[...result.assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)})),retired,redirects,changed:result.changed,backendFilesIncluded:false,wixCodeChangeRequired:true,productionRecovery:'9fb69be3ed20684e0bd9c64581b2c53091a4dacf'};fs.writeFileSync(path.join(target,'desk-delivery-release.json'),JSON.stringify(report,null,2)+'\n');return report;}
if(require.main===module){const result=stage(process.argv[2]);console.log(JSON.stringify({build,resources:result.resources.length,changed:result.changed,retired}));}
module.exports={plan,stage};
