const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),build='20261104-sales-selection-layout-v1',baselineCommit='7d28c83';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function plan(){
 const baseline=new Map(require('../buyer-quantity-efficiency-20261104/stage.cjs').plan().assets);
 baseline.set('index.html',Buffer.from(cp.execFileSync('git',['show',baselineCommit+':index.html'],{cwd:root,encoding:'utf8',maxBuffer:1024*1024}).replace(/\r\n/g,'\n')));
 const expected=require('./baseline-manifest.json');
 assert.equal(baseline.size,101);for(const r of expected.resources)assert.equal(hash(baseline.get(r.path)),r.sha256,r.path);
 const assets=new Map(baseline);assets.set('index.html',Buffer.from(fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/\r\n/g,'\n')));
 const changed=[...assets].filter(([file,b])=>!b.equals(baseline.get(file))).map(([file])=>file);
 assert.deepEqual(changed,['index.html']);return {build,baseline,assets,changed};
}
function stage(destination){const target=path.resolve(destination);assert(!fs.existsSync(target)&&target!==path.parse(target).root);const p=plan();for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const manifest={build,baseline:baselineCommit,changed:p.changed,unchanged:100,resources:[...p.assets].map(([file,b])=>({path:file,sha256:hash(b)}))};fs.writeFileSync(path.join(target,'sales-selection-layout-release.json'),JSON.stringify(manifest,null,2));return manifest;}
module.exports={build,baselineCommit,plan,stage};if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));
