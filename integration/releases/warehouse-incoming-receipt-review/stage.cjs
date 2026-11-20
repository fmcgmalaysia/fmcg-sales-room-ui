const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const site = path.resolve(process.argv[2]);
const exact = {
  'warehouse-room/app.js': 'e6c94f16ffc4e05c18dd8a89079839f6c749b5cf800fc71694d8ca98c5cf5c72',
  'warehouse-room/index.html': 'dfa2d525f08acfe5448c90e93e046e8a8d54e7857a76763d03d15c89a5300229',
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
for (const [file, hash] of Object.entries(exact)) {
  const source = fs.readFileSync(path.join(site, file), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), hash, file);
}
const patch = fs.readFileSync(path.join(__dirname, 'warehouse-static.patch'), 'utf8').replace(/\r\n/g, '\n');
execFileSync('git', ['apply', '--unidiff-zero', '--check', '-'], { cwd: site, input: patch });
execFileSync('git', ['apply', '--unidiff-zero', '-'], { cwd: site, input: patch });
const after = inventory();
assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
const changed = Object.keys(after).filter(file => before[file] !== after[file]).sort();
assert.deepEqual(changed, Object.keys(exact).sort());
console.log(JSON.stringify({ changed: Object.fromEntries(changed.map(file => [file, after[file]])), unchanged: Object.keys(after).length - changed.length }));
