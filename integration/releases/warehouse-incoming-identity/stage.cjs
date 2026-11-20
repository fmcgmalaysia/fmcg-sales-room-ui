const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const site = path.resolve(process.argv[2]);
const exact = {
  'warehouse-room/app.js': '79c9e9204d3b764431f3652eb23351cc97dbd7b7bfedf1d2d3fc378b5f6415f5',
  'warehouse-room/index.html': 'eba7ced93c8dedfb205baed4c1ad3266de7fdf7a9e2f0c96980833326336b939',
};
function inventory() {
  const files = fs.readdirSync(site, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile());
  return Object.fromEntries(files.map(entry => {
    const name = path.join(entry.parentPath, entry.name);
    return [path.relative(site, name).split(path.sep).join('/'), createHash('sha256').update(fs.readFileSync(name)).digest('hex')];
  }));
}
const before = inventory();
assert.equal(Object.keys(before).length, 117, 'Unexpected production inventory');
for (const [file, hash] of Object.entries(exact)) assert.equal(before[file], hash, file);
const patch = fs.readFileSync(path.join(__dirname, 'warehouse-static.patch'), 'utf8').replace(/\r\n/g, '\n');
execFileSync('git', ['apply', '--unidiff-zero', '--check', '-'], { cwd: site, input: patch });
execFileSync('git', ['apply', '--unidiff-zero', '-'], { cwd: site, input: patch });
const after = inventory();
assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
const changed = Object.keys(after).filter(file => before[file] !== after[file]).sort();
assert.deepEqual(changed, Object.keys(exact).sort());
console.log(JSON.stringify({ changed: Object.fromEntries(changed.map(file => [file, after[file]])), unchanged: Object.keys(after).length - changed.length }));
