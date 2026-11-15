const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const baseline = require('./fmcg-mobile-entry-baseline.json');

assert.ok(process.argv[2], 'Pass the extracted Pages artifact directory.');
const site = path.resolve(process.argv[2]);
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();
assert.deepEqual(files, Object.keys(baseline).sort());
for (const file of files) assert.equal(digest(path.join(site, file)), baseline[file], file);

const changed = ['index.html', 'buyer-login-20261113.html'];
const added = ['buyer-login-mobile.css', 'buyer-login-mobile-photo.jpg'];
for (const file of added) assert.ok(!Object.hasOwn(baseline, file), file);
const replacements = [...changed, ...added].map(file => [file, fs.readFileSync(path.resolve(__dirname, '../..', file))]);
assert.ok(replacements[0][1].includes('20261116-sales-mobile-entry-v1'));
assert.ok(replacements[1][1].includes('20261116-buyer-login-mobile-v1'));
for (const [file, bytes] of replacements) fs.writeFileSync(path.join(site, file), bytes);
for (const file of files.filter(file => !changed.includes(file))) {
  assert.equal(digest(path.join(site, file)), baseline[file], file);
}
console.log(`Verified ${files.length} original files. Replaced ${changed.length} and added ${added.length} FMCG assets.`);
