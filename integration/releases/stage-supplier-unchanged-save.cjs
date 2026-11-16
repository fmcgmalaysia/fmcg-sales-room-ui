const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { baseline, replacements } = require('./department-receipt-recovery-20261116/manifest.json');

const site = path.resolve(process.argv[2]);
const published = { ...baseline, ...replacements,
  'master-staff/index.html': 'aeacbe2801a8a5bea7b4c20135a055c561f21dab502014fb08e4551af69a5056' };
const reviewed = {
  'purchase-live/app.js': '072a095f714594ae24b2fe42ae932a4208ae9c448c5ba8453844db4bee7a4589',
  'purchase-live/index.html': 'caa9db0fbb02b210544c25ede2bf7b2378dc2785f3950480e2ebba5a48691f87'
};
const hash = contents => createHash('sha256').update(contents).digest('hex');
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();

assert.equal(files.length, 108);
assert.deepEqual(files, Object.keys(published).sort());
for (const file of files) assert.equal(hash(fs.readFileSync(path.join(site, file))), published[file], file);

const changes = Object.entries(reviewed).map(([file, fingerprint]) => {
  const contents = fs.readFileSync(path.join(__dirname, 'supplier-unchanged-save-20261116/static', file), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(hash(contents), fingerprint, file);
  return [file, contents];
});
for (const [file, contents] of changes) fs.writeFileSync(path.join(site, file), contents);
console.log('Verified 108 published resources and replaced only the two reviewed Purchase assets.');
