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
  assert.match(html, /\.workspace-table \.work-alert,\.workspace-table \.risk-alert/);
  assert.match(html, /month:'short',year:'numeric'/);
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

test('QD scan returns pending count separately from quote risk', () => {
  const source = fs.readFileSync(path.join(root, 'sales-room', 'google-apps-script', 'WixSelectionService.gs'), 'utf8');
  assert.match(source, /pendingQuoteCount/);
  assert.match(source, /=== 'PENDING'/);
  assert.match(source, /function WIX_publishCustomerQuotations/);
});

test('workspace scans risk only for customers that have quotation rows', () => {
  const source = fs.readFileSync(path.join(root, 'sales-room', 'wix', 'onboarding.web.js'), 'utf8');
  assert.match(source, /const riskCustomers = \(base\.customers \|\| \[\]\)\.filter/);
  assert.match(source, /quote\.quoted > 0 \|\| quote\.awaiting > 0/);
  assert.match(source, /loadQuoteRiskCounts\(riskCustomers\)/);
  assert.match(source, /setTimeout\(\(\) => resolve\(new Map\(\)\), 3500\)/);
  assert.match(source, /quoteWorkStatusAvailable/);
});

test('order and staff pages inherit the compact blue customer workspace style', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /Order and Staff pages follow the My Customers visual system/);
  assert.match(html, /#orders #newOrderArea\{padding:0\}/);
  assert.match(html, /\.staff-row\.selected\{background:#eaf3ff;box-shadow:inset 3px 0 #1769e0\}/);
  assert.match(html, /\.staff-tab\.active:after\{background:#1769e0\}/);
  assert.match(html, /function formatActivityTime[\s\S]*year:'numeric'/);
});

test('dashboard presents five premium metrics in the requested order', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dashboard = html.slice(html.indexOf('<section id="dashboard"'), html.indexOf('<section id="new"'));
  const headings = [
    'ACTIVE CUSTOMERS',
    'NEW ORDERS',
    'CUSTOMERS AWAITING QUOTES',
    'PENDING QUOTATION',
    'AT-RISK QUOTATIONS'
  ];
  const positions = headings.map((heading) => dashboard.indexOf(heading));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.equal((dashboard.match(/dashboard-metric-card/g) || []).length, 5);
  assert.match(dashboard, /id="atRiskQuotationCount"/);
  assert.match(html, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(html, /riskCount=customerRecords\.reduce\(\(sum,item\)=>sum\+\(Number\(item\.quoteRiskCount\)\|\|0\),0\)/);
});

test('workspace entry uses real QD warnings and a whole-QD publish action', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /customer\.pendingQuoteCount/);
  assert.match(html, /ACTION REQUIRED · 需要立即处理/);
  assert.match(html, /PUBLISH QUOTATIONS/);
  assert.match(html, /SALES_ROOM_PUBLISH_QUOTES/);
  assert.match(html, /YOUR LAST PUBLISH · 上次发布/);
  assert.match(html, /QD STATUS UNAVAILABLE · 暂时无法读取报价状态/);
});

test('quote publishing preserves unchanged dates and keeps one previous quote', () => {
  const http = fs.readFileSync(path.join(root, 'backend', 'http-functions.js'), 'utf8');
  assert.match(http, /currentFingerprint === incomingFingerprint/);
  assert.match(http, /changed: false,[\s\S]*?unchanged: true/);
  assert.match(http, /const previousQuote = hadLiveQuote/);
  assert.match(http, /expiredAt: now/);
  assert.match(http, /quoteEffectiveAt: now/);
});

test('Buyer Room shows only the last quoted time and withholds historical prices', () => {
  const html = fs.readFileSync(path.join(root, 'buyer-room.html'), 'utf8');
  const currentHeader = html.match(/id="currentPanel"[\s\S]*?id="myRows"/)[0];
  assert.doesNotMatch(currentHeader, /M³ \/ CTN/);
  assert.match(currentHeader, /Last Quoted<br>最后报价/);
  assert.doesNotMatch(currentHeader, /data-quote-detail|Quotation Details|Previous Quotation/);
  assert.doesNotMatch(html, /Current Quotation · 当前报价|Previous Quotation · 上次报价/);
  const pageHead = html.match(/<div class="page-head">[\s\S]*?<\/div>\s*<\/div>/)[0];
  const selectionGuide = html.match(/<div class="selection-guide">[\s\S]*?<\/a><\/div>/)[0];
  assert.doesNotMatch(pageHead, /Add More Items/);
  assert.match(selectionGuide, /Your quotation shortlist[\s\S]*Add More Items/);
  assert.match(html, /inline-stat awaiting[\s\S]*awaiting-icon[\s\S]*awaitingCount/);
  assert.match(html, /timeCell\(item\.addedTime,true\)/);
  assert.match(html, /date-part[\s\S]*clock-part/);
  const backend = fs.readFileSync(path.join(root, 'backend', 'catalogueAuth.web.js'), 'utf8');
  assert.match(backend, /delete safeData\.targetGp/);
  assert.match(backend, /delete safeData\.quoteActorEmail/);
  assert.match(backend, /delete safeData\.quoteRequestId/);
  assert.match(backend, /delete safeData\.previousQuote/);
});
