import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueRiskAlert } from '../backend/catalogueRiskAlert.js';

function fixture(actorType) {
  let now = 1000000, fail = false;
  const sent = [];
  let row = { version: 1, usage: { qa: now }, denials: { restricted: {
    status: 'PENDING', actorName: 'Test employee', companyName: 'Test company', actorType,
    deliveredUnique: 3, action: 'CATALOGUE_DETAIL'
  } } };
  const deliver = createCatalogueRiskAlert({
    now: () => now,
    store: {
      async read() { return structuredClone(row); },
      async replaceIfVersion(key, expected, next) {
        if (row.version !== expected) return false;
        row = { ...structuredClone(next), version: expected + 1 };
        return true;
      }
    },
    async send(message) { if (fail) throw Error('temporarily unavailable'); sent.push(message.notificationText); }
  });
  return { deliver: () => deliver('qa', 'restricted'), sent, failure: value => { fail = value; },
    advance: ms => { now += ms; }, event: () => row.denials.restricted };
}

test('two simultaneous deliveries produce one accepted company-labelled alert', async () => {
  const f = fixture('CUSTOMER_USER');
  await Promise.all([f.deliver(), f.deliver()]);
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0], /^Test company · Additional access limited · 3 distinct product details$/);
  assert.equal(await f.deliver(), 'ignored');
  assert.equal(f.event().attempts, 1);
});

test('known failed delivery is eligible after backoff and staff name is used', async () => {
  const f = fixture('STAFF');
  f.failure(true);
  assert.equal(await f.deliver(), 'RETRY');
  assert.equal(await f.deliver(), 'ignored');
  f.advance(60000);
  f.failure(false);
  assert.equal(await f.deliver(), 'ACCEPTED');
  assert.equal(f.event().attempts, 2);
  assert.match(f.sent[0], /^Test employee ·/);
});
