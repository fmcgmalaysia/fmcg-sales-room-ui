const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const site = path.resolve(process.argv[2]);
const releases = path.dirname(__dirname);
const supportHash = '51fe003fda78efb7eff8cb22035a6cbad5108f32a253bfb5ca2d5a470f0720a8';
const expected = {
  'support-room/index.html': supportHash,
  'support-room/draft.html': supportHash,
  'support-room/packing-workbench.html': supportHash,
  'catalogue/catalogue-header-v2.html': '9bc7974bc56782b7dfdbbab374398b58613c0f0459f8e7bff2285c349a63beda',
  'catalogue/catalogue-mega-menu-v3.html': 'bf903278bdffb167d5a5b8b5db4569c54705e24de0227b3c45089a9de6468080',
  'catalogue/catalogue-workspace-v1.html': '8c6cf2117312f893e0ec98d89e421b78f3ff83b60b4c6110407b9dadaa27bfa7',
};

function inventory() {
  const files = fs.readdirSync(site, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile());
  return Object.fromEntries(files.map(entry => {
    const file = path.join(entry.parentPath, entry.name);
    return [path.relative(site, file).split(path.sep).join('/'), createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
  }));
}

const before = inventory();
assert.equal(Object.keys(before).length, 117);
for (const [file, hash] of Object.entries(expected)) assert.equal(before[file], hash, file);
const patches = ['ltpos-workspace-links/support-static.patch', 'catalogue-compact-navigation/catalogue-static.patch'];
function applyPatch(patch, ...flags) {
  const input = fs.readFileSync(path.join(releases, patch), 'utf8').replace(/\r\n/g, '\n');
  execFileSync('git', ['apply', '--unidiff-zero', ...flags, '-'], { cwd: site, input });
}
for (const patch of patches) {
  applyPatch(patch, '--check');
}
execFileSync(process.execPath, [path.join(releases, 'warehouse-incoming-identity/stage.cjs'), site], { stdio: 'inherit' });
for (const patch of patches) {
  applyPatch(patch);
}
const after = inventory();
assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
const changed = Object.keys(after).filter(file => before[file] !== after[file]).sort();
assert.deepEqual(changed, [...Object.keys(expected), 'warehouse-room/app.js', 'warehouse-room/index.html'].sort());
console.log(JSON.stringify({ changed: Object.fromEntries(changed.map(file => [file, after[file]])), unchanged: 117 - changed.length }));
