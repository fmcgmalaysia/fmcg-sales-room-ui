const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { baseline, changes } = require('./master-compact-workrooms.json');

const hash = source => createHash('sha256').update(source).digest('hex');
const root = path.resolve(process.argv[2]);
const assets = fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory()).map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();
assert.deepEqual(assets, Object.keys(baseline).sort());
for (const asset of assets) assert.equal(hash(fs.readFileSync(path.join(root, asset))), baseline[asset], asset);
for (const [asset, { sha256, source }] of Object.entries(changes)) {
  assert.ok(Object.hasOwn(baseline, asset), asset);
  assert.equal(hash(source), sha256, asset);
  fs.writeFileSync(path.join(root, asset), source);
}
for (const asset of assets) assert.equal(hash(fs.readFileSync(path.join(root, asset))), changes[asset]?.sha256 || baseline[asset], asset);
console.log(`Verified ${assets.length} assets with ${Object.keys(changes).length} changes.`);
