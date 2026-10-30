const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { plan } = require('../integration/apps-script/selection-product-reference-20261030/plan.cjs');
const source = plan().output['SelectionProductReference.gs'];
const CUSTOMER = 'CUS-261030-ABCDEF', ID = 'ml_12345678_abcdef12';
const image = 'https://static.wixstatic.com/media/sunquick-asset.jpg';
function fixture() {
  const headers = ['STATUS', 'PRINCIPLE', 'UNIT BARCODE', 'ITEM NAME', 'PACKING SIZE', 'EA', 'SORT NO.', 'WIX IMAGE URL', 'NET COST'];
  const state = { qdCustomer: CUSTOMER, status: 'READY', existingBarcode: '', existingId: '', reads: [],
    products: [['ACTIVE', 'BARKATH', '9551234567890', 'SUNQUICK FULL NAME', '700ML x 6', 6, 'FO-03404', image, 'PRIVATE COST']] };
  function sheet(name, rows) {
    return { getLastRow: () => rows.length + 2, getLastColumn: () => headers.length,
      getRange(row, col, count = 1, width = 1) {
        state.reads.push({ name, row, col, count, width });
        if (row > 1 && name !== 'QD') assert.ok(col + width - 1 < 9, 'No cost column may be read');
        const get = (r, c) => row === 1 ? headers[c - 1] : rows[r - 3]?.[c - 1] ?? '';
        return { getDisplayValues: () => Array.from({ length: count }, (_, i) => Array.from({ length: width }, (_, j) => String(get(row + i, col + j)))),
          getDisplayValue: () => String(get(row, col)), getValue: () => get(row, col) };
      } };
  }
  const qdSheet = { getLastRow: () => 7, getRange(row, col) { return { getDisplayValues: () => [[state.existingId]], getDisplayValue: () => state.existingBarcode }; } };
  const qd = { getSheetByName: () => qdSheet };
  const pointbase = { getSheetByName: name => sheet(name, name === 'FOOD' ? state.products : []) };
  const context = { SpreadsheetApp: { openById: id => id === 'pointbase' ? pointbase : qd },
    WIX_QD_FACTORY_CFG: { POINT_BASE_FILE_ID: 'pointbase' },
    WIX_SELECTION_CFG: { CUSTOMER_ID_METADATA: 'customer', BUILD_STATUS_METADATA: 'status', QD_SHEET: 'QD', QD_DATA_START_ROW: 7 },
    WIX_spreadsheetMetadataValue_: (_qd, key) => key === 'customer' ? state.qdCustomer : state.status,
    WIX_selectionHeaderMap_: () => ({ 'WIX MY LIST ID': 1, 'UNIT BARCODE': 2 }) };
  vm.createContext(context); vm.runInContext(source, context);
  const payload = { customerId: CUSTOMER, qdFileId: 'synthetic-qd-file-123456789', wixMyListId: ID,
    reference: { imageUrl: image, packingSize: '700ML x 6', eaPerCtn: 6, principle: 'BARKATH' } };
  return { state, payload, resolve: () => context.WIX_resolveSelectionProductReference(payload) };
}
test('Read-only source resolver survives changed name and SORT NO and reads no prices', () => {
  const f = fixture(); const result = f.resolve();
  assert.equal(result.unitBarcode, '9551234567890'); assert.equal(result.itemName, 'SUNQUICK FULL NAME');
  assert.equal(result.wixMyListId, ID); assert.equal(result.imageKey, 'sunquick-asset.jpg');
  assert.ok(f.state.reads.every(r => r.row === 1 || r.col !== 7));
  assert.doesNotMatch(source, /\.setValue|\.setValues|\.appendRow|\.deleteRow|\.insertRow/);
});
test('The existing image reference may be a Wix image URI', () => {
  const f = fixture(); f.payload.reference.imageUrl = 'wix:image://v1/sunquick-asset.jpg/name#originWidth=100';
  assert.equal(f.resolve().unitBarcode, '9551234567890');
});
for (const kind of ['barcode', 'duplicate', 'missing', 'packing', 'ea', 'principle', 'customer', 'status', 'existing-qd']) {
  test(`Source resolver does not guess identity: ${kind}`, () => {
    const f = fixture();
    if (kind === 'barcode') f.state.products[0][2] = '9556107308 / 6107208101';
    if (kind === 'duplicate') f.state.products.push([...f.state.products[0]]);
    if (kind === 'missing') f.state.products.length = 0;
    if (kind === 'packing') f.state.products[0][4] = '1L x 12';
    if (kind === 'ea') f.state.products[0][5] = 12;
    if (kind === 'principle') f.state.products[0][1] = 'OTHER';
    if (kind === 'customer') f.state.qdCustomer = 'CUS-261030-000000';
    if (kind === 'status') f.state.status = 'BUILDING';
    if (kind === 'existing-qd') { f.state.existingId = ID; f.state.existingBarcode = '1111111111111'; }
    assert.throws(() => f.resolve());
  });
}
test('Only three isolated patches change existing central code and preserve its deployed cost entry', () => {
  const p = plan(); assert.equal(p.patches.length, 3);
  assert.match(p.output['Code.gs'], /MASTER_CAPTURE_COST/); assert.match(p.output['Code.gs'], /RESOLVE_SELECTION_PRODUCT/);
  for (const patch of p.patches) assert.equal(p.baseline[patch.file].split(patch.old).length, 2);
  assert.match(p.output['RemoveSelection.gs'], /unitBarcode: p.unitBarcode, idempotent: false/);
});
