const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {patch,baselines,sha,build}=require('../prototypes/master-workroom-domain-20261119/patch.cjs');
const root=process.argv[2];assert(root&&fs.statSync(root).isDirectory());
const inventory=()=>new Map(fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const file=path.join(e.parentPath,e.name);return[path.relative(root,file).split(path.sep).join('/'),sha(fs.readFileSync(file))];}));
const before=inventory();assert.equal(before.size,117);
for(const file of Object.keys(baselines)){const target=path.join(root,file);fs.writeFileSync(target,patch(file,fs.readFileSync(target)));}
const after=inventory();assert.equal(after.size,117);
const changed=[...after.keys()].filter(file=>before.get(file)!==after.get(file)).sort();assert.deepEqual(changed,Object.keys(baselines).sort());
console.log(JSON.stringify({build,changed:changed.map(file=>({file,sha256:after.get(file)})),unchanged:112}));
