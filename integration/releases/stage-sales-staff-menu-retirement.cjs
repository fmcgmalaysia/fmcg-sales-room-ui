const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { baseline, replacements } = require('./sales-staff-menu-retirement.json');

const site = path.resolve(process.argv[2]);
const hash = contents => createHash('sha256').update(contents).digest('hex');
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();

assert.equal(files.length, 108);
assert.deepEqual(files, Object.keys(baseline).sort());
for (const file of files) {
  assert.equal(hash(fs.readFileSync(path.join(site, file))), baseline[file], file);
}

assert.deepEqual(Object.keys(replacements).sort(), [
  'index.html'
]);
const updates = Object.entries(replacements).map(([file, expected]) => {
  assert.ok(Object.hasOwn(baseline, file), file);
  const contents = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(hash(contents), expected, file);
  return { file, contents };
});
for (const {file, contents} of updates) fs.writeFileSync(path.join(site, file), contents);
console.log('Verified all 108 baseline files and replaced only the Sales Room entry HTML.');
