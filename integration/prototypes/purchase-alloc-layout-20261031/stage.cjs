'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const previous=require('../purchase-stock-actions-20261031/stage.cjs'),{patchAllocation,style}=require('./patch.cjs'),root=path.resolve(__dirname,'../../..'),build='20261031-purchase-alloc-layout-v1';
function plan(){
 const baseline=new Map(previous.plan().assets),assets=new Map(baseline);
 assets.set('purchase-live/customer-allocation.js',Buffer.from(patchAllocation(baseline.get('purchase-live/customer-allocation.js').toString().replace(/\r\n/g,'\n'))));
 assets.set('purchase-live/task-grid.css',Buffer.from(baseline.get('purchase-live/task-grid.css').toString()+style));
 let index=assets.get('purchase-live/index.html').toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);
 for(const file of ['customer-allocation.js','task-grid.css'])index=index.replace(new RegExp('('+file.replace('.','\\.')+'\\?v=)[^"&]+'),'$1'+build);
 assets.set('purchase-live/index.html',Buffer.from(index));
 const changed=[...assets].filter(([file,b])=>!b.equals(baseline.get(file))).map(([file])=>file).sort();assert.equal(assets.size,97);assert.deepEqual(changed,['purchase-live/customer-allocation.js','purchase-live/index.html','purchase-live/task-grid.css']);return {assets,baseline,changed,build};
}
function stage(destination){const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const report={build,changed:p.changed,resources:[...p.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')})),backendFilesIncluded:false,recovery:'0a1e65d static and Wix purchase-stock-actions-v1'};fs.writeFileSync(path.join(target,'alloc-layout-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,changed:p.changed,resources:p.resources.length}));}module.exports={plan,stage};
