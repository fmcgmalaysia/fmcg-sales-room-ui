const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const target = process.argv[2];
assert.ok(target && fs.statSync(target).isDirectory(), 'Pass the extracted verified Pages package.');
const hash = value => createHash('sha256').update(value).digest('hex');
function tree() {
  return new Map(fs.readdirSync(target, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const file = path.join(entry.parentPath, entry.name);
    return [path.relative(target, file).split(path.sep).join('/'), hash(fs.readFileSync(file))];
  }));
}
const before = tree();
assert.equal(before.size, 117);
const expected = new Map([
  ['catalogue/catalogue-header-v2.html', '95fe90fc2252cbdb24121fb1c00717b0ebd46f672603dca60bcfcfc5c3b9f7ca'],
  ['catalogue/catalogue-workspace-v1.html', '1cfd7a672417101337667720f04af23f9934ea12c7e688b1902372422c38018c']
]);
for (const [name, checksum] of expected) {
  assert.equal(before.get(name), checksum, 'Unexpected production source: ' + name);
  const candidate = fs.readFileSync(path.resolve(__dirname, '../../buyer-room/catalogue/wix', path.basename(name)), 'utf8').replace(/\r\n/g, '\n');
  if (name.endsWith('header-v2.html')) {
    assert.ok(candidate.includes('20261119-catalogue-mobile-buyer-entry-v1'));
    assert.ok(candidate.includes("post('catalogueBuyerRoom')"));
  } else {
    assert.ok(candidate.includes('20261119-catalogue-mobile-buyer-entry-v1'));
    assert.ok(candidate.includes("if(d.type==='cataloguePrepareBuyerRoom')"));
    assert.ok(!candidate.includes('width="168" height="168"'));
    assert.ok(candidate.includes('cataloguePrepareBuyerRoom'));
    assert.ok(!candidate.includes('width="168" height="168"'));
  }
  fs.writeFileSync(path.join(target, name), candidate);
}
const after = tree();
assert.equal(after.size, before.size);
assert.deepEqual([...after].filter(([name, value]) => before.get(name) !== value).map(([name]) => name).sort(), [...expected.keys()].sort());
console.log(JSON.stringify({ changed: [...expected.keys()].map(name => ({ name, sha256: after.get(name) })), unchanged: 115 }));
