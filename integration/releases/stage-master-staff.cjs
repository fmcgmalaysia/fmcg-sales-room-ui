const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function stageMasterStaff(site) {
  const previous = JSON.parse(fs.readFileSync(path.join(site, 'warehouse-desk-workflow-release.json')));
  assert.equal(previous.build, '20261112-support-warehouse-polish-v1');
  assert.equal(previous.resources.length, 96);
  assert.equal(new Set(previous.resources.map(item => item.path)).size, 96);
  for (const item of previous.resources) {
    assert.equal(hash(fs.readFileSync(path.join(site, item.path))), item.sha256, item.path);
  }

  const additions = ['ltpos/index.html', 'ltpos/ltpos-team.jpg', 'master-staff/index.html']
    .map(file => ({ file, bytes: fs.readFileSync(path.join(root, file)) }));
  assert.match(additions[0].bytes.toString('utf8'), /name="build" content="ltpos-staff-portal-v2"/);
  assert.equal(additions[1].bytes.readUInt16BE(0), 0xffd8);
  assert.match(additions[2].bytes.toString('utf8'), /name="build" content="master-staff-management-v1"/);
  for (const { file } of additions) assert(!fs.existsSync(path.join(site, file)), file);
  for (const { file, bytes } of additions) {
    const target = path.join(site, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: 'wx' });
  }
  return [...previous.resources, ...additions.map(({file, bytes}) => ({path: file, sha256: hash(bytes)}))];
}

module.exports = { stageMasterStaff };
if (require.main === module) {
  assert(process.argv[2], 'Provide the generated Warehouse Desk package directory.');
  const resources = stageMasterStaff(path.resolve(process.argv[2]));
  console.log(`${resources.length} verified static resources`);
}
