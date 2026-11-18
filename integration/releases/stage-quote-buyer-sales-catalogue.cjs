const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const target = process.argv[2];
assert.ok(target && fs.statSync(target).isDirectory(), 'Pass the extracted production Pages directory.');
const source = path.join(__dirname, 'quote-buyer-sales-catalogue');
const replacements = new Map([
  ['buyer-room.html', '853c93f89f0a6f636839184ca9a68e804152b45c76ef2f9b0a7da4268a58a1ac'],
  ['master-quotations/index.html', '6d73d8543e3ac66b23e4d47b28ea3bc2b1eb989753a831db19e23d0733aeece1'],
  ['master-quotations/app.js', '3d9927c9546366e7936e6263007326bac9ff2319325812243c4862e1c808e546']
]);

function hashTree(directory) {
  return new Map(fs.readdirSync(directory, { recursive: true, withFileTypes: true }).filter(item => item.isFile()).map(item => {
    const file = path.join(item.parentPath, item.name);
    const relative = path.relative(directory, file).split(path.sep).join('/');
    return [relative, createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
  }));
}

const before = hashTree(target);
assert.equal(before.size, 117);
for (const [file, hash] of replacements) assert.equal(before.get(file), hash, 'Unexpected official baseline for ' + file);
for (const file of replacements.keys()) fs.copyFileSync(path.join(source, file), path.join(target, file));
const after = hashTree(target);
assert.equal(after.size, 117);
const changed = [...after].filter(([file, hash]) => before.get(file) !== hash).map(([file]) => file).sort();
assert.deepEqual(changed, [...replacements.keys()].sort());
for (const file of changed) console.log(`${after.get(file)}  ${file}`);
console.log('Verified 114 unchanged files and three scoped replacements.');
