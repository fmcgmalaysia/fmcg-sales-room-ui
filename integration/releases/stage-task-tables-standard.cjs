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
  'purchase-live/style.css': '233b595e7fc288e5e3bebefc8d660a4ab34a18d8246a3a101fe1f0579246a42a',
  'purchase-live/app.js': '72a91ca412b4dabb85c1df2fa0a3273f0c89cc949ff1e8c746211a37d256eb40',
  'purchase-live/index.html': 'c9a8b003708f87b4fff384a3a7aab4266c5efe8c1c29c5b5d43ea074a3bbc3df',
  'master-shared/desk-delivery.js': 'c6b581549f30cb561f5a8c2accaa5d208c2e3e5b6c4a9e86a6341f7c2dd6f7ca',
  'master-shared/workroom-theme.css': '925cd72480f7bd63898ecae7cdce83b895f4cd8195303e850443a266f01342f7',
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

const changes = [
  'master-shared/task-tables.css',
  'master-shared/workroom-theme.css',
  'customer-history/history.css',
];
for (const file of changes) {
  const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8').replaceAll('\r\n', '\n');
  if (file !== changes[0]) {
    const firstNewline = source.indexOf('\n');
    assert.match(source.slice(0, firstNewline), /^@import url\("(?:\.\.\/master-shared\/)?task-tables\.css\?v=20261115-task-tables-v1"\);$/);
    assert.equal(hash(source.slice(firstNewline + 1)), baseline[file], file);
  } else {
    assert.ok(!baseline[file], file);
  }
  fs.writeFileSync(path.join(root, file), source);
  console.log(file + ' ' + hash(source));
}
console.log('Verified ' + inventory.length + ' baseline assets. Replaced two CSS files and added one.');
