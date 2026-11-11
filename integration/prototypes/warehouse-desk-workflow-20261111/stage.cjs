const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const clients = require('./clients.cjs');
const build = '20261111-warehouse-desk-workflow-v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function stage(previous, destination) {
  const baseline = JSON.parse(fs.readFileSync(path.join(previous, 'warehouse-compact-receipt-release.json')));
  assert.equal(baseline.build, '20261111-warehouse-compact-receipt-v1');
  const resources = baseline.resources.map(item => {
    const bytes = fs.readFileSync(path.join(previous, item.path));
    assert.equal(hash(bytes), item.sha256, item.path);
    const transform = clients.transforms[item.path];
    const next = transform ? Buffer.from(transform(bytes.toString('utf8'), build)) : bytes;
    const file = path.join(destination, item.path);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, next);
    return {path: item.path, sha256: hash(next)};
  });
  const result = {build, base: baseline.build, changed: resources.filter((row, index) => row.sha256 !== baseline.resources[index].sha256).map(row => row.path), resources};
  fs.writeFileSync(path.join(destination, 'warehouse-desk-workflow-release.json'), JSON.stringify(result, null, 2));
  return result;
}

module.exports = {stage};
if (require.main === module) console.log(stage(process.argv[2], process.argv[3]).changed);
