const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const pageSource = readFileSync(resolve(__dirname, '../buyer-room/catalogue/wix/catalogue-access-20261123.page.js'), 'utf8').replace(/^import .*;\r?$/gm, '');

function fixture() {
  const messages = [], requests = [], details = [], handlers = {}, ready = [], selections = [];
  const $w = key => ({ postMessage: m => messages.push(m), onMessage: cb => { handlers[key] = cb; } });
  $w.onReady = fn => ready.push(fn);
  const context = vm.createContext({ $w, URL, console,
    authentication: { loggedIn: () => true }, session: { setItem() {}, removeItem() {} },
    getCurrentStaffContext: async () => ({ authorized: true, staffId: 'QA-STAFF', staffName: 'QA Staff' }),
    getCatalogueSelectionState: id => new Promise(done => selections.push({ id, done })),
    wixLocationFrontend: { url: 'https://qa.example/catalogue' },
    wixWindowFrontend: { formFactor: 'Mobile' }, connectAccountSession() {},
    buyerCompanyPath: () => '/buyer-room', readCatalogueSelectionCounts: async () => ({ total: 0, food: 0, nonFood: 0 }),
    listCataloguePage: (scope, filters) => new Promise(done => requests.push({ scope, filters, done })),
    readCatalogueProduct: (scope, id) => new Promise(done => details.push({ scope, id, done }))
  });
  vm.runInContext(pageSource, context);
  const run = code => vm.runInContext(code, context);
  run('setupCatalogueWorkspace(() => {})');
  return { messages, requests, details, run, selections, startIdentity: ready[0], send: data => handlers['#html5']({ data }) };
}
test('staff-assist starts one protected first page early but withholds products until company selection is verified', async () => {
  for (const allowed of [true, false]) {
    const f = fixture();
    f.run("wixLocationFrontend.query = { assist: 'QA-A' }");
    await f.send({ type: 'catalogueWorkspaceReady', instanceId: 'qa' });
    f.startIdentity();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.selections[0].id, 'QA-A');
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].scope.assistCustomerId, 'QA-A');
    f.requests[0].done({ items: [{ id: 'protected' }], afterId: null, previousAfterId: null });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(!f.messages.some(m => m.products?.some(p => p.id === 'protected')));

    f.selections[0].done({ ok: true, customerId: allowed ? 'QA-A' : 'QA-B', companyName: 'QA Company' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.requests.length, 1);
    assert.equal(f.messages.some(m => m.products?.some(p => p.id === 'protected')), allowed);
    assert.equal(f.messages.findLast(m => m.type === 'catalogueWorkspaceData').pageStatus, allowed ? 'ready' : 'blocked');
  }
});
test('workspace waits for company, discards slower search and rejects stale detail after exit', async () => {
  const f = fixture();
  await f.send({ type: 'catalogueWorkspaceReady', instanceId: 'qa' });
  assert.equal(f.requests.length, 0);
  f.run("setReader({ buyerCompanyId: 'QA-A' })");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].filters.size, 25);
  const search = f.run("showView({ query: 'tea' })");
  f.requests[1].done({ items: [{ id: 'tea', name: 'Test tea' }], afterId: null, previousAfterId: null });
  await search;
  f.requests[0].done({ items: [{ id: 'old' }], afterId: 'old', previousAfterId: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!f.messages.some(m => m.products?.some(p => p.id === 'old')));
  const version = f.run('catalogueWorkspaceQueryVersion');
  await f.send({ type: 'catalogueDetailRequest', id: 'old', version });
  assert.equal(f.details.length, 0);
  const detail = f.send({ type: 'catalogueDetailRequest', id: 'tea', version });
  f.run('setReader(null)');
  f.details[0].done({ id: 'tea', countryOrigin: 'QA' });
  await detail;
  assert.ok(!f.messages.some(m => m.type === 'catalogueDetailResult'));
  assert.equal(f.messages.at(-1).pageStatus, 'blocked');
});
test('failed page retries the same bounded view, and idle renders never fetch more pages', async () => {
  const f = fixture();
  await f.send({ type: 'catalogueWorkspaceReady', instanceId: 'qa' });
  f.run("setReader({ buyerCompanyId: 'QA-B' })");
  f.requests[0].done({ items: [], afterId: 'qa-end', previousAfterId: null });
  await new Promise(resolve => setImmediate(resolve));
  const turning = f.send({ type: 'catalogueTurnPage', version: 1, direction: 'next' });
  assert.equal(f.requests[1].filters.afterId, 'qa-end');
  f.requests[1].done(Promise.reject(new Error('temporarily unavailable')));
  await turning;
  assert.equal(f.messages.at(-1).pageStatus, 'failed');
  const retry = f.send({ type: 'catalogueTurnPage', version: 2, direction: 'retry' });
  assert.equal(f.requests[2].filters.afterId, 'qa-end');
  f.requests[2].done({ items: [{ id: 'ok' }], previousAfterId: '', afterId: null });
  await retry;
  f.run('sendCatalogueWorkspaceData()');
  assert.equal(f.requests.length, 3);
});
