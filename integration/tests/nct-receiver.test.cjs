const { test } = require('node:test');
const assert = require('node:assert/strict');
const receiver = import('../backend/nctReceiver.js');
const key = 'TEST-ONLY-LOCAL-NOT-A-LIVE-CREDENTIAL';
async function fixture(secret = key) {
  const { createNctReceiver } = await receiver;
  let reads = 0, captures = 0, parsed = 0;
  const handle = createNctReceiver({
    store: { read: async () => { reads++; return null; }, insert: async row => row },
    getIntakeSecret: async () => secret,
    captureCosts: async () => { captures++; return {}; }
  });
  const request = authorization => ({ headers: { authorization }, body: { json: async () => { parsed++; return {}; } } });
  return { handle, request, counters: () => ({ reads, captures, parsed }) };
}
test('unauthorized calls cannot read orders, fetch costs or parse business payloads', async () => {
  const f = await fixture(); const result = await f.handle(f.request('Bearer wrong'));
  assert.equal(result.status, 401); assert.deepEqual(f.counters(), { reads: 0, captures: 0, parsed: 0 });
});
test('missing server credential disables endpoint rather than accepting an empty token', async () => {
  const f = await fixture(''); const result = await f.handle(f.request('Bearer '));
  assert.equal(result.status, 503); assert.equal(f.counters().parsed, 0);
});
test('header names are case insensitive but multiple Authorization keys are rejected', async () => {
  const f = await fixture(); const request = f.request('Bearer ' + key);
  request.headers.Authorization = 'Bearer ' + key;
  assert.equal((await f.handle(request)).status, 401);
  delete request.headers.authorization;
  assert.equal((await f.handle(request)).status, 503); // Auth passes, invalid order is not accepted.
  assert.equal(f.counters().parsed, 1);
});
test('malformed authenticated JSON gives an explicit failure with no database access', async () => {
  const f = await fixture(); const request = f.request('Bearer ' + key);
  request.body.json = async () => { throw new Error('Bad JSON'); };
  const result = await f.handle(request); assert.equal(result.status, 400);
  assert.equal(result.body.ok, false); assert.equal(f.counters().reads, 0);
});
