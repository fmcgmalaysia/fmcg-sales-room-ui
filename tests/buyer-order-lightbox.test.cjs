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

test('Order Received popup exposes its signed Excel link on a stable button ID', () => {
  const lightboxCode = fs.readFileSync(path.join(root, 'buyer-room', 'wix', 'order-received-lightbox.js'), 'utf8');
  const pageCode = fs.readFileSync(path.join(root, 'buyer-room', 'wix', 'buyer-room-page.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'buyer-room.html'), 'utf8');
  assert.match(lightboxCode, /#downloadOrderExcelButton/);
  assert.doesNotMatch(lightboxCode, /#closeButton/);
  assert.match(lightboxCode, /Download Order Excel/);
  assert.match(lightboxCode, /downloadButton\.link = downloadUrl/);
  assert.match(lightboxCode, /downloadButton\.target = '_self'/);
  assert.match(lightboxCode, /downloadButton\.enable\(\)/);
  assert.doesNotMatch(lightboxCode, /wixLocationFrontend/);
  assert.doesNotMatch(pageCode, /wixLocationFrontend\.to\(downloadUrl\)/);
  assert.doesNotMatch(html, /startOrderExcelDownload/);
});

test('Review Order submits directly and has no embedded success modal', () => {
  const html = fs.readFileSync(path.join(root, 'buyer-room.html'), 'utf8');
  assert.match(html, /post\('BUYER_ROOM_SUBMIT_ORDER'/);
  assert.doesNotMatch(html, /id="successModalBg"/);
  assert.doesNotMatch(html, /BUYER_ROOM_NATIVE_ORDER_SUBMIT/);
});
