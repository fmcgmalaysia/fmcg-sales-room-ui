const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),build='20261103-purchase-save-consistency-v1',allowed=['purchase-live/app.js','purchase-live/index.html','purchase-live/task-grid.js'];
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function plan(){
 const baseline=new Map(require('../buyer-entry-parent-20261103/stage.cjs').plan().assets),assets=new Map(baseline);
 for(const file of allowed)assets.set(file,Buffer.from(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')));
 const changed=[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file).sort();assert.equal(assets.size,101);assert.deepEqual(changed,allowed);
 const html=assets.get('purchase-live/index.html').toString();for(const text of ['content="'+build+'"','app.js?v='+build,'task-grid.js?v='+build])assert(html.includes(text),text);
 return {build,baseline,assets,changed};
}
function stage(destination){
 const target=path.resolve(destination);assert(!fs.existsSync(target)&&target!==path.parse(target).root);const p=plan();
 for(const[file,bytes]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}
 const manifest={build,baseline:'e1138ea',changed:p.changed,unchanged:98,resources:[...p.assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)}))};fs.writeFileSync(path.join(target,'purchase-save-consistency-release.json'),JSON.stringify(manifest,null,2));return manifest;
}
module.exports={build,plan,stage};if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));
