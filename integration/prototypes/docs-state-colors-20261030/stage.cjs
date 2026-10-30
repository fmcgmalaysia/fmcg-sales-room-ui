'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const previous=require('../po-revision-ui-20261030/stage-state-colors.cjs');
const build='20261030-docs-synced-colors-v1';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function plan(){
 const inherited=previous.plan(),baseline=new Map(inherited.assets),assets=new Map(baseline);
 const patch=(file,old,next)=>{const text=assets.get(file).toString();assert.equal(text.split(old).length,2,file+' unique color-only patch');assets.set(file,Buffer.from(text.replace(old,()=>next)));};
 patch('purchase-live/style.css','.po-doc-badge.pending{background:#B8C4D0;border-color:#B8C4D0;color:#fff}',
  '.po-doc-badge.pending{background:#F58A00;border-color:#F58A00;color:#fff}');
 patch('account-room/payment-layout.js',"(issue?'red':present?'green':'waiting')","(issue?'red':present?'green':shared?.state==='MISSING'?'orange':'waiting')");
 for(const [file,script]of [['purchase-live/index.html','style.css'],['account-room/index.html','payment-layout.js']]){
  const text=assets.get(file).toString(),meta=text.match(/<meta name="build" content="[^"]+">/),token=text.match(new RegExp(script.replace('.','\\.')+'\\?v=[^"&]+'));
  assert(meta&&token);patch(file,meta[0],'<meta name="build" content="'+build+'">');patch(file,token[0],script+'?v='+build);
 }
 const changed=[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file).sort();
 assert.equal(assets.size,94);assert.deepEqual(changed,['account-room/index.html','account-room/payment-layout.js','purchase-live/index.html','purchase-live/style.css']);
 return {assets,baseline,changed,build};
}
function stage(destination){
 const p=plan(),target=path.resolve(destination||''),root=path.resolve(__dirname,'../../..');
 assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);
 fs.mkdirSync(target,{recursive:true});for(const[file,bytes]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}
 const report={build,changed:p.changed,resources:[...p.assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)})),backendFilesIncluded:false,productionRecovery:'3ec06032a3780ed4c45b1b8c830b978dbb648b3f'};
 fs.writeFileSync(path.join(target,'docs-colors-release.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,resources:p.resources.length,changed:p.changed}));}
module.exports={plan,stage};
