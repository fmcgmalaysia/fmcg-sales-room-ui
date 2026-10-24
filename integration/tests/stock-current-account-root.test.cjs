const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { createRequire } = require('node:module'), { execFileSync } = require('node:child_process'), load = require('./load-master-module.cjs');
const { createCurrentAccountOrderRecordSave, createCurrentPurchaseOrderRecordSave } = require('../prototypes/stock-current-state/current-order-record-save.cjs');
const { createCurrentAccountAuxiliarySave } = require('../prototypes/stock-current-state/current-account-auxiliary-save.cjs');
const {createCurrentOrderFileSave}=require('../prototypes/stock-current-state/current-order-file-save.cjs'),{createOrderFileFencedStore}=require('../prototypes/stock-current-state/order-file-fenced-store.cjs');
const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { createCurrentPurchaseTables } = require('../prototypes/stock-current-state/current-purchase-tables.cjs');
const { planCollections } = require('../prototypes/stock-current-state/domain-scope.cjs'), { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs'), copy = value => JSON.parse(JSON.stringify(value));
const filename = require.resolve('./stock-current-order-record-save.test.cjs');
const original = vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace("const test = require('node:test')", 'const test = () => {}') + ';fixture;', { require: createRequire(filename), Map, Buffer });
const folder = path.join(__dirname, '../prototypes/stock-current-state');
async function fixture({ company = 'NCT', coverage = true, generated = false, credit = false } = {}) {
  const f = await original(company, 'ACCOUNT'), calls = [],fileCommands=[], journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', orders = company === 'NCT' ? 'NCTOrders' : 'NCTOrders1', tasks = company === 'NCT' ? 'NCTTasks' : 'NCTTasks1';let slots=0;
  const requestPurchaseDocument=async command=>{fileCommands.push(copy(command));return command.action==='ALLOCATE'?{ok:true,fileId:'Account_File_Slot_'+String(++slots).padStart(4,'0')}:{ok:true,...command,...(command.action==='TRASH'?{trashed:true}:{})};};
  const modules = Object.assign({}, ...['purchaseOrderWorkflow.js','accountPurchaseReview.js','accountSettlement.js','supplierCredit.js','plannerAllocation.js','customerShipmentLedger.js','packingListOperations.js','packingListModel.js','warehousePreparation.js','accountReadQuery.js'].map(name => load(name)));
  const records = () => [...f.db].filter(([key]) => key.startsWith('PurchaseOrders:')).map(([, row]) => copy(row));
  const context = () => ({ ...copy(f.context), creditTransfers: modules.readCreditTransfers([...f.db].filter(([key]) => key.startsWith(journal + ':')).map(([, row]) => copy(row))) });
  const rows = () => modules.projectPurchaseOrders({ company, workspace: context(), records: records() });
  if (credit) {
    f.context.tasks[0].warehouse = { accepted: 100, hasPhysicalReceipt: true, issue: false };
    f.context.tasks.push({ ...copy(f.context.tasks[0]), id: 'U', po: 'PO2', sourceLineId: 'L2', editVersion: 'U0' });
    const target = f.db.get('PurchaseOrders:' + f.request.input.id); target.details.documents.push({ type: 'DO', fileId: 'DO', linked: true, sha256: 'do' });
    target.details.finance = { amounts: [{ fileId: 'INV', sha256: 'inv', cents: 100000 }], payments: [], cnNotApplicable: { enabled: true, byStaffId: 'A', at: '2026-10-21' } };
    const source = rows().find(row => row.number === 'PO2'), sourceRecord = { _id: source.id, title: source.id, company, _version: 'SOURCE0', details: { taskIds: ['U'], audit: [], documents: [
      { type: 'INV', fileId: 'INV2', linked: true, sha256: 'inv2' }, { type: 'DO', fileId: 'DO2', linked: true, sha256: 'do2' }, { type: 'CN', fileId: 'CN2', linked: true, sha256: 'cn2' }],
      finance: { amounts: [{ fileId: 'INV2', sha256: 'inv2', cents: 100000 }, { fileId: 'CN2', sha256: 'cn2', cents: 10000 }], payments: [
        { id: 'PAY', cents: 100000, confirmed: true, by: 'Account', byStaffId: 'A', at: '2026-10-21', proof: { linked: true, fileId: 'PROOF', sha256: 'proof' } }] } } };
    f.db.set('PurchaseOrders:' + source.id, sourceRecord);
    const version = rows().find(row => row.id === source.id).finance.reviewVersion;
    sourceRecord.details.finance.creditRecognition = { cents: 10000, reviewVersion: version, byStaffId: 'A', at: '2026-10-21' };
    sourceRecord.details.finance.check = { enabled: true, reviewVersion: version, byStaffId: 'A', at: '2026-10-21' };
    assert.equal(rows().find(row => row.id === source.id).invoiceChecked, true);
  }
  for (const row of f.context.tasks) f.db.set(tasks + ':' + row.id, { _id: row.id, title: row.id, company, _version: row.id + '0', stockCounterSchema: 2, stockDispatchedCumulative: 0, stockCounterGeneration: 0 });
  f.store.normalizeListedRow = (collection, row) => { assert.equal(row.company, company);
    const lock = collection === journal && row._id === hash(company + '/PURCHASE', 'LOCK') && row.owner && row.attempt && !row.action && !row.details && !Object.hasOwn(row, 'stockCommitVersion');
    if (!lock) assert.ok(row._version); return copy(row); };
  const tables = { [orders]: [{ _id: 'O', title: 'O', company, _version: 'O0' }], [tasks]: [...f.db].filter(([key]) => key.startsWith(tasks + ':')).map(([, row]) => copy(row)), SharedSuppliers: [{ _id: 'S', title: 'S', bankName: 'BANK', bankAccountNo: 'ORIGINAL' }] };
  const all = async collection => { if (collection === 'StaffMasterAccess') return [f.employee]; if (Object.hasOwn(tables, collection)) return copy(tables[collection]); if ([journal,'PurchaseOrders'].includes(collection)) return [...f.db].filter(([key]) => key.startsWith(collection + ':')).map(([, row]) => copy(row)); throw Error('Unexpected Account root table'); };
  const auth = (member, records) => { calls.push('AUTH'); return modules.requireAccountStaff(member, records); };
  let capabilities = { createCurrentAccountOrderRecordSave, createCurrentAccountAuxiliarySave, createCurrentPurchaseTables,createCurrentOrderFileSave,createOrderFileFencedStore };
  if (generated) capabilities = vm.runInNewContext(fs.readFileSync(path.join(folder, 'stockCurrentCommands.js'), 'utf8').replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';({createCurrentAccountOrderRecordSave,createCurrentAccountAuxiliarySave,createCurrentPurchaseTables,createCurrentOrderFileSave,createOrderFileFencedStore});', { createHash: crypto.createHash, randomBytes: crypto.randomBytes, StockRuntimeBuffer: Buffer });
  let native = fs.readFileSync(path.join(folder, 'stockCurrentAccountPurchase.js'), 'utf8');
  if (coverage) native = native.replace('const writerCoverage=Object.freeze({});', 'const writerCoverage=Object.freeze(' + JSON.stringify(Object.fromEntries(WRITERS.map(writer => [writer, { verified: true, build: 'TEST' }]))) + ');');
  const createCurrentAccountPurchase = vm.runInNewContext(native.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';createCurrentAccountPurchase;', {
    ...modules, ...capabilities,requestPurchaseDocument, requireAccountStaff: auth, items: {}, currentMember: { getMember: async () => f.member }, PURCHASE_CURRENT_PROJECTION_VERSION: 2,
    fulfilmentStore: { all, read: async (collection, id) => { calls.push('CONTROL'); const row = await f.store.read(collection, id); return row ? { ...row, stockCommitVersion: row._version } : null; } }, operationId: hash, planCollections,
    projectPurchaseWorkspace: args => { assert.equal(args.company, company); calls.push('ORIGINAL_CONTEXT'); return { ...context(), staff: args.staff }; },
    // Current stock/provenance mathematics remains in its real projector suite;
    // this fixture exercises ORIGINAL PO/financial projectors and native routing.
    readCurrentPurchaseProjection: async args => { calls.push('CURRENT_PROJECTION'); assert.equal(args.currentProjectionVersion, 2); assert.equal(args.control.mode, 'ACTIVE');
      assert.equal((await args.readCurrentTaskRows(company, f.context.tasks.map(row => row.id))).length, f.context.tasks.length); return { workspace: args.context }; },
    createSdkConditionalStore: config => { assert.deepEqual(copy(config.dateTimeFields), { [journal]: ['activityTime'], [orders]: ['masterReceivedTime','salesSubmissionTime'], [tasks]: ['lastCostCaptureTime'] }); return f.store; }, createSegmentedFencedProof: config=>config.store===f.store?f.protocol:createSegmentedFencedProof({...config,stepsPerInvocation:1})
  });
  let privateError;
  const api = vm.runInNewContext(fs.readFileSync(path.join(folder, 'accountPurchase.web.candidate.js'), 'utf8').replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';({saveAccountSettlement,saveAccountInvoiceCheck,getAccountPurchaseOrders,queryAccountPurchaseOrders,planAccountReadIndex,maintainAccountReadIndex});', {
    ...modules, requireAccountStaff: auth, currentMember: { getMember: async () => f.member }, webMethod: (_, fn) => fn, Permissions: { SiteMember: 'SITE' },
    wixData: { query: collection => ({ limit: () => ({ find: async () => ({ items: await all(collection), hasNext: () => false }) }) }) }, PURCHASE_COLLECTIONS: { [company]: { orders, tasks, activity: journal } },
    createCurrentAccountPurchase: async selected => { const current = await createCurrentAccountPurchase(selected); return current.save ? { ...current, save: async request => { try { return await current.save(request); } catch (error) { privateError = error; throw error; } } } : current; },
    createPurchaseOrderOperations: () => ({ list: async () => { calls.push('LEGACY_LIST'); return []; } }), createAccountReviewOperations: () => ({ save: async () => { calls.push('LEGACY_REVIEW'); return { ok: true }; } }),
    createAccountSettlementOperations: () => ({ save: async () => { calls.push('LEGACY_SETTLEMENT'); return { ok: true }; } }), createSupplierCreditOperations: () => async () => { calls.push('LEGACY_CREDIT'); return { ok: true }; },
    requestPurchaseDocument: () => { throw Error('No file calls'); }, readCustomerShortNames: async () => [{ customerId: 'C', shortName: 'SHORT' }], ACCOUNT_READ_INDEX_COLLECTION: 'AccountReadIndex',
    createAccountReadIndexOperations: ({ readRows }) => ({ plan: async selected => ({ rowCount: (await readRows(selected)).length }), stage: async selected => ({ rowCount: (await readRows(selected)).length }), activate: async selected => ({ rowCount: (await readRows(selected)).length }) })
  });
  const metadata = { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0, stockIdentity: { staffId: 'A', memberId: 'M' } };
  const send = (input = f.request.input, meta = metadata, requestId = f.request.requestId) => (input.action === 'INVOICE_CHECK' ? api.saveAccountInvoiceCheck : api.saveAccountSettlement)(company, requestId, input, meta);
  async function finish(input = f.request.input, meta = metadata, requestId = f.request.requestId) { for (let i = 0; i < 25; i++) { const result = await send(input, meta, requestId); if (!result.pending) { assert.equal(result.ok, true, privateError?.stack || result.error); return copy(result); } } throw Error('Still pending'); }
  return { ...f, api, send, finish, metadata, calls,fileCommands, rows, records, authorityContext: context, tables, createCurrentAccountPurchase, control: () => f.db.get(journal + ':' + f.protocol.ids.controlId) };
}

