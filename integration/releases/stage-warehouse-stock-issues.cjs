const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const changes = require('./warehouse-stock-issues-edits.json');

const version = '20261114-warehouse-stock-issues-v1';
const hash = value => createHash('sha256').update(value).digest('hex');

function stageWarehouseReceiptInput(site) {
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

module.exports = { version, stageWarehouseReceiptInput };
if (require.main === module) stageWarehouseReceiptInput(process.argv[2]);
