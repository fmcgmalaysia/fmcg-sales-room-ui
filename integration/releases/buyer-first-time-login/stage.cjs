const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const site = path.resolve(process.argv[2]);
const candidate = 'buyer-login-20261121.html';
const current = 'buyer-login-20261113.html';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function inventory() {
  const entries = fs.readdirSync(site, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile());
  return Object.fromEntries(entries.map(entry => {
    const file = path.join(entry.parentPath, entry.name);
    return [path.relative(site, file).split(path.sep).join('/'), hash(fs.readFileSync(file))];
  }));
}

const before = inventory();
assert.equal(Object.keys(before).length, 117);
const login = fs.readFileSync(path.join(site, current), 'utf8').replace(/\r\n/g, '\n');
assert.equal(hash(login), '612de849fbbcc67d7c9ca51bffaae89aa83da075f7fd23aefa6c18812d16211e');
const source = path.resolve(__dirname, '../../..', candidate);
fs.copyFileSync(source, path.join(site, candidate), fs.constants.COPYFILE_EXCL);
const after = inventory();
assert.equal(after[candidate], hash(fs.readFileSync(source)));
delete after[candidate];
assert.deepEqual(after, before);
console.log('First Time Login candidate added. All 117 existing production resources match.');
