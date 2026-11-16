'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const release = path.join(__dirname, 'catalogue-menu-focus-20261117');
const { baseline, changes } = require(path.join(release, 'manifest.json'));
const site = path.resolve(process.argv[2]);
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true }).filter(entry => !entry.isDirectory()).map(entry => {
  assert.ok(entry.isFile());
  return path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
}).sort();
const digest = input => createHash('sha256').update(input).digest('hex');

assert.equal(files.length, 113);
assert.deepEqual(files, Object.keys(baseline).sort());
for (const file of files) assert.equal(digest(fs.readFileSync(path.join(site, file))), baseline[file], file);
const target = 'catalogue/catalogue-workspace-v1.html';
assert.deepEqual(Object.keys(changes), [target]);
const file = path.join(__dirname, '../../buyer-room/catalogue/wix/catalogue-workspace-v1.html');
const source = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
assert.equal(digest(source), changes[target]);
fs.writeFileSync(path.join(site, target), source);
console.log('Verified 113 baseline files and replaced only the Catalogue workspace HTML.');
