'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const previous=require('../stock-list-purchase-style-20261031/stage.cjs'),{patchApp,patchAllocation}=require('./patch.cjs'),root=path.resolve(__dirname,'../../..'),build='20261031-purchase-stock-actions-v1';
function plan(){
 const baseline=new Map(previous.plan().assets),assets=new Map(baseline);
 for(const[file,patch]of [['app.js',patchApp],['customer-allocation.js',patchAllocation]])assets.set('purchase-live/'+file,Buffer.from(patch(baseline.get('purchase-live/'+file).toString().replace(/\r\n/g,'\n'))));
 let index=assets.get('purchase-live/index.html').toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);
 for(const file of ['app.js','customer-allocation.js'])index=index.replace(new RegExp('('+file.replace('.','\\.')+'\\?v=)[^"&]+'),'$1'+build);
 assets.set('purchase-live/index.html',Buffer.from(index));
 const changed=[...assets].filter(([file,b])=>!b.equals(baseline.get(file))).map(([file])=>file).sort();assert.equal(assets.size,97);assert.deepEqual(changed,['purchase-live/app.js','purchase-live/customer-allocation.js','purchase-live/index.html']);
 return {assets,baseline,changed,build};
}
function stage(destination){const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const report={build,changed:p.changed,resources:[...p.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')})),backendFilesIncluded:false,recovery:'72714a1 static; Purchase ready-stock-v1 Wix'};fs.writeFileSync(path.join(target,'stock-actions-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,changed:p.changed,resources:p.resources.length}));}module.exports={plan,stage};
