const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const site = path.resolve(process.argv[2]);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = fs.readFileSync(path.join(site, 'warehouse-desk-workflow-release.json'));
assert.equal(digest(manifest), '0669981b074a1832d0624876b6b06544839366452e9a349155eb8740d6ca49a5');
const { resources } = JSON.parse(manifest);
assert.equal(resources.length, 96);
for (const resource of resources) {
  assert.equal(digest(fs.readFileSync(path.join(site, resource.path))), resource.sha256, resource.path);
}

const portalFiles = [
  ['ltpos/index.html', '2d63bb908541e3b11e7034ac209bb79e31095a5bac63f9ae25484fcb6a1768c5'],
  ['ltpos/ltpos-team.jpg', 'bbc45b5201cca468a49d278dfa21279466cb3f6c8d811813ce4cf361805874a0'],
].map(([file, expected]) => {
  const bytes = execFileSync('git', ['show', 'a1a2cc3116a66fc1e5fed70b5aebdb49135c85b0:' + file], { cwd: root });
  assert.equal(digest(bytes), expected, file);
  return { file, bytes };
});
const buyerHtml = fs.readFileSync(path.join(root, 'buyer-login.html'), 'utf8').replace(/\r\n/g, '\n');
assert.match(buyerHtml, /name="build" content="20261113-buyer-password-reset-v1"/);
fs.mkdirSync(path.join(site, 'ltpos'));
for (const { file, bytes } of portalFiles) fs.writeFileSync(path.join(site, file), bytes, { flag: 'wx' });
fs.writeFileSync(path.join(site, 'buyer-login-20261113.html'), buyerHtml, { flag: 'wx' });
console.log('98 published assets preserved. Added the Buyer login page for the coordinated Wix switch.');
