const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const previous = require('./support-desk-summary.json');

const baseline = { ...previous.baseline };
for (const [file, change] of Object.entries(previous.changes)) baseline[file] = change.sha256;
Object.assign(baseline, {
  'master-shared/desk-delivery.js': 'c6b581549f30cb561f5a8c2accaa5d208c2e3e5b6c4a9e86a6341f7c2dd6f7ca',
  'master-shared/workroom-theme.css': '641ec3cc46577a1b1924e8780538497f4e71675ca9da3d12e83427d39457c18b',
  'warehouse-room/image-hover.js': 'a6a38de427feffc6d3ce1806b368f6d37ce4c0e2bf65c04d1aba780fb20d5193',
  'warehouse-room/index.html': '51f99346989af5cb5285236559171d68f6c78cdee3ff232a41d8c732932be889',
  'warehouse-room/workroom.css': '4a521b1a42d6fc40e7cc7d1731739aafcfd58c021c2a4d386cc04d8c4fb08d5d',
});
const root = path.resolve(process.argv[2]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inventory = fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();
assert.deepEqual(inventory, Object.keys(baseline).sort());
for (const file of inventory) assert.equal(hash(fs.readFileSync(path.join(root, file))), baseline[file], file);

const app = 'purchase-live/app.js';
const index = 'purchase-live/index.html';
const source = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8').replaceAll('\r\n', '\n');
const route = 'if(editNumber&&selected.size===1&&!chosen.supplierId&&!chosen.po){const editor=allocationUi();return editor?editor.open(chosen.id):purchasePlanEditor(chosen.id);}';
const version = '20261115-purchase-single-unassigned-po-v1';
const appSource = source(app);
const indexSource = source(index);
assert.equal(appSource.split(route).length, 2);
assert.equal(hash(appSource.replace(route, '')), baseline[app]);
assert.equal(hash(indexSource.replace('app.js?v='+version, 'app.js?v=20261114-purchase-company-switch-v1')
  .replace('name="build" content="'+version+'"','name="build" content="20261115-master-compact-workrooms-v1"')), baseline[index]);
for (const [file, content] of [[app, appSource], [index, indexSource]]) {
  fs.writeFileSync(path.join(root, file), content);
  console.log(file, hash(content));
}
console.log('All other production assets retained exactly: ' + (inventory.length - 2));
