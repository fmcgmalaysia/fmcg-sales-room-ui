const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const build='20261103-support-reusable-desk-v1';
function plan(){
 const baseline=require('../master-stress-closeout-20261103/stage.cjs').plan().assets,assets=new Map(baseline);
 for(const patch of require('./patches.json')){
  let text=assets.get(patch.file).toString().replace(/\r\n/g,'\n');
  for(const edit of patch.edits){assert.equal(text.split(edit.before).length,2,'Unique deployed anchor: '+patch.file);text=text.replace(edit.before,()=>edit.after);}
  assets.set(patch.file,Buffer.from(text));
 }
 for(const file of ['support-room/workroom.html','warehouse-room/index.html','purchase-live/index.html']){
  let html=assets.get(file).toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build).replace(/(desk-delivery\.js\?v=)[^"&]+/g,'$1'+build);
  if(file.startsWith('support-room'))html=html.replace(/(workroom(?:-model)?\.js\?v=)[^"&]+/g,'$1'+build).replace(/(workroom\.css\?v=)[^"&]+/g,'$1'+build);
  assets.set(file,Buffer.from(html));
 }
 const changed=[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file).sort();
 assert.deepEqual(changed,['master-shared/desk-delivery.js','purchase-live/index.html','support-room/workroom-model.js','support-room/workroom.css','support-room/workroom.html','support-room/workroom.js','warehouse-room/index.html']);assert.equal(assets.size,101);
 return {build,baseline,assets,changed};
}
function stage(destination){const target=path.resolve(destination);assert(!fs.existsSync(target));const result=plan();for(const[file,bytes]of result.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}const manifest={build,baseline:'b5af6a1',changed:result.changed,unchanged:94,resources:[...result.assets].map(([file,bytes])=>({path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}))};fs.writeFileSync(path.join(target,'support-reusable-desk-release.json'),JSON.stringify(manifest,null,2));return manifest;}
module.exports={build,plan,stage};if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));
