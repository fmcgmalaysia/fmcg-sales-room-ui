const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module'), { execFileSync } = require('node:child_process');
const { createCurrentPurchaseBorrowGateway } = require('../prototypes/stock-current-state/current-purchase-borrow-gateway.cjs');
const { planCollections } = require('../prototypes/stock-current-state/domain-scope.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const load = require('./load-master-module.cjs'), { operationId } = load('purchaseOperationJournal.js');
const folder = path.join(__dirname, '../prototypes/stock-current-state'), fixturePath = require.resolve('./stock-current-borrow-gateway.test.cjs');
const fixture = vm.runInNewContext(fs.readFileSync(fixturePath, 'utf8').replace("const test = require('node:test')", 'const test = () => {}')+'\nfixture;',
  { require: createRequire(fixturePath), Map, Buffer });
const copy = value => JSON.parse(JSON.stringify(value));
async function root(verifiedMockCoverage = false) {
  const f = await fixture(), calls = [], wrapped = [];
  for (const task of f.context.tasks) f.db.set('NCTTasks:'+task.id, { _id: task.id, title: task.id, company: 'NCT', _version: 'T0',
    description: task.orderId, imageAltText: task.sourceLineId, stockCounterSchema: 2, stockCounterGeneration: 0, stockDispatchedCumulative: 0 });
  const native = { webMethod: (permission, fn) => { wrapped.push(permission); return fn; }, Permissions: { SiteMember: 'SITE_MEMBER' },
    currentMember: { getMember: () => f.deps.readMember() }, items: f.items,
    getPurchaseStaffContext: async () => { calls.push('AUTH'); const member = await f.deps.readMember(); return { ...f.deps.requirePurchaseStaff(member, await f.deps.readStaffRecords()), memberId: member._id }; },
    fulfilmentStore: { all: async collection => { calls.push(collection); return collection === 'StaffMasterAccess' ? f.deps.readStaffRecords()
      : collection === 'PurchaseOrders' ? [{ company: 'GHR', _id: 'FOREIGN' }] : assert.fail('Unexpected original table scan'); } },
    readFulfilmentContext: async (company, staff) => { calls.push('CONTEXT'); return f.deps.readContext(company, staff); },
    ...Object.fromEntries(['requirePurchaseStaff','projectPurchaseOrders','readAllocations','readCustomerShipments','readPackingLists','packingHeld','readPreparation'].map(k => [k, f.deps[k]])),
    readPreparation: load('warehousePreparation.js').readPreparation, projectPreparation: load('warehousePreparation.js').projectPreparation, operationId, planCollections,
    createSdkConditionalStore: args => { calls.push('SDK:'+args.company); assert.ok(['NCT','GHR'].includes(args.company));
      assert.deepEqual(copy(args.collections), planCollections(args.company, true));
      const journal = args.company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
      assert.deepEqual(copy(args.dateTimeFields), { [journal]: ['activityTime'],
        [args.company==='NCT'?'NCTOrders':'NCTOrders1']:['estimatedShipmentDate','masterReceivedTime','salesSubmissionTime'],
        [args.company==='NCT'?'NCTTasks':'NCTTasks1']:['lastCostCaptureTime'] }); return f.store; },
    createSegmentedFencedProof: args => { assert.equal(args.store, f.store); assert.equal(args.domainWrites, true); return f.protocol; },
    createCurrentPurchaseBorrowGateway };
  let source = fs.readFileSync(path.join(folder, 'stockCurrentBorrow.web.js'), 'utf8');
  if (verifiedMockCoverage) {
    // Deliberate OFFLINE fixture only. Shipped candidate remains empty/fail-closed.
    const coverage = Object.fromEntries(WRITERS.map(w => [w, { verified: true, build: 'TEST' }]));
    const before = 'const writerCoverage = Object.freeze({});'; assert.equal(source.split(before).length, 2);
    source = source.replace(before, 'const writerCoverage = Object.freeze('+JSON.stringify(coverage)+');');
  }
  const api = vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '')
    +'\nreturn {getPurchaseBorrowOptionsCurrent,getPurchaseBorrowReturnOptionsCurrent,savePurchaseBorrowingCurrent,getPurchaseResumeContextCurrent};})()', native);
  return { ...f, api, calls, wrapped };
}

