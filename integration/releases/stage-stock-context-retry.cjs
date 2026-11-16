const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {baseline,changes}=require('./stock-context-retry-20261117/manifest.json');
const site=path.resolve(process.argv[2]);
const digest=input=>createHash('sha256').update(input).digest('hex');
const files=fs.readdirSync(site,{recursive:true,withFileTypes:true}).filter(entry=>!entry.isDirectory()).map(entry=>{
 assert.ok(entry.isFile());
 return path.relative(site,path.join(entry.parentPath,entry.name)).split(path.sep).join('/');
}).sort();
assert.equal(files.length,112);
assert.deepEqual(files,Object.keys(baseline).sort());
for(const file of files) assert.equal(digest(fs.readFileSync(path.join(site,file))),baseline[file],file);
assert.deepEqual(Object.keys(changes),['account-room/index.html','account-room/stock-list-link.js','account-room/stock-list.html',
 'warehouse-room/index.html','warehouse-room/stock-control-app.js','warehouse-room/stock-control-link.js','warehouse-room/stock-control.html']);
for(const [file,expected] of Object.entries(changes)){
 const data=fs.readFileSync(path.join(__dirname,'stock-context-retry-20261117/static',file),'utf8').replaceAll('\r\n','\n');
 assert.equal(digest(data),expected,file);
 fs.writeFileSync(path.join(site,file),data);
}
console.log('Verified 112 production resources. Swapped only the seven stock read recovery files.');
