const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../buyer-room/catalogue/wix/catalogue-page-v3.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
const buyerSource = fs.readFileSync(path.join(__dirname, '../buyer-room/wix/buyer-room-page.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');

async function catalogue({ admin = false, authorized = true, customerId = 'CUS-qa', scopeCustomerId = 'CUS-qa', buyer = false, storageFails = false } = {}) {
  const stored = new Map(buyer ? [['catalogueAccess', 'granted']] : []), callbacks = [], routes = [];
  const storage = { getItem: key => stored.get(key), removeItem: key => stored.delete(key), setItem(key, value) { if (storageFails) throw Error('Storage unavailable'); stored.set(key, value); } };
  const $w = () => ({ postMessage() {} }); $w.onReady = callback => callbacks.push(callback);
  const context = vm.createContext({ $w, URL, console, authentication:{loggedIn:()=>authorized}, session: storage, local: storage, setInterval() {},
    wixWindowFrontend: { viewMode: 'Site', formFactor: 'Mobile', rendering: { env: 'browser' } },
    wixLocationFrontend: { url: 'https://fixture.test/catalogue', query: buyer ? {} : { assist: customerId }, to: route => routes.push(route) },
    getCurrentStaffContext: async () => ({ authorized: authorized && !buyer, staffId: 'staff-qa', canViewAllCustomers: admin }),
    getCatalogueSelectionState: async () => ({ ok: true, customerId: scopeCustomerId, activeSelectedProductIds: [] })
  });
  vm.runInContext(source, context); callbacks[0](); await new Promise(resolve => setImmediate(resolve));
  return { stored, storage, routes, run: code => vm.runInContext(code, context) };
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
