const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const support = require('./support-desk-labels.json');
const patchProgress = require('./warehouse-photo-progress.cjs');

const site = path.resolve(process.argv[2]);
const baseline = { ...support.baseline, ...support.replacements };
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();
assert.deepEqual(files, Object.keys(baseline).sort());
for (const file of files) {
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(site, file))).digest('hex'), baseline[file], file);
}

const script = path.join(site, 'master-shared/desk-delivery.js');
const index = path.join(site, 'warehouse-room/index.html');
const previous = 'desk-delivery.js?v=20261115-warehouse-unchanged-refresh-v1';
const next = 'desk-delivery.js?v=20261115-warehouse-photo-progress-v1';
const html = fs.readFileSync(index, 'utf8');
assert.equal(html.split(previous).length, 2);
fs.writeFileSync(script, patchProgress(fs.readFileSync(script, 'utf8')));
fs.writeFileSync(index, html.replace(previous, next));
console.log(`Verified ${files.length} baseline files and replaced only the two Warehouse photo progress assets.`);
