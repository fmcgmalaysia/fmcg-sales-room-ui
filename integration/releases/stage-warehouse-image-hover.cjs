const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { baseline, changes } = require('./support-desk-summary.json');

const root = path.resolve(process.argv[2]);
const hash = content => createHash('sha256').update(content).digest('hex');
const live = { ...baseline };
for (const [file, change] of Object.entries(changes)) live[file] = change.sha256;
live['master-shared/workroom-theme.css'] = '641ec3cc46577a1b1924e8780538497f4e71675ca9da3d12e83427d39457c18b';
live['warehouse-room/index.html'] = 'a8efea9fb1acc27fce70671e484383543c71326ca842d2731bad5d64340180a3';
live['warehouse-room/workroom.css'] = '4a521b1a42d6fc40e7cc7d1731739aafcfd58c021c2a4d386cc04d8c4fb08d5d';
live['warehouse-room/image-hover.js'] = 'c12f59ee70697d8cf4a88945b14b1d16a1c11abfdbbd1d37f699fe4ce9c3dbaf';

const inventory = fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();
assert.deepEqual(inventory, Object.keys(live).sort());
for (const file of inventory) assert.equal(hash(fs.readFileSync(path.join(root, file))), live[file], file);

const edits = ['warehouse-room/index.html', 'warehouse-room/image-hover.js'];
for (const file of edits) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8').replaceAll('\r\n', '\n');
  if (file.endsWith('.html')) {
    const before = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(before.includes('image-hover.js?v=20261115-warehouse-image-hover-v1'));
    assert.equal(source, before.replace('image-hover.js?v=20261115-warehouse-image-hover-v1', 'image-hover.js?v=20261115-warehouse-image-hover-v2'));
  }
  assert.notEqual(hash(source), live[file], file);
  fs.writeFileSync(path.join(root, file), source);
  console.log(file, hash(source));
}
