const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {patchCostRead}=require('../prototypes/quotation-cost-batch-20261119/patch.cjs');
const site=process.argv[2];assert(site&&fs.statSync(site).isDirectory(),'Pass extracted verified Pages archive');
const sha=s=>createHash('sha256').update(s).digest('hex');
function tree(){return new Map(fs.readdirSync(site,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const p=path.join(e.parentPath,e.name);return[path.relative(site,p).split(path.sep).join('/'),sha(fs.readFileSync(p))]}));}
const before=tree();assert.equal(before.size,117);
const expected={'master-quotations/app.js':'fc574f4adf377eff3f71bdb7386646dc1b0974c725474da1fab4dc256992e9b6',
 'master-quotations/index.html':'304142da81c6b134de68f6b7c74a31271012b65d788b5fbad6f675e20c0f784d'};
for(const [file,hash]of Object.entries(expected))assert.equal(before.get(file),hash,'Unexpected live source '+file);
const app=path.join(site,'master-quotations/app.js');fs.writeFileSync(app,patchCostRead(fs.readFileSync(app,'utf8')));
const index=path.join(site,'master-quotations/index.html');fs.writeFileSync(index,fs.readFileSync(index,'utf8').replaceAll('20261119-view-quote-immediate-v1','20261119-quotation-cost-batch-v1'));
const after=tree();assert.equal(after.size,before.size);
assert.deepEqual([...after].filter(([name,hash])=>before.get(name)!==hash).map(([name])=>name).sort(),Object.keys(expected).sort());
console.log(JSON.stringify({changed:Object.keys(expected).map(name=>({name,sha256:after.get(name)})),unchanged:115}));
