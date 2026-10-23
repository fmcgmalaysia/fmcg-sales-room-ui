const test = require('node:test'), assert = require('node:assert/strict');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { createMaintenanceMetadataInitializer } = require('../prototypes/stock-current-state/maintenance-metadata-initializer.cjs');
const copy = value => structuredClone(value);
function fixture(company = 'NCT', hasCompany = false) {
  const before = { _id: 'ROW', title: 'Original', quantity: 0, barcode: '0001', date: new Date('2026-10-20T00:00:00Z'),
    values: [0, null, ''], _createdDate: new Date('2026-10-19T00:00:00Z'), _updatedDate: new Date('2026-10-21T00:00:00Z'), ...(hasCompany ? { company } : {}) };
  let row = copy(before), drains = true, fault = null, writes = 0, admin = { isAdmin: true, memberId: 'ADMIN' };
  const control = { _id: hash(company, 'STOCK_CONTROL'), company, mode: 'MAINTENANCE', schemaVersion: 1, _version: 'C0', pending: null };
  const input = { checkpointId: hash('CAPTURE'), ordinal: 0 }, captured = { checkpointId: input.checkpointId, ordinal: 0,
    collection: company === 'NCT' ? 'NCTTasks' : 'NCTTasks1', row: copy(before) };
  const items = {
    query: () => { const q = { eq: () => q, limit: () => q, find: async () => ({ items: [copy(row)], totalCount: 1 }) }; return q; },
    patch: () => {
      const fields = {}; const p = { setField: (key, value) => { fields[key] = value; return p; }, run: async ({ condition }) => {
        writes++;
        if (fault === 'INTERVENING') { row.quantity = 99; row._updatedDate = new Date('2026-10-21T00:00:01Z'); }
        if (row.stockCommitVersion !== undefined || row._updatedDate.toISOString() !== condition._updatedDate.$eq.$date
          || condition.company.$eq && row.company !== condition.company.$eq || condition.company.$exists === false && row.company != null) throw Error('Conditional refusal');
        Object.assign(row, fields); row._updatedDate = new Date('2026-10-22T00:00:00Z');
        if (fault === 'LOST') throw Error('Unknown response');
        if (fault === 'CORRUPT') row.quantity = 42;
      } }; return p;
    }
  };
  const service = createMaintenanceMetadataInitializer({ company, items, authenticateAdmin: async () => admin, verifyLegacyDrain: async () => drains,
    readControl: async () => copy(control), readCapturedRow: async () => copy(captured) });
  return { ...service, input, before, captured, control, get row() { return row; }, get writes() { return writes; },
    setFault: value => { fault = value; }, setDrains: value => { drains = value; }, setAdmin: value => { admin = value; } };
}
for (const company of ['NCT', 'GHR']) for (const hasCompany of [false, true]) test(company + ' metadata-only initialization retains native types, zero and original fields; replay only inspects', async () => {
  const f = fixture(company, hasCompany); assert.equal((await f.step(f.input)).initialized, true);
  assert.equal(f.row.company, company); assert.ok(f.row.stockCommitVersion); assert.equal(f.writes, 1);
  for (const key of Object.keys(f.before).filter(key => key !== '_updatedDate')) assert.deepEqual(f.row[key], f.before[key]);
  assert.equal((await f.step(f.input)).alreadyConfirmed, true); assert.equal(f.writes, 1);
});
test('unknown write result stops; later explicit invocation confirms existing exact token without writing again', async () => {
  const f = fixture(); f.setFault('LOST'); await assert.rejects(f.step(f.input), /Unknown response/); assert.equal(f.writes, 1);
  assert.equal((await f.step(f.input)).alreadyConfirmed, true); assert.equal(f.writes, 1);
});
test('intervening edit refuses conditional initialization and preserves edit', async () => {
  const f = fixture(); f.setFault('INTERVENING'); await assert.rejects(f.step(f.input), /Conditional refusal/);
  assert.equal(f.row.quantity, 99); assert.equal(f.row.stockCommitVersion, undefined); assert.equal(f.writes, 1);
});
test('no drain, no admin, changed mode or browser authority fields cause zero writes', async () => {
  const f = fixture(); f.setDrains(false); await assert.rejects(f.step(f.input), /drain/);
  f.setDrains(true); f.setAdmin({ memberId: 'ADMIN', isAdmin: false }); await assert.rejects(f.step(f.input), /Administrator/);
  f.setAdmin({ memberId: 'ADMIN', isAdmin: true }); f.control.mode = 'ACTIVE'; await assert.rejects(f.step(f.input), /maintenance/);
  await assert.rejects(f.step({ ...f.input, row: f.before }), /ordinal/); assert.equal(f.writes, 0);
});
test('null version, wrong company, wrong collection, reserved lock or ISO string native timestamp cannot be initialized', async () => {
  const edits = [c => { c.row.stockCommitVersion = null; }, c => { c.row.company = 'GHR'; }, c => { c.collection = 'StaffMasterAccess'; },
    c => { c.collection = 'NCTActivity'; c.row._id = hash('NCT/PURCHASE', 'LOCK'); }, c => { c.row._updatedDate = c.row._updatedDate.toISOString(); }];
  for (const edit of edits) { const f = fixture(); edit(f.captured); await assert.rejects(f.step(f.input), /Exact unversioned/); assert.equal(f.writes, 0); }
});
test('unexpected business change on write is not acknowledged or repaired', async () => {
  const f = fixture(); f.setFault('CORRUPT'); await assert.rejects(f.step(f.input), /unconfirmed/); assert.equal(f.writes, 1);
  await assert.rejects(f.step(f.input), /changed/); assert.equal(f.writes, 1); assert.equal(f.row.quantity, 42);
});
