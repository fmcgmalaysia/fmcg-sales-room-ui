'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const previous=require('../support-shortload-20261031/stage.cjs'),{patchGrid,patchApp,patchAllocation,style}=require('./patch.cjs');
const root=path.resolve(__dirname,'../../..'),build='20261031-purchase-ready-stock-v1';
function plan(){
 const prior=previous.plan(),baseline=new Map(prior.assets),assets=new Map(baseline);
 for(const [file,patch]of [['task-grid.js',patchGrid],['app.js',patchApp],['customer-allocation.js',patchAllocation]])assets.set('purchase-live/'+file,Buffer.from(patch(baseline.get('purchase-live/'+file).toString().replace(/\r\n/g,'\n'))));
 assets.set('purchase-live/task-grid.css',Buffer.from(baseline.get('purchase-live/task-grid.css').toString()+style));
 let index=assets.get('purchase-live/index.html').toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);
 for(const file of ['task-grid.js','app.js','customer-allocation.js','task-grid.css'])index=index.replace(new RegExp('('+file.replace('.','\\.')+'\\?v=)[^"&]+'),'$1'+build);
 assets.set('purchase-live/index.html',Buffer.from(index));
 const changed=[...assets].filter(([file,b])=>!b.equals(baseline.get(file))).map(([file])=>file).sort();assert.equal(assets.size,94);assert.deepEqual(changed,['purchase-live/app.js','purchase-live/customer-allocation.js','purchase-live/index.html','purchase-live/task-grid.css','purchase-live/task-grid.js']);
 return {assets,baseline,changed,build};
}
function stage(destination){
 const result=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);
 fs.mkdirSync(target,{recursive:true});for(const[file,b]of result.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}
 const report={build,changed:result.changed,resources:[...result.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')})),backendFilesIncluded:false,recovery:'8b203b5'};
 fs.writeFileSync(path.join(target,'ready-stock-release.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(require.main===module){const r=stage(process.argv[2]);console.log(JSON.stringify({build:r.build,changed:r.changed,resources:r.resources.length}));}module.exports={plan,stage};
