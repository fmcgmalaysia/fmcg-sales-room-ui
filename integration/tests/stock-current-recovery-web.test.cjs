const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), { createHash } = require('node:crypto');
const { createRecoveryReadStore } = require('../prototypes/stock-current-state/recovery-read-store.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const db = new Map(), calls = [], request = { company: 'NCT', memberId: 'M', requestId: '11111111-1111-4111-8111-111111111111', input: { originalPrivateCustomerNote: 'NOT_FOR_REPORT' } };
  const key = hash('NCT/PURCHASE', request.requestId, request.memberId), digest = hash(request.input), controlId = hash('NCT', 'STOCK_CONTROL'), resultId = hash(key, 'RESULT');
  const put = (c, row) => db.set(c + ':' + row._id, copy(row));
  put('NCTActivity', { _id: controlId, company: 'NCT', generation: 0, pending: null, stockCommitVersion: 'C0' });
  const items = { query: c => {
    const filters = [], q = { eq: (k, v) => { filters.push([k, v]); return q; }, limit: n => { assert.equal(n, 2); return q; },
      find: async options => { assert.deepEqual(copy(options), { consistentRead: true }); calls.push([c, filters]);
        return { items: [...db.entries()].filter(([id, row]) => id.startsWith(c + ':') && filters.every(([k, v]) => row[k] === v)).map(([, row]) => copy(row)) }; } };
    return q;
  } };
  let admin = false;
  const text = fs.readFileSync(require.resolve('../prototypes/stock-current-state/stockRecoveryRead.web.js'), 'utf8');
  const api = vm.runInNewContext(text.replace(/^import .*;\r?\n/gm, '').replace('export const inspectStockSave', 'const inspectStockSave') + '\n({inspectStockSave})',
    { items, createHash, Buffer, Permissions: { Admin: 'ADMIN' }, webMethod: (permission, fn) => {
      assert.equal(permission, 'ADMIN'); return async input => { if (!admin) throw Error('Wix Admin required'); return fn(input); };
    } });
  return { db, calls, items, request, key, digest, controlId, resultId, put, api, admin: () => { admin = true; } };
}
test('query-only recovery store has no mutation capability and never scans arbitrary collections', async () => {
  const f = fixture(), store = createRecoveryReadStore({ items: f.items, company: 'NCT' });
  assert.deepEqual(Object.keys(store), ['read']);
  assert.equal((await store.read('NCTActivity', f.controlId))._version, 'C0');
  assert.equal(Object.hasOwn(await store.read('NCTActivity', f.controlId), 'stockCommitVersion'), false);
  for (const c of ['StaffMasterAccess', 'SharedSuppliers', 'NCTActivity1', 'NCTOrders1']) await assert.rejects(store.read(c, 'ID'), /scope/);
  assert.equal(f.calls.length, 2);
});
test('Admin boundary precedes reads; browser administrator flag never grants access', async () => {
  const f = fixture(); await assert.rejects(f.api.inspectStockSave({ ...f.request, administrator: true }), /Admin/);
  assert.equal(f.calls.length, 0); f.admin();
  const invalid = await f.api.inspectStockSave({ ...f.request, administrator: true }); assert.equal(invalid.ok, false); assert.equal(f.calls.length, 0);
  const result = await f.api.inspectStockSave(f.request); assert.equal(result.ok, true); assert.equal(result.report.status, 'NO_RECEIPT_NOT_CONFIRMED');
});
test('old lock is never released and report excludes original input/plan/customer payload', async () => {
  const f = fixture(); f.admin();
  f.put('NCTActivity', { _id: hash('NCT/PURCHASE', 'LOCK'), company: 'NCT', owner: f.key, attempt: 'OLD-EXECUTION', createdAt: '2000-01-01' });
  const before = JSON.stringify([...f.db]), result = await f.api.inspectStockSave(f.request);
  assert.equal(result.report.status, 'LOCK_PRESENT_STAY_BLOCKED'); assert.equal(JSON.stringify([...f.db]), before);
  assert.equal(JSON.stringify(result).includes('NOT_FOR_REPORT'), false);
  assert.equal(Object.hasOwn(result.report, 'input'), false); assert.equal(Object.hasOwn(result.report, 'plan'), false);
});
test('prepared current domain images are classified privately with no rewrite or retry', async () => {
  const f = fixture(); f.admin();
  const after = { _id: 'TASK', company: 'NCT', _version: hash(f.key, 'NCTTasks', 'TASK'), customerSecret: 'PRIVATE_PAYLOAD' };
  f.put('NCTActivity', { _id: f.key, company: 'NCT', digest: f.digest, baseGeneration: 0, plan: { writes: [{ collection: 'NCTTasks', before: null, after }] } });
  f.put('NCTActivity', { _id: f.controlId, company: 'NCT', generation: 0, stockCommitVersion: 'C1', pending: { key: f.key, digest: f.digest } });
  const before = JSON.stringify([...f.db]), result = await f.api.inspectStockSave(f.request);
  assert.equal(result.report.status, 'SAME_REQUEST_RESUME_PREPARED'); assert.equal(result.report.images[0].image, 'BEFORE');
  assert.equal(JSON.stringify(result).includes('PRIVATE_PAYLOAD'), false); assert.equal(JSON.stringify([...f.db]), before);
});
test('scope corruption and provider errors fail without exposing raw diagnostics', async () => {
  const f = fixture(); f.admin(); f.db.get('NCTActivity:' + f.controlId).company = 'GHR';
  const result = await f.api.inspectStockSave(f.request); assert.equal(result.ok, false); assert.equal(Object.hasOwn(result, 'report'), false);
  assert.equal(JSON.stringify(result).includes('GHR'), false);
  const g = fixture(); g.admin(); g.items.query = () => { throw Error('PRIVATE_PROVIDER_DIAGNOSTIC'); };
  const failure = await g.api.inspectStockSave(g.request); assert.equal(failure.ok, false); assert.equal(JSON.stringify(failure).includes('PRIVATE_PROVIDER'), false);
});
test('standalone recovery bundle contains exact current inspector and query-only store bodies', () => {
  const bundle = fs.readFileSync(require.resolve('../prototypes/stock-current-state/stockRecoveryRead.web.js'), 'utf8');
  for (const [file, imports] of [['recovery-inspector.cjs', ["const { hash } = require('./commit-proof.cjs');", "const { planCollections } = require('./domain-scope.cjs');"]],
    ['recovery-read-store.cjs', ["const { planCollections } = require('./domain-scope.cjs');"]]]) {
    let source = fs.readFileSync(require.resolve('../prototypes/stock-current-state/' + file), 'utf8').replace(/^'use strict';\r?\n/, '');
    for (const line of imports) source = source.replace(line, '');
    source = source.replace(/module\.exports = ([^;]+);/, 'return $1;').trim();
    assert.equal(bundle.replaceAll('\r\n', '\n').includes(source.replaceAll('\r\n', '\n')), true);
  }
});
