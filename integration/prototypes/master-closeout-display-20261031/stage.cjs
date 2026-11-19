'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const candidate=require('../payment-request-reconciliation-labels-20261031/stage.cjs'),previous=require('../warehouse-operational-header-20261031/stage.cjs');
const build='20261031-master-closeout-display-v1';
let cached;
function plan(){
 if(cached)return cached;
 const baseline=new Map(previous.plan().assets),assets=new Map(candidate.plan().assets);
 for(const file of ['purchase-live/index.html','account-room/index.html'])assets.set(file,Buffer.from(assets.get(file).toString().replaceAll(candidate.build,build)));
 return cached={assets,baseline,build,changed:[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file)};
}
function stage(destination){
 const target=path.resolve(destination||''),root=path.resolve(__dirname,'../../..');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);
 const result=plan();fs.mkdirSync(target,{recursive:true});for(const[file,bytes]of result.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}
 const report={build,changed:result.changed,resources:[...result.assets].map(([file,bytes])=>({path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')})),backendFilesIncluded:false,recovery:'0d6b492 static composition; original purchaseProjection preserved privately'};
 fs.writeFileSync(path.join(target,'master-closeout-display-release.json'),JSON.stringify(report,null,2));return report;
}
if(require.main===module){const result=stage(process.argv[2]);console.log(JSON.stringify({build,changed:result.changed,resources:result.resources.length}));}
module.exports={plan,stage,build};
