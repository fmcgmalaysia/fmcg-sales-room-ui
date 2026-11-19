'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),build='20261102-customer-invoice-payments-v1',hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const contentFiles=['account-room/customer-debtors.js','customer-history/history.js','customer-history/history.css','support-room/workroom-model.js','support-room/workroom.js'];
function plan(){
 const zip=fs.readFileSync(path.join(__dirname,'public-baseline-28bcf9a.json.gz'));assert.equal(hash(zip),'0a6ddab30b0c58f7bd1003015ec63d76ea8733ab53b6f9e8169069163e19ce5e');
 const record=JSON.parse(zlib.gunzipSync(zip));assert.equal(record.commit,'28bcf9a9827b8e68eef4517ad1e4d4a49e79a7ce');assert.equal(record.assets.length,101);
 const baseline=new Map(record.assets.map(row=>{const bytes=Buffer.from(row.base64,'base64');assert.equal(hash(bytes),row.sha256,row.path);return [row.path,bytes];})),assets=new Map(baseline);
 for(const file of contentFiles)assets.set(file,Buffer.from(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')));
 let buyer=assets.get('buyer-room.html').toString();assert.equal((buyer.match(/Loaded Records/g)||[]).length,2);buyer=buyer.replaceAll('Loaded Records','Transaction History').replace('Loaded and invoiced quantities, payments and documents.','Invoices, payments and transaction documents.');assets.set('buyer-room.html',Buffer.from(buyer));
 let support=assets.get('support-room/workroom.js').toString();assert.match(support,/dataset\.supportBuild='20261101-customer-loaded-records-v1'/);support=support.replace(/dataset\.supportBuild='[^']+'/,()=>"dataset.supportBuild='"+build+"'");assets.set('support-room/workroom.js',Buffer.from(support));
 const entries=[];
 for(const [file,bytes]of assets){if(!file.endsWith('.html'))continue;let html=bytes.toString(),changed=file==='buyer-room.html';
  for(const script of contentFiles){const relative=path.posix.relative(path.posix.dirname(file),script),escaped=relative.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp('('+escaped+'\\?v=)[^"&]+','g');if(pattern.test(html)){html=html.replace(pattern,(_,prefix)=>prefix+build);changed=true;}}
  if(changed){html=html.replace(/(<meta name="build" content=")[^"]+/,(_,prefix)=>prefix+build);assets.set(file,Buffer.from(html));entries.push(file);}
 }
 const changed=[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file).sort();
 assert.equal(assets.size,101);assert(changed.every(file=>contentFiles.includes(file)||entries.includes(file)));
 for(const file of ['purchase-live/customer-allocation.js','purchase-live/app.js','master-shared/desk-delivery.js','support-room/index.html','account-room/stock-list-link.js'])assert(assets.get(file).equals(baseline.get(file)),file+' protected');
 assert.match(assets.get('account-room/index.html').toString(),/data-view="stock"/);
 return {build,baseline,assets,changed,entries};
}
function stage(destination){const target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);const p=plan();for(const [file,bytes]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}const report={build,baseline:'28bcf9a',changed:p.changed,resources:[...p.assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)}))};fs.writeFileSync(path.join(target,'customer-invoice-payments-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const result=stage(process.argv[2]);console.log(JSON.stringify({build,resources:result.resources.length,changed:result.changed}));}
module.exports={plan,stage,build};
