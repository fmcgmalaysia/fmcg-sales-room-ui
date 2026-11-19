'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const previous=require('../purchase-personal-row-order-20261030/stage.cjs'),{patch}=require('./patch.cjs');
const root=path.resolve(__dirname,'../../..'),build='20261031-purchase-received-review-v1';
function plan(){
 const prior=previous.plan(),baseline=new Map(prior.assets),assets=new Map(baseline);
 assets.set('purchase-live/app.js',Buffer.from(patch(baseline.get('purchase-live/app.js').toString())));
 let index=assets.get('purchase-live/index.html').toString();
 index=index.replace(/<meta name="build" content="[^"]+">/,'<meta name="build" content="'+build+'">');
 assert(index.includes('app.js?v='+prior.build));index=index.replace('app.js?v='+prior.build,'app.js?v='+build);
 assets.set('purchase-live/index.html',Buffer.from(index));
 const changed=[...assets].filter(([file,b])=>!b.equals(baseline.get(file))).map(([file])=>file).sort();
 assert.equal(assets.size,94);assert.deepEqual(changed,['purchase-live/app.js','purchase-live/index.html']);
 return {assets,baseline,changed,build};
}
function stage(destination){
 const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);
 fs.mkdirSync(target,{recursive:true});for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}
 const report={build,changed:p.changed,resources:[...p.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')})),backendFilesIncluded:false,recovery:'cbf572a1fef00087bf6a6b8ae781b730cc60f414'};
 fs.writeFileSync(path.join(target,'received-review-release.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));
module.exports={plan,stage};
