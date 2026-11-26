const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('native download waits for a prepared link, survives concurrent loads, and follows the active view', async () => {
  const readVeloSource = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\r?\n/gm, '');
  const source = readVeloSource('buyer-room/wix/buyer-room-page.js');
  const accountSession = readVeloSource('integration/wix/wix-account-session.js').replace(/^export function /m, 'function ');
  let ready, message, click, resolveDownload, downloadCalls = 0, now = Date.now();
  const navigations = [], intervals = [];
  const button = { visible: true, enabled: true, hide() { this.visible = false; }, show() { this.visible = true; }, disable() { this.enabled = false; }, enable() { this.enabled = true; }, onClick(fn) { click = fn; } };
  const frame = { onMessage(fn) { message = fn; }, postMessage() {} };
  const $w = id => id === '#html1' ? frame : button;
  $w.onReady = fn => { ready = fn; };
  const location = { query: { assist: 'CUS-TEST' }, path: ['buyer-room'], baseUrl: 'https://example.test/site', to(url) { navigations.push(url); } };
  const wixWindow = { rendering: { env: 'browser' } };
  const context = {
    $w, console, URL, Date: { now: () => now }, encodeURIComponent, setInterval(fn) { intervals.push(fn); }, setTimeout() {},
    session: { setItem() {} },
    authentication: { loggedIn: () => false },
    wixLocation: location, wixLocationFrontend: location,
    wixWindow, wixWindowFrontend: wixWindow,
    wixRealtimeFrontend: { subscribe: () => Promise.resolve() },
    getBuyerWorkspace: async () => ({ ok: true, context: { customerId: 'CUS-TEST', status: 'ACTIVE' } }),
    createBuyerSelectionDownload: () => { downloadCalls++; return new Promise(resolve => { resolveDownload = resolve; }); }
  };
  vm.runInNewContext(accountSession + '\n' + source, context);
  await ready();
  assert.equal(button.visible, false);
  assert.equal(button.enabled, false);
  const repeatedLoad = message({ data: { type: 'BUYER_ROOM_READY' } });
  await repeatedLoad;
  assert.equal(downloadCalls, 1);
  resolveDownload({ ok: true, url: 'https://example.test/site/_functions/buyerSelectionExcel?token=signed%20token', expiresAt: Date.now() + 3600000 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.link, 'https://example.test/site/_functions/buyerSelectionExcel?token=signed%20token');
  assert.equal(button.target, '_self');
  assert.equal(button.visible, true);
  assert.equal(button.enabled, true);
  assert.equal(typeof click, 'function');
  click();
  assert.deepEqual(navigations, [], 'native link handles download without a second scripted navigation');
  await message({ data: { type: 'BUYER_ROOM_VIEW_CHANGED', view: 'order' } });
  assert.equal(button.visible, false);
  await message({ data: { type: 'BUYER_ROOM_REQUEST_DATA' } });
  assert.equal(button.visible, false);
  assert.equal(downloadCalls, 1);
  await message({ data: { type: 'BUYER_ROOM_VIEW_CHANGED', view: 'my' } });
  assert.equal(button.visible, true);
  now += 7200000;
  intervals.forEach(tick => tick());
  assert.equal(button.link, '', 'expired native link is removed before reuse');
  assert.equal(button.enabled, false);
  assert.equal(navigations.length, 0);
  assert.equal(downloadCalls, 2);
});
