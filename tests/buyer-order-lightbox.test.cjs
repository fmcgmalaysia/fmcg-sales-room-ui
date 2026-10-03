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

test('native lightbox owns the optional Excel download button', () => {
  const lightboxCode = fs.readFileSync(path.join(root, 'buyer-room', 'wix', 'order-received-lightbox.js'), 'utf8');
  const pageCode = fs.readFileSync(path.join(root, 'buyer-room', 'wix', 'buyer-room-page.js'), 'utf8');
  assert.match(lightboxCode, /#comp-mupidwxx/);
  assert.doesNotMatch(lightboxCode, /#closeButton/);
  assert.match(lightboxCode, /lightbox\.close\(\{/);
  assert.match(lightboxCode, /action: 'download'/);
  assert.doesNotMatch(lightboxCode, /wixLocationFrontend/);
  assert.match(pageCode, /lightboxResult\?\.action === 'download'/);
  assert.match(pageCode, /wixLocationFrontend\.to\(requestedUrl\)/);
});

test('Review Order submits directly and has no embedded success modal', () => {
  const html = fs.readFileSync(path.join(root, 'buyer-room.html'), 'utf8');
  assert.match(html, /post\('BUYER_ROOM_SUBMIT_ORDER'/);
  assert.doesNotMatch(html, /id="successModalBg"/);
  assert.doesNotMatch(html, /BUYER_ROOM_NATIVE_ORDER_SUBMIT/);
});
