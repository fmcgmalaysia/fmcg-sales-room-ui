const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const manifest = require('./pages-baseline.json');
const site = path.resolve(process.argv[2]);
const overlay = path.join(__dirname,'sales-room.html');
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function inventory(directory, prefix='') {
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const file = prefix+entry.name;
    if (entry.isDirectory()) return inventory(path.join(directory,entry.name),file+'/');
    assert.ok(entry.isFile(),file);
    return [file];
  });
}
function verify(expected) {
  assert.deepEqual(inventory(site).sort(),Object.keys(expected).sort());
  for (const [file,hash] of Object.entries(expected)) assert.equal(digest(path.join(site,file)),hash,file);
}
verify(manifest.baseline);
assert.equal(digest(overlay),manifest.replacement);
assert.match(fs.readFileSync(overlay,'utf8'),/20261118-sales-qd-retirement-v1/);
fs.copyFileSync(overlay,path.join(site,'index.html'));
verify({...manifest.baseline,'index.html':manifest.replacement});
console.log('Validated 116 Pages resources. Sales Room index.html only.');
