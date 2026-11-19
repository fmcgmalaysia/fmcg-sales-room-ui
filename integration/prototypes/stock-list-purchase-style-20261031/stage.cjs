// Stock List presentation only, layered on the accepted company-stock release.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),previous=require('../company-stock-list-20261031/stage.cjs'),build='20261031-stock-list-purchase-v1';
function plan(){
 const baseline=new Map(previous.plan().assets);
 baseline.set('master-shared/stock-list.css',execFileSync('git',['show','035cf57:master-shared/stock-list.css'],{cwd:root}));
 const assets=new Map(baseline);assets.set('master-shared/stock-list.css',fs.readFileSync(path.join(root,'master-shared/stock-list.css')));
 for(const file of ['warehouse-room/stock-control.html','account-room/stock-list.html','warehouse-room/stock-control-link.js','account-room/stock-list-link.js','warehouse-room/index.html','account-room/index.html']){
  const before=assets.get(file).toString();assert(before.includes('20261031-company-stock-list-v1'),file);assets.set(file,Buffer.from(before.replaceAll('20261031-company-stock-list-v1',build)));
 }
 const changed=[...assets].filter(([file,b])=>!b.equals(baseline.get(file))).map(([file])=>file).sort();assert.equal(changed.length,7);assert.equal(assets.size,97);
 return {assets,baseline,changed,build};
}
function stage(destination){const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const report={build,changed:p.changed,resources:[...p.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')})),backendFilesIncluded:false,recovery:'4c1e7a5 static, 6b6ea23 Wix runtime'};fs.writeFileSync(path.join(target,'stock-style-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,changed:p.changed,resources:p.resources.length}));}module.exports={plan,stage};
