const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const changes = require('./purchase-company-switch-edits.json');

const version = '20261114-purchase-company-switch-v1';
const hash = value => createHash('sha256').update(value).digest('hex');

function stagePurchaseCompanySwitch(site) {
  const staged = Object.entries(changes).map(([name, change]) => {
    const file = path.join(site, name);
    const original = fs.readFileSync(file);
    assert.equal(hash(original), change.before, name);
    let candidate = original.toString('utf8');
    for (const [before, after] of change.edits) {
      assert.equal(candidate.split(before).length, 2, name + ' replacement occurrence');
      candidate = candidate.replace(before, () => after);
    }
    assert.equal(hash(candidate), change.after, name + ' candidate');
    return [file, candidate];
  });
  for (const [file, candidate] of staged) fs.writeFileSync(file, candidate);
}

module.exports = { version, stagePurchaseCompanySwitch };
if (require.main === module) stagePurchaseCompanySwitch(process.argv[2]);
