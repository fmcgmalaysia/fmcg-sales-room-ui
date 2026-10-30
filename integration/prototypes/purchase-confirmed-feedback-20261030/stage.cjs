'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process'),previous=require('../purchase-active-only-20261030/stage.cjs'),root=path.resolve(__dirname,'../../..');
const build='20261030-purchase-confirmed-feedback-v1',hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function plan(){
 const inherited=previous.plan(),assets=new Map(inherited.assets),baseline=new Map(assets);assert.equal(assets.size,94);
 let app=assets.get('purchase-live/app.js').toString();
 const hunks=[
  ['modal.close();request(true);if(completed?', 'modal.close();request(true,true);if(completed?'],
  ['function request(quiet=false) {','function request(quiet=false,confirmedSave=false) {'],
  ['pending = { requestId, company, quiet };','pending = { requestId, company, quiet, confirmedSave };'],
  ['const quiet=pending.quiet;pending = null;\n    if(quiet&&editingTask())return;', "const quiet=pending.quiet,confirmedSave=pending.confirmedSave;pending = null;\n    if(quiet&&editingTask()&&(!confirmedSave||savePending||costRetry))return;\n    const preserveEditing=quiet&&Boolean(drafts.size||sequenceDraft||modal.open||document.activeElement?.matches?.('input,select,textarea'));"],
  ["time(result.fetchedAt); render();window.DeskDelivery", "time(result.fetchedAt); if(!preserveEditing)render();window.DeskDelivery"]
 ];
 for(const[find,replace]of hunks){assert.equal(app.split(find).length,2,'Unique confirmed-read patch');app=app.replace(find,()=>replace);}
 assets.set('purchase-live/app.js',Buffer.from(app));
 assets.set('purchase-live/supplier-allocation.js',Buffer.from(fs.readFileSync(path.join(root,'purchase-live/supplier-allocation.js'),'utf8').replace(/\r\n/g,'\n')));
 let index=assets.get('purchase-live/index.html').toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);
 for(const file of ['app.js','supplier-allocation.js'])index=index.replace(new RegExp('(src="'+file.replace('.','\\.')+'\\?v=)[^"&]+'),'$1'+build);
 assets.set('purchase-live/index.html',Buffer.from(index));
 const changed=[...assets].filter(([file,bytes])=>hash(bytes)!==hash(baseline.get(file))).map(([file])=>file);assert.deepEqual(changed.sort(),['purchase-live/app.js','purchase-live/index.html','purchase-live/supplier-allocation.js']);return {...inherited,build,assets,baseline,changed};
}
function stage(destination){const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const[file,bytes]of p.assets){const output=path.join(target,file);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);}const report={build,codeCommit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),productionRecovery:'864322fcf7be0262a8ab0dba809dec9029426a3a',resources:[...p.assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)})),retired:p.retired,redirects:p.redirects,changed:p.changed,backendFilesIncluded:false,wixCodeChangeRequired:true};fs.writeFileSync(path.join(target,'confirmed-feedback-release.json'),JSON.stringify(report,null,2)+'\n');return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,resources:p.resources.length,changed:p.changed}));}module.exports={plan,stage};
