const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {baseline,changes}=require('./sales-mobile-staff-name-20261117/manifest.json');
const site=path.resolve(process.argv[2]);
const digest=input=>createHash('sha256').update(input).digest('hex');
const files=fs.readdirSync(site,{recursive:true,withFileTypes:true}).filter(entry=>!entry.isDirectory()).map(entry=>{
 assert.ok(entry.isFile());
 return path.relative(site,path.join(entry.parentPath,entry.name)).split(path.sep).join('/');
}).sort();
assert.equal(files.length,113);
assert.deepEqual(files,Object.keys(baseline).sort());
for(const file of files) assert.equal(digest(fs.readFileSync(path.join(site,file))),baseline[file],file);
assert.deepEqual(Object.keys(changes),['index.html']);
const data=fs.readFileSync(path.join(__dirname,'sales-mobile-staff-name-20261117/static/index.html'),'utf8').replaceAll('\r\n','\n');
assert.equal(digest(data),changes['index.html']);
fs.writeFileSync(path.join(site,'index.html'),data);
console.log('Verified 113 production resources; changed only the Sales header name display in index.html.');
