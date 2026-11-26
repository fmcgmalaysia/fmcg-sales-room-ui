const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdirSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { dirname, join, relative, resolve, sep } = require('node:path');

assert.ok(process.argv[2], 'Pass the extracted production Pages archive.');
const site = resolve(process.argv[2]);
const head = resolve(__dirname, '..');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const getManifest = () => Object.fromEntries(readdirSync(site, { recursive: true, withFileTypes: true })
  .filter(item => item.isFile())
  .map(item => relative(site, join(item.parentPath, item.name)).split(sep).join('/'))
  .sort().map(name => [name, sha256(readFileSync(join(site, name)))]));
const before = getManifest();
assert.equal(Object.keys(before).length, 161);
assert.equal(sha256(Object.entries(before).map(([name, hash]) => `${hash}  ${name}\n`).join('')),
  '8d93de13c24a522bd055edcaf6d257945c07d8940bd61d4988680e591ee4333e',
  'Use the current 45743203339 production Pages archive.');

const entrypoints = [
  'account-room/index.html',
  'buyer-room-20261125-company-entry.html',
  'ltpos/managed.html',
  'master-staff/index.html',
  'purchase-live/index-20261124-split-surplus.html',
  'sales-room-20261125-company-consent.html',
  'support-room/workroom.html',
  'warehouse-room/index.html',
  'warehouse-room/stock-control.html'
];
const newAssets = [
  'account-menu.css', 'account-menu.js', 'buyer-room-account.js', 'catalogue-header-account.js',
  'catalogue-workspace-account.js', 'frame-logout.js', 'sales-room-account.js', 'workroom-account.js'
].map(file => 'account-menu/' + file);
for (const file of entrypoints) assert.ok(before[file], 'The existing page is missing: ' + file);
for (const file of newAssets) assert.ok(!before[file], 'The added asset already exists: ' + file);
for (const file of [...entrypoints, ...newAssets]) {
  const target = join(site, file);
  mkdirSync(dirname(target), { recursive: true });
  const source = readFileSync(join(head, file), 'utf8').replace(/\r\n/g, '\n');
  if (entrypoints.includes(file)) assert.match(source, /<meta name="header-account-menu-build"/);
  writeFileSync(target, source);
}
const after = getManifest();
assert.equal(Object.keys(after).length, 169);
for (const [name, hash] of Object.entries(before)) {
  if (!entrypoints.includes(name)) assert.equal(after[name], hash, 'Unexpected change: ' + name);
  else assert.notEqual(after[name], hash);
}
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(after, null, 2));
console.log('Staged nine account-menu entry points and eight new shared assets, preserving 152 other files.');
