const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');

const hashes = {
  "purchase-live/index.html": "30865c02bc84cbaee67434a05e583d0f33cb0eae59fe243b9953a95cd2869c3f",
  "purchase-live/app.js": "1c72e96f605c1d004c5751afa4252a2cdaca22a457cec9fa2f45dda0275909ad",
  "purchase-live/customer-allocation.js": "e2d524af8eb0fc44d923c5a44518869396f98be11acb722d9f7417423313bc0e",
  "purchase-live/task-grid.js": "ee764000d38c62e82f8cfbb42bb79d8aae6beb641ff41463bbf46836e69027cf",
  "support-room/workroom.html": "c64d8afcd41b0420fb83f8ae255ebfcd3cb47be31095f35294b5ab524be3c75a",
  "support-room/workroom-model.js": "60fe3898d5cbe3e3954f7db57125ef4b19f0aea4d662a83c716bbbe57ee91d72",
  "support-room/workroom.js": "70db5c05f718e46ef5f82e6328e1dc89dc75011e7b1365bc724ae579cf887541"
};
const marker = '20261119-purchase-support-shortfall-v1';
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
