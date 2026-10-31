'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const previous=require('../warehouse-effective-quantity-20261031/stage.cjs'),build='20261031-warehouse-operational-header-v1';
let cached;
function plan(){
 if(cached)return cached;
 const baseline=new Map(previous.plan().assets),assets=new Map(baseline),file='master-shared/desk-delivery.js';
 const before=assets.get(file).toString(),obsolete="<span>PO No. <b>'+esc(refs?.poNo||'—')+'</b></span>";
 assert.equal(before.split(obsolete).length,2);assets.set(file,Buffer.from(before.replace(obsolete,'')));
 for(const name of ['purchase-live/index.html','warehouse-room/index.html','support-room/workroom.html']){
  const text=assets.get(name).toString();assert(text.includes(previous.build));assets.set(name,Buffer.from(text.replaceAll(previous.build,build)));
 }
 return cached={assets,baseline,build,changed:[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file)};
}
function stage(destination){
 const target=path.resolve(destination||''),root=path.resolve(__dirname,'../../..');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);
 const result=plan();fs.mkdirSync(target,{recursive:true});for(const[file,bytes]of result.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}
 const report={build,changed:result.changed,resources:[...result.assets].map(([file,bytes])=>({path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')})),backendFilesIncluded:false,recovery:'26ff1a1 static composition; original warehouseDeliveryView preserved privately'};
 fs.writeFileSync(path.join(target,'warehouse-operational-header-release.json'),JSON.stringify(report,null,2));return report;
}
if(require.main===module){const result=stage(process.argv[2]);console.log(JSON.stringify({build,changed:result.changed,resources:result.resources.length}));}
module.exports={plan,stage,build};
