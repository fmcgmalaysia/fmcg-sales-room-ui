const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../buyer-room/catalogue/wix/catalogue-page-v3.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
const buyerSource = fs.readFileSync(path.join(__dirname, '../buyer-room/wix/buyer-room-page.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
const staffLoginSource = fs.readFileSync(path.join(__dirname, '../integration/wix/sales-room-login-page.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
const googleSource = fs.readFileSync(path.join(__dirname, '../backend/http-functions.js'), 'utf8')
  .replace(/^import .+;\r?$/gm, '').replace(/^export /gm, '');

async function catalogue({ admin = false, authorized = true, signedIn = authorized, customerId = 'CUS-qa', scopeCustomerId = 'CUS-qa', buyer = false, legacyAccess = buyer, storageFails = false, url, staffReason } = {}) {
  const stored = new Map(legacyAccess ? [['catalogueAccess', 'granted']] : []), callbacks = [], routes = [], reads = [];
  const storage = { getItem: key => stored.get(key), removeItem: key => stored.delete(key), setItem(key, value) { if (storageFails) throw Error('Storage unavailable'); stored.set(key, value); } };
  const $w = () => ({ postMessage() {} }); $w.onReady = callback => callbacks.push(callback);
  const context = vm.createContext({ $w, URL, console, authentication:{loggedIn:()=>signedIn}, session: storage, local: storage, setInterval() {},
    wixWindowFrontend: { viewMode: 'Site', formFactor: 'Mobile', rendering: { env: 'browser' } },
    wixLocationFrontend: { url: url || 'https://fixture.test/catalogue', query: buyer ? {} : { assist: customerId }, to: route => routes.push(route) },
    getCurrentStaffContext: async () => ({ authorized: authorized && !buyer, reason: staffReason, staffId: 'staff-qa', canViewAllCustomers: admin }),
    getCatalogueSelectionState: async scope => { reads.push(scope); return { ok: authorized, customerId: scopeCustomerId, activeSelectedProductIds: [] }; }
  });
  vm.runInContext(source, context); callbacks[0](); await new Promise(resolve => setImmediate(resolve));
  return { stored, storage, routes, reads, run: code => vm.runInContext(code, context) };
}
async function buyerEntry(fixture, result, query = {}, url = 'https://fixture.test/buyer-room') {
  const reads = [];
  const context = vm.createContext({ $w: { onReady() {} }, URL, session: fixture.storage,
    wixLocationFrontend: { query, url }, getCurrentBuyerContext: async id => { reads.push(id); return result; } });
  return { customerId: await vm.runInContext('' + buyerSource + '\nresolveEntryCustomerId()', context), reads };
}
const allowed = (type = 'STAFF', override = {}) => ({ ok: true, buyer: {
  customerId: 'CUS-qa', actorStaffId: 'staff-qa', actorType: type, status: 'ACTIVE', ...override
} });

for (const admin of [false, true]) test(`${admin ? 'Super Admin' : 'authorized staff'} Catalogue hands off the verified customer and staff once`, async () => {
  const fixture = await catalogue({ admin }); const before = Date.now(); fixture.run('openBuyerRoom()');
  assert.deepEqual(fixture.routes, ['/buyer-room?assist=CUS-qa']);
  const record = JSON.parse(fixture.stored.get('staffBuyerEntryV1'));
  assert.equal(record.staffId, 'staff-qa'); assert.equal(record.customerId, 'CUS-qa');
  assert.ok(record.expiresAt >= before + 29900 && record.expiresAt <= Date.now() + 30000);
  const recovered = await buyerEntry(fixture, allowed(admin ? 'ADMIN' : 'STAFF'));
  assert.equal(recovered.customerId, 'CUS-qa'); assert.deepEqual(recovered.reads, ['CUS-qa']);
  assert.equal((await buyerEntry(fixture, allowed())).customerId, '', 'completed Entry is consumed');
});

test('an explicit URL remains authoritative and performs no recovery lookup', async () => {
  const fixture = await catalogue(); fixture.run('openBuyerRoom()');
  assert.deepEqual(await buyerEntry(fixture, allowed(), {}, 'https://fixture.test/buyer-room?assist=CUS-explicit'), { customerId: 'CUS-explicit', reads: [] });
  assert.equal(fixture.stored.has('staffBuyerEntryV1'), false);
});

for (const [name, result] of [
  ['different staff', allowed('STAFF', { actorStaffId: 'other' })],
  ['different customer', allowed('STAFF', { customerId: 'CUS-other' })],
  ['customer login', allowed('CUSTOMER_USER')],
  ['suspended customer', allowed('STAFF', { status: 'SUSPENDED' })],
  ['revoked access', { ok: false }]
]) test(`short Entry cannot authorize ${name}`, async () => {
  const fixture = await catalogue(); fixture.run('openBuyerRoom()');
  assert.equal((await buyerEntry(fixture, result)).customerId, '');
});

test('expired Entry is discarded without an authorization read', async () => {
  const fixture = await catalogue(); fixture.run('openBuyerRoom()');
  const record = JSON.parse(fixture.stored.get('staffBuyerEntryV1')); record.expiresAt = Date.now() - 1;
  fixture.stored.set('staffBuyerEntryV1', JSON.stringify(record));
  assert.deepEqual(await buyerEntry(fixture, allowed()), { customerId: '', reads: [] });
});

test('unconfirmed and denied Catalogue identity never falls through into the ordinary buyer route', async () => {
  for (const options of [{ authorized: false }, { scopeCustomerId: 'CUS-other' }]) {
    const fixture = await catalogue(options); const routes = [...fixture.routes]; fixture.run('openBuyerRoom()');
    assert.deepEqual(fixture.routes, routes); assert.equal(fixture.stored.has('staffBuyerEntryV1'), false);
  }
});

test('ordinary buyer never creates staff Entry and preview still chooses a customer in Sales Room', async () => {
  const fixture = await catalogue({ buyer: true }); fixture.run('openBuyerRoom()');
  assert.deepEqual(fixture.routes, ['/buyer-room']); assert.equal(fixture.stored.has('staffBuyerEntryV1'), false);
  fixture.run("catalogueContextMessage={mode:'preview'}; selectionContext=null; openBuyerRoom()");
  assert.equal(fixture.routes.at(-1), '/sales-room');
});

test('storage refusal preserves the explicit scoped route', async () => {
  const fixture = await catalogue(); fixture.storage.setItem = () => { throw Error('Storage unavailable'); };
  fixture.run('openBuyerRoom()'); assert.deepEqual(fixture.routes, ['/buyer-room?assist=CUS-qa']);
});

test('expired staff with a stale buyer marker goes to staff sign-in with the original Catalogue customer', async () => {
  for (const options of [
    { signedIn: false, customerId: 'CUS-qa' },
    { signedIn: true, staffReason: 'NOT_LOGGED_IN', customerId: '', url: 'https://fixture.test/catalogue?assist=CUS-qa' }
  ]) {
    const fixture = await catalogue({ authorized: false, legacyAccess: true, ...options });
    assert.deepEqual(fixture.routes, ['/sales-room-login?next=%2Fcatalogue%3Fassist%3DCUS-qa']);
    assert.deepEqual(fixture.reads, ['CUS-qa']);
    assert.equal(fixture.run('selectionContext'), null);
  }
});

test('a signed-in account without staff rights cannot use a buyer marker to open an assisted Catalogue', async () => {
  const fixture = await catalogue({ authorized: false, signedIn: true, legacyAccess: true });
  assert.deepEqual(fixture.routes, []);
  assert.deepEqual(fixture.reads, ['CUS-qa']);
  assert.equal(fixture.run('catalogueAccessIssue'), true);
  assert.equal(fixture.run('selectionContext'), null);
});

test('authorized staff can read the Catalogue customer from the URL even when mobile query or storage is unavailable', async () => {
  const fixture = await catalogue({ customerId: '', url: 'https://fixture.test/catalogue?assist=CUS-qa', storageFails: true });
  assert.deepEqual(fixture.routes, []);
  assert.deepEqual(fixture.reads, ['CUS-qa']);
  assert.equal(fixture.run('selectionContext?.assistCustomerId'), 'CUS-qa');
});

test('a signed-out Buyer Room retains a valid recent staff handoff for sign-in without reading customer data', async () => {
  for (const signedIn of [false, true]) {
    const fixture = await catalogue();
    fixture.run('openBuyerRoom()');
    const routes = [];
    let onReady;
    const $w = () => assert.fail('An expired staff handoff must redirect before customer data loads');
    $w.onReady = handler => { onReady = handler; };
    vm.runInNewContext(buyerSource, {
      $w, URL, session: fixture.storage,
      wixWindowFrontend: { rendering: { env: 'browser' } },
      wixLocationFrontend: { url: 'https://fixture.test/buyer-room', to: route => routes.push(route) },
      authentication: { loggedIn: () => signedIn },
      getCurrentBuyerContext: async () => {
        if (signedIn) return { ok: false, reason: 'Sign in is required.' };
        throw new Error('Member session expired');
      }
    });
    await onReady();
    assert.deepEqual(routes, ['/sales-room-login?next=%2Fbuyer-room%3Fassist%3DCUS-qa']);
    assert.equal(fixture.stored.has('staffBuyerEntryV1'), false);
  }
});

test('the existing Google staff flow resumes the requested customer only after verifying staff permission', async () => {
  const source = await catalogue({ authorized: false, legacyAccess: true });
  const next = new URL(source.routes[0], 'https://www.fmcgmalaysia.com').searchParams.get('next');
  for (const target of [next, '/buyer-room?assist=CUS-qa']) {
    for (const staffAllowed of [true, false]) {
      const slots = new Map();
      const session = { getItem: key => slots.get(key), setItem: (key, value) => slots.set(key, value), removeItem: key => slots.delete(key) };
      const routes = [];
      let ready, signIn, tokenApplied = false;
      const $w = id => ({ style: {}, disable() {}, enable() {}, onClick(callback) { if (id === '#button1') signIn = callback; } });
      $w.onReady = callback => { ready = callback; };
      const fixture = {
        $w, URL, crypto: require('node:crypto').webcrypto, session,
        wixLocationFrontend: { query: { next: target }, to: route => routes.push(route) },
        currentMember: { getMember: async () => null },
        authentication: { loggedIn: () => false, applySessionToken: async () => { tokenApplied = true; } },
        getCurrentStaffContext: async () => {
          assert.equal(tokenApplied, true);
          return { authorized: staffAllowed };
        }
      };
      vm.runInNewContext(staffLoginSource, { ...fixture });
      await ready();
      await signIn();
      const googleStart = new URL(routes.pop());
      assert.equal(googleStart.pathname, '/_functions/googleStaffAuthStart');
      const oauth = vm.runInNewContext(googleSource + '\nget_googleStaffAuth', {
        URLSearchParams,
        response: result => result,
        getSecret: async () => 'fixture-value',
        fetch: async url => ({ ok: true, json: async () => url.includes('/userinfo')
          ? { email: 'test-staff@example.invalid', email_verified: true }
          : { access_token: 'fixture-token' } }),
        authentication: { generateSessionToken: async () => 'synthetic-wix-session' },
        getMasterStaffScope: async (email, fresh) => {
          assert.equal(email, 'test-staff@example.invalid');
          assert.equal(fresh, true);
          return { customerScope: {} };
        }
      });
      const googleReply = await oauth({ query: { state: googleStart.searchParams.get('state'), code: 'fixture-code' } });
      const callback = new URL(googleReply.headers.Location);
      assert.equal(callback.pathname, '/sales-room-login');
      assert.equal(callback.searchParams.get('oauth'), 'success');
      fixture.wixLocationFrontend.query = Object.fromEntries(callback.searchParams);
      vm.runInNewContext(staffLoginSource, { ...fixture });
      await ready();
      assert.deepEqual(routes, staffAllowed ? [target] : []);
    }
  }
});

test('an explicit Buyer Room link resumes staff sign-in on expiry but denies a revoked staff member in place', async () => {
  for (const [message, shouldRedirect] of [['Sign in is required.', true], ['Customer access revoked', false]]) {
    const routes = [], posts = [], calls = [];
    let ready;
    const $w = id => id === '#html1' ? { onMessage() {}, postMessage: data => posts.push(data) }
      : { disable() {}, hide() {}, onClick() {} };
    $w.onReady = callback => { ready = callback; };
    vm.runInNewContext(buyerSource, {
      $w, URL, console: { error() {} }, setInterval() {}, session: { getItem() {} },
      wixWindowFrontend: { rendering: { env: 'browser' } },
      wixLocationFrontend: { query: { assist: 'CUS-qa' }, to: route => routes.push(route) },
      authentication: { loggedIn: () => true },
      wixRealtimeFrontend: { subscribe: async () => {} },
      getBuyerWorkspace: async id => { calls.push(id); throw new Error(message); }
    });
    await ready();
    assert.deepEqual(calls, ['CUS-qa']);
    assert.deepEqual(routes, shouldRedirect ? ['/sales-room-login?next=%2Fbuyer-room%3Fassist%3DCUS-qa'] : []);
    assert.ok(posts.every(data => data.type !== 'BUYER_ROOM_DATA'));
    if (!shouldRedirect) assert.match(posts[0].message, /could not authorize/i);
  }
});
