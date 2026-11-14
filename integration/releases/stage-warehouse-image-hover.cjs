const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { baseline, changes } = require('./support-desk-summary.json');
const patchWarehouseRefresh = require('./warehouse-unchanged-refresh.cjs');

const root = path.resolve(process.argv[2]);
const hash = content => createHash('sha256').update(content).digest('hex');
const live = { ...baseline };
for (const [file, change] of Object.entries(changes)) live[file] = change.sha256;
live['master-shared/workroom-theme.css'] = '641ec3cc46577a1b1924e8780538497f4e71675ca9da3d12e83427d39457c18b';
live['warehouse-room/index.html'] = '40e8fb467e929be41a47f70d6da7dd84c9ae187c2d434067401e2b62f10d1899';
live['warehouse-room/workroom.css'] = '4a521b1a42d6fc40e7cc7d1731739aafcfd58c021c2a4d386cc04d8c4fb08d5d';
live['warehouse-room/image-hover.js'] = 'a6a38de427feffc6d3ce1806b368f6d37ce4c0e2bf65c04d1aba780fb20d5193';

const inventory = fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();
assert.deepEqual(inventory, Object.keys(live).sort());
for (const file of inventory) assert.equal(hash(fs.readFileSync(path.join(root, file))), live[file], file);

const originalScript = 'desk-delivery.js?v=20261114-support-warehouse-desk-sync-v2';
const edits = {
  'master-shared/desk-delivery.js': patchWarehouseRefresh,
  'warehouse-room/index.html': source => {
    assert.equal(source.split(originalScript).length, 2);
    return source.replace(originalScript, 'desk-delivery.js?v=20261115-warehouse-unchanged-refresh-v1');
  },
};
for (const [file, edit] of Object.entries(edits)) {
  const source = edit(fs.readFileSync(path.join(root, file), 'utf8'));
  assert.notEqual(hash(source), live[file], file);
  fs.writeFileSync(path.join(root, file), source);
  console.log(file, hash(source));
}
