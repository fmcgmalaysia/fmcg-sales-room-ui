const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../quotation-desk/QuotationDeskToolsV3.gs'), 'utf8');

function setup(sortError) {
  const events = [], alerts = [], requests = [];
  let rows = [
    { id: 'B', barcode: '222', pc: 2, ctn: 24, gp: 0.12 },
    { id: 'A', barcode: '111', pc: 1, ctn: 10, gp: 0.12 }
  ];
  const ui = { ButtonSet: { OK: 'OK' }, alert: (...args) => alerts.push(args) };
  const sheet = {};
  const lock = { tryLock: () => { events.push('publish-lock'); return true; }, releaseLock: () => events.push('release') };
  const context = vm.createContext({
    console,
    SpreadsheetApp: { getUi: () => ui, getActiveSheet: () => sheet, getActive: () => ({ getId: () => 'qd-test', getUrl: () => 'https://example.test/qd' }) },
    LockService: { getDocumentLock: () => lock },
    Utilities: { getUuid: () => 'test-request' },
    Session: { getActiveUser: () => ({ getEmail: () => 'staff@example.test' }) },
    ScriptApp: { getOAuthToken: () => 'test-token' },
    UrlFetchApp: { fetch: (_url, options) => {
      events.push('publish');
      const payload = JSON.parse(options.payload);
      requests.push(payload);
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, results: payload.quotations.map(q => ({ wixMyListId: q.wixMyListId, ok: true, changed: false })) }) };
    } }
  });
  vm.runInContext(source, context);
  Object.assign(context, {
    sortQuotationSheet_: (_sheet, wait) => {
      events.push(wait ? 'pre-sort' : 'post-sort');
      if (sortError && wait) throw new Error('Sorting failed');
      rows.sort((a, b) => a.id.localeCompare(b.id));
      return { sorted: true };
    },
    getHeaderMap_: () => { events.push('read-headers'); return {}; },
    validateHeaders_: () => {},
    getSyncConfig_: () => ({ url: 'https://example.test/sync', token: '' }),
    getMetadataValue_: () => 'customer-test',
    getHeaderCol_: () => 3,
    findLastDataRow_: () => 8,
    validateQuoteRow_: () => ({ ok: true }),
    markSyncFailures_: () => {},
    getCellByHeader_: (_sheet, _headers, row, header) => {
      const item = rows[row - 7];
      return { 'QUOTE STATUS': 'VIEW QUOTE', 'WIX MY LIST ID': item.id, 'UNIT BARCODE': item.barcode, 'QUOTE $/PC': item.pc, 'QUOTE $/CTN': item.ctn, 'TARGET GP': item.gp }[header];
    }
  });
  return { context, events, alerts, requests };
}

test('publishing reads row identities and prices after sorting, outside the sort lock', () => {
  const run = setup(false);
  run.context.syncQuotationToWix();
  assert.deepEqual(run.events, ['pre-sort', 'publish-lock', 'read-headers', 'publish', 'release', 'post-sort']);
  assert.deepEqual(run.requests[0].quotations.map(q => [q.wixMyListId, q.unitBarcode, q.quotePerPc, q.quotePerCtn]), [['A', '111', 1, 10], ['B', '222', 2, 24]]);
  assert.match(run.alerts[0][1], /Unchanged: 2/);
});

test('sorting failure blocks quotation transmission and shows the real error', () => {
  const run = setup(true);
  assert.throws(() => run.context.syncQuotationToWix(), /Sorting failed/);
  assert.deepEqual(run.events, ['pre-sort']);
  assert.equal(run.requests.length, 0);
  assert.deepEqual(run.alerts[0], ['SORT ERROR', 'Sorting failed', 'OK']);
});
