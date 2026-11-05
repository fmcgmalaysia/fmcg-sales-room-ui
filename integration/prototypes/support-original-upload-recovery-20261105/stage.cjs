const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),build='20261105-support-original-upload-recovery-v1',hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function plan(){
 const baseline=new Map(require('../sales-date-segments-20261105/stage.cjs').plan().assets);
 for(const row of require('./baseline-manifest.json').resources)assert.equal(hash(baseline.get(row.path)),row.sha256,row.path);
 assert.equal(baseline.size,96);const assets=new Map(baseline);
 for(const file of ['support-room/workroom.js','support-room/workroom-model.js','support-room/workroom.html'])assets.set(file,Buffer.from(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')));
 const changed=[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file).sort();
 assert.deepEqual(changed,['support-room/workroom-model.js','support-room/workroom.html','support-room/workroom.js']);
 assert(assets.get('support-room/workroom.html').toString().includes(build));assert(assets.get('support-room/workroom.js').toString().includes(build));
 return{build,baseline,assets,changed};
}
function stage(destination){const target=path.resolve(destination);assert(!fs.existsSync(target)&&target!==path.parse(target).root);const p=plan();for(const[file,bytes]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}const manifest={build,baseline:'5a268f3f',changed:p.changed,unchanged:93,resources:[...p.assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)}))};fs.writeFileSync(path.join(target,'support-original-upload-recovery-release.json'),JSON.stringify(manifest,null,2));return manifest;}
module.exports={plan,stage,build};if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));
