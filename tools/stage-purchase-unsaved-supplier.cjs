const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const base = require('../integration/releases/dual-account-navigation-20261125/pages-base.json');

const baseline = {
  ...base,
  'buyer-room-20261125-company-navigation.html': '26ebb94a3b5aa3095e781fea7d5a529836e425d3120f94620e235aab71c654d2',
  'sales-room-20261125-company-consent.html': 'aa67686475cd7093b4becef9e25f6fc34d202816157f35a148c84cd012767cbf',
  'buyer-room/company-switch-navigation-20261125.js': '7c27965243d0bedeab6bd59ed84f17a530f61485786df6fc30ce8e24ea804e05'
};

assert.ok(process.argv[2], 'Pass the unpacked verified Pages archive.');
const site = path.resolve(process.argv[2]);
const read = name => fs.readFileSync(path.join(site, name));
const hash = content => createHash('sha256').update(content).digest('hex');
const filenames = fs.readdirSync(site, { recursive: true, withFileTypes: true }).filter(entry => {
  assert.ok(entry.isFile() || entry.isDirectory(), 'Unsupported archive entry: ' + entry.name);
  return entry.isFile();
}).map(entry => path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));

assert.deepEqual(filenames.sort(), Object.keys(baseline).sort());
for (const [name, expected] of Object.entries(baseline)) {
  assert.equal(hash(read(name)), expected, 'Previously deployed asset changed: ' + name);
}

const index = 'purchase-live/index-20261124-split-surplus.html';
const original = 'supplier-allocation-20261124-split-surplus.js';
const next = 'supplier-allocation-20261125-discard-draft.js';
const html = read(index).toString('utf8');
assert.equal(html.split('src="' + original + '"').length, 2);
fs.writeFileSync(path.join(site, index), html.replace('src="' + original + '"', 'src="' + next + '"'));
const asset = 'purchase-live/' + next;
fs.copyFileSync(path.join(__dirname, '../purchase-live/supplier-allocation.js'), path.join(site, asset), fs.constants.COPYFILE_EXCL);
for (const name of [index, asset]) console.log(name, hash(read(name)));
