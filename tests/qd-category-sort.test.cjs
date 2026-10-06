const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('native row sorting groups FOOD, NON FOOD, OTHERS independently of risk and keeps row identities', () => {
  const rows = [
    ['🔴', 'VIEW QUOTE', 'nf2', 0.01, 'NF-00002', 'id-nf2', 72],
    ['🟢', 'VIEW QUOTE', 'fo2', 0.20, 'FO-00002', 'id-fo2', 18],
    ['🔴', 'RFQ', 'other', 0.01, 'OT-00001', 'id-other', 40],
    ['🟢', 'VIEW QUOTE', 'fo1', 0.20, 'FO-00001', 'id-fo1', 12],
    ['🟢', 'VIEW QUOTE', 'nf1', 0.20, 'NF-00001', 'id-nf1', 36],
    ['🟢', 'RFQ', 'manual', 0.20, 'NOT IN CATALOGUE', 'id-manual', 24]
  ];
  const originalPairs = new Map(rows.map(r => [r[2], [r[5], r[6]]]));
  let helpers;
  const lock = { tryLock: () => true, releaseLock() {} };
  const sheet = {
    getLastColumn: () => 7,
    getMaxColumns: () => 10,
    getRange(start, column, count, width) {
      assert.equal(start, 7, 'formula row 6 must never be included');
      return {
        getValues: () => rows.map(r => [...r]),
        setValues(values) { helpers = values; return this; },
        sort(keys) {
          const combined = rows.map((row, index) => ({ row, key: helpers[index] }));
          combined.sort((a, b) => {
            for (const spec of keys) {
              const k = spec.column - 8;
              const av = a.key[k], bv = b.key[k];
              if (av !== bv) return av < bv ? -1 : 1;
            }
            return 0;
          });
          rows.splice(0, rows.length, ...combined.map(r => r.row));
        },
        clearContent() { return this; }, clearNote() { return this; }
      };
    }
  };
  const context = vm.createContext({ LockService: { getDocumentLock: () => lock }, SpreadsheetApp: { flush() {} }, console });
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../quotation-desk/QuotationDeskToolsV3.gs'), 'utf8'), context);
  context.getHeaderMap_ = () => ({});
  context.validateHeaders_ = () => {};
  context.getHeaderCol_ = (_, name) => ({ 'UNIT BARCODE': 3, 'SORT NO.': 5, 'COST HEALTH': 1, GP: 4, 'QUOTE STATUS': 2 })[name];
  context.hasHeader_ = () => true;
  context.findLastDataRow_ = () => 12;
  context.sortQuotationSheet_(sheet, true);
  assert.deepEqual(rows.map(r => r[2]), ['fo1', 'fo2', 'nf1', 'nf2', 'other', 'manual']);
  for (const row of rows) assert.deepEqual([row[5], row[6]], originalPairs.get(row[2]));
});
