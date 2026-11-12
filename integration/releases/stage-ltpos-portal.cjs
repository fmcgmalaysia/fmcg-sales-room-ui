const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const site = path.resolve(process.argv[2]);
const directory = path.join(site, 'ltpos');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = JSON.parse(fs.readFileSync(path.join(site, 'warehouse-desk-workflow-release.json')));
assert.equal(baseline.build, '20261112-support-warehouse-polish-v1');
assert.equal(baseline.resources.length, 96);
assert.equal(new Set(baseline.resources.map(item => item.path)).size, 96);
for (const item of baseline.resources) {
  assert.equal(digest(fs.readFileSync(path.join(site, item.path))), item.sha256, item.path);
}
assert.equal(fs.existsSync(directory), false, 'LTPOS cannot overwrite an existing directory');
const source = path.resolve(__dirname, '../../ltpos');
const files = ['index.html', 'ltpos-team.jpg'].map(name => ({
  name,
  bytes: fs.readFileSync(path.join(source, name))
}));
assert.match(files[0].bytes.toString('utf8'), /name="build" content="ltpos-staff-portal-v1"/);
assert.equal(files[1].bytes.readUInt16BE(0), 0xffd8);
fs.mkdirSync(directory);
for (const { name, bytes } of files) {
  fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx' });
}
console.log('96 verified existing resources, plus 2 LTPOS files');
