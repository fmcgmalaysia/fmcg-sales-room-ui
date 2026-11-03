const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),build='20261103-buyer-entry-parent-v1',baselineCommit='0de747399222cd69997af29f99bb70af333f284e';
const protectedHashes={'buyer-room.html':'2b97f3489c957513681b24f5244614a9964c94ab4683caf0d64732ee0a7ee0d0','customer-history/history.js':'02310143eef429c305c8fae96737e99e26fb71b562345ecec8f8d1b4ca4f863a','index.html':'fd36d49a40f790bff64dfa573f9fbcffa5c6a21f7647dcad127e2beefc617381'};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function plan(){
 const baseline=new Map(require('../purchase-saved-plan-close-20261103/stage.cjs').plan().assets);
 // Freeze the user-verified download package instead of rereading mutable entry files.
 for(const[file,expected]of Object.entries(protectedHashes)){const bytes=Buffer.from(cp.execFileSync('git',['show',baselineCommit+':'+file],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n'));assert.equal(hash(bytes),expected,file);baseline.set(file,bytes);}
 const assets=new Map(baseline);assets.set('index.html',Buffer.from(fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/\r\n/g,'\n')));
 const changed=[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file);assert.equal(assets.size,101);assert.deepEqual(changed,['index.html']);return {build,baseline,assets,changed};
}
function stage(destination){const target=path.resolve(destination);assert(!fs.existsSync(target)&&target!==path.parse(target).root);const p=plan();for(const[file,bytes]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}const manifest={build,baseline:baselineCommit,changed:p.changed,unchanged:100,resources:[...p.assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)}))};fs.writeFileSync(path.join(target,'buyer-entry-parent-release.json'),JSON.stringify(manifest,null,2));return manifest;}
module.exports={build,baselineCommit,plan,stage};if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));
