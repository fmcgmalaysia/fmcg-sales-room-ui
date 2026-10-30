'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process'),previous=require('../purchase-confirmed-feedback-20261030/stage.cjs'),root=path.resolve(__dirname,'../../..');
const build='20261030-support-planned-loaded-v1',hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function plan(){
 const inherited=previous.plan(),baseline=new Map(inherited.assets),assets=new Map(baseline),patches=JSON.parse(fs.readFileSync(path.join(__dirname,'UI_PATCHES.json'),'utf8'));
 assert.equal(assets.size,94);
 for(const patch of patches.patches){let text=assets.get(patch.file).toString();for(const hunk of patch.hunks){assert.equal(text.split(hunk.find).length,2,patch.file+' unique totals patch');text=text.replace(hunk.find,()=>hunk.replace);}assets.set(patch.file,Buffer.from(text));}
 let index=assets.get('support-room/workroom.html').toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);for(const file of ['workroom.js','workroom.css'])index=index.replace(new RegExp('('+file.replace('.','\\.')+'\\?v=)[^"&]+'),'$1'+build);assets.set('support-room/workroom.html',Buffer.from(index));
 const js=assets.get('support-room/workroom.js').toString();assert.equal(js.split("dataset.supportBuild='20261029-support-details-v1'").length,2);assets.set('support-room/workroom.js',Buffer.from(js.replace("dataset.supportBuild='20261029-support-details-v1'","dataset.supportBuild='"+build+"'")));
 const changed=[...assets].filter(([file,bytes])=>hash(bytes)!==hash(baseline.get(file))).map(([file])=>file);assert.deepEqual(changed.sort(),['support-room/workroom.css','support-room/workroom.html','support-room/workroom.js']);
 assert.match(assets.get('support-room/workroom.js').toString(),/location\.ancestorOrigins\?\.\[0\]\|\|document\.referrer/);
 return {...inherited,assets,baseline,changed,build};
}
function stage(destination){const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const[file,bytes]of p.assets){const dest=path.join(target,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);}const report={build,codeCommit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),resources:[...p.assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)})),changed:p.changed,backendFilesIncluded:false,wixCodeChangeRequired:true,productionRecovery:'4ec81129a73c1fdac928c556c670c755c8792863',retired:p.retired,redirects:p.redirects};fs.writeFileSync(path.join(target,'support-totals-release.json'),JSON.stringify(report,null,2)+'\n');return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,resources:p.resources.length,changed:p.changed}));}module.exports={plan,stage};
