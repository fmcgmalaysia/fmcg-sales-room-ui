const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const changes = require('./support-desk-header-edits.json');

const version = '20261114-support-desk-header-v1';
const hash = value => createHash('sha256').update(value).digest('hex');

function stageSupportDeskHeader(site) {
  const staged = Object.entries(changes).map(([name, change]) => {
    const file = path.join(site, name);
    const original = fs.readFileSync(file);
    assert.equal(hash(original), change.before, name);
    const lines = original.toString('utf8').split('\n');
    for (const { index, before, after } of change.hunks.toReversed()) {
      assert.deepEqual(lines.slice(index, index + before.length), before, name);
      lines.splice(index, before.length, ...after);
    }
    const candidate = lines.join('\n');
    assert.equal(hash(candidate), change.after, name + ' candidate');
    return [file, candidate];
  });
  for (const [file, candidate] of staged) fs.writeFileSync(file, candidate);
}

module.exports = { version, stageSupportDeskHeader };
if (require.main === module) stageSupportDeskHeader(process.argv[2]);
