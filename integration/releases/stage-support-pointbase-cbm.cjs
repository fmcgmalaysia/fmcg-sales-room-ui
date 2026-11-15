const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { baseline, replacements } = require('./support-shared-activity-refresh.json');

const installedRefresh = { ...baseline, ...replacements };
const assets = [
  'support-room/workroom-model.js',
  'support-room/workroom.html',
  'support-room/workroom.js'
];
const site = path.resolve(process.argv[2]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inventory = fs.readdirSync(site, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();

assert.deepEqual(inventory, Object.keys(installedRefresh).sort());
for (const asset of inventory) {
  assert.equal(hash(fs.readFileSync(path.join(site, asset))), installedRefresh[asset], asset);
}

const sources = assets.map(asset => {
  const source = fs.readFileSync(path.join(__dirname, '../..', asset), 'utf8').replaceAll('\r\n', '\n');
  assert.notEqual(hash(source), installedRefresh[asset], asset);
  return { asset, source };
});
for (const { asset, source } of sources) fs.writeFileSync(path.join(site, asset), source);
console.log('Verified ' + inventory.length + ' files and replaced only ' + assets.join(', '));
