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
        return { items: [...db.entries()].filter(([id, row]) => id.startsWith(c + ':') && filters.every(([k, v]) => row[k] === v)).map(([, row]) => structuredClone(row)) }; } };
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

test('read-only recovery uses the same explicit DateTime codec and rejects invalid native versions', async () => {
  for (const company of ['NCT', 'GHR']) {
    const f = fixture(), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
    const store = createRecoveryReadStore({ items: f.items, company, dateTimeFields: { [journal]: ['activityTime'] } });
    const iso = '2026-10-22T07:55:26.483Z', id = 'EVENT';
    f.db.set(journal + ':' + id, { _id: id, company, activityTime: new Date(iso), stockCommitVersion: 'V1',
      note: iso, details: { activityTime: iso }, _createdDate: new Date(iso) });
    const decoded = await store.read(journal, id);
    assert.equal(decoded.activityTime, iso); assert.equal(decoded.note, iso);
    assert.deepEqual(decoded.details, { activityTime: iso }); assert.equal(decoded._version, 'V1');
    assert.equal(Object.hasOwn(decoded, '_createdDate'), false);
    f.db.get(journal + ':' + id).activityTime = iso;
    await assert.rejects(store.read(journal, id), /DateTime read type mismatch/);
    f.db.get(journal + ':' + id).activityTime = new Date(iso);
    for (const invalid of ['', 0, {}, null]) {
      f.db.get(journal + ':' + id).stockCommitVersion = invalid;
      await assert.rejects(store.read(journal, id), /Invalid recovery storage version/);
    }
  }
});

