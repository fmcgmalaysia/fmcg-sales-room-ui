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

for (const filename of [
  'buyer-room-20261124-company-switch.html',
  'buyer-room/company-switch.js',
  'sales-room-20261124-company-switch.html'
]) {
  assert.ok(!Object.hasOwn(baseline, filename), 'Existing published asset would be overwritten.');
  fs.mkdirSync(path.dirname(path.join(site, filename)), { recursive: true });
  fs.copyFileSync(path.join(repo, filename), path.join(site, filename), fs.constants.COPYFILE_EXCL);
  console.log(filename, sha256(path.join(site, filename)));
}
