const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../apps-script/MasterPointbaseCost.gs'), 'utf8');
const headers = ['STATUS', 'PRINCIPLE', 'BRAND NAME', 'COST VERIFIED ON', 'COST FRESHNESS',
  'UNIT BARCODE', 'ITEM NAME', 'PACKING SIZE', 'EA', 'COST /PC', 'COST /CTN',
  'DISC. 1', 'DISC. 2', 'DISC. 3', 'NET COST /CTN', 'NOTES', 'L (MM)', 'H (MM)',
  'W (MM)', 'CBM /CTN', 'NET WEIGHT', 'COUNTRY ORIGIN', 'SHELF LIFE',
  'CARTON BARCODE', 'INNER BOX BARCODE', 'SORT NO.', 'WIX IMAGE URL'];
const fixture = (barcode = '0012345678901') => ['ACTIVE', '', 'TEST BRAND', '', '', barcode,
  'PRODUCT', '100G x 16', 16, 10, 160, 0.02, 0.03, 5, 147.10, '', 0, 0, 0, 0.012345, '', '', '', '', '', '', ''];
function context(rows = {}, failSheet = '') {
  const reads = [];
  const sheet = name => ({
    getLastRow: () => (rows[name] || []).length + 2,
    getRange: (r, c, nr, nc) => {
      reads.push({ name, r, c, nr, nc });
      if (name === failSheet) throw new Error('Read timed out');
      const values = r === 1 ? [headers] : (rows[name] || []).slice(r - 3, r - 3 + nr);
      const sliced = values.map(row => row.slice(c - 1, c - 1 + nc));
      return { getValues: () => sliced, getDisplayValues: () => sliced.map(row => row.map(String)) };
    }
  });
  const ctx = vm.createContext({ SpreadsheetApp: { openById: id => {
    assert.equal(id, '12tyTIrmjF6JxMY-JW8K3JLuz5TcCkEjQUFXsauberLg');
    return { getSheetByName: sheet };
  } } });
  vm.runInContext(source, ctx);
  return { ctx, reads };
}
const capture = (rows, barcodes = ['0012345678901'], failSheet = '') => {
  const state = context(rows, failSheet);
  const result = JSON.parse(JSON.stringify(state.ctx.MPC_captureOrderCosts_(barcodes)));
  return { ...state, result };
};

test('MYR costs retain fraction discounts and cash Disc3; source net result is preserved', () => {
  const { result } = capture({ FOOD: [fixture()] });
  const cost = result['0012345678901'];
  assert.equal(cost.costStatus, 'CAPTURED');
  assert.equal(cost.costCurrency, 'MYR');
  assert.equal(cost.disc1, 0.02); assert.equal(cost.disc2, 0.03); assert.equal(cost.disc3, 5);
  assert.equal(cost.netCostCtn, 147.10); assert.equal(cost.cbmPerCtn, 0.0123);
  assert.equal(cost.unitBarcode, '0012345678901'); assert.equal(cost.eaPerCtn, 16);
});
test('reads complete rows only for submitted barcodes and captures duplicate requests once', () => {
  const other = fixture('9999999999999'); other[10] = 999;
  const { reads, result } = capture({ FOOD: [fixture(), other] }, ['0012345678901', '0012345678901']);
  assert.equal(Object.keys(result).length, 1);
  const completeRows = reads.filter(read => read.r >= 3 && read.nc === 27);
  assert.deepEqual(completeRows, [{ name: 'FOOD', r: 3, c: 1, nr: 1, nc: 27 }]);
});
test('not found stays unavailable, never zero', () => {
  const { result } = capture({}); const cost = result['0012345678901'];
  assert.deepEqual(cost.costIssues, ['BARCODE_NOT_FOUND']);
  assert.equal(cost.lpCtn, null); assert.equal(cost.disc3, null); assert.equal(cost.cbmPerCtn, null);
});
test('same barcode in two source tabs is rejected without choosing a supplier cost', () => {
  const { result, reads } = capture({ FOOD: [fixture()], NONFOOD: [fixture()] });
  assert.deepEqual(result['0012345678901'].costIssues, ['DUPLICATE_BARCODE']);
  assert.equal(reads.filter(read => read.r >= 3 && read.nc === 27).length, 0);
});
test('a failed source tab cannot be misreported as a successful unique match', () => {
  const { result } = capture({ FOOD: [fixture()] }, undefined, 'NONFOOD');
  assert.deepEqual(result['0012345678901'].costIssues, ['POINTBASE_READ_FAILED']);
});
test('discontinued row retains costs and product status but remains an exception', () => {
  const row = fixture(); row[0] = 'DISCONTINUED';
  const cost = capture({ FOOD: [row] }).result['0012345678901'];
  assert.equal(cost.lpCtn, 160); assert.equal(cost.productStatus, 'DISCONTINUED');
  assert.equal(cost.costStatus, 'ERROR'); assert.ok(cost.costIssues.includes('PRODUCT_DISCONTINUED'));
});
test('missing cost and invalid percentage do not become usable numeric prices', () => {
  const row = fixture(); row[10] = ''; row[11] = 2;
  const cost = capture({ FOOD: [row] }).result['0012345678901'];
  assert.equal(cost.lpCtn, null); assert.equal(cost.disc1, null); assert.equal(cost.costStatus, 'ERROR');
});
test('blank discounts differ from valid zero discounts', () => {
  const row = fixture(); row[11] = 0; row[12] = 0; row[13] = 0;
  assert.equal(capture({ FOOD: [row] }).result['0012345678901'].costStatus, 'CAPTURED');
  row[13] = '';
  assert.equal(capture({ FOOD: [row] }).result['0012345678901'].disc3, null);
});
test('invalid CBM and source formula errors remain visible exceptions', () => {
  const row = fixture(); row[19] = 0; row[14] = '#REF!';
  const cost = capture({ FOOD: [row] }).result['0012345678901'];
  assert.equal(cost.cbmPerCtn, null); assert.equal(cost.netCostCtn, null);
  assert.ok(cost.costIssues.includes('UNAVAILABLE_CBMPERCTN'));
});
test('numeric source barcode is rejected instead of losing leading-zero identity', () => {
  const row = fixture(); row[5] = 12345678901;
  const { ctx } = context(); const columns = ctx.MPC_columns_(headers);
  const result = ctx.MPC_snapshot_('12345678901', row, row.map(String), columns, {}, '2026-10-09T00:00:00Z');
  assert.equal(result.costIssues[0], 'BARCODE_NOT_STORED_AS_TEXT');
});
test('duplicate or missing cost headers fail closed; no index guessing', () => {
  const { ctx } = context();
  assert.throws(() => ctx.MPC_columns_(headers.concat('COST /CTN')), /duplicated/);
  assert.throws(() => ctx.MPC_columns_(headers.map(x => x === 'DISC. 3' ? '' : x)), /missing/);
});
test('raw percentage fractions and display percentage text have the same interpretation', () => {
  const row = fixture(); row[11] = '2%';
  assert.equal(capture({ FOOD: [row] }).result['0012345678901'].disc1, 0.02);
});