test('Admin segmented inspection distinguishes a real native journal Date from an ISO text impostor', async () => {
  const f = fixture(); f.admin();
  const codec = require('../prototypes/stock-current-state/segmented-plan.cjs').createSegmentedPlanCodec({ company: 'NCT', domainWrites: true });
  const iso = '2026-10-22T07:55:26.483Z';
  const encoded = codec.encode({ ...f.request, key: f.key, digest: f.digest, baseGeneration: 0, attempt: 'A',
    plan: { writes: [{ collection: 'NCTActivity', before: null, after: { _id: 'EVENT', company: 'NCT', activityTime: iso } }] } });
  for (const row of [encoded.manifest, ...encoded.fragments]) f.put('NCTActivity', row);
  f.put('NCTActivity', { _id: f.controlId, company: 'NCT', generation: 0, stockCommitVersion: 'C1',
    pending: { key: f.key, digest: f.digest, planHash: encoded.manifest.planHash, phase: 'APPLY', cursor: 1, count: 1 } });
  const after = codec.decode({ manifest: encoded.manifest, fragments: encoded.fragments, key: f.key, digest: f.digest,
    memberId: f.request.memberId, requestId: f.request.requestId }).writes[0].after;
  f.db.set('NCTActivity:EVENT', { ...after, _version: undefined, stockCommitVersion: after._version, activityTime: new Date(iso) });
  delete f.db.get('NCTActivity:EVENT')._version;
  const report = await f.api.inspectStockSave(f.request);
  assert.equal(report.ok, true); assert.equal(report.report.images[0].image, 'AFTER');
  assert.equal(report.report.status, 'SAME_REQUEST_REVALIDATES_ON_RESUME');
  const before = JSON.stringify([...f.db]);
  f.db.get('NCTActivity:EVENT').activityTime = iso;
  const invalid = await f.api.inspectStockSave(f.request);
  assert.equal(invalid.ok, false); assert.equal(Object.hasOwn(invalid, 'report'), false);
  assert.equal(JSON.stringify(invalid).includes('DateTime'), false);
  // No SDK mutation method exists in this fixture; serialization alone must not
  // make the invalid native type appear as a verified AFTER image.
  assert.equal(JSON.stringify([...f.db]), before);
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

test('generated Admin endpoint decodes segmented plan without exposing images or granting recovery writes', async () => {
  const f = fixture(); f.admin();
  const codec = require('../prototypes/stock-current-state/segmented-plan.cjs').createSegmentedPlanCodec({ company: 'NCT', domainWrites: true });
  const encoded = codec.encode({ ...f.request, key: f.key, digest: f.digest, baseGeneration: 0, attempt: 'A',
    plan: { writes: [{ collection: 'NCTTasks', before: null, after: { _id: 'TASK', company: 'NCT', secret: 'DO_NOT_EXPOSE' } }] } });
  for (const row of [encoded.manifest, ...encoded.fragments]) f.put('NCTActivity', row);
  f.put('NCTActivity', { _id: f.controlId, company: 'NCT', generation: 0, stockCommitVersion: 'C1',
    pending: { key: f.key, digest: f.digest, planHash: encoded.manifest.planHash, phase: 'BEFORE', cursor: 0, count: 1 } });
  const before = JSON.stringify([...f.db]), result = await f.api.inspectStockSave({ ...f.request, pageSize: 1 });
  assert.equal(result.ok, true); assert.equal(result.report.status, 'SAME_REQUEST_REVALIDATES_ON_RESUME');
  assert.equal(result.report.recoveryPerformed, false); assert.equal(JSON.stringify(result).includes('DO_NOT_EXPOSE'), false);
  assert.equal(JSON.stringify([...f.db]), before);
});
test('scope corruption and provider errors fail without exposing raw diagnostics', async () => {
  const f = fixture(); f.admin(); f.db.get('NCTActivity:' + f.controlId).company = 'GHR';
  const result = await f.api.inspectStockSave(f.request); assert.equal(result.ok, false); assert.equal(Object.hasOwn(result, 'report'), false);
  assert.equal(JSON.stringify(result).includes('GHR'), false);
  const g = fixture(); g.admin(); g.items.query = () => { throw Error('PRIVATE_PROVIDER_DIAGNOSTIC'); };
  const failure = await g.api.inspectStockSave(g.request); assert.equal(failure.ok, false); assert.equal(JSON.stringify(failure).includes('PRIVATE_PROVIDER'), false);
});

test('actual Admin bundle distinguishes valid receipt, partial page and corrupt same-generation images without writes',async()=>{
  const f=fixture();f.admin();
  const codec=require('../prototypes/stock-current-state/segmented-plan.cjs').createSegmentedPlanCodec({company:'NCT',domainWrites:true});
  const encoded=codec.encode({...f.request,key:f.key,digest:f.digest,baseGeneration:0,attempt:'A',plan:{writes:['ONE','TWO'].map(id=>({
    collection:'NCTTasks',before:null,after:{_id:id,company:'NCT',secret:'PRIVATE_IMAGE'}}))}});
  for(const row of [encoded.manifest,...encoded.fragments])f.put('NCTActivity',row);
  const plan=codec.decode({manifest:encoded.manifest,fragments:encoded.fragments,key:f.key,digest:f.digest,memberId:f.request.memberId,requestId:f.request.requestId});
  for(const change of plan.writes)f.put(change.collection,change.after);
  f.put('NCTActivity',{_id:f.resultId,company:'NCT',stockOperationProtocol:2,digest:f.digest,baseGeneration:0,outcome:{ok:true,operationId:f.key,generation:1}});
  f.put('NCTActivity',{_id:f.controlId,company:'NCT',generation:1,stockCommitVersion:'C1',pending:null});
  const before=JSON.stringify([...f.db]);
  const page=await f.api.inspectStockSave({...f.request,pageSize:1});
  assert.equal(page.ok,true);assert.equal(page.report.status,'PAGED_RESULT_INSPECTION_ONLY');
  assert.equal(page.report.receiptVerified,true);assert.equal(page.report.currentImagesVerified,false);
  const complete=await f.api.inspectStockSave(f.request);assert.equal(complete.report.status,'CONFIRMED_RESULT');
  assert.equal(complete.report.currentImagesVerified,true);assert.equal(JSON.stringify([...f.db]),before);
  // Deliberate local corruption, not a native delete or an authorized repair.
  f.db.delete('NCTTasks:TWO');const corrupt=JSON.stringify([...f.db]);
  const report=await f.api.inspectStockSave(f.request);
  assert.equal(report.report.status,'REVIEW_RESULT_IMAGES');assert.equal(report.report.currentImagesVerified,false);
  assert.equal(report.report.recoveryPerformed,false);assert.equal(JSON.stringify([...f.db]),corrupt);
  assert.equal(JSON.stringify(report).includes('PRIVATE_IMAGE'),false);assert.equal(JSON.stringify(report).includes('NOT_FOR_REPORT'),false);
});
test('standalone recovery bundle contains exact current inspector and query-only store bodies', () => {
  const bundle = fs.readFileSync(require.resolve('../prototypes/stock-current-state/stockRecoveryRead.web.js'), 'utf8');
  for (const [file, imports] of [['recovery-inspector.cjs', ["const { hash } = require('./commit-proof.cjs');", "const { planCollections } = require('./domain-scope.cjs');", "const { inspectSegmentedStockRecovery } = require('./segmented-recovery-inspector.cjs');"]],
    ['segmented-plan.cjs', ["const { hash } = require('./commit-proof.cjs');", "const { planCollections } = require('./domain-scope.cjs');"]],
    ['purchase-delete-images.cjs', ["const {hash}=require('./commit-proof.cjs');", "const {copy,same}=require('./segmented-plan.cjs');"]],
    ['segmented-recovery-inspector.cjs', ["const { hash } = require('./commit-proof.cjs');", "const { createSegmentedPlanCodec, same } = require('./segmented-plan.cjs');", "const { classifyPurchaseDeletionImage } = require('./purchase-delete-images.cjs');"]],
    ['sdk-field-codec.cjs', []],
    ['recovery-read-store.cjs', ["const { planCollections } = require('./domain-scope.cjs');", "const { createSdkFieldCodec } = require('./sdk-field-codec.cjs');"]]]) {
    let source = fs.readFileSync(require.resolve('../prototypes/stock-current-state/' + file), 'utf8').replace(/^'use strict';\r?\n/, '');
    for (const line of imports) source = source.replace(line, '');
    source = source.replace(/module\.exports = ([^;]+);/, 'return $1;').trim();
    assert.equal(bundle.replaceAll('\r\n', '\n').includes(source.replaceAll('\r\n', '\n')), true);
  }
});
