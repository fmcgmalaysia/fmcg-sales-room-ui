'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const checkout=path.resolve(__dirname,'../../..'),receipt=require('../receipt-feedback-20261026/stage.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const normalized=bytes=>Buffer.from(String(bytes).replace(/\r\n/g,'\n'));
const git=args=>cp.execFileSync('git',args,{cwd:checkout,maxBuffer:12000000});
const entries=['purchase-live/index.html','account-room/index.html','warehouse-room/index.html','support-room/index.html','support-room/workroom.html'];
function replaceOne(bytes,pattern,replacement,label,count=1){const value=bytes.toString(),matches=value.match(new RegExp(pattern.source,'g'));if(matches?.length!==count)throw Error('Exact version patch count required: '+label);return Buffer.from(value.replace(new RegExp(pattern.source,'g'),replacement));}
function plan(sourceCommit){
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'),'utf8'));
 const assets=new Map(receipt.plan(sourceCommit).assets);
 const support=JSON.parse(git(['show',manifest.baselineSource+':integration/prototypes/support-workroom-20261027/manifest.json']).toString());
 for(const row of support.files){const bytes=normalized(git(['show',manifest.baselineSource+':'+row.target]));if(hash(bytes)!==row.sha256)throw Error('Support recovery content changed');assets.set(row.target,bytes);}
 if(assets.size!==99||manifest.baselineResources.length!==99)throw Error('Existing public boundary changed');
 for(const row of manifest.baselineResources)if(!assets.has(row.path)||hash(assets.get(row.path))!==row.sha256)throw Error('Public recovery differs: '+row.path);
 const previous=new Map(assets);
 for(const row of manifest.files){if(!['master-shared/task-chat.js','support-room/workroom.js'].includes(row.target))throw Error('Unexpected business-source change');const bytes=normalized(sourceCommit?git(['show',sourceCommit+':'+row.target]):fs.readFileSync(path.join(checkout,row.target)));if(hash(bytes)!==row.sha256)throw Error('Candidate source changed: '+row.target);assets.set(row.target,bytes);}
 for(const file of entries){let bytes=assets.get(file);bytes=replaceOne(bytes,/(\.\.\/master-shared\/task-chat\.js\?v=)[^"&]+/,'$1'+manifest.build,file+' chat');bytes=replaceOne(bytes,/(<meta name="build" content=")[^"]+(">)/,'$1'+manifest.build+'$2',file+' marker');if(file==='support-room/workroom.html')bytes=replaceOne(bytes,/(src="workroom\.js\?v=)[^"&]+/,'$1'+manifest.build,file+' workroom');assets.set(file,bytes);}
 let supportJs=assets.get('support-room/workroom.js');
 supportJs=replaceOne(supportJs,/dataset\.supportBuild='20261027-support-shipment-header-v2'/,"dataset.supportBuild='"+manifest.build+"'",'Support marker');
 supportJs=replaceOne(supportJs,/(packing-workbench\.html\?v=)20261021-packing-v1/,'$1'+manifest.build,'Support packing link',2);assets.set('support-room/workroom.js',supportJs);
 let packingJs=assets.get('support-room/packing-workbench.js');packingJs=replaceOne(packingJs,/(\.\.\/master-shared\/task-chat\.js\?v=)20261021-packing-v1/,'$1'+manifest.build,'Packing chat');assets.set('support-room/packing-workbench.js',packingJs);
 let packingHtml=assets.get('support-room/packing-workbench.html');packingHtml=replaceOne(packingHtml,/(packing-workbench\.js\?v=)[^"&]+/,'$1'+manifest.build,'Packing script');packingHtml=replaceOne(packingHtml,/(<meta name="build" content=")[^"]+(">)/,'$1'+manifest.build+'$2','Packing marker');assets.set('support-room/packing-workbench.html',packingHtml);
 const changed=[...assets].filter(([file,bytes])=>hash(bytes)!==hash(previous.get(file))).map(([file])=>file);
 const allowed=new Set([...entries,'master-shared/task-chat.js','support-room/workroom.js','support-room/packing-workbench.js','support-room/packing-workbench.html']);
 if(changed.length!==9||changed.some(file=>!allowed.has(file)))throw Error('Optimization exceeded the nine-resource boundary');
 return {assets,manifest,changed,protectedResources:99-changed.length};
}
function stage(destination){const {assets,manifest,changed,protectedResources}=plan(),target=path.resolve(destination||'');if(!destination||fs.existsSync(target)||target===checkout||target.startsWith(checkout+path.sep)||target===path.parse(target).root)throw Error('New artifact directory outside checkout required');fs.mkdirSync(target,{recursive:true});for(const [file,bytes]of assets){const output=path.join(target,file);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);}const report={build:manifest.build,codeCommit:git(['rev-parse','HEAD']).toString().trim(),productionRecovery:manifest.productionRecovery,resources:[...assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)})),changed,protectedResources,backendFilesIncluded:false,wixCodeChangeRequired:false};fs.writeFileSync(path.join(target,'master-efficiency-release.json'),JSON.stringify(report,null,2)+'\n');return report;}
if(require.main===module){const result=stage(process.argv[2]);console.log(JSON.stringify({build:result.build,resources:result.resources.length,changed:result.changed,protectedResources:result.protectedResources,backendFilesIncluded:false}));}
module.exports={plan,stage};
