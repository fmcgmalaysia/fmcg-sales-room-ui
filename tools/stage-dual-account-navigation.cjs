const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const baseline = require('../integration/releases/dual-account-navigation-20261125/pages-base.json');

assert.ok(process.argv[2], 'Pass the unpacked verified Pages archive.');
const site = path.resolve(process.argv[2]);
const repo = path.join(__dirname, '..');
const sha256 = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

function listFiles(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(folder, entry.name);
    if (entry.isDirectory()) return listFiles(filename);
    assert.ok(entry.isFile(), 'Unsupported baseline entry: ' + filename);
    return [path.relative(site, filename).split(path.sep).join('/')];
  });
}

assert.deepEqual(listFiles(site).sort(), Object.keys(baseline).sort());
for (const [filename, hash] of Object.entries(baseline)) {
  assert.equal(sha256(path.join(site, filename)), hash, 'Previously deployed asset changed: ' + filename);
}

const assets = [
  'buyer-room-20261125-company-navigation.html',
  'sales-room-20261125-company-consent.html',
  'buyer-room/company-switch-navigation-20261125.js'
];
for (const filename of assets) {
  const destination = path.join(site, filename);
  fs.copyFileSync(path.join(repo, filename), destination, fs.constants.COPYFILE_EXCL);
  console.log(filename, sha256(destination));
}
