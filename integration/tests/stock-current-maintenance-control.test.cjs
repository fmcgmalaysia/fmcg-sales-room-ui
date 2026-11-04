const test = require('node:test'), assert = require('node:assert/strict');
const { createMaintenanceControlInitializer } = require('../prototypes/stock-current-state/maintenance-control-initializer.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { copy } = require('../prototypes/stock-current-state/segmented-plan.cjs');
const input = { requestId: '77777777-1111-4111-8111-111111111111' };
function fixture(company = 'NCT', factory = createMaintenanceControlInitializer) {
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const rows = new Map(), reads = [], writes = [], controlId = hash(company, 'STOCK_CONTROL'), lockId = hash(company + '/PURCHASE', 'LOCK');
  let admin = { isAdmin: true, memberId: 'ADMIN' }, drain = true, privacy = true, schema = true, lose = false, onRead = null;
  const args = { company, store: {
    read: async (collection, id) => { assert.equal(collection, journal); reads.push(id); if (onRead) onRead(id); return copy(rows.get(id) || null); },
    insert: async (collection, row) => { assert.equal(collection, journal); if (rows.has(row._id)) throw Error('Occupied'); writes.push(copy(row)); rows.set(row._id, copy(row));
      if (lose) throw Error('Native insert reply unknown'); }
  }, authenticateAdmin: async () => copy(admin), verifyLegacyDrain: async () => drain,
  verifyPrivateRetention: async request => { assert.deepEqual(copy(request), { company, collection: journal }); return privacy; },
  verifyControlSchema: async request => { assert.deepEqual(copy(request), { company, collection: journal }); return schema; } };
  return { service: factory(args), args, rows, reads, writes, controlId, lockId,
    admin: value => { admin = value; }, drain: value => { drain = value; }, privacy: value => { privacy = value; }, schema: value => { schema = value; },
    lose: () => { lose = true; }, onRead: fn => { onRead = fn; } };
}
for (const company of ['NCT', 'GHR']) test(company + ' initializes exactly one original maintenance control and explicit replay only confirms it', async () => {
  const f = fixture(company);
  assert.equal((await f.service.inspect(input)).initialized, false); assert.equal(f.writes.length, 0);
  const saved = await f.service.initialize(input); assert.equal(saved.created, true); assert.equal(saved.activationReady, false);
  assert.equal(f.writes.length, 1); assert.deepEqual(f.writes[0], { _id: f.controlId, company, mode: 'MAINTENANCE', schemaVersion: 1,
    transferIndexVersion: 2, generation: 0, pending: null, _version: hash(company, 'MAINTENANCE_CONTROL_V1', input.requestId, 'ADMIN') });
  assert.equal((await f.service.initialize(input)).created, false); assert.equal((await f.service.inspect(input)).initialized, true);
  assert.equal(f.writes.length, 1); assert.equal(f.rows.has(f.lockId), false);
});
test('unknown Admin/drain/privacy/schema refuses before any item read or insert', async () => {
  for (const gate of ['admin', 'drain', 'privacy', 'schema']) {
    const f = fixture(); f[gate](gate === 'admin' ? { isAdmin: false, memberId: 'M' } : undefined);
    await assert.rejects(f.service.initialize(input)); await assert.rejects(f.service.inspect(input));
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  }
});
test('no browser mode, generation, row, Admin or proof input is accepted', async () => {
  for (const extra of [{ mode: 'ACTIVE' }, { generation: 1 }, { row: {} }, { isAdmin: true }, { drain: true }]) {
    const f = fixture(); await assert.rejects(f.service.initialize({ ...input, ...extra }), /Original maintenance/);
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  }
});
test('existing foreign request/owner/mode/generation or pending control is preserved, never transitioned', async () => {
  for (const mutate of [row => { row._version = 'FOREIGN'; }, row => { row.mode = 'LEGACY'; }, row => { row.mode = 'ACTIVE'; },
    row => { row.generation = 1; }, row => { row.pending = { key: 'K' }; }]) {
    const f = fixture(); await f.service.initialize(input); const row = f.rows.get(f.controlId); mutate(row); const before = copy(row);
    await assert.rejects(f.service.initialize(input), /Existing control differs/); assert.deepEqual(f.rows.get(f.controlId), before); assert.equal(f.writes.length, 1);
  }
  const f = fixture(); await f.service.initialize(input); f.admin({ isAdmin: true, memberId: 'OTHER' });
  await assert.rejects(f.service.initialize(input), /Existing control differs/); assert.equal(f.writes.length, 1);
});
test('business locks block creation but are not cleared or treated as drain evidence', async () => {
  const f = fixture(); const lock = { _id: f.lockId, owner: 'UNKNOWN', attempt: 'UNKNOWN' }; f.rows.set(f.lockId, lock);
  await assert.rejects(f.service.initialize(input), /business lock/); assert.equal(f.writes.length, 0); assert.deepEqual(f.rows.get(f.lockId), lock);
});
test('unknown insert reply is propagated once; later explicit same-request inspection confirms the retained record', async () => {
  const f = fixture(); f.lose(); await assert.rejects(f.service.initialize(input), /reply unknown/);
  assert.equal(f.writes.length, 1); assert.equal((await f.service.inspect(input)).initialized, true); assert.equal(f.writes.length, 1);
});
test('late drain/Admin/control changes prevent insertion and never overwrite the newer record', async () => {
  for (const fault of ['DRAIN', 'ADMIN', 'CONTROL']) {
    const f = fixture(); let count = 0;
    f.onRead(id => { if (id !== f.controlId || ++count !== 1) return;
      if (fault === 'DRAIN') f.drain(false);
      if (fault === 'ADMIN') f.admin({ isAdmin: true, memberId: 'OTHER' });
      if (fault === 'CONTROL') f.rows.set(id, { _id: id, company: 'NCT', mode: 'LEGACY', _version: 'CHANGED' });
    });
    await assert.rejects(f.service.initialize(input)); assert.equal(f.writes.length, 0);
  }
});
test('generated Wix runtime runs the same private initialization and original-owner inspection for both companies', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
  const source = fs.readFileSync(path.join(__dirname, '../prototypes/stock-current-state/stockCurrentCommands.js'), 'utf8');
  const api = vm.runInNewContext('(function(){' + source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '')
    + '\nreturn {createMaintenanceControlInitializer};})()', { createHash: crypto.createHash, randomBytes: crypto.randomBytes, StockRuntimeBuffer: Buffer });
  for (const company of ['NCT', 'GHR']) {
    const f = fixture(company, api.createMaintenanceControlInitializer);
    assert.equal((await f.service.initialize(input)).created, true); assert.equal(f.writes.length, 1);
    assert.equal((await f.service.inspect(input)).initialized, true);
    f.drain(false); await assert.rejects(f.service.initialize(input), /drain/); assert.equal(f.writes.length, 1);
  }
});
