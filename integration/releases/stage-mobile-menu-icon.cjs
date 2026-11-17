const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {baseline,changes} = require('./mobile-menu-icon-20261117/manifest.json');

const site=path.resolve(process.argv[2]);
const source=path.join(__dirname,'mobile-menu-icon-20261117','static');
const expectedChanges=['account-room/index.html','buyer-room.html','index.html','master-shared/mobile-menu.css',
  'master-shared/mobile-menu.js','purchase-live/index.html','support-room/workroom.html','warehouse-room/index.html'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function filesIn(folder){
  return fs.readdirSync(folder,{recursive:true,withFileTypes:true}).filter(entry=>!entry.isDirectory()).map(entry=>{
    assert.ok(entry.isFile());
    return path.relative(folder,path.join(entry.parentPath,entry.name)).split(path.sep).join('/');
  }).sort();
}
const files=filesIn(site);
assert.equal(files.length,113);
assert.deepEqual(files,Object.keys(baseline).sort());
assert.deepEqual(Object.keys(changes).sort(),expectedChanges);
assert.deepEqual(filesIn(source),expectedChanges);
for(const file of files)assert.equal(digest(fs.readFileSync(path.join(site,file))),baseline[file],file);
const updates=expectedChanges.map(file=>{
  const bytes=fs.readFileSync(path.join(source,file));
  assert.equal(digest(bytes),changes[file],file);
  return [file,bytes];
});
for(const [file,bytes] of updates)fs.writeFileSync(path.join(site,file),bytes);
for(const file of files)assert.equal(digest(fs.readFileSync(path.join(site,file))),changes[file]??baseline[file],file);
console.log('Verified 113 resources. Replaced only the eight mobile menu files.');
