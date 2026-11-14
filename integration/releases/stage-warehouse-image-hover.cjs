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

const inventory = fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();
assert.deepEqual(inventory, Object.keys(live).sort());
for (const file of inventory) assert.equal(hash(fs.readFileSync(path.join(root, file))), live[file], file);

const version = '20261115-warehouse-image-hover-v1';
const script = `<script src="image-hover.js?v=${version}"></script>`;
const edits = {
  'warehouse-room/index.html': source => source.replace(script, '').replace(`workroom.css?v=${version}`, 'workroom.css?v=20261115-master-compact-workrooms-v1'),
  'warehouse-room/workroom.css': source => source.replace(/\n\/\* Mouse-only previews for Warehouse receipt and shipment photos\. \*\/[\s\S]*$/, ''),
  'warehouse-room/image-hover.js': null,
};
for (const [file, undo] of Object.entries(edits)) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8').replaceAll('\r\n', '\n');
  if (undo) assert.equal(hash(undo(source)), live[file], file);
  else assert.ok(!Object.hasOwn(live, file));
  fs.writeFileSync(path.join(root, file), source);
  console.log(file, hash(source));
}
