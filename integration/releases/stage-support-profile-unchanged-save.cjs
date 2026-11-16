const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {baseline, replacements} = require('./support-profile-unchanged-save-20261116/manifest.json');

const site = path.resolve(process.argv[2]);
const files = fs.readdirSync(site, {recursive:true, withFileTypes:true})
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(files.length, 108);
assert.deepEqual(files, Object.keys(baseline).sort());
for (const file of files) assert.equal(digest(fs.readFileSync(path.join(site, file))), baseline[file], file);

const updated = Object.entries(replacements).map(([file, expected]) => {
  assert.ok(baseline[file], file);
  const source = path.join(__dirname, 'support-profile-unchanged-save-20261116/static', file);
  const contents = fs.readFileSync(source, 'utf8').replaceAll('\r\n', '\n');
  assert.equal(digest(contents), expected, file);
  return [file, contents];
});
assert.equal(updated.length, 3);
for (const [file, contents] of updated) fs.writeFileSync(path.join(site, file), contents);
console.log('Verified 108 published resources and replaced only three Support customer profile files.');
