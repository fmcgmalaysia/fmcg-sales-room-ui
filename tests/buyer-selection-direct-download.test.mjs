import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBuyerSelectionExcel } from '../backend/buyerSelectionExcel.js';
import { createBuyerSelectionExportToken, verifyBuyerSelectionExportToken } from '../backend/buyerSelectionExportToken.js';

const workbook = buildBuyerSelectionExcel({
  buyerRoomUrl: 'https://www.fmcgmalaysia.com/buyer-room?ignore=1',
  currency: 'USD',
  rows: [
    { imageUrl: 'https://example.com/a.jpg', unitBarcode: '0123456789012', itemName: 'Quoted item', packingSize: '12 x 500ML', ea: 12, unitPrice: 1.25, cbmPerCtn: 0.0123 },
    { imageUrl: '', unitBarcode: '9988776655443', itemName: 'Awaiting quote', packingSize: '24 x 250G', ea: 24, unitPrice: null, cbmPerCtn: null }
  ]
});
const binaryText = Buffer.from(workbook).toString('utf8');
assert.equal(Buffer.from(workbook).subarray(0, 4).toString('hex'), '504b0304');
for (const expected of ['IMAGE URL', 'UNIT BARCODE', 'USD UNIT PRICE', 'EA × UNIT PRICE', '0123456789012', 'Quoted item']) {
  assert.ok(binaryText.includes(expected), `Workbook is missing ${expected}`);
}
assert.ok(binaryText.includes('IF(OR(E3=&quot;&quot;,F3=&quot;&quot;),&quot;&quot;,E3*F3)'));
assert.ok(binaryText.includes('IF(OR(E4=&quot;&quot;,F4=&quot;&quot;),&quot;&quot;,E4*F4)'));
assert.ok(binaryText.includes('fullCalcOnLoad="1"'));

const secret = 'test-only-secret';
const issued = createBuyerSelectionExportToken('CUS-TEST-001', secret, 120);
assert.equal(verifyBuyerSelectionExportToken(issued.token, secret).customerId, 'CUS-TEST-001');
assert.ok(issued.expiresAt - Date.now() > 3500 * 1000);
assert.throws(() => verifyBuyerSelectionExportToken(issued.token + 'x', secret));
const longLived = createBuyerSelectionExportToken('CUS-TEST-001', secret);
assert.ok(longLived.expiresAt - Date.now() > 3500 * 1000);

const pageCode = fs.readFileSync(new URL('../buyer-room/wix/buyer-room-page.js', import.meta.url), 'utf8');
const buyerRoomHtml = fs.readFileSync(new URL('../buyer-room.html', import.meta.url), 'utf8');
const webModule = fs.readFileSync(new URL('../backend/catalogueAuth.web.js', import.meta.url), 'utf8');
const selectionDownloadModule = fs.readFileSync(new URL('../backend/buyerSelectionDownload.js', import.meta.url), 'utf8');
const httpFunctions = fs.readFileSync(new URL('../backend/http-functions.js', import.meta.url), 'utf8');
assert.match(pageCode, /createBuyerSelectionDownload/);
assert.match(pageCode, /downloadButton\.hide\(\)/);
assert.match(pageCode, /_functions\/buyerSelectionExcel\?token=/);
assert.match(pageCode, /wixLocationFrontend\.to\(downloadUrl\)/);
assert.match(pageCode, /frame\.postMessage\(\{ type: 'BUYER_ROOM_EXPORT_RESULT', ok: true \}\)/);
assert.match(pageCode, /wixWindowFrontend\.openLightbox\('Order Received', \{ orderId: result\.orderId, downloadReady: Boolean\(downloadFile\), downloadError \}\)/);
assert.match(pageCode, /BUYER_ROOM_VIEW_CHANGED/);
assert.match(buyerRoomHtml, /BUYER_ROOM_VIEW_CHANGED/);
assert.doesNotMatch(pageCode, /uploadBuyerSelectionExcel|BUYER_ROOM_EXPORT_FILE/);
assert.match(pageCode, /20261004-selection-same-site-download-v98/);
assert.match(buyerRoomHtml, /2026-10-06-buyer-column-spacing-room5-v1/);
assert.match(webModule, /createBuyerSelectionExportToken/);
assert.match(webModule, /createBuyerSelectionExportToken\(buyer\.customerId, await getSecret\(QD_ROUTER_SECRET\), 3600\)/);
assert.match(buyerRoomHtml, /id="exportToggle"/);
assert.match(buyerRoomHtml, /post\('BUYER_ROOM_EXPORT'\)/);
assert.doesNotMatch(buyerRoomHtml, /document\.createElement\('iframe'\)/);
assert.match(httpFunctions, /content-disposition/);
assert.match(httpFunctions, /'content-length': String\(file\.bytes\.length\)/);
assert.match(httpFunctions, /'cross-origin-resource-policy': 'cross-origin'/);
assert.match(httpFunctions, /body: file\.bytes/);
console.log('buyer selection direct download tests passed');
