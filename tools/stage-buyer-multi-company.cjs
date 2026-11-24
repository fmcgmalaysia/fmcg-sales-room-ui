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

const filename = 'buyer-room/company-switch.js';
assert.ok(Object.hasOwn(baseline, filename), 'The deployed company switch asset could not be verified.');
fs.copyFileSync(path.join(repo, filename), path.join(site, filename));
console.log(filename, sha256(path.join(site, filename)));
