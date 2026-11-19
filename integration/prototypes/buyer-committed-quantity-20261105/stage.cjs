const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const changed = ['buyer-room.html'];
const root = path.resolve(__dirname, '../../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function stage(previous, destination) {
  const baseline = JSON.parse(fs.readFileSync(path.join(previous, 'customer-track-evidence-release.json')));
  assert.equal(baseline.build, '20261105-customer-track-evidence-v1');
  assert.equal(baseline.resources.length, 96);
  assert.equal(new Set(baseline.resources.map(row=>row.path)).size, 96);
  assert(!fs.existsSync(destination));
  const resources = baseline.resources.map(({path: file, sha256}) => {
    const original = fs.readFileSync(path.join(previous, file));
    assert.equal(hash(original), sha256, file);
    const bytes = changed.includes(file) ? Buffer.from(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g,'\n')) : original;
    if(changed.includes(file)) assert.notEqual(hash(bytes), sha256, file);
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.writeFileSync(target, bytes);
    return {path:file, sha256: hash(bytes)};
  });
  const manifest = {build:'20261105-buyer-committed-quantity-v1',changed,unchanged:95,resources};
  fs.writeFileSync(path.join(destination,'buyer-committed-quantity-release.json'),JSON.stringify(manifest,null,2));
  return manifest;
}
if(require.main===module)stage(process.argv[2],process.argv[3]);
