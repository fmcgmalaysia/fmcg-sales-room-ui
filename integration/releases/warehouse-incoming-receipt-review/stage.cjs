const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const site = path.resolve(process.argv[2]);
const exact = {
  'warehouse-room/app.js': '00717100b6c6412f2a62417bf5717247d096d3e3f203730a69ae1e4f2d8e2eba',
  'warehouse-room/index.html': '245a0a6abf5df16a9f91241e9f1fa3940a043cae502161277f2d19408f9475ea',
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
