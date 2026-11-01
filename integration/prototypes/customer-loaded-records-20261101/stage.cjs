'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),build='20261101-customer-loaded-records-v1',hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const changedFiles=['account-room/customer-debtors.js','account-room/settlement.js','buyer-room.html','index.html','master-shared/shipment-batches.js','master-shared/stock-exceptions.js','purchase-live/app.js','purchase-live/supplier-allocation.js','sales-room/customer-documents.js','support-room/workroom-model.js','support-room/workroom.html','support-room/workroom.js'];
const added=['customer-history/history.js','customer-history/history.css'];
function plan(){
 const zipped=fs.readFileSync(path.join(__dirname,'public-baseline-f8aba73.json.gz'));assert.equal(hash(zipped),'c45edc16dd78515bff18d552146841c4e3f39318aacbcd8cb1cdbd2b8a3e8e3d');
 const record=JSON.parse(zlib.gunzipSync(zipped));assert.equal(record.commit,'f8aba73b48e1515c8787a66fc98c61f273da4fa5');assert.equal(record.assets.length,99);
 const baseline=new Map(record.assets.map(r=>{const b=Buffer.from(r.base64,'base64');assert.equal(hash(b),r.sha256,r.path);return[r.path,b];})),assets=new Map(baseline);
 for(const patch of JSON.parse(fs.readFileSync(path.join(__dirname,'patches.json'),'utf8'))){assert(changedFiles.includes(patch.file));let value=assets.get(patch.file).toString().replace(/\r\n/g,'\n');assert(patch.before);assert.equal(value.split(patch.before).length,2,patch.file+' unique baseline hunk');assets.set(patch.file,Buffer.from(value.replace(patch.before,()=>patch.after)));}
 for(const file of added)assets.set(file,Buffer.from(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')));
 let support=assets.get('support-room/workroom.js').toString();assert.match(support,/dataset\.supportBuild='[^']+'/);support=support.replace(/dataset\.supportBuild='[^']+'/,"dataset.supportBuild='"+build+"'");assets.set('support-room/workroom.js',Buffer.from(support));
 const scripts=[...changedFiles,...added],entries=[];
 for(const [file,bytes]of assets){if(!file.endsWith('.html'))continue;let html=bytes.toString(),changed=false;
  for(const script of scripts){const relative=path.posix.relative(path.posix.dirname(file),script),escaped=relative.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp('('+escaped+'\\?v=)[^"&]+','g');if(pattern.test(html)){html=html.replace(pattern,'$1'+build);changed=true;}}
  if(changed||changedFiles.includes(file)){html=html.replace(/(<meta name="build" content=")[^"]+/,'$1'+build);assets.set(file,Buffer.from(html));entries.push(file);}
 }
 const changed=[...assets].filter(([f,b])=>!baseline.has(f)||!b.equals(baseline.get(f))).map(([f])=>f).sort();assert.equal(assets.size,101);assert(changed.every(f=>[...changedFiles,...added,...entries].includes(f)));assert(assets.get('purchase-live/customer-allocation.js').equals(baseline.get('purchase-live/customer-allocation.js')));assert(assets.get('master-shared/desk-delivery.js').equals(baseline.get('master-shared/desk-delivery.js')));
 return {baseline,assets,changed,entries,build};
}
function stage(destination){const target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);const p=plan();for(const [file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const report={build,baseline:'f8aba73',changed:p.changed,resources:[...p.assets].map(([file,b])=>({path:file,sha256:hash(b)}))};fs.writeFileSync(path.join(target,'customer-loaded-records-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const r=stage(process.argv[2]);console.log(JSON.stringify({build,resources:r.resources.length,changed:r.changed}));}module.exports={plan,stage,build};
