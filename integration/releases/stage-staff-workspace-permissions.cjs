const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {patchStaff}=require('../prototypes/staff-workspace-permissions-20261119/patch-staff.cjs');
const {patchSales}=require('../prototypes/staff-workspace-permissions-20261119/patch-sales.cjs');
const folder=process.argv[2];assert(folder&&fs.statSync(folder).isDirectory());
const sha=b=>createHash('sha256').update(b).digest('hex');
const tree=()=>new Map(fs.readdirSync(folder,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{
  const p=path.join(e.parentPath,e.name);return[path.relative(folder,p).split(path.sep).join('/'),sha(fs.readFileSync(p))];
}));
const before=tree();assert.equal(before.size,117);
for(const [name,patch]of [['master-staff/index.html',patchStaff],['index.html',patchSales]]){
  const file=path.join(folder,name);fs.writeFileSync(file,patch(fs.readFileSync(file,'utf8')));
}
const after=tree();assert.equal(after.size,before.size);
const changed=[...after].filter(([name,hash])=>before.get(name)!==hash).map(([name])=>name).sort();
assert.deepEqual(changed,['index.html','master-staff/index.html']);
console.log(JSON.stringify({changed:changed.map(file=>({file,sha256:after.get(file)})),unchanged:115}));
