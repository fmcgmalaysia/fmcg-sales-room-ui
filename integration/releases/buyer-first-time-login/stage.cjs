const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const productionAssets = require('./production-assets.json');

const site = path.resolve(process.argv[2]);
const candidate = 'buyer-login-20261121-member-setup.html';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function inventory() {
  const entries = fs.readdirSync(site, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile());
  return Object.fromEntries(entries.map(entry => {
    const file = path.join(entry.parentPath, entry.name);
    return [path.relative(site, file).split(path.sep).join('/'), hash(fs.readFileSync(file))];
  }));
}

const before = inventory();
assert.deepEqual(before, productionAssets);
const source = path.resolve(__dirname, '../../..', candidate);
fs.copyFileSync(source, path.join(site, candidate), fs.constants.COPYFILE_EXCL);
const after = inventory();
assert.equal(after[candidate], hash(fs.readFileSync(source)));
delete after[candidate];
assert.deepEqual(after, before);
console.log(`Member setup candidate added. All ${Object.keys(before).length} existing production resources match.`);
