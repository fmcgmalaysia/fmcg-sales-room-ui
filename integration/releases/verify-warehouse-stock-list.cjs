const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const expected = require('./warehouse-stock-list-seal.json');

const root = path.resolve(process.argv[2]);

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(file);
    assert.ok(entry.isFile(), 'Unexpected resource type: ' + file);
    return [file];
  });
}

const files = filesUnder(root).map(file => path.relative(root, file).split(path.sep).join('/'));
assert.deepEqual(files.sort(), Object.keys(expected).sort());

for (const file of files) {
  const hash = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  assert.equal(hash, expected[file], file);
}

console.log('Verified all ' + files.length + ' staged files before upload.');
