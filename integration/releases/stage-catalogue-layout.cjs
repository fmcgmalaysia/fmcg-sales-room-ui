const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { baseline, additions } = require('./catalogue-layout-20261117/manifest.json');

const site = path.resolve(process.argv[2]);
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(files.length, 108);
assert.deepEqual(files, Object.keys(baseline).sort());
for (const file of files) assert.equal(digest(fs.readFileSync(path.join(site, file))), baseline[file], file);

const source = path.resolve(__dirname, '../../buyer-room/catalogue/wix');
const expectedFiles = ['catalogue/catalogue-header-v2.html', 'catalogue/catalogue-workspace-v1.html'];
assert.deepEqual(Object.keys(additions), expectedFiles);
const documents = expectedFiles.map(file => {
  assert.equal(baseline[file], undefined);
  const contents = fs.readFileSync(path.join(source, path.basename(file)), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(digest(contents), additions[file], file);
  assert.ok(contents.includes('<!-- 20261117-catalogue-layout-v1 -->'), file);
  return [file, contents];
});
fs.mkdirSync(path.join(site, 'catalogue'));
for (const [file, contents] of documents) fs.writeFileSync(path.join(site, file), contents);
console.log('Verified 108 existing files. Added only the two versioned Catalogue components.');
