const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const baseline = require('../integration/releases/buyer-multi-company-20261124/pages-base.json');

const site = path.resolve(process.argv[2]);
const repo = path.join(__dirname, '..');
const sha256 = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

function files(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(folder, entry.name);
    if (entry.isDirectory()) return files(filename);
    assert.ok(entry.isFile(), 'Unsupported baseline entry: ' + filename);
    return [path.relative(site, filename).split(path.sep).join('/')];
  });
}

assert.deepEqual(files(site).sort(), Object.keys(baseline).sort());
for (const [filename, expected] of Object.entries(baseline)) {
  assert.equal(sha256(path.join(site, filename)), expected, 'Previously deployed asset changed: ' + filename);
}

const assets = [
  ['buyer-room-20261124-company-switch.html', 'buyer-room-20261125-order-recovery.html'],
  ['sales-room-20261124-company-switch.html', 'sales-room-20261125-linked-registration.html'],
  ['buyer-room/company-switch.js', 'buyer-room/company-switch-20261125.js']
];
for (const [source, filename] of assets) {
  assert.ok(!Object.hasOwn(baseline, filename), 'Release must keep existing assets: ' + filename);
  fs.copyFileSync(path.join(repo, source), path.join(site, filename), fs.constants.COPYFILE_EXCL);
  console.log(filename, sha256(path.join(site, filename)));
}
