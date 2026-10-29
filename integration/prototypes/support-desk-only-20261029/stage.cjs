'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),previous=require('../stock-loaded-contract-20261028/stage.cjs');
const build='20261029-support-desk-only-v1',hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const retired=['app.js','style.css','draft-app.js','invoice-draft-model.js'].map(name=>'support-room/'+name);
const redirects=['support-room/index.html','support-room/draft.html'];
function redirect(){return Buffer.from('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="build" content="'+build+'"><title>MASTER Support</title></head><body><p>This old page has moved to the Desk workroom.</p><a id="desk-entry" href="workroom.html?live=1&amp;department=SUPPORT">Open MASTER Support</a><script>(()=>{const company=new URLSearchParams(location.search).get("company")==="GHR"?"GHR":"NCT";const target=parent===window?"https://fmcg999.wixstudio.com/master/support-department":"workroom.html?live=1&department=SUPPORT&company="+company;document.getElementById("desk-entry").href=target;location.replace(target);})();</script></body></html>');}
function plan(){
 const previousPlan=previous.plan(),baseline=previousPlan.assets,assets=new Map(baseline);assert.equal(assets.size,99);
 for(const file of retired){assert(assets.has(file));assets.delete(file);}
 for(const file of redirects){assert(assets.has(file));assets.set(file,redirect());}
 for(const [file,bytes]of assets)if(/\.(html|js)$/.test(file)){const source=bytes.toString(),next=source.replaceAll('20261029-stock-loaded-v3',build);if(next!==source)assets.set(file,Buffer.from(next));}
 assert.equal(assets.size,95);
 // Retired assets have no incoming references in any remaining published file.
 const references=[];
 for(const [file,bytes]of assets){if(!/\.(html|js|css)$/.test(file))continue;
  for(const match of bytes.toString().matchAll(/["'(]([^"'\s<>]+?\.(?:html|js|css))(?:[?#][^"'\s<>)]*)?["')]/g)){
   let target;try{target=new URL(match[1],'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/'+file).pathname.replace(/^\/fmcg-sales-room-ui\//,'');}catch(_){continue;}
   if(retired.includes(target))references.push({file,target});
  }
 }
 assert.deepEqual(references,[]);assert(assets.get('support-room/workroom.js').toString().includes('activeDesk'));
 const changed=[...assets].filter(([name,bytes])=>hash(bytes)!==hash(baseline.get(name))).map(([name])=>name);
 const allowed=new Set([...previousPlan.changed,...redirects]);assert(changed.every(name=>allowed.has(name)));
 return {assets,baseline,retired,redirects,changed,references,build};
}
function stage(destination){const result=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const [file,bytes]of result.assets){const name=path.join(target,file);fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,bytes);}
 const report={build,codeCommit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),resources:[...result.assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)})),retired:retired.map(file=>({path:file,previousSha256:hash(result.baseline.get(file))})),redirects,changed:result.changed,unreferencedRetiredAssets:true,backendFilesIncluded:false,wixCodeChangeRequired:false,wixBackendRuntime:'9fb69be3ed20684e0bd9c64581b2c53091a4dacf',recovery:'Exact v2 99-resource package and14 published backend hashes retained'};
 fs.writeFileSync(path.join(target,'support-desk-only-release.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(require.main===module){const r=stage(process.argv[2]);console.log(JSON.stringify({build:r.build,resources:r.resources.length,retired:r.retired.map(row=>row.path),redirects:r.redirects}));}
module.exports={plan,stage};
