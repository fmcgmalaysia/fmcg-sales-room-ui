const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const previous = require('./support-desk-summary.json');

const baseline = { ...previous.baseline };
for (const [file, change] of Object.entries(previous.changes)) baseline[file] = change.sha256;
Object.assign(baseline, {
  'account-room/index.html': '77ca1197ba8d3ea1fc5856516224b4ccdbdae5d0ababd11f6fa3b26a055152ef',
  'account-room/purchase-payments.js': '0cd805d8cc324ece7d66a0fb26e61916fd7c0a0d41661ab91eff9f0733f895da',
  'account-room/finance-overview.js': 'db99800152ac316a2ca0395424e031603004f87164c547bdd3bb74c900826e1a',
  'account-room/finance-overview.css': '07ba5702ed0e17ae335d7a40bb08f92e755bfa401c9b46928baa71d2f23c90f5',
  'customer-history/history.css': '26b732b901ebd5c0f4bb9b0a4c0ff2e821c6e6ee718da0360dad51241bec6eef',
  'master-shared/task-tables.css': '70205ef5fa5610b1154134fc0f0784a6404e8fa58ad5d040e47558877cbe5a29',
  'purchase-live/style.css': '233b595e7fc288e5e3bebefc8d660a4ab34a18d8246a3a101fe1f0579246a42a',
  'purchase-live/app.js': '72a91ca412b4dabb85c1df2fa0a3273f0c89cc949ff1e8c746211a37d256eb40',
  'purchase-live/index.html': 'c9a8b003708f87b4fff384a3a7aab4266c5efe8c1c29c5b5d43ea074a3bbc3df',
  'master-shared/desk-delivery.js': 'c6b581549f30cb561f5a8c2accaa5d208c2e3e5b6c4a9e86a6341f7c2dd6f7ca',
  'master-shared/workroom-theme.css': '464469ce223474d0cad8a0ef979739b96320286d0ea5ee8f3706f2dae9959961',
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

const stockCss = 'master-shared/stock-list.css';
const source = fs.readFileSync(path.join(__dirname, '../..', stockCss), 'utf8').replaceAll('\r\n', '\n');
assert.equal(baseline[stockCss], 'eb03d733f0b8cefa7b5183f39f31f14315500617ffeabe7054ff30e46d1884e4');
assert.equal(hash(source), 'cbad10b6322bac30604b25faeca1dbf66c34b8833629ce7ab34a93a689b9e181');
fs.writeFileSync(path.join(root, stockCss), source);
console.log('Verified all ' + inventory.length + ' baseline files. Only ' + stockCss + ' changed: ' + hash(source));
