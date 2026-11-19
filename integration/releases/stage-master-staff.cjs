const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function stageMasterStaff(site) {
  const manifest = fs.readFileSync(path.join(site, 'warehouse-desk-workflow-release.json'));
  assert.equal(hash(manifest), '0669981b074a1832d0624876b6b06544839366452e9a349155eb8740d6ca49a5',
    'The package must start from the verified production manifest.');
  const previous = JSON.parse(manifest);
  assert.equal(previous.build, '20261112-support-warehouse-polish-v1');
  assert.equal(previous.resources.length, 96);
  assert.equal(new Set(previous.resources.map(item => item.path)).size, 96);
  for (const item of previous.resources) {
    assert.equal(hash(fs.readFileSync(path.join(site, item.path))), item.sha256, item.path);
  }

  const portal = Buffer.from(fs.readFileSync(path.join(root, 'ltpos/index.html'), 'utf8').replace(/\r\n/g, '\n'));
  assert.equal(hash(portal), 'fe461e0e38741739ef67bb86256476e46add871d96910c25b21ccc6064315132');
  const publishedPortal = execFileSync('git', [
    'show', 'a1a2cc3116a66fc1e5fed70b5aebdb49135c85b0:ltpos/index.html'
  ], { cwd: root });
  const teamPhoto = fs.readFileSync(path.join(root, 'ltpos/ltpos-team.jpg'));
  assert.equal(hash(publishedPortal), '2d63bb908541e3b11e7034ac209bb79e31095a5bac63f9ae25484fcb6a1768c5');
  assert.equal(hash(teamPhoto), 'bbc45b5201cca468a49d278dfa21279466cb3f6c8d811813ce4cf361805874a0');
  assert.match(portal.toString('utf8'), /name="build" content="ltpos-staff-portal-v2"/);
  const staffPage = fs.readFileSync(path.join(root, 'master-staff/index.html'));
  assert.match(staffPage.toString('utf8'), /name="build" content="master-staff-management-v2"/);
  const additions = [
    { file: 'ltpos/index.html', bytes: publishedPortal },
    { file: 'ltpos/managed.html', bytes: portal },
    { file: 'ltpos/ltpos-team.jpg', bytes: teamPhoto },
    { file: 'master-staff/index.html', bytes: staffPage },
  ];
  const buyerResetSource = execFileSync('git', [
    'show', 'e007684e441e52d545d5774b6f8c49729b26f771:buyer-login.html'
  ], { cwd: root, encoding: 'utf8' });
  const buyerReset = Buffer.from(buyerResetSource.replace(/\r\n/g, '\n'));
  assert.equal(hash(buyerReset), 'e4a2f0cdb8627a4e4d50bfd3f84bebfe941c227b7d9165ca58e6e94a10e8b472',
    'Retain the published Buyer password reset page referenced by Wix.');
  additions.push({ file: 'buyer-login-20261113.html', bytes: buyerReset });
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
