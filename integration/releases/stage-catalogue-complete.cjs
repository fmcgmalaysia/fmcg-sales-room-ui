const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const target = process.argv[2];
if (!target || !fs.statSync(target).isDirectory()) throw Error('Pass the extracted Pages baseline directory');
const source = path.resolve(__dirname, '../../buyer-room/catalogue/wix');
const assets = new Map([
  ['catalogue-header-v2.html', '8de897752fca04e1441923d2288753253ad730d6616a517e7f50371f309961a6'],
  ['catalogue-workspace-v1.html', '927b96eda8add9ea33037a9084a385df68de0b0bed4bb73182e5f2ac828dc716']
]);

function fileDigests(dir, base = dir) {
  const files = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [file, digest] of fileDigests(fullPath, base)) files.set(file, digest);
    } else if (entry.isFile()) {
      const file = path.relative(base, fullPath).split(path.sep).join('/');
      files.set(file, createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex'));
    }
  }
  return files;
}

const before = fileDigests(target);
assert.equal(before.size, 117, 'expected the 117-file successful Pages run 44317237371');
for (const [asset, hash] of assets) {
  assert.equal(before.get('catalogue/' + asset) || null, hash, 'baseline mismatch for ' + asset);
  assert.match(fs.readFileSync(path.join(source, asset), 'utf8'), /20261118-catalogue-staff-entry-v1/);
}
for (const asset of assets.keys()) {
  fs.copyFileSync(path.join(source, asset), path.join(target, 'catalogue', asset));
}
const after = fileDigests(target);
assert.equal(after.size, 117);
const changed = [...after].filter(([file, digest]) => before.get(file) !== digest).map(([file]) => file).sort();
assert.deepEqual(changed, [...assets.keys()].map(asset => 'catalogue/' + asset).sort());
for (const file of changed) console.log(after.get(file) + '  ' + file);
console.log('Verified 115 unchanged files and two Catalogue replacements.');
