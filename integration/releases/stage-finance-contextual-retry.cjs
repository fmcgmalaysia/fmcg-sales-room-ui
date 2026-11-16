'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const release = path.join(__dirname, 'finance-contextual-retry-20261117');
const { baseline, changes } = require(path.join(release, 'manifest.json'));
const site = path.resolve(process.argv[2]);
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true }).filter(entry => !entry.isDirectory()).map(entry => {
  assert.ok(entry.isFile());
  return path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
}).sort();
const digest = input => createHash('sha256').update(input).digest('hex');

assert.equal(files.length, 113);
assert.deepEqual(files, Object.keys(baseline).sort());
for (const file of files) assert.equal(digest(fs.readFileSync(path.join(site, file))), baseline[file], file);
assert.deepEqual(Object.keys(changes).sort(), [
  'account-room/customer-debtors.js',
  'account-room/finance-overview.js',
  'account-room/index.html',
  'account-room/payment-layout.js',
  'account-room/purchase-payments.js'
]);
for (const [file, hash] of Object.entries(changes)) {
  const source = fs.readFileSync(path.join(release, 'static', file), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(digest(source), hash, file);
  fs.writeFileSync(path.join(site, file), source);
}
console.log('Verified 113 baseline files and replaced only the five Finance retry assets.');
