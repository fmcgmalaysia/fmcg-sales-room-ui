'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const checkout=path.resolve(__dirname,'../../..'),base=require('../receipt-feedback-20261026/stage.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),normalize=bytes=>Buffer.from(String(bytes).replace(/\r\n/g,'\n'));
const allowed=new Set(['support-room/workroom.html','support-room/workroom.css','support-room/workroom.js','support-room/workroom-model.js','support-room/packing-workbench.html']);
function plan(){
 const previous=base.plan(),manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'),'utf8'));
 if(previous.assets.size!==95||manifest.previousBuild!==previous.manifest.build||manifest.productionRecovery!=='d081bae2b07233e9d7b3a4da2e7a91cbb1695a73'||manifest.files.length!==5||new Set(manifest.files.map(row=>row.target)).size!==5)throw Error('Support release baseline changed');
 const assets=new Map(previous.assets);
 for(const row of manifest.files){if(!allowed.has(row.target))throw Error('Unexpected Support public file');const bytes=normalize(fs.readFileSync(path.join(checkout,row.target)));if(hash(bytes)!==row.sha256)throw Error('Support content changed: '+row.target);assets.set(row.target,bytes);}
 if(assets.size!==99)throw Error('Support resource boundary changed');
 for(const [file,bytes]of previous.assets)if(file!=='support-room/packing-workbench.html'&&hash(assets.get(file))!==hash(bytes))throw Error('Protected public resource changed: '+file);
 return {assets,manifest};
}
function stage(destination){
 const {assets,manifest}=plan(),target=path.resolve(destination||'');
 if(!destination||fs.existsSync(target)||target===checkout||target.startsWith(checkout+path.sep)||target===path.parse(target).root)throw Error('New artifact directory outside checkout required');
 fs.mkdirSync(target,{recursive:true});for(const [file,bytes]of assets){const output=path.join(target,file);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);}
 const report={build:manifest.build,codeCommit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim(),productionRecovery:manifest.productionRecovery,resources:[...assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)})),backendFilesIncluded:false,wixRequired:manifest.wixRequired,documentServiceVersion:manifest.documentServiceVersion};
 fs.writeFileSync(path.join(target,'support-workroom-release.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(require.main===module){const result=stage(process.argv[2]);console.log(JSON.stringify({build:result.build,resources:result.resources.length,backendFilesIncluded:false}));}
module.exports={plan,stage};
