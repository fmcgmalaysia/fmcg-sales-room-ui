'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createFreshCohortBootstrap } = require('../prototypes/stock-current-state/fresh-cohort-bootstrap.cjs');
const { COLLECTIONS, COHORT } = require('../prototypes/stock-current-state/isolated-cohort.cjs');
function fixture(system = 'MASTER') {
  const db = new Map(), calls = [], metadata = new Map(); let approved = true, unknown = false;
  const controlFields = { cohort: 'TEXT', company: 'TEXT', mode: 'TEXT', schemaVersion: 'NUMBER', transferIndexVersion: 'NUMBER', generation: 'NUMBER', pending: 'OBJECT', stockCommitVersion: 'TEXT', bootstrapMemberId: 'TEXT', bootstrapRequestId: 'TEXT' };
  for (const target of Object.values(COLLECTIONS[system])) metadata.set(target, { _id: target, revision: '1',
    fields: Object.entries(controlFields).map(([key, type]) => ({ key, type })), permissions: { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' } });
  const items = { query: c => {
    calls.push(['query', c]); const query = { limit: () => query, find: async () => { const rows = [...db].filter(([key]) => key.startsWith(c + '/')).map(([, row]) => structuredClone(row)); return { items: rows.slice(0, 3), totalCount: rows.length }; } }; return query;
  }, insert: async (c, row) => { calls.push(['insert', c]); const key = c + '/' + row._id; if (db.has(key)) throw Error('Duplicate'); db.set(key, structuredClone(row)); if (unknown) throw Error('LOST_REPLY'); return structuredClone(row); } };
  const api = createFreshCohortBootstrap({ system, items, collections: { getDataCollection: async c => structuredClone(metadata.get(c)) }, authenticateAdmin: async () => ({ isAdmin: approved, memberId: 'ADMIN' }) });
  return { db, calls, metadata, api, deny: () => approved = false, lose: () => unknown = true };
}
const input = { company: 'NCT', requestId: '88888888-8888-4888-8888-000000000001' };
test('new empty authority initializes only a private MAINTENANCE control; original tables and drain API are never addressed', async () => {
  const f = fixture(); f.db.set('NCTTasks/OLD', { _id: 'OLD', garbage: true });
  const before = await f.api.inspect({}); assert.equal(before.emptyBusiness, true); assert.equal(before.rows.length, 12);
  assert.equal((await f.api.initialize(input)).mode, 'MAINTENANCE');
  assert.equal((await f.api.initialize(input)).created, false);
  assert.equal(f.calls.filter(row => row[0] === 'insert').length, 1);
  const ghr = await f.api.initialize({ ...input, company: 'GHR' }); assert.equal(ghr.activationAllowed, false);
  assert.equal([...f.db.values()].filter(row => row.cohort === COHORT).length, 2);
  assert.ok(f.calls.every(([, c]) => c.startsWith('R2')));
  assert.equal(f.db.get('NCTTasks/OLD').garbage, true);
});
test('any new business/foreign row, public permission, missing type, or non-admin refuses BEFORE initialization', async () => {
  for (const change of [f => f.db.set('R2NCTTasks/X', { _id: 'X' }),
    f => f.db.set('R2NCTActivity/X', { _id: 'X', mode: 'MAINTENANCE' }),
    f => f.metadata.get('R2NCTActivity').fields.find(row => row.key === 'cohort').type = 'NUMBER',
    f => f.metadata.get('R2PurchaseOrders').permissions.read = 'ANYONE', f => f.deny()]) {
    const f = fixture(); change(f); await assert.rejects(f.api.initialize(input)); assert.equal(f.calls.some(row => row[0] === 'insert'), false);
  }
});
test('lost insert reply is not retried or overwritten; inspect and exact original request can confirm the retained control', async () => {
  const f = fixture(); f.lose(); await assert.rejects(f.api.initialize(input), /LOST_REPLY/);
  assert.equal(f.calls.filter(row => row[0] === 'insert').length, 1);
  assert.equal((await f.api.inspect({})).rows.find(row => row.target === 'R2NCTActivity').control.bootstrapRequestId, input.requestId);
  await assert.rejects(f.api.initialize({ ...input, requestId: '88888888-8888-4888-8888-000000000002' }), /never replace/);
  assert.equal((await f.api.initialize(input)).created, false); assert.equal(f.calls.filter(row => row[0] === 'insert').length, 1);
});
test('Source audit is independent of old disposable data and cannot initialize MASTER controls or accept browser table/activation flags', async () => {
  const f = fixture('FMCGMALAYSIA'); f.db.set('WixBuyerOrders/OLD', { _id: 'OLD' });
  assert.equal((await f.api.inspect({})).rows.length, 3);
  await assert.rejects(f.api.initialize(input), /server-owned/);
  await assert.rejects(f.api.inspect({ activationAllowed: true }), /server-owned/);
  await assert.rejects(f.api.inspect({ collection: 'NCTActivity' }), /server-owned/);
  assert.equal(f.calls.some(row => row[0] === 'insert'), false);
});
