'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib'),assert=require('assert/strict');
const build='20261102-customer-site-isolation-v1',hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function plan(){
 const zip=fs.readFileSync(path.join(__dirname,'public-baseline-e0ac431.json.gz'));assert.equal(hash(zip),'8d8e591fda7ac7f985b8fb26e7bbea0529b20f928f0abf5c711360d906d854ee');
 const record=JSON.parse(zlib.gunzipSync(zip));assert.equal(record.commit,'e0ac43154091bf989324b29812dbfaa2ad136a70');assert.equal(record.assets.length,105);
 const baseline=new Map(record.assets.map(row=>{const bytes=Buffer.from(row.base64,'base64');assert.equal(hash(bytes),row.sha256,row.path);return [row.path,bytes];})),assets=new Map(baseline);
 const removed=[...assets.keys()].filter(file=>file.startsWith('sales-department/'));assert.equal(removed.length,4);for(const file of removed)assets.delete(file);
 let html=assets.get('index.html').toString();const script='<script src="sales-department/entry.js?v=20261102-sales-department-v1"></script>';assert.equal(html.split(script).length,2);html=html.replace(script,'').replace(/(<meta name="build(?:-version)?" content=")[^"]+/,(_,prefix)=>prefix+build);assert(!html.includes('sales-department'));assets.set('index.html',Buffer.from(html));
 const changed=[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file);assert.deepEqual(changed,['index.html']);assert.equal(assets.size,101);
 for(const[file,bytes]of assets)if(file!=='index.html')assert(bytes.equals(baseline.get(file)),file);
 return {build,baseline,assets,changed,removed};
}
function stage(destination){const target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&!target.startsWith(path.resolve(__dirname,'../../..'))&&target!==path.parse(target).root);const p=plan();for(const[file,bytes]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}const report={build,baseline:'e0ac431',changed:p.changed,removed:p.removed,resources:[...p.assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)}))};fs.writeFileSync(path.join(target,'sales-department-isolation-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,resources:p.resources.length,changed:p.changed,removed:p.removed}));}module.exports={plan,stage,build};
