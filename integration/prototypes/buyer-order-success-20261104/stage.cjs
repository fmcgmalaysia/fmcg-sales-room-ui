const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),build='20261104-buyer-order-success-v1';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const versioned=(revision,file)=>Buffer.from(cp.execFileSync('git',['show',revision+':'+file],{cwd:root,encoding:'utf8',maxBuffer:1024*1024}).replace(/\r\n/g,'\n'));
function plan(){
 const baseline=new Map(require('../purchase-save-consistency-20261103/stage.cjs').plan().assets);
 baseline.set('index.html',versioned('4bc463e','index.html'));
 baseline.set('buyer-room.html',versioned('44c698f3','buyer-room.html'));
 const expected=require('./baseline-manifest.json');assert.equal(baseline.size,101);
 for(const row of expected.resources)assert.equal(hash(baseline.get(row.path)),row.sha256,row.path);
 const assets=new Map(baseline);assets.set('buyer-room.html',Buffer.from(fs.readFileSync(path.join(root,'buyer-room.html'),'utf8').replace(/\r\n/g,'\n')));
 const changed=[...assets].filter(([file,b])=>!b.equals(baseline.get(file))).map(([file])=>file);
 assert.deepEqual(changed,['buyer-room.html']);return {build,baseline,assets,changed};
}
function stage(destination){const target=path.resolve(destination);assert(!fs.existsSync(target)&&target!==path.parse(target).root);const p=plan();for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const manifest={build,baseline:'44c698f3',changed:p.changed,unchanged:100,resources:[...p.assets].map(([file,b])=>({path:file,sha256:hash(b)}))};fs.writeFileSync(path.join(target,'buyer-order-success-release.json'),JSON.stringify(manifest,null,2));return manifest;}
module.exports={build,plan,stage};if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));
