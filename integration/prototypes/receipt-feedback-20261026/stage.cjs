'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const checkout=path.resolve(__dirname,'../../..');
const original='6926ae01ea3db56d38d920aa8ca1144f7e82f71d',previous='dd234f9d5e28227d5841a632acce4f7be583e1f6';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const git=args=>cp.execFileSync('git',args,{cwd:checkout,maxBuffer:12000000});
const text=bytes=>Buffer.from(String(bytes).replace(/\r\n/g,'\n'));
const entrypoints=new Set(['index.html','buyer-room.html','buyer-login.html','catalogue-sidebar-v1.html']);
const allowed=file=>entrypoints.has(file)||/^(?:assets|master-shared|purchase-live|warehouse-room|support-room|account-room|sales-room)\/[A-Za-z0-9._-]+\.(?:html|js|css|png|jpg|jpeg|svg|ico|webp)$/.test(file);
function plan(){
 const assets=new Map();
 for(const file of git(['ls-tree','-r','--name-only',original]).toString().trim().split('\n').filter(allowed))assets.set(file,git(['show',original+':'+file]));
 const prior=JSON.parse(git(['show',previous+':integration/prototypes/purchase-active-layout-20261025/manifest.json']).toString());
 for(const row of prior.files){const bytes=git(['show',previous+':integration/prototypes/purchase-active-layout-20261025/'+path.posix.basename(row.target)]);if(hash(bytes)!==row.sha256)throw Error('Previous approved overlay does not match');assets.set(row.target,bytes);}
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'),'utf8'));
 if(manifest.productionRecovery!==previous||manifest.files.length!==12)throw Error('Scoped receipt-feedback overlay required');
 for(const row of manifest.files){if(!allowed(row.target)||!assets.has(row.target))throw Error('New public entry not approved');const bytes=text(fs.readFileSync(path.join(__dirname,row.target)));if(hash(bytes)!==row.sha256)throw Error('Receipt overlay content changed: '+row.target);assets.set(row.target,bytes);}
 if(assets.size!==95||[...assets.keys()].some(file=>file.startsWith('integration/')))throw Error('Public resource boundary changed');
 return {assets,manifest};
}
function stage(destination){
 const {assets,manifest}=plan(),target=path.resolve(destination||'');
 if(!destination||fs.existsSync(target)||target===checkout||target.startsWith(checkout+path.sep)||target===path.parse(target).root)throw Error('New artifact directory outside checkout required');
 fs.mkdirSync(target,{recursive:true});for(const [file,bytes]of assets){const output=path.join(target,file);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);}
 const report={build:manifest.build,codeCommit:git(['rev-parse','HEAD']).toString().trim(),productionRecovery:previous,resources:[...assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)})),backendFilesIncluded:false,matchingWixBackendRequired:true,backendExpectedSha256:manifest.backendExpectedSha256};
 fs.writeFileSync(path.join(target,'receipt-feedback-release.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(require.main===module){const report=stage(process.argv[2]);console.log(JSON.stringify({build:report.build,codeCommit:report.codeCommit,resources:report.resources.length,backendFilesIncluded:false}));}
module.exports={plan,stage};
