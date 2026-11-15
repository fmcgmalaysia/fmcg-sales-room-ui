const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const support = require('./support-desk-labels.json');
const patchProgress = require('./warehouse-photo-progress.cjs');
const galleryEdits = require('./warehouse-receipt-gallery.cjs');

const site = path.resolve(process.argv[2]);
const mode = process.argv[3];
assert.ok(mode === undefined || mode === 'receipt-gallery');
const baseline = { ...support.baseline, ...support.replacements };
if (mode === 'receipt-gallery') {
  baseline['master-shared/desk-delivery.js'] = '25b157af41d8d2edb6a577b5aae24ad274d1e8b77923e8f9f6a6d71816f7d2bb';
  baseline['warehouse-room/index.html'] = '7e8b4653d754fe8ae39fa185ed0e9c0fb61ee890ab60919ec181723be345b4ed';
}
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

const changes = mode === 'receipt-gallery' ? galleryEdits : {
  'master-shared/desk-delivery.js': patchProgress,
  'warehouse-room/index.html': html => {
    const previous = 'desk-delivery.js?v=20261115-warehouse-unchanged-refresh-v1';
    const next = 'desk-delivery.js?v=20261115-warehouse-photo-progress-v1';
    assert.equal(html.split(previous).length, 2);
    return html.replace(previous, next);
  },
};
const updated = Object.entries(changes).map(([file, edit]) => {
  const target = path.join(site, file);
  return [target, edit(fs.readFileSync(target, 'utf8'))];
});
for (const [target, contents] of updated) fs.writeFileSync(target, contents);
console.log(`Verified ${files.length} baseline files and replaced only ${updated.length} Warehouse assets.`);
