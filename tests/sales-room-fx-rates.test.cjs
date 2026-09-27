const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('recovery build hides the incomplete FX entry from Sales Room', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /Sales Room build: 2026-09-27-sales-room-recovery-v34/);
  assert.match(html, /#fxRateNav\{display:none!important\}/);
});

test('recovery removes FX services from the shared login backend while retaining the guarded QD script', () => {
  const backend = fs.readFileSync(path.join(root, 'sales-room', 'wix', 'onboarding.web.js'), 'utf8');
  const router = fs.readFileSync(path.join(root, 'sales-room', 'google-apps-script', 'WebAppRouter.gs'), 'utf8');
  assert.doesNotMatch(backend, /FX_RATE_COLLECTION = 'WixFxRates'/);
  assert.doesNotMatch(backend, /syncSalesRoomFxRates/);
  assert.match(router, /APPROVED_QD_FOLDER_ID = '1frEBQD7vwPW6X_dqQSoItbFQDUQs3THL'/);
  assert.match(router, /getRange\('D3'\)/);
  assert.match(router, /getRange\('D4'\)\.setValue\(rate\)\.setNumberFormat\('0\.00'\)/);
});
