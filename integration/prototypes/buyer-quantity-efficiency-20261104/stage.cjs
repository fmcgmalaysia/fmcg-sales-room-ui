const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),build='20261104-buyer-quantity-efficiency-v1';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function plan(){
 const baseline=new Map(require('../sales-customer-selected-20261104/stage.cjs').plan().assets),assets=new Map(baseline);
 assets.set('buyer-room.html',Buffer.from(fs.readFileSync(path.join(root,'buyer-room.html'),'utf8').replace(/\r\n/g,'\n')));
 const changed=[...assets].filter(([file,b])=>!b.equals(baseline.get(file))).map(([file])=>file);
 assert.equal(assets.size,101);assert.deepEqual(changed,['buyer-room.html']);
 return {build,baseline,assets,changed};
}
function stage(destination){const target=path.resolve(destination);assert(!fs.existsSync(target)&&target!==path.parse(target).root);const p=plan();for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const manifest={build,baseline:'ae151e8',changed:p.changed,unchanged:100,resources:[...p.assets].map(([file,b])=>({path:file,sha256:hash(b)}))};fs.writeFileSync(path.join(target,'buyer-quantity-efficiency-release.json'),JSON.stringify(manifest,null,2));return manifest;}
module.exports={build,plan,stage};if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));
