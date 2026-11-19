'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const previous=require('../purchase-quantity-style-20261031/stage.cjs');
const build='20261031-warehouse-effective-quantity-v1';
function once(text,from,to){assert.equal(text.split(from).length,2,'Effective quantity display anchor');return text.replace(from,()=>to);}
function patch(text){
 text=once(text,"number(line.quantity)+'</td><td class=\"dd-number\"><button", "number(line.resolution?.maximum??line.quantity)+'</td><td class=\"dd-number\"><button");
 text=once(text,"<p>Authorized Alloc Qty 已授权数量 <b>'+line.quantity+'</b></p>","<p>Alloc Qty 本次待交总量 <b>'+(line.resolution?.maximum??line.quantity)+'</b></p>");
 return text;
}
let cached;
function plan(){
 if(cached)return cached;
 const baseline=new Map(previous.plan().assets),assets=new Map(baseline);
 assets.set('master-shared/desk-delivery.js',Buffer.from(patch(assets.get('master-shared/desk-delivery.js').toString())));
 for(const file of ['purchase-live/index.html','warehouse-room/index.html','support-room/workroom.html']){
  let text=assets.get(file).toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);
  text=once(text,text.match(/desk-delivery\.js\?v=[^"&]+/)[0],'desk-delivery.js?v='+build);
  assets.set(file,Buffer.from(text));
 }
 return cached={assets,baseline,build,changed:[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file)};
}
function stage(destination){
 const target=path.resolve(destination||''),root=path.resolve(__dirname,'../../..');
 assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);
 const result=plan();fs.mkdirSync(target,{recursive:true});
 for(const [file,bytes]of result.assets){const output=path.join(target,file);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);}
 const report={build,changed:result.changed,resources:[...result.assets].map(([file,bytes])=>({path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')})),backendFilesIncluded:false,recovery:'26ff1a1 static release; 97f9623 live backend unchanged'};
 fs.writeFileSync(path.join(target,'warehouse-effective-quantity-release.json'),JSON.stringify(report,null,2));return report;
}
if(require.main===module){const result=stage(process.argv[2]);console.log(JSON.stringify({build,changed:result.changed,resources:result.resources.length}));}
module.exports={plan,patch,stage,build};
