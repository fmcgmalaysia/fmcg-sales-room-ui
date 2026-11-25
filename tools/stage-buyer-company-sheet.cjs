const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const base = require('../integration/releases/dual-account-navigation-20261125/pages-base.json');

const baseline = {
  ...base,
  'buyer-room-20261125-company-navigation.html': '26ebb94a3b5aa3095e781fea7d5a529836e425d3120f94620e235aab71c654d2',
  'sales-room-20261125-company-consent.html': 'aa67686475cd7093b4becef9e25f6fc34d202816157f35a148c84cd012767cbf',
  'buyer-room/company-switch-navigation-20261125.js': '7c27965243d0bedeab6bd59ed84f17a530f61485786df6fc30ce8e24ea804e05',
  'purchase-live/index-20261124-split-surplus.html': 'cc97eec394af9412be138c11da2f064f175d549ce51a39cfe91620ee58686614',
  'buyer-room-20261125-company-entry.html': 'e6390fa172c67cd9233914f6290a59b0caa0eedb41bb35eb97dbe35424bc71f0',
  'buyer-room/company-switch-entry-20261125.js': 'c82688ad797504f9e94b2dd023a513f23bcdd7064a953f63800e1645827aa08a',
  'purchase-live/supplier-allocation-20261125-discard-draft.js': '181429687802f425b01024d41fa380e70069ae95d3e16fbe77815d0332ed2105'
};

assert.ok(process.argv[2], 'Pass the unpacked verified Pages archive.');
const site = path.resolve(process.argv[2]);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true }).filter(entry => {
  assert.ok(entry.isFile() || entry.isDirectory(), 'Unsupported archive entry: ' + entry.name);
  return entry.isFile();
}).map(entry => path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));

assert.deepEqual(files.sort(), Object.keys(baseline).sort());
for (const [name, expected] of Object.entries(baseline)) {
  assert.equal(sha256(fs.readFileSync(path.join(site, name))), expected, 'Previously deployed asset changed: ' + name);
}
for (const name of ['buyer-room-20261125-company-entry.html', 'buyer-room/company-switch-sheet-20261125.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', name), 'utf8').replace(/\r\n/g, '\n');
  fs.writeFileSync(path.join(site, name), code, { flag: name.endsWith('.js') ? 'wx' : 'w' });
  console.log(name, sha256(code));
}
