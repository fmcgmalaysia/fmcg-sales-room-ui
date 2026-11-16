const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { baseline, changes } = require('./master-workroom-header-20261117/manifest.json');

const site = path.resolve(process.argv[2]);
const files = fs.readdirSync(site,{recursive:true,withFileTypes:true})
  .filter(entry=>!entry.isDirectory())
  .map(entry=>{
    assert.ok(entry.isFile(),entry.name);
    return path.relative(site,path.join(entry.parentPath,entry.name)).split(path.sep).join('/');
  }).sort();
const digest = content => createHash('sha256').update(content).digest('hex');
assert.equal(files.length,110);
assert.deepEqual(files,Object.keys(baseline).sort());
for(const file of files) assert.equal(digest(fs.readFileSync(path.join(site,file))),baseline[file],file);

const additions=['master-shared/workroom-app-header.css','master-shared/workroom-app-header.js'];
const replacements=['account-room/index.html','purchase-live/app.js','purchase-live/index.html','support-room/workroom.html','support-room/workroom.js','warehouse-room/app.js','warehouse-room/index.html'];
assert.deepEqual(Object.keys(changes).sort(),[...additions,...replacements].sort());
const payload=Object.entries(changes).map(([file,expected])=>{
  assert.equal(Boolean(baseline[file]),replacements.includes(file),file);
  const source=path.join(__dirname,'master-workroom-header-20261117','static',file);
  const content=fs.readFileSync(source,'utf8').replaceAll('\r\n','\n');
  assert.equal(digest(content),expected,file);
  return [file,content];
});
for(const [file,content] of payload) fs.writeFileSync(path.join(site,file),content);
console.log('Verified 110 existing files. Replaced only the 7 scoped workroom assets and added 2 shared header files.');
