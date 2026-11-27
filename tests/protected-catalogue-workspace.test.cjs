const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const pageSource = readFileSync(resolve(__dirname, '../buyer-room/catalogue/wix/catalogue-access-20261123.page.js'), 'utf8').replace(/^import .*;\r?$/gm, '');

function fixture() {
  const messages = [], requests = [], details = [], handlers = {};
  const $w = key => ({ postMessage: m => messages.push(m), onMessage: cb => { handlers[key] = cb; } });
  $w.onReady = () => {};
  let now = 50000;
  const context = vm.createContext({ $w, URL, console, Date: { now: () => now },
    wixLocationFrontend: { url: 'https://qa.example/catalogue' },
    wixWindowFrontend: { formFactor: 'Mobile' }, connectAccountSession() {},
    buyerCompanyPath: () => '/buyer-room', readCatalogueSelectionCounts: async () => ({ total: 0, food: 0, nonFood: 0 }),
    listCataloguePage: (scope, filters) => new Promise(done => requests.push({ scope, filters, done })),
    readCatalogueProduct: (scope, id) => new Promise(done => details.push({ scope, id, done }))
  });
  vm.runInContext(pageSource, context);
  const run = code => vm.runInContext(code, context);
  run('setupCatalogueWorkspace(() => {})');
  return { messages, requests, details, run, advance: ms => { now += ms; }, send: data => handlers['#html5']({ data }) };
}
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

test('the authorized page read starts before the iframe and returns with its own first image', async () => {
  const f = fixture();
  f.run("setReader({ assistCustomerId: 'QA-A' })");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].filters.deferImages, true);
  const product = { id: 'test', image: 'https://catalogue.example/first' };
  f.requests[0].done({ items: [product], afterId: null, previousAfterId: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.messages.length, 0);
  await f.send({ type: 'catalogueWorkspaceReady', instanceId: 'qa', deferredThumbnails: true });
  const ready = f.messages.find(message => message.pageStatus === 'ready');
  assert.equal(ready.products[0].image, product.image);
  assert.equal(ready.selectionReady, false);
  assert.equal(f.requests.length, 1);
});

test('a recent category returns with the same image and cursor, then expires or clears on company switch', async () => {
  const f = fixture();
  await f.send({ type: 'catalogueWorkspaceReady', instanceId: 'qa', deferredThumbnails: true });
  f.run("setReader({ buyerCompanyId: 'QA-A' })");
  const finish = (index, id, afterId = null) => f.requests[index].done({
    items: [{ id, image: 'https://catalogue.example/' + id }], afterId, previousAfterId: null
  });
  finish(0, 'home');
  await new Promise(resolve => setImmediate(resolve));
  const drink = () => f.run("showView({ subIds: ['drinks'] })");
  const first = drink();
  finish(1, 'tea', 'next-tea');
  await first;
  const second = f.run("showView({ subIds: ['food'] })");
  finish(2, 'rice');
  await second;
  await drink();
  assert.equal(f.requests.length, 3);
  assert.equal(f.messages.findLast(message => message.products?.length).products[0].id, 'tea');
  assert.equal(f.run('catalogueNext'), 'next-tea');
  f.advance(20001);
  const expired = drink();
  finish(3, 'coffee');
  await expired;
  f.run("setReader(null); setReader({ buyerCompanyId: 'QA-B' })");
  assert.equal(f.requests.length, 5);
  assert.equal(f.requests[4].scope.buyerCompanyId, 'QA-B');
  assert.equal(f.messages.findLast(message => message.type === 'catalogueWorkspaceData').products.length, 0);
});
