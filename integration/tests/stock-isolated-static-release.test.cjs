'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { execFileSync } = require('node:child_process');
const { staticPath, planIsolatedStatic, verifyVersionedStatic } = require('../prototypes/stock-current-state/stage-isolated-cohort.cjs');
test('Pages artifact contains actual paired static resources but never backend/private handoff or retired candidates', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const { assets, release } = planIsolatedStatic({ tracked, commit: 'a'.repeat(40) });
  assert.ok(assets.has('buyer-room.html')); assert.ok(assets.has('account-room/account-current.js'));
  assert.ok(assets.has('purchase-live/borrow-approval.js')); assert.ok(assets.has('warehouse-room/index.html'));
  assert.equal(release.currentStockActivated, false); assert.equal(release.wixPublished, false);
  for (const file of assets.keys()) assert.ok(staticPath(file));
  for (const file of ['handoff/private.png', 'backend/catalogueAuth.web.js', 'integration/prototypes/stock-current-state/isolated-cohort/MASTER/r2stockCurrentCommands.js',
    'sales-room/wix/onboarding.web.js', 'assets/private.csv', '../secret.js', 'assets/a/b.js', '.git/config']) assert.equal(staticPath(file), false, file);
});
test('a resource edit or uncommitted overlay cannot be labelled with an older valid-looking code commit', () => {
  const plan = { assets: new Map([['buyer-room.html', Buffer.from('ACTUAL')], ['purchase-live/borrow-approval.js', Buffer.from('NEW')]]), release: { codeCommit: 'a'.repeat(40) } };
  const paths = [];
  verifyVersionedStatic(plan, (version, file) => { assert.equal(version, plan.release.codeCommit); paths.push(file); return file === 'buyer-room.html' ? 'ACTUAL' : 'NEW'; });
  assert.deepEqual(paths, ['buyer-room.html', 'integration/prototypes/stock-current-state/isolated-cohort/PAGES/purchase-live/borrow-approval.js']);
  assert.throws(() => verifyVersionedStatic(plan, () => 'OLD'), /recorded committed/);
});

test('Windows text checkout endings do not invent a content change or alter binary assets', () => {
  const fs = require('node:fs'), path = require('node:path'), root = path.join(__dirname, '../..');
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const plan = planIsolatedStatic({ tracked, commit: 'a'.repeat(40), read: file => {
    const bytes = fs.readFileSync(path.join(root, file));
    return /\.(?:html|js|css|svg)$/.test(file) ? Buffer.from(String(bytes).replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')) : bytes;
  } });
  const actual = plan.assets.get('account-room/customer-debtors.js');
  assert.equal(String(actual).includes('\r\n'), false);
  assert.equal(String(actual), fs.readFileSync(path.join(root, 'account-room/customer-debtors.js'), 'utf8').replace(/\r\n/g, '\n'));
  for (const [file, bytes] of plan.assets) if (/\.(?:png|jpg|jpeg|ico|webp)$/.test(file)) assert.deepEqual(bytes, fs.readFileSync(path.join(root, file)));
});
test('new workflow option keeps original baseline/interface path and permissions, and stages isolated files before its upload', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../.github/workflows/pages-v64-same-origin.yml'), 'utf8');
  assert.match(source, /- isolated-stock-interface/); assert.match(source, /- stock-interface/); assert.match(source, /default: baseline/);
  assert.ok(source.indexOf('stage-isolated-cohort.cjs') < source.indexOf('name: Upload isolated static site'));
  assert.match(source, /inputs.static_ui != 'isolated-stock-interface'/);
  assert.match(source, /contents: read\s+actions: read\s+pages: write\s+id-token: write/);
  assert.doesNotMatch(source, /contents: write|cancel-in-progress: true/);
});
test('missing public dependencies and invented code version cannot be packaged as a ready release', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.throws(() => planIsolatedStatic({ tracked, commit: 'latest' }), /Exact/);
  assert.throws(() => planIsolatedStatic({ tracked: tracked.filter(file => file !== 'master-shared/task-chat.js'), commit: 'a'.repeat(40) }), /dependency missing/);
  assert.throws(() => planIsolatedStatic({ tracked: [...tracked, tracked[0]], commit: 'a'.repeat(40) }), /distinct/);
});
