const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');

const source = import(pathToFileURL(join(__dirname, '../integration/wix/account-exit-signal.js')).href);

function fixture() {
  const entries = new Map();
  return {
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) { entries.set(key, value); }
  };
}

function clock() {
  let nextId = 0;
  const queue = new Map();
  return {
    schedule(fn) { const id = ++nextId; queue.set(id, fn); return id; },
    cancel(id) { queue.delete(id); },
    advance() { for (const fn of [...queue.values()]) fn(); },
    count() { return queue.size; }
  };
}

test('old tabs close once and a new login starts from the latest logout marker', async () => {
  const { recordAccountExit, observeAccountExit } = await source;
  const site = fixture();
  const otherSite = fixture();
  const ticker = clock();
  const calls = [];
  for (const name of ['Purchasing', 'Finance']) {
    observeAccountExit(site, () => true, () => calls.push(name), ticker.schedule, ticker.cancel);
  }
  observeAccountExit(otherSite, () => true, () => calls.push('Other site'), ticker.schedule, ticker.cancel);
  recordAccountExit(site, () => 100, () => 0.1);
  ticker.advance();
  ticker.advance();
  assert.deepEqual(calls, ['Purchasing', 'Finance']);
  observeAccountExit(site, () => true, () => calls.push('New sign-in'), ticker.schedule, ticker.cancel);
  ticker.advance();
  assert.deepEqual(calls, ['Purchasing', 'Finance']);
  recordAccountExit(site, () => 100, () => 0.2);
  ticker.advance();
  assert.deepEqual(calls, ['Purchasing', 'Finance', 'New sign-in']);
});

test('abandoned routes release the listener and storage failure never grants access', async () => {
  const { observeAccountExit } = await source;
  const ticker = clock();
  const storage = fixture();
  let active = true;
  let closed = 0;
  observeAccountExit(storage, () => active, () => closed++, ticker.schedule, ticker.cancel);
  active = false;
  ticker.advance();
  assert.equal(ticker.count(), 0);
  observeAccountExit({ getItem() { throw Error('storage unavailable'); } }, () => true,
    () => closed++, ticker.schedule, ticker.cancel);
  assert.equal(ticker.count(), 0);
  assert.equal(closed, 0);
});
