const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const previous = require('./support-desk-summary.json');

const baseline = { ...previous.baseline };
for (const [file, change] of Object.entries(previous.changes)) baseline[file] = change.sha256;
Object.assign(baseline, {
  'purchase-live/app.js': '72a91ca412b4dabb85c1df2fa0a3273f0c89cc949ff1e8c746211a37d256eb40',
  'purchase-live/index.html': 'c9a8b003708f87b4fff384a3a7aab4266c5efe8c1c29c5b5d43ea074a3bbc3df',
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

const theme = 'master-shared/workroom-theme.css';
const source = fs.readFileSync(path.join(__dirname, '../..', theme), 'utf8').replaceAll('\r\n', '\n');
assert.equal(hash(source), '925cd72480f7bd63898ecae7cdce83b895f4cd8195303e850443a266f01342f7');
assert.equal(hash(source.replace(/\/\* 20261115-master-dialog-headers-v3\.[\s\S]*?(?=body \.task-signal\{)/, '')), baseline[theme]);
fs.writeFileSync(path.join(root, theme), source);
console.log('Verified all ' + inventory.length + ' assets. Only ' + theme + ' changed: ' + hash(source));
