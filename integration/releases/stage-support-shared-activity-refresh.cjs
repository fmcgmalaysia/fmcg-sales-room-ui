const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { baseline, replacements } = require('./support-shared-activity-refresh.json');

const site = path.resolve(process.argv[2]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inventory = fs.readdirSync(site, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();
assert.deepEqual(inventory, Object.keys(baseline).sort());
for (const file of inventory) {
  assert.equal(hash(fs.readFileSync(path.join(site, file))), baseline[file], file);
}

assert.deepEqual(Object.keys(replacements), ['support-room/workroom.html', 'support-room/workroom.js']);
const updated = Object.entries(replacements).map(([file, expected]) => {
  const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(hash(source), expected, file);
  return { file, source };
});
for (const { file, source } of updated) fs.writeFileSync(path.join(site, file), source);
console.log('Verified all ' + inventory.length + ' baseline files and replaced only ' + updated.map(asset => asset.file).join(', '));
