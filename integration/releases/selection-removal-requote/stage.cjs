const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const baseline = {
  "buyer-room.html": "840a8aba0cbcfb2c06ab4604830a7c4ebf37e305913ca989990c62c6cd88ebee",
  "catalogue/catalogue-workspace-v1.html": "afee7745acc783e4db19166d018ef4fde52a3a8d756f73cbc6c9a0643720c270",
  "master-quotations/app.js": "d454e42e537b6d4a19ea791a8e46939f4c688403e5ece3f611571b60230bdc1f",
  "master-quotations/index.html": "1aa9b1a0e2971656d4b9d290470115b70e057fde26aff09abbb7722facbc7e50"
};
const worktree = path.resolve(__dirname, '../../..');
const directory = process.argv[2];
assert(directory && fs.statSync(directory).isDirectory(), 'Provide the verified 117-file Pages archive directory');
const site = path.resolve(directory);
const files = {
  'buyer-room.html': 'buyer-room.html',
  'catalogue/catalogue-workspace-v1.html': 'buyer-room/catalogue/wix/catalogue-workspace-v1.html'
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function inventory() {
  const entries = fs.readdirSync(site, { recursive: true, withFileTypes: true });
  return new Map(entries.filter(entry => entry.isFile()).map(entry => {
    const absolute = path.join(entry.parentPath, entry.name);
    return [path.relative(site, absolute).split(path.sep).join('/'), digest(fs.readFileSync(absolute))];
  }));
}
const before = inventory();
assert.equal(before.size, 117);
for (const [file, hash] of Object.entries(baseline)) assert.equal(before.get(file), hash, file + ' has a different base');
const patch = path.join(__dirname, 'quotations.patch');
execFileSync('git', ['apply', '--unidiff-zero', '--check', patch], { cwd: site });
execFileSync('git', ['apply', '--unidiff-zero', patch], { cwd: site });
for (const [file, source] of Object.entries(files)) {
  const html = fs.readFileSync(path.join(worktree, source), 'utf8').replace(/\r\n/g, '\n');
  fs.writeFileSync(path.join(site, file), html);
}
const after = inventory();
assert.equal(after.size, before.size);
const changes = [...after.keys()].filter(file => before.get(file) !== after.get(file)).sort();
assert.deepEqual(changes, Object.keys(baseline).sort());
console.log(JSON.stringify({ changes: changes.map(file => ({ file, sha256: after.get(file) })), unchanged: after.size - changes.length }));
