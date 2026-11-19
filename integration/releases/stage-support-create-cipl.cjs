const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');

const hashes = {
  "support-room/workroom.html": "aeebadc19d8737e37b614099da64c60729a362d6af25300dc639a8b4b02b3acf",
  "support-room/workroom.js": "9838cd18613968d86b94a574db72c47f644270f8a6ce08231fd61c55c8e6346c"
};
const marker = '20261120-support-create-cipl-v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = process.argv[2];
assert(root && fs.statSync(root).isDirectory(), 'Provide the pinned Pages package directory');
const inventory = () => new Map(fs.readdirSync(root, {recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>{
  const file = path.join(entry.parentPath,entry.name);
  return [path.relative(root,file).split(path.sep).join('/'),sha(fs.readFileSync(file))];
}));
const before = inventory();
assert.equal(before.size,117);
const sources = new Map();
for (const [file,hash] of Object.entries(hashes)) {
  assert.equal(before.get(file),hash,'The production baseline changed for '+file);
  const source = fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8').replace(/\r\n/g,'\n');
  if (file.endsWith('.html')) assert(source.includes(marker),'The new resource version is missing from '+file);
  sources.set(file,source);
}
for (const [file,source] of sources) fs.writeFileSync(path.join(root,file),source);
const after = inventory();
assert.equal(after.size,before.size);
const changed = [...before.keys()].filter(file=>before.get(file)!==after.get(file)).sort();
assert.deepEqual(changed,Object.keys(hashes).sort());
console.log(JSON.stringify({build:marker,changed:changed.map(file=>({file,sha256:after.get(file)})),unchanged:before.size-changed.length}));