test('original shared Account web/root builds exactly and original Account auth precedes control or private records', async () => {
  assert.match(execFileSync(process.execPath, [path.join(folder, 'build-current-account-purchase.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const f = await fixture(); f.employee.departments = ['PURCHASE']; await assert.rejects(f.api.getAccountPurchaseOrders('NCT')); await assert.rejects(f.send()); assert.equal(f.calls.includes('CONTROL'), false);
});

test('existing Account read method provides only fresh own authorization context during pending state, never inventory/finance data', async () => {
  const f = await fixture(); f.control().pending = { original: 'PENDING' };
  const context = await f.api.getAccountPurchaseOrders('NCT', { contextOnly: true });
  assert.deepEqual(copy(context), { ok: true, schema: 'ACCOUNT_ORIGINAL_CONTEXT_V1', company: 'NCT', staff: { staffId: 'A', staffName: 'ACCOUNT', memberId: 'M' } });
  assert.equal(f.calls.includes('CONTROL'), false); assert.equal(f.calls.includes('CURRENT_PROJECTION'), false);
  for (const options of [null, {}, { contextOnly: false }, { contextOnly: true, role: 'SUPER ADMIN' }]) await assert.rejects(f.api.getAccountPurchaseOrders('NCT', options));
  f.employee.departments = ['PURCHASE']; await assert.rejects(f.api.getAccountPurchaseOrders('NCT', { contextOnly: true }));
});

test('both companies original full/query/index reads and non-file save retain versions, bank/file permissions, audit and stock counters', async () => {
  for (const company of ['NCT','GHR']) {
    const f = await fixture({ company, generated: true }), listed = await f.api.getAccountPurchaseOrders(company), row = listed.orders[0];
    assert.equal(row.customerName, 'SHORT'); assert.equal(row.supplierBank.bankAccountNo, 'ORIGINAL'); assert.equal(row.documents.length, 2); assert.deepEqual(copy(listed.stockCurrent), f.metadata);
    assert.equal((await f.api.queryAccountPurchaseOrders(company, { view: 'SUPPLIER_ACTIVE' })).items[0].id, row.id); assert.equal((await f.api.planAccountReadIndex(company)).rowCount, 1);
    await assert.rejects(f.api.maintainAccountReadIndex(company, 'STAGE'), /SUPER ADMIN/);
    const before = JSON.stringify([...f.db].filter(([key]) => /^(Stock|NCTTasks|NCTOrders)/.test(key))); f.request.input.version = row.version;
    const result = await f.finish(); assert.equal(result.stockGeneration, 1); assert.deepEqual(copy(await f.send()), result); assert.equal(f.db.get('PurchaseOrders:' + row.id).details.audit.length, 1);
    assert.equal(JSON.stringify([...f.db].filter(([key]) => /^(Stock|NCTTasks|NCTOrders)/.test(key))), before); assert.equal(f.calls.some(call => call.startsWith('LEGACY_')), false);
  }
});

test('actual current root supplier credit uses original financial projector/ledger, and legacy cancellation keeps original separate audit', async () => {
  const f = await fixture({ generated: true, credit: true }), listed = await f.api.getAccountPurchaseOrders('NCT'), source = listed.orders.find(row => row.number === 'PO2'), target = listed.orders.find(row => row.number === 'PO1');
  const input = { action: 'APPLY_CREDIT', id: target.id, version: target.version, sourceId: source.id, sourceVersion: source.version, cents: 4000, reason: 'Original confirmed supplier credit' };
  assert.equal(source.finance.supplierCreditCents, 10000); const before = JSON.stringify(f.records());
  await f.finish(input); assert.equal(JSON.stringify(f.records()), before); const after = await f.api.getAccountPurchaseOrders('NCT');
  assert.equal(after.orders.find(row => row.id === source.id).finance.supplierCreditCents, 6000); assert.equal(after.orders.find(row => row.id === target.id).finance.balanceCents, target.finance.balanceCents - 4000);
  const currentSource = after.orders.find(row => row.id === source.id), cancel = { action: 'INVOICE_CHECK', id: source.id, version: currentSource.version, enabled: false, reason: 'Original legacy cancellation' };
  const result = await f.finish(cancel, after.stockCurrent, '22222222-2222-4222-8222-222222222222'); assert.equal(result.stockGeneration, 2);
  const record = f.db.get('PurchaseOrders:' + source.id); assert.equal(record.details.invoiceCheck.enabled, false); assert.equal(record.details.audit.at(-1).action, 'SUPPLIER_INVOICE_CHECK_CHANGED');
  assert.equal(record.details.finance.check.enabled, true, 'preserve original separate legacy-check behavior, do not rewrite existing financial check policy');
  assert.equal(f.calls.some(call => call.startsWith('LEGACY_')), false);
});

test('unpaired modes, missing coverage/actor, stale version and invalid files refuse without old writer fallback', async () => {
  const f = await fixture(); for (const mode of ['SHADOW','MAINTENANCE']) { f.control().mode = mode; assert.equal((await f.send()).ok, false); await assert.rejects(f.api.getAccountPurchaseOrders('NCT')); }
  f.control().mode = 'ACTIVE'; for (const meta of [null, { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0 }, { ...f.metadata, stockIdentity: { staffId: 'OTHER', memberId: 'M' } }]) assert.equal((await f.send(f.request.input, meta)).ok, false);
  for (const action of ['DOCUMENT_UPLOAD','PAYMENT_FILE_DELETE']) assert.equal((await f.send({ ...f.request.input, action })).ok, false);
  assert.equal((await f.api.saveAccountSettlement('NCT', f.request.requestId, { ...f.request.input, action: 'INVOICE_CHECK' }, f.metadata)).ok, false, 'distinct original endpoint may not adopt legacy review');
  assert.equal((await f.send({ ...f.request.input, version: 'OLD' })).ok, false); assert.equal(f.calls.some(call => call.startsWith('LEGACY_')), false);
  const g = await fixture({ coverage: false }); assert.equal((await g.send()).ok, false); await assert.rejects(g.api.queryAccountPurchaseOrders('NCT', { view: 'SUPPLIER_ACTIVE' }), /co-writers/); assert.equal(g.calls.includes('CURRENT_PROJECTION'), false);
});

test('actual original Account web/private root supports original multi-proof payment then exact proof trash with original financial/stock invariants',async()=>{
 for(const company of ['NCT','GHR']){
  const f=await fixture({company,generated:true}),listed=await f.api.getAccountPurchaseOrders(company),row=listed.orders[0],before=JSON.stringify([...f.db].filter(([key])=>/^(Stock|NCTTasks|NCTOrders)/.test(key)));
  const input={id:row.id,version:row.version,action:'DOCUMENT_UPLOAD',type:'PAYMENT',date:'2026-10-22',number:'PAY-NEW',reason:'Original payment proof',cents:12300,paymentSource:'CASH',recipientChoice:'SUPPLIER',recipientBank:row.supplierBank,
   base64:Buffer.from('%PDF-1.4\n'+'A'.repeat(210000)).toString('base64'),attachments:[{base64:Buffer.from('%PDF-1.4\nsecond').toString('base64')}]};
  const done=await f.finish(input,listed.stockCurrent);assert.equal(done.stockGeneration,1);assert.equal(f.fileCommands.filter(command=>command.action==='UPLOAD').length,2);
  const fresh=await f.api.getAccountPurchaseOrders(company),payment=fresh.orders[0].finance.payments[0];assert.equal(payment.cents,12300);assert.equal(payment.proofs.length,2);
  assert.deepEqual(copy(payment.recipientBank),{bankName:'BANK',bankAccountNo:'ORIGINAL'});assert.equal(payment.paymentSource,'CASH');
  const deletion={id:row.id,version:fresh.orders[0].version,action:'PAYMENT_FILE_DELETE',paymentId:payment.id,fileId:payment.proofs[0].fileId},requestId='22222222-2222-4222-8222-222222222222';
  const removed=await f.finish(deletion,fresh.stockCurrent,requestId);assert.equal(removed.stockGeneration,2);assert.equal(f.fileCommands.filter(command=>command.action==='TRASH').length,1);
  assert.equal((await f.send(deletion,fresh.stockCurrent,requestId)).stockGeneration,2);assert.equal(f.fileCommands.filter(command=>command.action==='TRASH').length,1);
  const record=f.db.get('PurchaseOrders:'+row.id);assert.equal(record.details.audit.length,2);assert.equal(record.details.finance.payments.length,1);assert.equal(record.details.finance.payments[0].cents,12300);
  assert.equal(JSON.stringify([...f.db].filter(([key])=>/^(Stock|NCTTasks|NCTOrders)/.test(key))),before);assert.equal(f.calls.some(call=>call.startsWith('LEGACY_')),false);
 }
});

test('native interrupted Account record resumes same request, pending reads refuse and revoked replay is not authorized', async () => {
  const f = await fixture(); f.request.input.version = (await f.api.getAccountPurchaseOrders('NCT')).orders[0].version; f.interrupt(); let interrupted = false;
  for (let i = 0; i < 20; i++) { const result = await f.send(); if (!result.pending) { assert.equal(result.ok, false); interrupted = true; break; } }
  assert.equal(interrupted, true); assert.ok(f.control().pending); await assert.rejects(f.api.getAccountPurchaseOrders('NCT'), /pending/);
  assert.equal((await f.finish()).stockGeneration, 1); f.member.status = 'PENDING'; await assert.rejects(f.send());
});

test('explicit clean LEGACY alone retains each original settlement/credit/review route, never a current request', async () => {
  const f = await fixture(); f.control().mode = 'LEGACY'; assert.equal((await f.send()).ok, false); assert.deepEqual(copy((await f.api.getAccountPurchaseOrders('NCT')).orders), []);
  assert.equal((await f.api.saveAccountSettlement('NCT', f.request.requestId, f.request.input)).ok, true);
  assert.equal((await f.api.saveAccountSettlement('NCT', f.request.requestId, { action: 'APPLY_CREDIT' })).ok, true);
  assert.equal((await f.api.saveAccountInvoiceCheck('NCT', f.request.requestId, { action: 'INVOICE_CHECK' })).ok, true);
  for (const name of ['LEGACY_SETTLEMENT','LEGACY_CREDIT','LEGACY_REVIEW']) assert.equal(f.calls.filter(call => call === name).length, 1);
});

test('original supplier-credit journal co-writer and Purchase PO record cannot interleave across the shared company barrier', async () => {
  const f = await fixture({ credit: true }), listed = await f.api.getAccountPurchaseOrders('NCT'), source = listed.orders.find(row => row.number === 'PO2'), target = listed.orders.find(row => row.number === 'PO1');
  const input = { action: 'APPLY_CREDIT', id: target.id, version: target.version, sourceId: source.id, sourceVersion: source.version, cents: 4000, reason: 'Original credit' };
  assert.equal((await f.send(input)).pending, true); f.employee.departments = ['PURCHASE','ACCOUNT'];
  const purchase = createCurrentPurchaseOrderRecordSave({ company: 'NCT', store: f.store, protocol: f.protocol,
    coverage: Object.fromEntries(WRITERS.map(writer => [writer, { verified: true, build: 'TEST' }])), authorityDependencies: { ...f.deps,
      readContext: async () => f.authorityContext(), readPurchaseRecords: async () => f.records() } });
  const request = { requestId: '33333333-3333-4333-8333-333333333333', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0, stockIdentity: { staffId: 'A', memberId: 'M' },
    input: { action: 'TERM', id: target.id, version: target.version, termDays: 30, reason: 'Original terms' } };
  await assert.rejects(purchase(request), /pending|another|busy|owned/i);
  await f.finish(input); const current = (await f.api.getAccountPurchaseOrders('NCT')).orders.find(row => row.id === target.id);
  request.stockGeneration = 1; request.input.version = current.version;
  let result; for (let i = 0; i < 25; i++) { result = await purchase(request); if (!result.pending) break; }
  assert.equal(result.stockGeneration, 2); assert.equal(f.db.get('PurchaseOrders:' + target.id).details.audit.at(-1).action, 'PAYMENT_TERM_CHANGED');
  assert.equal(f.rows().find(row => row.id === source.id).finance.supplierCreditCents, 6000); assert.equal((await f.send(input)).stockGeneration, 1);
});
