const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');

const hashes = {
  "support-room/workroom.html": "a0272928d1b7c33f02eaf9e9e61f81d080237966b0d30d834f9da49b56d3ef4d",
  "purchase-live/customer-allocation.js": "42cd4606eedeafe381732bbdc513789e49752859e4b59469a3be0d947eaf0d31",
  "purchase-live/task-grid.js": "646a42e7e47cd5d444917df0f8d3d28e9cddd4e031d9fd95c3601f016f6e6c21",
  "purchase-live/app.js": "453b9516e213540c6b2bbc6560d78ccedba4665d1b77bccfd3dc97a8f9a9de89",
  "support-room/workroom.js": "6be6ce97fce89959226a7235c41bbc396b5c9fc4e6f11417077c51ccb6757964",
  "buyer-room.html": "f2c98d7f3ee11ad9a5c978cbc489db40e0cee7c25e63b77d500c7daf9f854bb1",
  "purchase-live/index.html": "d994d23938e2e833618eb89bfa2cfe695e450a9da8f5d06e0164edf7e2e5c01d"
};
const marker = '20261120-shortfall-dispatch-confirmation-v1';
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
