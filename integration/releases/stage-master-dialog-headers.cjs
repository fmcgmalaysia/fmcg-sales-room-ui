const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const previous = require('./support-desk-summary.json');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = path.resolve(process.argv[2]);
const theme = 'master-shared/workroom-theme.css';
const baseline = { ...previous.baseline };
for (const [asset, change] of Object.entries(previous.changes)) {
  baseline[asset] = change.sha256;
}
const assets = fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory()).map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();
assert.deepEqual(assets, Object.keys(baseline).sort());
for (const asset of assets) {
  assert.equal(hash(fs.readFileSync(path.join(root, asset))), baseline[asset], asset);
}
const source = fs.readFileSync(path.join(__dirname, '../..', theme), 'utf8').replaceAll('\r\n', '\n');
assert.equal(hash(source.replace(/\/\* 20261115-master-dialog-headers-v1\.[\s\S]*?(?=body \.task-signal\{)/, '')), baseline[theme]);
fs.writeFileSync(path.join(root, theme), source);
console.log(`Verified ${assets.length} baseline assets. Replaced only ${theme}: ${hash(source)}`);
