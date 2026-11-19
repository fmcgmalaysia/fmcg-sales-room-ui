// OFFLINE DIAGNOSTIC ONLY. Unmodified production journal/readers with an in-memory store.
// No experimental current records, added rootIds, pending metadata, network or Wix writes.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { setup, request } = require('./read-growth-contract.cjs');
const load = require('../../tests/load-master-module.cjs');
const { operationId } = load('purchaseOperationJournal.js');
const { confirmedPurchaseState, readPurchasePlan, readPurchaseShares } = load('purchasePlan.js');
const { createPurchaseSourceOperations, purchaseSourcesVersion } = load('purchaseSources.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { projectWarehouseOrders, createWarehouseOperations } = load('warehouseReceiving.js');
const { projectWarehouseCustomerReadiness } = load('warehouseCustomerReadiness.js');
const { projectPreparation } = load('warehousePreparation.js');
const { warehouseCbm } = load('warehouseCbm.js');
const plain = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const rows = (f, collection) => [...f.rows].filter(([key]) => key.startsWith(collection + '/')).map(([, row]) => plain(row));
const view = (f, activity = rows(f, 'NCTActivity')) => confirmedPurchaseState({ company: 'NCT', tasks: rows(f, 'NCTTasks'), activity });
const locks = f => rows(f, 'NCTActivity').filter(row => row._id === operationId('NCT/PURCHASE', 'LOCK') || row._id === operationId('NCT', f.id, 'COST_LOCK') || row._id === operationId('NCT', f.second, 'COST_LOCK'));
async function seed() { const f = setup(); await f.operate(request(f, 1)); return f; }
function failAfter(f, method, predicate) {
  const original = f.store[method]; let armed = true;
  f.store[method] = async (...args) => {
    const result = await original(...args);
    if (armed && predicate(...args)) { armed = false; throw Error('OFFLINE_RESPONSE_LOST'); }
    return result;
  };
}
function failBefore(f, action) {
  const original = f.store.insert; let armed = true;
  f.store.insert = async (collection, row) => {
    if (armed && row.action === action) { armed = false; throw Error('OFFLINE_BEFORE_INSERT'); }
    return original(collection, row);
  };
}
function decode(input) {
  return input.map(row => ({ _id: row.ID, title: row['Activity ID'], action: row.Action,
    description: row['Order ID'], image: row['Source Line ID'], imageAltText: row['Task ID'],
    result: row.Result, details: row.Details ? JSON.parse(row.Details) : null }));
}
async function run(snapshotPath) {
  const output = { date: '2026-11-04', baseline: '3ea8672', productionChanges: 0, productionWrites: 0, checks: [], observations: {}, limits: [
    'Existing private export is from Nov 3; not a fresh live export.',
    'Handled failures are simulated around the original store. No real Wix crash/concurrency/latency proof.',
    'This is procurement evidence scope, not a replacement for the full workspace, stock or finance reader.',
    'No lock, PREPARED, RESULT or historical business fact is deleted or migrated.',
    'No new indexes, nested-field query acceptance, root associations or current-state records are deployed.'
  ] };
  const check = async (name, fn) => { const evidence = await fn(); output.checks.push({ name, evidence }); };
  const raw = fs.readFileSync(snapshotPath), activity = decode(JSON.parse(raw));
  const prepared = activity.filter(row => row.action === 'PURCHASE_OPERATION_PREPARED');
  const types = {};
  for (const row of prepared) {
    const plan = row.details.plan;
    const kind = plan.operation || (plan.task ? 'ADD_SOURCE_SHAPE' : 'OTHER:' + Object.keys(plan).sort().join(','));
    types[kind] = (types[kind] || 0) + 1;
  }
  output.snapshot = { sha256: hash(raw), rows: activity.length, prepared: prepared.length, types };
  await check('Existing shared scope cannot select a customer task', () => {
    assert.equal(prepared.length, 99);
    assert.equal(prepared.filter(row => row.imageAltText).length, 0);
    assert.deepEqual([...new Set(prepared.map(row => row.description))], ['NCT/PURCHASE']);
    const plans = prepared.filter(row => row.details.plan.operation === 'PLAN');
    const po = prepared.filter(row => row.details.plan.operation === 'PO');
    const merged = po.filter(row => row.details.plan.updates.length > 1);
    assert.equal(plans.length, 18); assert.equal(po.length, 8); assert.ok(merged.length);
    return { sharedScopePrepared: prepared.length, topLevelTaskPopulated: 0, planPrepared: plans.length,
      poPrepared: po.length, mergedPOPrepared: merged.length, maxMergedTasks: Math.max(...po.map(row => row.details.plan.updates.length)),
      otherPrepared: prepared.length - plans.length - po.length };
  });
  await check('RESULT presence is not a deletion or recovery-discovery query', () => {
    const byId = new Map(activity.map(row => [row._id, row]));
    const complete = prepared.filter(row => byId.get(operationId(row.title, 'RESULT'))?.action === 'PURCHASE_OPERATION_RESULT');
    assert.equal(complete.length, prepared.length);
    return { exactResultMatches: complete.length, unknownRequestDiscoveryStillRequired: true,
      note: 'Known request RESULT can be read by ID; unknown interrupted requests cannot be found from that ID without discovering their PREPARED first.' };
  });
  await check('Handled PLAN failure leaves no lock while original evidence restores old price', async () => {
    const f = await seed(), next = request(f, 2, 32);
    failAfter(f, 'update', c => c === 'NCTTasks');
    await assert.rejects(f.operate(next), /OFFLINE_RESPONSE_LOST/);
    const full = view(f);
    assert.equal(locks(f).length, 0); assert.equal(f.task().lpCtn, 32);
    assert.equal(full.pending.length, 1); assert.equal(full.tasks.find(row => row._id === f.id).lpCtn, 16);
    const unsafe = view(f, rows(f, 'NCTActivity').filter(row => row.action !== 'PURCHASE_OPERATION_PREPARED'));
    assert.equal(unsafe.pending.length, 0); assert.equal(unsafe.tasks.find(row => row._id === f.id).lpCtn, 32);
    await f.operate(next); assert.equal(view(f).pending.length, 0);
    const count = f.rows.size; await f.operate(next); assert.equal(f.rows.size, count);
    return { locksAfterHandledFailure: 0, rawPrice: 32, confirmedPrice: 16, priceWithoutPrepared: 32, originalRequestRecovered: true, retryExtraRows: 0 };
  });
  await check('Missing RESULT alone must not hide already complete PLAN facts', async () => {
    const f = await seed(), next = request(f, 2, 32);
    failBefore(f, 'PURCHASE_OPERATION_RESULT');
    await assert.rejects(f.operate(next), /OFFLINE_BEFORE_INSERT/);
    const state = view(f); assert.equal(locks(f).length, 0); assert.equal(state.pending.length, 0);
    assert.equal(readPurchasePlan(f.task(), state.activity).costing.averageCostCtn, 32);
    const priorCount = f.rows.size; await f.operate(next); assert.equal(f.rows.size, priorCount + 1);
    return { confirmedPrice: 32, pending: false, retryAddedOnlyResult: true };
  });
  await check('Merged PO handled failure is not described by a one-task lock or PLAN-only pending reader', async () => {
    const f = await seed();
    const next = { ...f.base, requestId: '00000002-1111-4111-8111-111111111111', operation: 'PO',
      input: { taskIds: [f.id, f.second], versions: f.versions(), poNumber: 'NCT-OFFLINE-MERGED' } };
    // Production updates run concurrently; fail one specific member before persistence.
    const update = f.store.update; let armed = true;
    f.store.update = async (collection, row) => {
      if (armed && collection === 'NCTTasks' && row._id === f.second) { armed = false; throw Error('OFFLINE_RESPONSE_LOST'); }
      return update(collection, row);
    };
    await assert.rejects(f.operate(next), /OFFLINE_RESPONSE_LOST/);
    const p = rows(f, 'NCTActivity').find(row => row.action === 'PURCHASE_OPERATION_PREPARED' && row.details.plan.operation === 'PO');
    assert.equal(p.details.plan.updates.length, 2); assert.equal(locks(f).length, 0);
    assert.equal(rows(f, 'NCTTasks').filter(row => row.ourPoNumber === next.input.poNumber).length, 1);
    assert.equal(view(f).pending.length, 0);
    await f.operate(next); assert.equal(rows(f, 'NCTTasks').filter(row => row.ourPoNumber === next.input.poNumber).length, 2);
    const count = f.rows.size; await f.operate(next); assert.equal(f.rows.size, count);
    return { affectedTasks: 2, assignedBeforeRecovery: 1, locks: 0, planReaderPending: 0,
      originalRequestRecovered: true, limitation: 'PLAN-only pending semantics cannot be advertised as complete PO-operation safety; other guards are not assessed by this single reader.' };
  });
  await check('ADD_SOURCE membership must come from prepared plan before source acceptance exists', async () => {
    const f = await seed();
    const add = createPurchaseSourceOperations({ store: f.store, names: { NCT: { orders: 'NCTOrders', tasks: 'NCTTasks', activity: 'NCTActivity' } }, readWorkspace: async () => f.workspace() });
    const next = { ...f.base, requestId: '00000002-1111-4111-8111-111111111111', staff: { ...f.base.staff, canAddPurchaseSource: true }, input: {
      action: 'ADD_SOURCE', parentTaskId: f.id, version: purchaseSourcesVersion(f.workspace()), quantity: 50, supplierId: 'S',
      poNumber: '', draftPlan: true, transportMode: 'SUPPLIER_DELIVER', reason: '',
      costing: { schema: 1, mode: 'NORMAL', moneySource: 'PRICES', paidCtn: 50, freeCtn: 0, prices: { lpPc: 1, lpCtn: 16, disc1: 0, disc2: 0, disc3: 0 } } } };
    failBefore(f, 'PURCHASE_SOURCE_ADDED');
    await assert.rejects(add(next), /OFFLINE_BEFORE_INSERT/);
    const p = rows(f, 'NCTActivity').find(row => row.action === 'PURCHASE_OPERATION_PREPARED' && row.details.plan.task);
    assert.equal(p.details.plan.task.customerDemandTaskId, f.id); assert.equal(locks(f).length, 0);
    assert.ok(f.rows.has('NCTTasks/' + p.details.plan.task._id));
    assert.equal(rows(f, 'NCTActivity').filter(row => row.action === 'PURCHASE_SOURCE_ADDED').length, 0);
    assert.equal(readPurchaseShares(f.id, rows(f, 'NCTActivity')).shares.length, 2);
    assert.equal(view(f).pending.length, 0);
    await add(next); const count = f.rows.size; await add(next); assert.equal(f.rows.size, count);
    return { newTaskExists: true, sourceAccepted: false, declaredShareMembers: 2, locks: 0, planReaderPending: 0,
      rootInPreparedTask: true, originalRequestRecovered: true };
  });
  await check('Warehouse follow-on during incomplete merged PO is exercised through original projections and save', async () => {
    const f = await seed();
    const next = { ...f.base, requestId: '00000002-1111-4111-8111-111111111111', operation: 'PO',
      input: { taskIds: [f.id, f.second], versions: f.versions(), poNumber: 'NCT-OFFLINE-MERGED-RECEIVE' } };
    const update = f.store.update; let armed = true;
    f.store.update = async (collection, row) => {
      if (armed && collection === 'NCTTasks' && row._id === f.second) { armed = false; throw Error('OFFLINE_MEMBER_FAILURE'); }
      return update(collection, row);
    };
    await assert.rejects(f.operate(next), /OFFLINE_MEMBER_FAILURE/);
    const readOrders = async company => {
      const workspace = f.workspace();
      // Exercise the same sibling read projections as warehouseReceiving.web.js.
      projectWarehouseCustomerReadiness(workspace);
      projectPreparation({ ...workspace, activity: rows(f, 'NCTActivity') }).forEach(item => {
        const task = workspace.tasks.find(row => row.id === item.taskId);
        if (task) warehouseCbm(company, task, rows(f, 'NCTActivity'));
      });
      return projectWarehouseOrders({ company, purchaseOrders: projectPurchaseOrders({ company, workspace, records: rows(f, 'PurchaseOrders') }),
        tasks: workspace.tasks, activity: rows(f, 'NCTActivity') });
    };
    const before = await readOrders('NCT');
    assert.equal(before.length, 1); assert.equal(before[0].lines.length, 1);
    const warehouse = createWarehouseOperations({ store: f.store, names: { NCT: { activity: 'NCTActivity' } }, readOrders });
    let receiptError = null;
    try { await warehouse.save({ ...f.base, requestId: '00000003-1111-4111-8111-111111111111', input: {
      id: before[0].id, version: before[0].version, action: 'RECEIVE',
      lines: [{ taskId: f.id, accepted: 20, rejected: 0, kind: 'PARTIAL', reason: 'Offline interrupted PO boundary' }] } }); }
    catch (error) { receiptError = error.message; }
    const receivedBeforeRecovery = (await readOrders('NCT'))[0].lines.reduce((sum, row) => sum + row.accepted, 0);
    let recoveryError = null;
    try { await f.operate(next); } catch (error) { recoveryError = error.message; }
    const after = await readOrders('NCT');
    const evidence = { receiptError, recoveryError, receiptFacts: rows(f, 'NCTActivity').filter(row => row.action === 'WAREHOUSE_RECEIPT_SAVED').length,
      beforePOId: before[0].id, afterPOId: after[0]?.id || null, afterMembers: after[0]?.lines.length || 0,
      receivedBeforeRecovery, afterDisplayedAccepted: after[0]?.lines.reduce((sum, row) => sum + row.accepted, 0) ?? null };
    assert.equal(receiptError, null); assert.equal(recoveryError, null);
    assert.equal(receivedBeforeRecovery, 20); assert.equal(evidence.receiptFacts, 1);
    assert.notEqual(evidence.beforePOId, evidence.afterPOId);
    assert.equal(evidence.afterMembers, 2); assert.equal(evidence.afterDisplayedAccepted, 0);
    output.observations.mergedFollowOn = evidence;
    return evidence;
  });
  await check('PLAN-only read may omit unrelated PREPARED, but full workspace contract may not', async () => {
    const f = await seed(); failAfter(f, 'update', c => c === 'NCTTasks');
    await assert.rejects(f.operate(request(f, 2, 32)), /OFFLINE_RESPONSE_LOST/);
    const all = rows(f, 'NCTActivity');
    const unrelated = prepared.filter(row => row.details.plan.operation !== 'PLAN');
    const combined = all.concat(unrelated), minimal = combined.filter(row => row.action !== 'PURCHASE_OPERATION_PREPARED' || row.details?.plan?.operation === 'PLAN');
    const a = confirmedPurchaseState({ company: 'NCT', tasks: rows(f, 'NCTTasks'), activity: combined });
    const b = confirmedPurchaseState({ company: 'NCT', tasks: rows(f, 'NCTTasks'), activity: minimal });
    assert.deepEqual(plain(a.tasks), plain(b.tasks)); assert.deepEqual(plain(a.pending), plain(b.pending));
    return { unrelatedPreparedExcluded: unrelated.length, confirmedTasksAndPendingEqual: true,
      deployable: false, note: 'Only this reader ignores them. Desk resume, shortload recovery, uploads and legacy display-order consumers have separate PREPARED requirements.' };
  });
  const files = ['purchaseOperationJournal.js', 'purchaseOperations.js', 'purchaseSources.js', 'purchasePlan.js', 'warehouseReceiving.js', 'warehouseReceiving.web.js', 'purchaseOrderWorkflow.js'];
  output.sourceHashes = Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.resolve(__dirname, '../../backend', file)))]));
  return output;
}
if (require.main === module) run(process.argv[2]).then(result => {
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ checks: result.checks, snapshot: result.snapshot }, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
