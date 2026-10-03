const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('successful order opens the native Wix Order Received lightbox', () => {
  const pageCode = fs.readFileSync(path.join(root, 'buyer-room', 'wix', 'buyer-room-page.js'), 'utf8');
  assert.match(pageCode, /openLightbox\('Order Received', \{ orderId: result\.orderId, downloadUrl, downloadError \}\)/);
  assert.doesNotMatch(pageCode, /BUYER_ROOM_NATIVE_ORDER_SUBMIT/);
  assert.doesNotMatch(pageCode, /BUYER_ROOM_PREPARE_ORDER_DOWNLOAD/);
});

test('Order Received popup hands its signed Excel to the embedded Buyer Room downloader', () => {
  const lightboxCode = fs.readFileSync(path.join(root, 'buyer-room', 'wix', 'order-received-lightbox.js'), 'utf8');
  const pageCode = fs.readFileSync(path.join(root, 'buyer-room', 'wix', 'buyer-room-page.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'buyer-room.html'), 'utf8');
  assert.match(lightboxCode, /#downloadOrderExcelButton/);
  assert.match(lightboxCode, /#closeButton/);
  assert.match(lightboxCode, /closeButton\.onClick\(\(\) => wixWindowFrontend\.lightbox\.close\(\)\)/);
  assert.match(lightboxCode, /Download Order Excel/);
  assert.match(lightboxCode, /downloadButton\.enable\(\)/);
  assert.doesNotMatch(lightboxCode, /wixLocationFrontend/);
  assert.match(lightboxCode, /downloadButton\.onClick/);
  assert.match(lightboxCode, /lightbox\.close\(\{ action: 'download', downloadUrl \}\)/);
  assert.match(pageCode, /lightboxResult\?\.action === 'download'/);
  assert.match(pageCode, /BUYER_ROOM_DOWNLOAD_ORDER_EXCEL/);
  assert.match(html, /async function downloadOrderExcel/);
  assert.match(html, /fetch\(String\(url\|\|''\)/);
  assert.match(html, /response\.blob\(\)/);
  assert.match(html, /URL\.createObjectURL\(blob\)/);
  assert.match(html, /anchor\.download=fileName/);
});

test('Review Order submits directly and has no embedded success modal', () => {
  const html = fs.readFileSync(path.join(root, 'buyer-room.html'), 'utf8');
  assert.match(html, /post\('BUYER_ROOM_SUBMIT_ORDER'/);
  assert.doesNotMatch(html, /id="successModalBg"/);
  assert.doesNotMatch(html, /BUYER_ROOM_NATIVE_ORDER_SUBMIT/);
});
