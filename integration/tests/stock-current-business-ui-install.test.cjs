const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { definition, inspectBusinessUiInstall } = require('../prototypes/stock-current-state/build-business-ui-install.cjs');
const { stageBusinessUiInstall } = require('../prototypes/stock-current-state/stage-business-ui-install.cjs');
const folder = path.join(__dirname, '../prototypes/stock-current-state');
test('real Sales/Purchase/Warehouse/Support asset destinations and five paired Wix relays include the separate Source Sales page', () => {
  const report = inspectBusinessUiInstall();
  assert.deepEqual(report.errors, []); assert.equal(report.activationAllowed, false); assert.equal(report.deployPerformed, false);
  assert.equal(report.install.filter(row => row.kind === 'PAGES').length, 38);
  assert.equal(report.install.filter(row => row.kind !== 'PAGES').length, 5);
  const sourceRelay = report.install.find(row => row.target === 'sales-room/wix/sales-room-page.js');
  assert.equal(sourceRelay.system, 'FMCGMALAYSIA');
  assert.equal(sourceRelay.source, 'source-sales-room-page.candidate.js');
  assert.match(sourceRelay.beforeSha256, /^[a-f0-9]{64}$/);
  for (const target of ['index.html', 'sales-room/order-adjustment.js', 'purchase-live/index.html', 'purchase-live/borrow-approval.js',
    'purchase-live/borrow-relations.js', 'warehouse-room/workroom.js', 'support-room/packing-workbench.js', 'integration/wix/packingListBridge.js']) {
    assert.ok(report.install.some(row => row.target === target));
  }
  assert.ok(report.install.every(row => /^[a-f0-9]{64}$/.test(row.sha256)));
  assert.ok(report.install.every(row => !/preview|review/.test(row.source + row.target)));
  execFileSync(process.execPath, [path.join(folder, 'build-business-ui-install.cjs'), '--check']);
});
test('omitted paired asset, duplicate destination, fixture input and path escape cannot become a business UI install', () => {
  assert.ok(inspectBusinessUiInstall(definition().filter(row => row.target !== 'support-room/packing-transport.js')).errors.length);
  assert.throws(() => inspectBusinessUiInstall([...definition(), definition()[0]]), /unique/);
  assert.throws(() => inspectBusinessUiInstall([{ source: 'preview/purchase-workbench-review.html', target: 'index.html', kind: 'PAGES' }]), /unique/);
  assert.throws(() => inspectBusinessUiInstall([{ source: '../index.html', target: 'index.html', kind: 'PAGES' }]), /unique/);
});
test('approval JS and CSS use matching fresh resource versions and retain real CURRENT-only mounting and original mutation route', () => {
  const html = fs.readFileSync(path.join(folder, 'purchase-ui/index.html'), 'utf8');
  for (const file of ['borrow-approval.js', 'borrow-approval.css']) assert.ok(html.includes(file + '?v=20261023-split-borrow-entry-v4'));
  const approval = fs.readFileSync(path.join(folder, 'purchase-ui/borrow-approval.js'), 'utf8');
  assert.match(approval, /const enabled = meta\?\.schema === 'PURCHASE_TRANSFERS_V2' && meta.stockProtocol === 1/);
  assert.match(approval, /if \(!enabled\) \{[\s\S]*?data-borrow-availability[\s\S]*?return;/);
  assert.match(approval, /consent.checked = false/);
  const source = fs.readFileSync(path.join(folder, 'purchase-ui/supplier-allocation.js'), 'utf8');
  assert.match(source, /api.mutate\('PURCHASE_SAVE_REQUEST',\{operation:'BORROW_APPROVE',input\}\)/);
  assert.doesNotMatch(approval, /EXAMPLE-PO-|fetch\(|postMessage\(/);
});

test('formal Pages packaging installs exact static paths, preserves original Wix and does not include untracked data or activate stock', () => {
  const checkout = path.resolve(folder, '../../..'), temporary = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fmcg-business-ui-'));
  const destination = path.join(temporary, 'site'), report = inspectBusinessUiInstall();
  const files = [...new Set([...report.install.map(row => 'integration/prototypes/stock-current-state/' + row.source),
    ...report.install.filter(row => row.beforeSha256).map(row => row.target), 'buyer-room.html', '.github/workflows/pages-v64-same-origin.yml'])];
  const release = stageBusinessUiInstall(destination, files, 'a'.repeat(40));
  assert.equal(release.resources.length, 38); assert.equal(release.backendInstalled, false);
  assert.equal(release.wixSourcesInstalled, false); assert.equal(release.currentStockActivated, false);
  assert.equal(release.realBorrowingEnabled, false); assert.equal(release.loadedAcceptanceCompleted, false);
  for (const row of report.install.filter(row => row.kind === 'PAGES')) {
    assert.equal(fs.readFileSync(path.join(destination, row.target), 'utf8').replace(/\r\n/g, '\n'),
      fs.readFileSync(path.join(folder, row.source), 'utf8').replace(/\r\n/g, '\n'));
  }
  for (const row of report.install.filter(row => row.kind !== 'PAGES')) {
    assert.deepEqual(fs.readFileSync(path.join(destination, row.target)), fs.readFileSync(path.join(checkout, row.target)));
  }
  assert.deepEqual(fs.readFileSync(path.join(destination, 'buyer-room.html')), fs.readFileSync(path.join(checkout, 'buyer-room.html')));
  assert.equal(fs.existsSync(path.join(destination, 'active-column-gap-tests.txt')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination, 'stock-interface-release.json'), 'utf8')), release);
  assert.throws(() => stageBusinessUiInstall(destination, files, 'a'.repeat(40)), /new dedicated/);
  assert.throws(() => stageBusinessUiInstall(checkout, files, 'a'.repeat(40)), /new dedicated/);
  assert.throws(() => stageBusinessUiInstall(path.join(temporary, 'bad-path'), ['../outside.txt'], 'a'.repeat(40)), /unique/);
  assert.throws(() => stageBusinessUiInstall(path.join(temporary, 'missing-source'), [], 'a'.repeat(40)), /versioned/);
  assert.equal(fs.existsSync(path.join(temporary, 'missing-source')), false);
  const workflow = fs.readFileSync(path.join(checkout, '.github/workflows/pages-v64-same-origin.yml'), 'utf8');
  assert.match(workflow, /default: baseline/);
  assert.match(workflow, /github.event_name == 'workflow_dispatch' && inputs.static_ui == 'stock-interface'/);
  assert.match(workflow, /path: \$\{\{ inputs.static_ui == 'stock-interface'/);
});
