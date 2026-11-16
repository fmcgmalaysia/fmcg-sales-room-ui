const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { baseline, replacements } = require('./department-receipt-recovery-20261116/manifest.json');

const site = path.resolve(process.argv[2]);
const published = { ...baseline, ...replacements };
const hash = contents => createHash('sha256').update(contents).digest('hex');
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();

assert.equal(files.length, 108);
assert.deepEqual(files, Object.keys(published).sort());
for (const file of files) {
  assert.equal(hash(fs.readFileSync(path.join(site, file))), published[file], file);
}

const staffFile = 'master-staff/index.html';
const staffPage = fs.readFileSync(path.resolve(__dirname, '../..', staffFile), 'utf8').replaceAll('\r\n', '\n');
assert.equal(hash(staffPage), 'aeacbe2801a8a5bea7b4c20135a055c561f21dab502014fb08e4551af69a5056');
fs.writeFileSync(path.join(site, staffFile), staffPage);
console.log('Verified 108 published resources and replaced only the Staff Management page.');
