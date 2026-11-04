'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process'),root=path.resolve(__dirname,'../../..');
const build='20261030-po-revision-paid-lock-v1',hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function plan(){
 const preview=require('./preview.cjs').plan(),assets=new Map(preview.assets),baseline=new Map(preview.baseline);
 for(const name of ['AUTHORITY_UI_PATCHES.json','../support-planned-loaded-20261030/UI_PATCHES.json'])for(const patch of JSON.parse(fs.readFileSync(path.join(__dirname,name),'utf8')).patches){let s=assets.get(patch.file).toString();for(const h of patch.hunks){assert.equal(s.split(h.find).length,2,patch.file+' unique release hunk');s=s.replace(h.find,()=>h.replace);}assets.set(patch.file,Buffer.from(s));}
 for(const [folder,page,scripts]of [['purchase-live','index.html',['app.js','supplier-allocation.js','style.css']],['account-room','index.html',['payment-layout.js','settlement.js']],['support-room','workroom.html',['workroom.js','workroom.css']]]){
  const file=folder+'/'+page;let s=assets.get(file).toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);
  for(const script of scripts)s=s.replace(new RegExp('('+script.replace('.','\\.')+'\\?v=)[^"&]+','g'),'$1'+build);
  assets.set(file,Buffer.from(s));
 }
 let support=assets.get('support-room/workroom.js').toString();assert.equal(support.split("dataset.supportBuild='20261029-support-details-v1'").length,2);assets.set('support-room/workroom.js',Buffer.from(support.replace("dataset.supportBuild='20261029-support-details-v1'","dataset.supportBuild='"+build+"'")));
 const changed=[...assets].filter(([f,b])=>!b.equals(baseline.get(f))).map(([f])=>f).sort();assert.equal(assets.size,94);assert.deepEqual(changed,['account-room/index.html','account-room/payment-layout.js','account-room/settlement.js','purchase-live/app.js','purchase-live/index.html','purchase-live/style.css','purchase-live/supplier-allocation.js','support-room/workroom.css','support-room/workroom.html','support-room/workroom.js']);
 return {assets,baseline,changed,build,deployable:true};
}
function stage(destination){const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const[f,b]of p.assets){const out=path.join(target,f);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const report={build,codeCommit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),resources:[...p.assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)})),changed:p.changed,backendFilesIncluded:false,wixCodeChangeRequired:true,productionRecovery:'4ec81129a73c1fdac928c556c670c755c8792863'};fs.writeFileSync(path.join(target,'po-revision-release.json'),JSON.stringify(report,null,2)+'\n');return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,resources:p.resources.length,changed:p.changed}));}module.exports={plan,stage};
