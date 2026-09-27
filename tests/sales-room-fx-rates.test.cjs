const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('FX settings are an independent Admin navigation tool with a centered modal', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const adminNav = html.slice(html.indexOf('<div class="admin-zone"'), html.indexOf('<div class="session">'));
  const staffPosition = adminNav.indexOf('Staff Management');
  const fxPosition = adminNav.indexOf('FX Rate Settings');
  assert.ok(staffPosition >= 0 && fxPosition > staffPosition);
  assert.match(html, /id="fxRateModal" class="fx-modal-mask" hidden/);
  assert.match(html, /\.fx-modal-mask\{position:fixed;inset:0;z-index:320;display:grid;place-items:center/);
  assert.match(html, /id="fxSyncBtn"/);
});

test('FX synchronization saves current rates and protects QD D4 with folder and D3 checks', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const backend = fs.readFileSync(path.join(root, 'sales-room', 'wix', 'onboarding.web.js'), 'utf8');
  const router = fs.readFileSync(path.join(root, 'sales-room', 'google-apps-script', 'WebAppRouter.gs'), 'utf8');
  assert.match(html, /SALES_ROOM_FX_RATES_SYNC/);
  assert.match(backend, /FX_RATE_COLLECTION = 'WixFxRates'/);
  assert.match(backend, /action: 'SYNC_FX_RATES'/);
  assert.match(router, /APPROVED_QD_FOLDER_ID = '1frEBQD7vwPW6X_dqQSoItbFQDUQs3THL'/);
  assert.match(router, /getRange\('D3'\)/);
  assert.match(router, /getRange\('D4'\)\.setValue\(rate\)\.setNumberFormat\('0\.00'\)/);
});
