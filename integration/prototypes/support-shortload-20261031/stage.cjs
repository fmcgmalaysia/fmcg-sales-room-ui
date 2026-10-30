const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const previous=require('../purchase-received-review-20261031/stage.cjs'),root=path.resolve(__dirname,'../../..'),build='20261031-support-shortload-v1';
function plan(){
 const prior=previous.plan(),baseline=new Map(prior.assets),assets=new Map(baseline);
 for(const patch of JSON.parse(fs.readFileSync(path.join(__dirname,'UI_PATCHES.json'),'utf8')).patches){let text=assets.get(patch.file).toString().replace(/\r\n/g,'\n');for(const hunk of patch.hunks){assert.equal(text.split(hunk.find).length,2,patch.file+' exact production hunk');text=text.replace(hunk.find,()=>hunk.replace);}assets.set(patch.file,Buffer.from(text));}
 for(const file of ['support-room/workroom.html','warehouse-room/index.html','purchase-live/index.html']){let text=assets.get(file).toString();text=text.replace(/(<meta name="build" content=")[^"]+/,'$1'+build);text=text.replace(/(desk-delivery\.(?:js|css)\?v=)[^"&]+/g,'$1'+build);if(file.startsWith('support'))text=text.replace(/(workroom(?:-model)?\.js\?v=)[^"&]+/g,'$1'+build);assets.set(file,Buffer.from(text));}
 assets.set('support-room/workroom.js',Buffer.from(assets.get('support-room/workroom.js').toString().replace(/dataset\.supportBuild='[^']+'/,'dataset.supportBuild=\''+build+'\'')));
 const changed=[...assets].filter(([file,b])=>!b.equals(baseline.get(file))).map(([file])=>file).sort();assert.equal(assets.size,94);assert.equal(changed.length,7);
 return {assets,baseline,changed,build};
}
function stage(destination){const result=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const[file,b]of result.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const report={build,changed:result.changed,resources:[...result.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')})),backendFilesIncluded:false,recovery:'10e2a88'};fs.writeFileSync(path.join(target,'shortload-release.json'),JSON.stringify(report,null,2)+'\n');return report;}
if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));module.exports={plan,stage};
