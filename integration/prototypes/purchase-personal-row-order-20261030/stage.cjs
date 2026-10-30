'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const previous=require('../docs-state-colors-20261030/stage.cjs'),{patch}=require('./patch.cjs');
const root=path.resolve(__dirname,'../../..'),build='20261030-purchase-personal-row-order-v1';
function plan(){
 const inherited=previous.plan(),baseline=new Map(inherited.assets),assets=new Map(baseline);
 assets.set('purchase-live/app.js',Buffer.from(patch(baseline.get('purchase-live/app.js').toString())));
 assets.set('purchase-live/display-rows.js',fs.readFileSync(path.join(root,'purchase-live/display-rows.js')));
 let index=assets.get('purchase-live/index.html').toString();
 index=index.replace(/<meta name="build" content="[^"]+">/,'<meta name="build" content="'+build+'">');
 for(const file of ['app.js','display-rows.js']){const token=new RegExp('(?<![\\w-])'+file.replace('.','\\.')+'\\?v=[^"&]+');assert(token.test(index));index=index.replace(token,file+'?v='+build);}
 assets.set('purchase-live/index.html',Buffer.from(index));
 const changed=[...assets].filter(([file,b])=>!b.equals(baseline.get(file))).map(([file])=>file).sort();
 assert.equal(assets.size,94);assert.deepEqual(changed,['purchase-live/app.js','purchase-live/display-rows.js','purchase-live/index.html']);
 return {assets,baseline,changed,build};
}
function stage(destination){
 const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);
 fs.mkdirSync(target,{recursive:true});for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}
 const report={build,changed:p.changed,resources:[...p.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')})),backendFilesIncluded:false,productionRecovery:'d7409c76a90b256601506e0068c78a917a7c694e'};
 fs.writeFileSync(path.join(target,'personal-row-order-release.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));
module.exports={plan,stage};
