const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHmac, timingSafeEqual } = require('node:crypto');

function workbookApi() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'buyerSelectionExcel.js'), 'utf8')
    .replace(/export function /g, 'function ');
  return new Function('TextEncoder', `${source}\nreturn { buildBuyerOrderExcel };`)(TextEncoder);
}

function tokenApi() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'buyerOrderExportToken.js'), 'utf8')
    .replace(/^import .*?;\s*/m, '')
    .replace(/export function /g, 'function ');
  return new Function('createHmac', 'timingSafeEqual', 'Buffer', `${source}\nreturn { createBuyerOrderExportToken, verifyBuyerOrderExportToken };`)(createHmac, timingSafeEqual, Buffer);
}

function zipFiles(bytes) {
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    if (view.getUint32(0, true) !== 0x04034b50) break;
    const size = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = Buffer.from(bytes.subarray(nameStart, nameStart + nameLength)).toString('utf8');
    files.set(name, Buffer.from(bytes.subarray(dataStart, dataStart + size)).toString('utf8'));
    offset = dataStart + size;
  }
  return files;
}

test('order export token binds the customer and immutable order', () => {
  const api = tokenApi();
  const issued = api.createBuyerOrderExportToken('CUST-1', 'ORD-100', 'secret', 900);
  assert.deepEqual(api.verifyBuyerOrderExportToken(issued.token, 'secret').customerId, 'CUST-1');
  assert.equal(api.verifyBuyerOrderExportToken(issued.token, 'secret').orderId, 'ORD-100');
  assert.throws(() => api.verifyBuyerOrderExportToken(issued.token, 'wrong-secret'), /INVALID_ORDER_EXPORT_TOKEN/);
});

test('order workbook contains required fields and live formulas', () => {
  const { buildBuyerOrderExcel } = workbookApi();
  const bytes = buildBuyerOrderExcel({
    buyerRoomUrl: 'https://example.com/buyer-room', orderId: 'ORD-100', companyName: 'Test Buyer',
    submittedAt: '01/10/2026 10:42 am', currency: 'USD',
    rows: [{ barcode: '09556570012598', itemName: '100 PLUS', packingSize: '325ML x 24', eaPerCtn: 24, unitPrice: 0.41, quantityCtn: 50, cbmPerCtn: 0.0059 }]
  });
  const files = zipFiles(bytes);
  const sheet = files.get('xl/worksheets/sheet1.xml');
  assert.ok(sheet);
  for (const heading of ['BARCODE', 'ITEM NAME', 'PACKING SIZE', 'EA / CTN', 'USD / PC', 'USD / CTN', 'ORDER QTY / CTN', 'LINE AMOUNT / USD', 'CBM / CTN', 'TOTAL CBM']) assert.match(sheet, new RegExp(heading.replace('/', '\\/')));
  assert.match(sheet, /D4\*E4/);
  assert.match(sheet, /G4\*F4/);
  assert.match(sheet, /G4\*I4/);
  assert.match(sheet, /SUM\(G4:G4\)/);
  assert.match(sheet, /SUM\(H4:H4\)/);
  assert.match(sheet, /SUM\(J4:J4\)/);
  assert.match(sheet, /t="inlineStr"><is><t>09556570012598<\/t>/);
});
