const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('workspace uses the compact customer, sku, user icon and risk layout', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const workspaceOverride = html.slice(html.indexOf('const originalWorkspaceCustomerTable'));
  assert.match(workspaceOverride, /Customer<span>客户<\/span>/);
  assert.doesNotMatch(workspaceOverride, /<th>COUNTRY<span>国家<\/span><\/th>/);
  assert.match(workspaceOverride, /\+esc\(selectionLimit\)\+' sku/);
  assert.match(workspaceOverride, /workspace-user-count/);
  assert.match(workspaceOverride, /Risk <span class="risk-warning" aria-label="Risk warning">⚠<\/span><span>报价风险<\/span>/);
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

test('quotation publishing scans the QD template with batch reads', () => {
  const source = fs.readFileSync(path.join(root, 'sales-room', 'google-apps-script', 'WixSelectionService.gs'), 'utf8');
  const publishSource = source.slice(
    source.indexOf('function WIX_publishCustomerQuotations'),
    source.indexOf('function WIX_hasRedQuoteSignal_')
  );
  assert.match(publishSource, /statusValues/);
  assert.match(publishSource, /confirmedRows/);
  assert.match(publishSource, /quotationRange\.getDisplayValues\(\)\[0\]/);
  assert.match(publishSource, /quotationRange\.getValues\(\)\[0\]/);
  assert.match(publishSource, /getProperty\('WIX_ONBOARDING_SHARED_SECRET'\)\s*\|\|\s*properties\.getProperty\('WIX_QUOTE_SYNC_TOKEN'\)/);
  assert.doesNotMatch(publishSource, /sheet\.getRange\(row,\s*headers\[[^\n]+\.get(?:Display)?Value\(\)/);
});

test('workspace scans risk only for customers that have quotation rows', () => {
  const source = fs.readFileSync(path.join(root, 'sales-room', 'wix', 'onboarding.web.js'), 'utf8');
  assert.match(source, /const riskCustomers = \(base\.customers \|\| \[\]\)\.filter/);
  assert.match(source, /quote\.quoted > 0 \|\| quote\.awaiting > 0/);
  assert.match(source, /loadQuoteRiskCounts\(riskCustomers\)/);
  assert.match(source, /setTimeout\(\(\) => resolve\(new Map\(\)\), 8000\)/);
  assert.match(source, /quoteWorkStatusAvailable/);
});

test('risk counts keep the last successful snapshot and avoid rapid table redraws', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /quoteWorkSnapshotKey='sales-room-quote-work-v1'/);
  assert.match(html, /function stabilizeQuoteWork\(customers\)/);
  assert.match(html, /quoteWorkStatusStale:true/);
  assert.match(html, /fingerprint===customerRenderFingerprint/);
  assert.match(html, /requestCustomerRefresh\(\).*60000/);
});

test('Sales Room logo matches the Buyer Room header width', () => {
  const sales = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const buyer = fs.readFileSync(path.join(root, 'buyer-room.html'), 'utf8');
  assert.match(sales, /\.brand-lockup\{width:220px;height:52px\}/);
  assert.match(sales, /\.brand-lockup img\{width:220px;max-width:100%\}/);
  assert.match(buyer, /style="display:block;width:220px;max-height:42px/);
});

test('Staff Management uses readable type and structured panel headings', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /#staff-management \.staff-table td\{height:53px[\s\S]*font-size:12px/);
  assert.match(html, /#staff-management \.staff-toolbar input,#staff-management \.staff-toolbar select\{height:40px[\s\S]*font-size:12px/);
  assert.match(html, /staff-panel-heading/);
  assert.match(html, /<b>Staff Directory<\/b><span class="cn">员工名单<\/span>/);
  assert.match(html, /<b>Staff Profile<\/b><span class="cn">员工资料<\/span>/);
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

test('workspace entry uses a compact vertical action launcher with readable Chinese guidance', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /PUBLISH QUOTATIONS/);
  assert.match(html, /SALES_ROOM_PUBLISH_QUOTES/);
  assert.match(html, /result\.ok!==false/);
  assert.doesNotMatch(html, /workspace-command-summary/);
  assert.match(html, /检查待确认及高风险报价/);
  assert.match(html, /发布已确认的 VIEW QUOTE 价格/);
  assert.match(html, /进入此客户的 Buyer Room/);
  assert.match(html, /协助客户浏览及选择商品/);
  assert.match(html, /\.workspace-command-actions\{display:grid;grid-template-columns:1fr;/);
  assert.match(html, /\.workspace-command-action small\{[^}]*font-size:12px/);
  assert.match(html, /id="drawerOpenBuyerRoom"/);
  assert.match(html, /buyerRoomAdminUrlV27\(customer\.customerId\)/);
  assert.match(html, /workspace-command-action buyer/);
  assert.match(html, /workspace-command-action catalogue/);
  assert.match(html, /\.workspace-command-action\.buyer\{background:#16885b\}/);
  assert.match(html, /\.workspace-command-action\.catalogue\{background:#e87324\}/);
  assert.match(html, /ACCESS ENABLED/);
  assert.doesNotMatch(html, /class="record-access-switch /);
  assert.doesNotMatch(html, /admin-buyer-link/);
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
  assert.match(currentHeader, /Last Quoted/);
  assert.doesNotMatch(currentHeader, /报价更新|最后报价/);
  assert.doesNotMatch(currentHeader, /data-quote-detail|Quotation Details|Previous Quotation/);
  assert.doesNotMatch(html, /Current Quotation · 当前报价|Previous Quotation · 上次报价/);
  assert.match(html, /id="browse"[^>]*Open Catalogue in a new tab[\s\S]*Add More Items/);
  assert.match(html, /inline-stat awaiting[\s\S]*awaiting-icon[\s\S]*hourglass-disc[\s\S]*hourglass-mark[\s\S]*awaitingCount/);
  assert.match(html, /\.inline-stat\.awaiting\{align-items:center\}/);
  assert.match(html, /\.awaiting-icon\{width:18px;height:18px/);
  assert.match(html, /compactTime\(item\.addedTime\)/);
  assert.match(html, /date-part[\s\S]*clock-part/);
  assert.match(html, /quote-updated\{color:#355f53;font-weight:400\}/);
  assert.match(html, /price-line\.ctn strong\{color:var\(--orange\)\}/);
  const orderSummary = html.match(/<div class="summary order-summary">[\s\S]*?<\/div><\/div>/)[0];
  const orderActions = html.match(/<div class="list-tabs-bar order-action-bar">[\s\S]*?<\/div><\/div>/)[0];
  assert.match(orderSummary, /Estimated Order Total[\s\S]*Send Order Request/);
  assert.doesNotMatch(orderActions, /View Excel|Google Sheets|Confirm Order/);
  const backend = fs.readFileSync(path.join(root, 'backend', 'catalogueAuth.web.js'), 'utf8');
  assert.match(backend, /delete safeData\.targetGp/);
  assert.match(backend, /delete safeData\.quoteActorEmail/);
  assert.match(backend, /delete safeData\.quoteRequestId/);
  assert.match(backend, /delete safeData\.previousQuote/);
});