test('generated actual-import web root retains original auth before stock access, exact schema gate and CLOSED writer coverage', async () => {
  assert.match(execFileSync(process.execPath, [path.join(folder, 'build-purchase-borrow-web.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const f = await root(); assert.deepEqual(f.wrapped, ['SITE_MEMBER','SITE_MEMBER','SITE_MEMBER','SITE_MEMBER','SITE_MEMBER','SITE_MEMBER']);
  const quote = await f.api.getPurchaseBorrowOptionsCurrent('NCT', { borrowerTaskId: 'A' });
  assert.equal(quote.ok, false); assert.equal(f.calls[0], 'AUTH');
  assert.equal(f.calls.includes('CONTEXT'), false, 'unverified writer coverage must not yield actionable borrowing quotes');
  const failed = await f.api.savePurchaseBorrowingCurrent('NCT', { ...f.request, coverage: Object.fromEntries(WRITERS.map(w => [w, true])) });
  assert.equal(failed.ok, false); assert.equal(failed.requestId, f.request.requestId);
  assert.equal([...f.db.values()].some(r => r.action === 'STOCK_TRANSFER_CURRENT'), false);
  assert.equal((await f.protocol.readControl()).generation, 0);
  const source = fs.readFileSync(path.join(folder, 'stockCurrentBorrow.web.js'), 'utf8');
  assert.equal(/elevate\(|suppressAuth|\.initialize\(|getPurchaseWorkspace\(/.test(source), false);
});

test('root and existing relay can drive actual scoped borrow plan with same request progress; no receipt or PO duplication', async () => {
  const f = await root(true), quote = await f.api.getPurchaseBorrowOptionsCurrent('NCT', { borrowerTaskId: 'A' });
  assert.equal(quote.ok, true); assert.equal(quote.options[0].maximumQuantity, 100); assert.equal(f.calls[0], 'AUTH');
  assert.ok(f.calls.indexOf('CONTEXT') > f.calls.indexOf('AUTH'));
  const request = { ...f.request, input: { ...f.request.input, expectedRevision: quote.expectedRevision, approvedBy: 'FORGED' } };
  let result, attempts = 0; do { result = await f.api.savePurchaseBorrowingCurrent('NCT', request); assert.ok(attempts++ < 40); } while (result.pending);
  assert.equal(result.ok, true); assert.equal(result.stockGeneration, 1); assert.ok(attempts > 1);
  assert.equal((await f.api.savePurchaseBorrowingCurrent('NCT', request)).stockGeneration, 1);
  const relations = [...f.db.values()].filter(r => r.action === 'STOCK_TRANSFER_CURRENT'); assert.equal(relations.length, 1);
  assert.equal(relations[0].details.relation.approvedBy, 'P1'); assert.equal(relations[0].details.relation.quantity, 30);
  assert.deepEqual(copy(f.context.tasks.map(t => t.po)), ['PO-A','PO-B']);
  const relationId = relations[0].details.relation.id, before = JSON.stringify([...f.db]);
  const unused = await f.api.getPurchaseBorrowReturnOptionsCurrent('NCT', { relationId });
  assert.equal(unused.ok, true); assert.equal(unused.maximumQuantity, 30); assert.equal(unused.remaining, 30);
  assert.equal(unused.expectedRevision, 1); assert.equal(unused.stockCurrent.stockGeneration, 1);
  assert.equal(JSON.stringify([...f.db]), before, 'return quote must not release debt or move cartons');
  const returning = { requestId: '22222222-2222-4222-8222-222222222222', operation: 'BORROW_RETURN', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 1,
    input: { relationId, expectedRevision: unused.expectedRevision, quantity: 10, reason: 'Unused cartons restored', approvedBy: 'FORGED' } };
  attempts = 0; do { result = await f.api.savePurchaseBorrowingCurrent('NCT', returning); assert.ok(attempts++ < 40); } while (result.pending);
  assert.equal(result.ok, true); assert.equal(result.stockGeneration, 2); assert.equal((await f.api.savePurchaseBorrowingCurrent('NCT', returning)).stockGeneration, 2);
  const afterReturn = await f.api.getPurchaseBorrowReturnOptionsCurrent('NCT', { relationId });
  assert.equal(afterReturn.maximumQuantity, 20); assert.equal(afterReturn.remaining, 20); assert.equal(afterReturn.expectedRevision, 2);
  const current = [...f.db.values()].find(r => r.action === 'STOCK_TRANSFER_CURRENT');
  assert.equal(current.status, 'ACTIVE'); assert.equal(current.details.relation.returned, 10); assert.equal(current.details.relation.returnApprovedBy, 'P1');
  assert.equal([...f.db.values()].filter(r => r.action === 'STOCK_TRANSFER_CURRENT').length, 1);
});

test('unapproved member, foreign company, unverified writer coverage and oversize messages cannot read stock or save', async () => {
  const f = await root(); assert.equal((await f.api.getPurchaseBorrowOptionsCurrent('OTHER', { borrowerTaskId: 'A' })).ok, false);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.api.getPurchaseBorrowOptionsCurrent('GHR', { borrowerTaskId: 'A' })).ok, false);
  assert.deepEqual(f.calls, ['AUTH','SDK:GHR','StaffMasterAccess']);
  assert.equal(f.calls.includes('CONTEXT'), false, 'verified field type does not authorize stock access before all-writer coverage');
  f.calls.length = 0; f.deps.readMember = async () => ({ _id: 'M1', status: 'PENDING' });
  assert.equal((await f.api.getPurchaseBorrowOptionsCurrent('NCT', { borrowerTaskId: 'A' })).ok, false); assert.deepEqual(f.calls, ['AUTH']);
  f.calls.length = 0; assert.equal((await f.api.getPurchaseBorrowOptionsCurrent('NCT', { borrowerTaskId: 'X'.repeat(6001) })).ok, false);
  assert.equal((await f.api.savePurchaseBorrowingCurrent('NCT', { ...f.request, input: { note: 'X'.repeat(6001) } })).ok, false);
  assert.equal(f.calls.length, 0);
});

function relay() {
  let callback; const messages = [], queries = [], saves = [], taskSaves = [], legacy = [], room = { postMessage: m => messages.push(copy(m)), onMessage: fn => { callback = fn; } };
  const $w = () => room; $w.onReady = fn => fn();
  const source = fs.readFileSync(path.join(folder, 'purchase-room-page.candidate.js'), 'utf8').replace(/^import[^\n]+\n/gm, '');
  const native = { $w, getPurchaseResumeContextCurrent: async company => { queries.push({ company, kind:'RESUME_CONTEXT' }); return { ok:true,schema:'PURCHASE_RESUME_CONTEXT_V1',company,staff:{staffId:'P1',memberId:'M1',staffName:'Purchase'} }; },
    getPurchaseBorrowOptionsCurrent: async (company, input) => { queries.push({ company, input: copy(input) }); return { ok: true, options: [] }; },
    getPurchaseBorrowReturnOptionsCurrent: async (company, input) => { queries.push({ company, input: copy(input), kind: 'RETURN' }); return { ok: true, maximumQuantity: 0 }; },
    savePurchaseBorrowingCurrent: async (company, request) => { saves.push({ company, request: copy(request) }); return {
      ok: false, pending: true, requestId: request.requestId, phase: 'APPLY', completedCount: 1, totalRecords: 5 }; },
    savePurchaseTasksCurrent: async (company,request) => { taskSaves.push({company,request:copy(request)}); return { ok:false,pending:true,requestId:request.requestId,phase:'VERIFY',completedCount:2,totalRecords:4 }; },
    savePurchaseOperation: async (...args) => { legacy.push(args); return { ok: true, requestId: args[1] }; } };
  vm.runInNewContext(source, native); return { messages, queries, saves, taskSaves, legacy, send: data => callback({ data }) };
}

test('actual Wix relay sends OPTIONS and BORROW to new root, preserves exact UUID/metadata/progress and leaves ordinary saves untouched', async () => {
  const f = relay(), id = '11111111-2222-4333-8444-555555555555', stock = { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 8 };
  await f.send({ type: 'PURCHASE_BORROW_OPTIONS_REQUEST', company: 'NCT', requestId: id, input: { borrowerTaskId: 'A' } });
  assert.deepEqual(f.queries, [{ company: 'NCT', input: { borrowerTaskId: 'A' } }]);
  assert.equal(f.messages.at(-1).type, 'PURCHASE_BORROW_OPTIONS_RESULT');
  const input = { borrowerTaskId: 'A', lenderSourceId: 'B', replacementSourceId: 'A', expectedRevision: 1, quantity: 20, reason: 'Customer shipment' };
  for (const operation of ['BORROW_APPROVE','BORROW_RETURN']) await f.send({ type: 'PURCHASE_SAVE_REQUEST', company: 'NCT', requestId: id, operation, input,
    ...stock, memberId: 'FORGED', coverage: 'FORGED' });
  assert.equal(f.saves.length, 2); assert.equal(f.legacy.length, 0);
  assert.deepEqual(f.saves[0].request, { requestId: id, operation: 'BORROW_APPROVE', input, ...stock });
  assert.deepEqual(f.messages.at(-1).result, { ok: false, pending: true, requestId: id, phase: 'APPLY', completedCount: 1, totalRecords: 5 });
  await f.send({ type: 'PURCHASE_SAVE_REQUEST', company: 'NCT', requestId: id, operation: 'PLAN', input: { original: true } });
  assert.equal(f.legacy.length, 1); assert.equal(f.saves.length, 2); assert.equal(f.messages.at(-1).type, 'PURCHASE_SAVE_RESULT');
});

test('original Purchase resume context authenticates without stock reads, coverage or workspace and refuses role downgrade', async () => {
  const f = await root();
  const result = await f.api.getPurchaseResumeContextCurrent('NCT');
  assert.equal(result.ok,true);assert.equal(result.schema,'PURCHASE_RESUME_CONTEXT_V1');assert.equal(result.company,'NCT');
  assert.equal(result.staff.staffId,'P1');assert.equal(result.staff.memberId,'M1');
  assert.deepEqual(f.calls,['AUTH']);assert.equal(Object.hasOwn(result,'stockCurrent'),false);
  f.calls.length=0;assert.equal((await f.api.getPurchaseResumeContextCurrent('OTHER')).ok,false);assert.deepEqual(f.calls,[]);
  f.deps.readMember=async()=>({_id:'M1',status:'PENDING'});
  assert.equal((await f.api.getPurchaseResumeContextCurrent('NCT')).ok,false);assert.deepEqual(f.calls,['AUTH']);
});

test('resume context relay sends no cached request or browser identity to authorization', async () => {
  const f=relay(),request={type:'PURCHASE_RESUME_CONTEXT_REQUEST',company:'NCT',requestId:'11111111-2222-4333-8444-555555555555',memberId:'FORGED'};
  await f.send(request);assert.deepEqual(f.queries,[{company:'NCT',kind:'RESUME_CONTEXT'}]);
  assert.equal(f.messages[0].type,'PURCHASE_RESUME_CONTEXT_RESULT');assert.equal(f.messages[0].result.staff.memberId,'M1');
  await f.send({...request,requestId:'BAD'});await f.send({...request,note:'X'.repeat(1001)});
  assert.equal(f.queries.length,1);assert.equal(f.messages.at(-1).ok,false);assert.equal(f.saves.length,0);assert.equal(f.legacy.length,0);
});

test('new relay invalid company/UUID/oversize borrowing payload cannot call either new or legacy writer', async () => {
  const f = relay(), valid = { type: 'PURCHASE_SAVE_REQUEST', company: 'NCT', requestId: '11111111-2222-4333-8444-555555555555', operation: 'BORROW_APPROVE', input: {} };
  for (const patch of [{ company: 'OTHER' }, { requestId: 'INVALID' }, { input: { reason: 'X'.repeat(6001) } }]) await f.send({ ...valid, ...patch });
  assert.equal(f.saves.length, 0); assert.equal(f.legacy.length, 0); assert.equal(f.messages.length, 3);
  assert.ok(f.messages.every(m => m.type === 'PURCHASE_SAVE_RESULT' && m.ok === false));
});

test('actual return quote relay is readonly, bounded and preserves company/request identity', async () => {
  const f = relay(), request = { type: 'PURCHASE_BORROW_RETURN_OPTIONS_REQUEST', company: 'NCT', requestId: '11111111-2222-4333-8444-555555555555', input: { relationId: 'R' } };
  await f.send(request); assert.deepEqual(f.queries, [{ company: 'NCT', input: { relationId: 'R' }, kind: 'RETURN' }]);
  assert.equal(f.messages.at(-1).type, 'PURCHASE_BORROW_RETURN_OPTIONS_RESULT'); assert.equal(f.messages.at(-1).requestId, request.requestId);
  await f.send({ ...request, input: { relationId: 'X'.repeat(6001) } }); assert.equal(f.queries.length, 1);
  assert.equal(f.saves.length, 0); assert.equal(f.legacy.length, 0);
});
test('current task relay preserves exact command and progress without a legacy fallback or browser actor grant',async()=>{
  const f=relay(),request={type:'PURCHASE_SAVE_REQUEST',company:'NCT',requestId:'11111111-2222-4333-8444-555555555555',operation:'EDIT',
    input:{edits:[{taskId:'T',version:'V',changes:{lpCtn:20}}]},stockProtocol:1,stockBuild:'TEST',stockGeneration:8};
  await f.send({...request,memberId:'FORGED',coverage:'FORGED'});
  assert.deepEqual(f.taskSaves,[{company:'NCT',request:{requestId:request.requestId,operation:'EDIT',input:request.input,stockProtocol:1,stockBuild:'TEST',stockGeneration:8}}]);
  assert.equal(f.legacy.length,0);assert.equal(f.saves.length,0);assert.equal(f.messages.at(-1).result.phase,'VERIFY');
  await f.send({...request,stockProtocol:2});assert.equal(f.taskSaves.length,2);assert.equal(f.legacy.length,0,'invalid metadata must reach current refusal, not old apply');
  for(const patch of [{company:'OTHER'},{requestId:'BAD'},{input:{reason:'X'.repeat(200001)}}])await f.send({...request,...patch});
  assert.equal(f.taskSaves.length,2);assert.equal(f.legacy.length,0);
});
