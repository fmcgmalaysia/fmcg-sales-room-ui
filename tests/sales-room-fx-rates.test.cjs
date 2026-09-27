const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('FX settings use one save-and-update action', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /Sales Room build: 2026-09-27-admin-fx-save-sync-v36/);
  assert.match(html, /SAVE &amp; UPDATE ALL QDs/);
  assert.match(html, /SALES_ROOM_FX_RATES_APPLY/);
  assert.doesNotMatch(html, /id="fxSyncBtn"/);
});

test('FX synchronization is isolated from login and scans only the approved QD folder', () => {
  const backend = fs.readFileSync(path.join(root, 'sales-room', 'wix', 'onboarding.web.js'), 'utf8');
  const fxBackend = fs.readFileSync(path.join(root, 'sales-room', 'wix', 'fxRates.web.js'), 'utf8');
  const router = fs.readFileSync(path.join(root, 'sales-room', 'google-apps-script', 'WebAppRouter.gs'), 'utf8');
  assert.doesNotMatch(backend, /FX_RATE_COLLECTION = 'WixFxRates'/);
  assert.doesNotMatch(backend, /syncSalesRoomFxRates/);
  assert.match(fxBackend, /export const saveAndSyncFxRates/);
  assert.match(fxBackend, /action: 'SYNC_FX_RATES'/);
  assert.match(router, /APPROVED_QD_FOLDER_ID = '1frEBQD7vwPW6X_dqQSoItbFQDUQs3THL'/);
  assert.match(router, /getFolderById\(APPROVED_QD_FOLDER_ID\)\.getFiles\(\)/);
  assert.match(router, /getRange\('D3'\)/);
  assert.match(router, /getRange\('D4'\)\.setValue\(rate\)\.setNumberFormat\('0\.00'\)/);
});
