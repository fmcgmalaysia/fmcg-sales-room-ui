const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('workspace uses the compact customer, sku, user icon and risk layout', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const workspaceOverride = html.slice(html.indexOf('const originalWorkspaceCustomerTable'));
  assert.match(workspaceOverride, /CUSTOMER<span>客户 \/ 国家<\/span>/);
  assert.doesNotMatch(workspaceOverride, /<th>COUNTRY<span>国家<\/span><\/th>/);
  assert.match(workspaceOverride, /\+esc\(selectionLimit\)\+' sku/);
  assert.match(workspaceOverride, /workspace-user-count/);
  assert.match(workspaceOverride, /RISK<span>报价风险<\/span>/);
  assert.match(workspaceOverride, /quoteRiskCount/);
});

test('quote risk rules detect red signals and GP below six percent', () => {
  const source = fs.readFileSync(path.join(root, 'sales-room', 'google-apps-script', 'WixSelectionService.gs'), 'utf8');
  const helpers = new Function(source + '; return { lowGp: WIX_isLowGp_, redSignal: WIX_hasRedQuoteSignal_ };')();
  assert.equal(helpers.lowGp(0.05, '5%'), true);
  assert.equal(helpers.lowGp(0.06, '6%'), false);
  assert.equal(helpers.lowGp('', ''), false);
  assert.equal(helpers.redSignal('🔴', '#ffffff', '#000000'), true);
  assert.equal(helpers.redSignal('', '#d9363e', '#000000'), true);
  assert.equal(helpers.redSignal('', '#ffffff', '#286c4d'), false);
});

test('workspace scans risk only for customers that have quotation rows', () => {
  const source = fs.readFileSync(path.join(root, 'sales-room', 'wix', 'onboarding.web.js'), 'utf8');
  assert.match(source, /const riskCustomers = \(base\.customers \|\| \[\]\)\.filter/);
  assert.match(source, /quote\.quoted > 0 \|\| quote\.awaiting > 0/);
  assert.match(source, /loadQuoteRiskCounts\(riskCustomers\)/);
  assert.match(source, /setTimeout\(\(\) => resolve\(new Map\(\)\), 3500\)/);
});
