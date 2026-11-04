const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const build='20261103-customer-file-parent-open-v1',allowed=['buyer-room.html','customer-history/history.js','index.html'];
function plan(){
 const baseline=require('../purchase-saved-plan-close-20261103/stage.cjs').plan().assets,assets=new Map(baseline);
 for(const file of allowed)assets.set(file,Buffer.from(fs.readFileSync(path.resolve(__dirname,'../../..',file),'utf8').replace(/\r\n/g,'\n')));
 const changed=[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file).sort();
 assert.equal(assets.size,101);assert.deepEqual(changed,allowed);
 for(const file of ['buyer-room.html','index.html']){const html=assets.get(file).toString();assert(html.includes('customer-history/history.js?v='+build));assert(html.includes('content="'+build+'"'));}
 return {build,baseline,assets,changed};
}
function stage(destination){
 const target=path.resolve(destination);assert(!fs.existsSync(target)&&target!==path.parse(target).root);const p=plan();
 for(const [file,bytes]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}
 const manifest={build,baseline:'859f6ca',changed:p.changed,unchanged:98,resources:[...p.assets].map(([file,bytes])=>({path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}))};
 fs.writeFileSync(path.join(target,'customer-file-parent-open-release.json'),JSON.stringify(manifest,null,2));return manifest;
}
module.exports={build,plan,stage};if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));
