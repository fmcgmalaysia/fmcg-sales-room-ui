const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),build='20261104-sales-customer-selected-v1',baselineCommit='7c6122d';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function plan(){
 const baseline=new Map(require('../purchase-save-consistency-20261103/stage.cjs').plan().assets);
 const original=Buffer.from(cp.execFileSync('git',['show',baselineCommit+':index.html'],{cwd:root,encoding:'utf8',maxBuffer:1024*1024}).replace(/\r\n/g,'\n'));
 baseline.set('index.html',original);
 const assets=new Map(baseline);assets.set('index.html',Buffer.from(fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/\r\n/g,'\n')));
 const changed=[...assets].filter(([p,b])=>!b.equals(baseline.get(p))).map(([p])=>p);
 assert.equal(assets.size,101);assert.deepEqual(changed,['index.html']);return {build,baseline,assets,changed};
}
function stage(destination){const target=path.resolve(destination);assert(!fs.existsSync(target)&&target!==path.parse(target).root);const p=plan();for(const [file,bytes]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}const manifest={build,baseline:baselineCommit,changed:p.changed,unchanged:100,resources:[...p.assets].map(([file,b])=>({path:file,sha256:hash(b)}))};fs.writeFileSync(path.join(target,'sales-customer-selected-release.json'),JSON.stringify(manifest,null,2));return manifest;}
module.exports={build,baselineCommit,plan,stage};if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));
