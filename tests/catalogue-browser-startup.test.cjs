const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../buyer-room/catalogue/wix/catalogue-page-v3.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');

function page(env, staffResult, selectionResult) {
  const callbacks = [], calls = [], messages = [], redirects = [];
  let releaseStaff;
  const staffWait = new Promise(resolve => { releaseStaff = resolve; });
  const storage = { getItem() { calls.push('storage'); return null; }, setItem() {}, removeItem() {} };
  const $w = () => ({ postMessage(message) { messages.push(message); } });
  $w.onReady = callback => callbacks.push(callback);
  const context = vm.createContext({
    $w, URL, console,
    wixWindowFrontend: { viewMode: 'Site', rendering: { env } },
    wixLocationFrontend: {
      query: { assist: 'CUS-FIXTURE' }, url: 'https://fixture.test/catalogue',
      to(route) { redirects.push(route); }
    },
    session: storage, local: storage,
    getCurrentStaffContext: async () => { calls.push('staff'); await staffWait; return staffResult; },
    getCatalogueSelectionState: async () => { calls.push('selection'); return selectionResult; }
  });
  vm.runInContext(source, context);
  return { callbacks, calls, messages, redirects, releaseStaff, context };
}

test('server rendering never waits for staff identity or starts interactive queries', async () => {
  const p = page('backend');
  await p.callbacks[0]();
  assert.deepEqual(p.calls, []);
  vm.runInContext("setupFluidCatalogueLayout = () => globalThis.layoutRuns = 1; setupNav = () => {throw Error('Server navigation setup')}; setupCatalogueWorkspace = () => {throw Error('Server catalogue query')};", p.context);
  p.callbacks[1]();
  assert.equal(p.context.layoutRuns, 1);
  assert.deepEqual(p.messages, []);
  assert.deepEqual(p.redirects, []);
});

test('browser still waits for authoritative staff identity before publishing customer context', async () => {
  const p = page('browser',
    { authorized: true, canViewAllCustomers: true, staffName: 'Fixture staff' },
    { ok: true, customerId: 'CUS-FIXTURE', companyName: 'Fixture Trading', activeSelectedProductIds: [] });
  const started = p.callbacks[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(p.calls.slice(-2), ['selection', 'staff']);
  assert.deepEqual(p.messages, []);
  p.releaseStaff();
  await started;
  assert.equal(p.messages.at(-1).sheetName, 'Fixture Trading');
  assert.equal(p.messages.at(-1).signedInName, 'Fixture staff');
  assert.equal(p.messages.at(-1).buyerRoomUrl, 'https://fixture.test/buyer-room?assist=CUS-FIXTURE');
});

test('browser still rejects a different customer response and denied staff', async () => {
  for (const authorized of [true, false]) {
    const p = page('browser', { authorized, canViewAllCustomers: true },
      { ok: true, customerId: 'CUS-OTHER', companyName: 'Other Trading' });
    const started = p.callbacks[0]();
    p.releaseStaff();
    await started;
    assert.equal(p.messages.length, 0);
    assert.deepEqual(p.redirects, [authorized ? '/blank-1' : '/']);
  }
});
