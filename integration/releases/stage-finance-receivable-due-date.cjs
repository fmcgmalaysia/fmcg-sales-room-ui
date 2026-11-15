const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const baseline = require('./finance-receivable-due-date-baseline.json');

const site = path.resolve(process.argv[2]);
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => {
    assert.ok(entry.isFile(), entry.name);
    return path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
  }).sort();

assert.deepEqual(files, Object.keys(baseline).sort());
for (const file of files) {
  const hash = createHash('sha256').update(fs.readFileSync(path.join(site, file))).digest('hex');
  assert.equal(hash, baseline[file], file);
}

const changes = ['account-room/index.html', 'account-room/customer-debtors.js'];
const sources = changes.map(file => fs.readFileSync(path.resolve(__dirname, '../..', file)));
for (const [index, file] of changes.entries()) {
  fs.writeFileSync(path.join(site, file), sources[index]);
}
console.log(`Verified ${files.length} baseline files and updated ${changes.length} Finance assets.`);
