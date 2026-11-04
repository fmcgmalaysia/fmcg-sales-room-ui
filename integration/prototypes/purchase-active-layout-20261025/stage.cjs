'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const checkout=path.resolve(__dirname,'../../..');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'),'utf8'));
const baseline='6926ae01ea3db56d38d920aa8ca1144f7e82f71d';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const git=args=>cp.execFileSync('git',args,{cwd:checkout,maxBuffer:12000000});
const roots=new Set(['index.html','buyer-room.html','buyer-login.html','catalogue-sidebar-v1.html']);
const allowed=file=>roots.has(file)||/^(?:assets|master-shared|purchase-live|warehouse-room|support-room|account-room|sales-room)\/[A-Za-z0-9._-]+\.(?:html|js|css|png|jpg|jpeg|svg|ico|webp)$/.test(file);
function plan(){
 if(manifest.baseline!==baseline||manifest.backendChanged!==false||manifest.stockActivated!==false)throw Error('Approved static-only baseline required');
 const assets=new Map();
 for(const file of git(['ls-tree','-r','--name-only',baseline]).toString().trim().split('\n').filter(allowed))assets.set(file,git(['show',baseline+':'+file]));
 const expected=['purchase-live/active-layout.js','purchase-live/active-layout.css','purchase-live/task-grid.js','purchase-live/index.html'];
 if(manifest.files.length!==expected.length||expected.some(file=>!manifest.files.some(row=>row.target===file)))throw Error('Only approved four-resource overlay allowed');
 for(const row of manifest.files){const source=fs.readFileSync(path.join(__dirname,path.posix.basename(row.target)));if(hash(source)!==row.sha256)throw Error('Overlay content changed');assets.set(row.target,source);}
 for(const file of roots)if(!assets.has(file))throw Error('Protected public entry missing');
 for(const [file,bytes] of assets)if(file.endsWith('.html')){
  for(const match of String(bytes).matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g)){
   const value=match[1].split(/[?#]/)[0];if(!value||/^(?:https?:|data:|\/\/)/i.test(value)||value.includes("'+")||value.includes('${'))continue;
   const target=value.startsWith('/')?value.slice(1):path.posix.normalize(path.posix.join(path.posix.dirname(file),value));
   if(!assets.has(target))throw Error('Static dependency missing: '+file+' -> '+target);
  }
 }
 return assets;
}
function stage(destination){
 const assets=plan(),target=path.resolve(destination||'');
 if(!destination||fs.existsSync(target)||target===path.parse(target).root||target===checkout||target.startsWith(checkout+path.sep))throw Error('New artifact directory outside checkout required');
 fs.mkdirSync(target,{recursive:true});
 for(const [file,source] of assets){if(!allowed(file))throw Error('Unapproved publication path');const output=path.join(target,file);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,source);}
 const report={schema:'APPROVED_PURCHASE_LAYOUT_RELEASE_V1',build:manifest.build,baseline,codeCommit:git(['rev-parse','HEAD']).toString().trim(),
  resources:[...assets].map(([file,source])=>({path:file,sha256:hash(source)})),backendChanged:false,wixCodeChanged:false,stockActivated:false,notificationsConnected:false};
 fs.writeFileSync(path.join(target,'purchase-layout-release.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(require.main===module){const report=stage(process.argv[2]);console.log(JSON.stringify({resources:report.resources.length,build:report.build,codeCommit:report.codeCommit,backendChanged:false}));}
module.exports={plan,stage};
