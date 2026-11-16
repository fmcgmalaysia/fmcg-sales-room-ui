const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {baseline,changes}=require('./fmcg-sales-mobile-header-20261117/manifest.json');
const site=path.resolve(process.argv[2]);
const digest=input=>createHash('sha256').update(input).digest('hex');
const files=fs.readdirSync(site,{recursive:true,withFileTypes:true}).filter(entry=>!entry.isDirectory()).map(entry=>{
 assert.ok(entry.isFile());
 return path.relative(site,path.join(entry.parentPath,entry.name)).split(path.sep).join('/');
}).sort();
assert.equal(files.length,112);
assert.deepEqual(files,Object.keys(baseline).sort());
for(const file of files) assert.equal(digest(fs.readFileSync(path.join(site,file))),baseline[file],file);
assert.deepEqual(Object.keys(changes),['index.html','master-shared/fmcg-mobile-room-header.css','master-shared/workroom-app-header.css','master-shared/workroom-app-header.js']);
assert.equal(Boolean(baseline['master-shared/fmcg-mobile-room-header.css']),false);
for(const [file,expected] of Object.entries(changes)){
 const data=fs.readFileSync(path.join(__dirname,'fmcg-sales-mobile-header-20261117/static',file),'utf8').replaceAll('\r\n','\n');
 assert.equal(digest(data),expected,file);
 fs.writeFileSync(path.join(site,file),data);
}
console.log('Verified 112 production resources. Replaced Sales and shared header assets; added one mobile stylesheet.');
