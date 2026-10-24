const r2ControlIds = new Set(["3567f9546be0625c335b5757aa6d2091","62457682228f2b70f0fea35db30fb807"]);
function r2RequireControl(collection, row) { if (['R2NCTActivity','R2NCTActivity1'].includes(collection) && row && r2ControlIds.has(row._id) && (row.cohort !== 'MASTER_20261024_R2' || !['MAINTENANCE','SHADOW','ACTIVE'].includes(row.mode))) throw Error('Isolated cohort control unavailable; legacy fallback forbidden'); return row; }
import { createHash, randomBytes } from 'crypto';
import { Buffer as StockRuntimeBuffer } from 'buffer';
const Buffer = StockRuntimeBuffer;
// Candidate-only backend runtime. Original gateway authentication and verified
// all-writer coverage are mandatory. No webMethods, SDK elevation or mode switch.
const factories = {
// current-stock-save.cjs sha256:ce797701f3b6105bb4e27b2ddf91e11772fc7498afb662791ff09238992b9406
"current-stock-save.cjs": (load, module) => {
'use strict';

const { evaluateStockAdmission, WRITERS } = load("stock-admission.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
// Server composition boundary. Does not grant roles, verify coverage or implement a
// legacy fallback. Real gateway supplies original department auth and its exact plan.
// Default empty coverage deliberately keeps activation OFF until all writers verified.
function createCurrentStockSave({ company, writer, authenticate, protocol, prepare, coverage = {} }) {
  if (!['NCT', 'GHR'].includes(company) || !WRITERS.includes(writer) || typeof authenticate !== 'function'
    || typeof protocol?.commit !== 'function' || typeof prepare !== 'function') throw Error('Server current-save dependencies required');
  return async request => {
    if (!request || !/^[a-f0-9-]{36}$/i.test(request.requestId || '') || !request.input || typeof request.input !== 'object'
      || Array.isArray(request.input)) throw Error('Valid current stock request required');
    // Reauthorize even if the exact request has already completed. No browser actor,
    // approval, coverage, resume or route field enters the privileged callbacks.
    const actor = await authenticate(company);
    if (typeof actor?.memberId !== 'string' || !actor.memberId) throw Error('Authenticated department member required');
    if(request.stockIdentity!==undefined&&(typeof request.stockIdentity!=='object'||request.stockIdentity===null||Array.isArray(request.stockIdentity)
      ||Object.keys(request.stockIdentity).length!==2||['staffId','memberId'].some(field=>typeof request.stockIdentity[field]!=='string'||!request.stockIdentity[field]||request.stockIdentity[field].length>200)
      ||request.stockIdentity.memberId!==actor.memberId||request.stockIdentity.staffId!==actor.staffId))throw Error('Original stock request identity required');
    // Gateways still check the ORIGINAL role/staff ID. Bind that expected identity
    // into immutable replay digest too: same login with a reissued staff ID must
    // not adopt a plan prepared under its old staff ID. This grants no authority.
    const envelope = copy({ company, writer, input: request.input, stockProtocol: request.stockProtocol,
      stockBuild: request.stockBuild, stockGeneration: request.stockGeneration,...(request.stockIdentity!==undefined?{stockIdentity:request.stockIdentity}:{}) });
    let admittedGeneration;
    const result = await protocol.commit({ requestId: request.requestId, memberId: actor.memberId, input: envelope,
      authorize: operation => {
        const admission = evaluateStockAdmission({ company, writer, control: operation.control, coverage, request: envelope, operation });
        if (admission.route !== 'FENCED_CURRENT') throw Error('Current save requires ACTIVE mode; no legacy or shadow fallback');
        admittedGeneration = admission.generation;
      },
      prepare: async () => {
        const prepared = await prepare({ company, requestId: request.requestId, memberId: actor.memberId, staffId: actor.staffId, input: copy(envelope.input) });
        if (prepared?.memberId !== actor.memberId || prepared.generation !== admittedGeneration || !prepared.plan) throw Error('Prepared authority/generation changed');
        return prepared.plan;
      } });
    if (result?.ok === false && result.pending === true && result.requestId === request.requestId
      && ['BEFORE', 'APPLY', 'VERIFY'].includes(result.phase) && Number.isSafeInteger(result.completedCount)
      && Number.isSafeInteger(result.totalRecords) && result.totalRecords > 0
      && result.completedCount >= 0 && result.completedCount <= result.totalRecords) {
      return { ok: false, pending: true, requestId: request.requestId, phase: result.phase,
        completedCount: result.completedCount, totalRecords: result.totalRecords };
    }
    if (result?.ok !== true || !Number.isSafeInteger(result.generation) || result.generation < 1) throw Error('Current stock result unconfirmed');
    return { ok: true, requestId: request.requestId, stockGeneration: result.generation };
  };
}
module.exports = { createCurrentStockSave };

},
// stock-admission.cjs sha256:b554993a2b33070b1d48e775606b9acf25bd6eb869ee7c297a14cabc48bcd0d0
"stock-admission.cjs": (load, module) => {
'use strict';

const WRITERS = Object.freeze(['RECEIPT', 'ALLOCATION', 'BORROWING', 'SALES_DEMAND', 'PURCHASE_SOURCE', 'PURCHASE_PLAN', 'PURCHASE_TASK',
  'STOCK_EXCEPTION', 'STOCK_RESOLUTION', 'PACKING', 'WAREHOUSE_PREPARATION', 'SHIPMENT', 'ORDER_INTAKE', 'ORDER_UPDATE', 'COST_REFERENCE',
  'MARGIN_REFERENCE', 'SHIPMENT_PLAN', 'QUANTITY_CASE', 'PURCHASE_ORDER_RECORD', 'ACCOUNT_PURCHASE_RECORD']);
// Server construction only. Never accept coverage/mode/company/build from browser.
// Permission checks remain in original authenticated gateways; this grants none.
function createStockAdmission({ company, readControl, coverage = {} }) {
  if (!['NCT', 'GHR'].includes(company) || typeof readControl !== 'function') throw Error('Server stock admission scope required');
  return async ({ writer, request }) => {
    const control = await readControl();
    return evaluateStockAdmission({ company, control, coverage, writer, request });
  };
}
// SERVER ONLY: operation is supplied by the owned protocol callback, never request.
function evaluateStockAdmission({ company, control, coverage = {}, writer, request, operation }) {
    if (!['NCT', 'GHR'].includes(company) || !WRITERS.includes(writer)) throw Error('Unknown inventory writer; activation requires review');
    if (!control || control.company !== company || !control._version || !Number.isSafeInteger(control.generation) || control.generation < 0
      || !['LEGACY', 'SHADOW', 'ACTIVE', 'MAINTENANCE'].includes(control.mode) || control.schemaVersion !== 1) throw Error('Stock mode unavailable; no automatic fallback');
    const replay = operation?.replay === true && Number.isSafeInteger(operation.baseGeneration) && operation.baseGeneration >= 0;
    if (control.pending && (!replay || control.pending.key !== operation.key || control.pending.digest !== operation.digest
      || control.generation !== operation.baseGeneration)) throw Error('Inventory save pending; preserve the same request');
    if (control.mode === 'MAINTENANCE') throw Error('Inventory maintenance; business writes are paused');
    if (control.mode === 'LEGACY') return { route: 'LEGACY', generation: control.generation };
    if (!control.writerBuild || WRITERS.some(name => coverage[name]?.verified !== true || coverage[name].build !== control.writerBuild)) throw Error('Inventory writer coverage incomplete; activation blocked');
    if (request?.stockProtocol !== 1 || request.stockBuild !== control.writerBuild
      || request.stockGeneration !== (replay ? operation.baseGeneration : control.generation)) throw Error('Stock form changed; refresh and review retained input');
    return { route: control.mode === 'ACTIVE' ? 'FENCED_CURRENT' : 'FENCED_SHADOW', generation: control.generation, build: control.writerBuild };
}
module.exports = { WRITERS, createStockAdmission, evaluateStockAdmission };

},
// current-department-saves.cjs sha256:8847110b1afa1a5bdd1f24c138674d8a0e6d79b14a94c360f9848c5282088592
"current-department-saves.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { createWarehouseAuthority } = load("warehouse-authority.cjs");
const { createWarehouseStockReader } = load("warehouse-stock-reader.cjs");
const { createBorrowingAuthority } = load("borrowing-authority.cjs");
const { createBorrowingStockReader } = load("borrowing-stock-reader.cjs");
const { createAllocationAuthority } = load("allocation-authority.cjs");
const { createPurchaseStockPreparation } = load("purchase-stock-preparation.cjs");
const { createQuantityCasePreparation } = load("quantity-case-preparation.cjs");
const { createShortageStockPreparation } = load("shortage-stock-preparation.cjs");
const { hash } = load("commit-proof.cjs");
const { domainCollections } = load("domain-scope.cjs");

function authenticate(deps, requireStaff) {
  if (typeof deps?.readMember !== 'function' || typeof deps?.readStaffRecords !== 'function' || typeof requireStaff !== 'function') throw Error('Original department authentication required');
  return async () => {
    const member = await deps.readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requireStaff(member, []);
    return { ...requireStaff(member, await deps.readStaffRecords()), memberId: member._id };
  };
}
function authorityContext(deps, protocol) {
  if (protocol?.planFormat !== 'SEGMENTED_V2') return deps;
  if (typeof deps?.readCurrentTaskRows !== 'function') throw Error('Private v2 task checkpoint reader required');
  return deps;
}
// Concrete original authority -> current reader -> shared commit composition. No
// legacy writer or new privilege may be supplied through a browser request.
function createCurrentWarehouseReceiptSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  const authorize = authenticate(authorityDependencies, authorityDependencies?.requireWarehouseStaff);
  const authority = createWarehouseAuthority(authorityContext(authorityDependencies, protocol));
  return async request=>{
    let actor;
    const save = createCurrentStockSave({ company, writer: 'RECEIPT', protocol, coverage,
      authenticate: async()=>{actor=await authorize();return actor;},
      prepare: command => createWarehouseStockReader({ company, items, store, protocol, readAuthority: () => authority(command) })() });
    const result=await save(request);
    if(result.ok!==true)return result;
    const id=hash(company,request.requestId,actor.memberId,'WAREHOUSE_RECEIPT');
    const snapshot=await protocol.readSnapshot(()=>store.read(company==='NCT'?'R2NCTActivity':'R2NCTActivity1',id)),event=snapshot.rows;
    if(!event?._version||event._id!==id||event.title!==id||event.company!==company||event.result!=='SAVED'
      ||event.action!=='WAREHOUSE_RECEIPT_SAVED'||event.initiatedByStaffId!==actor.staffId
      ||event.description!==request.input.id||event.details?.company!==company
      ||typeof event.activityTime!=='string'||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Committed Warehouse receipt requires review');
    return {...result,company,poId:event.description,receiptId:id,savedAt:event.activityTime};
  };
}
function createCurrentBorrowingSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  const authorize = authenticate(authorityDependencies, authorityDependencies?.requirePurchaseStaff);
  const authority = createBorrowingAuthority(authorityContext(authorityDependencies, protocol));
  const save = createCurrentStockSave({ company, writer: 'BORROWING', protocol, coverage,
    authenticate: authorize,
    prepare: command => createBorrowingStockReader({ company, items, store, protocol,
      readAuthority: async () => {
        const verified = await authority({ company, requestId: command.requestId, kind: command.input.kind, input: command.input.details });
        // Both identities are server-read. A same-member staff reissue between
        // admission and PO authority must not stage approval under another staff.
        if (verified.event?.initiatedByStaffId !== command.staffId) throw Error('Borrowing approval identity changed');
        return verified;
      } })() });
  return request => {
    if (!request || !['APPROVE', 'RETURN'].includes(request.kind)) throw Error('Purchase borrowing action required');
    return save({ requestId: request.requestId, stockProtocol: request.stockProtocol, stockBuild: request.stockBuild,
      stockGeneration: request.stockGeneration, stockIdentity: request.stockIdentity, input: { kind: request.kind, details: request.input } });
  };
}
function createCurrentAllocationSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  const authorize = authenticate(authorityDependencies, authorityDependencies?.requirePurchaseStaff);
  const authority = createAllocationAuthority({ ...authorityContext(authorityDependencies, protocol), currentPlan: protocol?.planFormat === 'SEGMENTED_V2' });
  return createCurrentStockSave({ company, writer: 'ALLOCATION', protocol, coverage, authenticate: authorize,
    prepare: command => createBorrowingStockReader({ company, items, store, protocol, readAuthority: () => authority(command) })() });
}
function createCurrentPurchaseSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  if (protocol?.planFormat !== 'SEGMENTED_V2') throw Error('Current Purchase v2 protocol required');
  const authorize = authenticate(authorityDependencies, authorityDependencies?.requirePurchaseStaff);
  const prepare = createPurchaseStockPreparation({ ...authorityContext(authorityDependencies, protocol), company, items, store, protocol });
  return async request => {
    const writer = request?.operation === 'ADD_SOURCE' ? 'PURCHASE_SOURCE' : request?.operation === 'PLAN' ? 'PURCHASE_PLAN'
      : ['EDIT', 'PO', 'AVERAGE_COST', 'QTY'].includes(request?.operation) ? 'PURCHASE_TASK' : null;
    if (!writer) throw Error('Supported current Purchase operation required');
    let actor;
    const result = await createCurrentStockSave({ company, writer, protocol, coverage, authenticate: async () => {
      actor = await authorize();
      // Replays also retain the ORIGINAL operation-specific grant, not merely
      // general Purchase access after a role downgrade.
      if (request.operation === 'QTY' && actor.role !== 'SUPER ADMIN') throw Error('Only Super Admin may change customer demand.');
      return actor;
    },
      prepare: command => prepare({ company, requestId: command.requestId, staffId: command.staffId, operation: command.input.operation, input: command.input.details }) })({
      requestId: request.requestId, stockProtocol: request.stockProtocol, stockBuild: request.stockBuild,
      stockGeneration: request.stockGeneration, stockIdentity: request.stockIdentity, input: { operation: request.operation, details: request.input } });
    if (result.ok !== true) return result;
    if (request.operation === 'EDIT' && request.input.displayRows !== undefined) {
      const id = authorityDependencies.operationId(company,request.requestId,actor.memberId,'PURCHASE_DISPLAY_ORDER');
      const receipt = await protocol.readSnapshot(() => store.read(company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1',id)), event = receipt.rows;
      const taskIds = [...new Set([...request.input.taskIds,...request.input.edits.map(row => row.taskId)])];
      if (!event?._version || event._id !== id || event.title !== id || event.company !== company || event.result !== 'SAVED'
        || event.action !== 'PURCHASE_DISPLAY_ORDER_SAVED' || event.initiatedByStaffId !== actor.staffId || event.details?.schema !== 2
        || event.details.displayOrder?.customerId !== request.input.customerId
        || JSON.stringify(event.details.displayOrder.rows) !== JSON.stringify(request.input.displayRows)
        || !Array.isArray(event.details.taskIds) || new Set(event.details.taskIds).size !== taskIds.length
        || event.details.taskIds.some(id => !taskIds.includes(id))) throw Error('Committed combined Purchase display receipt requires review');
      return { ...result, company, operation: 'EDIT', savedAt: event.activityTime, taskIds: [...event.details.taskIds] };
    }
    if (request.operation === 'QTY') {
      // Original QTY reduces the procurement commitment, NOT the Sales requested
      // demand. Keep its original Super Admin validator and immutable stock guards.
      const id = authorityDependencies.operationId(company, request.requestId, actor.memberId, request.input.taskId, 'PURCHASE_QTY_REDUCED');
      const receipt = await protocol.readSnapshot(() => store.read(company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', id));
      const event = receipt.rows;
      if (!event?._version || event._id !== id || event.title !== id || event.company !== company || event.result !== 'SAVED'
        || event.action !== 'PURCHASE_QTY_REDUCED' || event.imageAltText !== request.input.taskId
        || event.initiatedByStaffId !== actor.staffId || event.details?.authorizedRole !== 'SUPER ADMIN'
        || event.details.after !== request.input.quantity) throw Error('Committed original Purchase quantity receipt requires review');
      return { ...result, company, operation: 'QTY', savedAt: event.activityTime, taskIds: [request.input.taskId] };
    }
    if (request.operation !== 'ADD_SOURCE') return result;
    // Preserve the ORIGINAL supplier-dialog receipt contract. A deterministic ID
    // is not enough: confirm its real committed source row under the read barrier.
    const sourceTaskId = authorityDependencies.operationId(company, request.requestId, actor.memberId, 'PURCHASE_SOURCE');
    const [, tasks] = domainCollections(company);
    await protocol.readSnapshot(async () => {
      const row = await store.read(tasks, sourceTaskId);
      if (!row || row._id !== sourceTaskId || row.company !== company || row.title !== sourceTaskId
        || row.procurementSource !== true || row.customerDemandTaskId !== request.input.parentTaskId || !row._version) throw Error('Committed Purchase source receipt requires review');
    });
    return { ...result, company, sourceTaskId, parentTaskId: request.input.parentTaskId };
  };
}
function createCurrentQuantityCaseSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  if (protocol?.planFormat !== 'SEGMENTED_V2') throw Error('Current quantity v2 protocol required');
  const authorize = authenticate(authorityDependencies, authorityDependencies?.requirePurchaseStaff);
  const prepare = createQuantityCasePreparation({ ...authorityContext(authorityDependencies, protocol), company, items, store, protocol });
  return async request => {
    let actor;
    const result = await createCurrentStockSave({ company, writer: 'QUANTITY_CASE', protocol, coverage,
      authenticate: async () => { actor = await authorize(); return actor; },
      prepare: command => prepare({ company, requestId: command.requestId, staffId: command.staffId, input: command.input }) })(request);
    if (result.ok !== true) return result;
    const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
    const receipt = await protocol.readSnapshot(() => store.read(journal, hash(company, request.requestId, actor.memberId, 'QUANTITY_CASE_DECISION')));
    const event = receipt.rows;
    if (!event?._version || event.company !== company || event._id !== event.title || event.result !== 'SAVED'
      || event.action !== 'PURCHASE_QUANTITY_CASE_DECIDED' || event.initiatedByStaffId !== actor.staffId
      || event.details?.caseId !== request.input.id) throw Error('Committed quantity decision receipt requires review');
    return { ...result, company, caseId: event.details.caseId };
  };
}
function createCurrentShortageSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  if (protocol?.planFormat !== 'SEGMENTED_V2') throw Error('Current shortage v2 protocol required');
  const authorize = authenticate(authorityDependencies, authorityDependencies?.requirePurchaseStaff);
  const prepare = createShortageStockPreparation({ ...authorityContext(authorityDependencies, protocol), company, items, store, protocol });
  return async request => {
    let actor;
    const result = await createCurrentStockSave({ company, writer: 'QUANTITY_CASE', protocol, coverage,
      authenticate: async () => { actor = await authorize(); return actor; },
      prepare: command => prepare({ company, requestId: command.requestId, staffId: command.staffId, input: command.input }) })(request);
    if (result.ok !== true) return result;
    const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
    const receipt = await protocol.readSnapshot(() => store.read(journal, hash(company, request.requestId, actor.memberId, 'SHORTAGE')));
    const event = receipt.rows;
    if (!event?._version || event.company !== company || event._id !== event.title || event.result !== 'SAVED'
      || event.action !== 'PURCHASE_SHORTAGE_DECIDED' || event.initiatedByStaffId !== actor.staffId
      || event.imageAltText !== request.input.taskId) throw Error('Committed shortage decision receipt requires review');
    return { ...result, company, taskId: event.imageAltText, savedAt: event.activityTime };
  };
}
module.exports = { createCurrentWarehouseReceiptSave, createCurrentBorrowingSave, createCurrentAllocationSave, createCurrentPurchaseSave, createCurrentQuantityCaseSave, createCurrentShortageSave };

},
// warehouse-authority.cjs sha256:a8595c9c5616fe9b85e1a498c92550175c27ea683dfa7563d99f9e54d3e19d4b
"warehouse-authority.cjs": (load, module) => {
'use strict';

const { stockKey } = load("current-model.cjs");
const { originalProductState } = load("original-product-state.cjs");
const { validateOriginalReceipt } = load("original-receipt-validation.cjs");
// Server-only authority preparation. Caller must execute this INSIDE readSnapshot
// and recheck expectedVersion under the fenced lock before committing its plan.
function createWarehouseAuthority({ readMember, readStaffRecords, requireWarehouseStaff, readContext, readPurchaseRecords,
  projectPurchaseOrders, projectWarehouseOrders, createWarehouseOperations,
  readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation, readCurrentTaskRows, now = () => new Date() }) {
  for (const fn of [readMember, readStaffRecords, requireWarehouseStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, projectWarehouseOrders, createWarehouseOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld]) {
    if (typeof fn !== 'function') throw Error('Existing Warehouse authority dependency required');
  }
  return async ({ company, requestId, input, staffId: admittedStaffId }) => {
    if (!['NCT', 'GHR'].includes(company) || !/^[a-f0-9-]{36}$/i.test(requestId || '')
      || !input || !['RECEIVE', 'CORRECT'].includes(input.action)) throw Error('Valid Warehouse receipt request required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requireWarehouseStaff(member, []);
    const staff = { ...requireWarehouseStaff(member, await readStaffRecords()), memberId: member._id };
    // Private current-save command carries its server-read admission identity;
    // browser input cannot supply or overwrite this top-level preparation field.
    if (admittedStaffId !== undefined && staff.staffId !== admittedStaffId) throw Error('Warehouse receipt identity changed');
    const context = await readContext(company, staff);
    if (context.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
      || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Authoritative company context required');
    const records = await readPurchaseRecords(company, staff);
    const purchaseOrders = projectPurchaseOrders({ company, workspace: context, records });
    const orders = projectWarehouseOrders({ company, purchaseOrders, tasks: context.tasks, activity: context.activity });
    const validated = await validateOriginalReceipt({ createWarehouseOperations, company, staff, requestId,
      input, orders, activity: context.activity, now });
    const products = new Map();
    for (const line of validated.event.details.lines) {
      const task = context.tasks.find(t => t.id === line.taskId);
      if (!task) throw Error('Receipt source unavailable');
      const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea }, key = stockKey(identity);
      if (!products.has(key)) products.set(key, originalProductState({ company, context, orders: purchaseOrders, identity,
        readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation }));
      const source = products.get(key).sources.find(s => s.id === line.taskId);
      if (!source || source.poId !== validated.event.description || source.accepted !== line.beforeAccepted
        || source.planned !== line.planned) throw Error('Original receipt and source authority differ');
    }
    return { kind: 'RECEIVE', memberId: member._id, validated,
      readTaskRows: typeof readCurrentTaskRows === 'function' ? ids => readCurrentTaskRows(company, ids, staff) : null,
      products: [...products.values()].map(p => {
        const lines = validated.event.details.lines.filter(line => p.sources.some(s => s.id === line.taskId));
        return { identity: p.identity, buildState: p.buildState, scopeTaskIds: p.scopeTaskIds,
          readTaskRows: typeof readCurrentTaskRows === 'function' ? rows => readCurrentTaskRows(company, p.scopeTaskIds(rows), staff) : null, stockScope: {
          sourceTaskIds: lines.map(line => line.taskId),
          correctionSourceIds: lines.filter(line => line.kind === 'CORRECTION' && line.accepted < line.beforeAccepted).map(line => line.taskId),
          claimPairs: lines.flatMap(line => { const source = p.sources.find(s => s.id === line.taskId);
            return source.ownerTaskId ? [{ sourceTaskId: source.id, taskId: source.ownerTaskId }] : []; }) } };
      }) };
  };
}
module.exports = { createWarehouseAuthority };

},
// current-model.cjs sha256:4592c6af36e4804e7fee0ba19be83d546c6fd84d7d52b9bcf30810210c8cca6f
"current-model.cjs": (load, module) => {
'use strict';

// Pure candidate model. No history reads, CMS mutations, routes or production imports.
const { hash } = load("commit-proof.cjs");
const count = value => Number.isSafeInteger(value) && value >= 0;
const nullableCount = value => value === null || count(value);
function total(rows, field) {
  let result = 0;
  for (const row of rows) {
    if (row[field] === null) return null;
    result += row[field];
    if (!count(result)) throw Error('Quantity overflow');
  }
  return result;
}
function stockKey({ company, barcode, packing, ea }) {
  if (!['NCT', 'GHR'].includes(company) || typeof barcode !== 'string' || !barcode
    || typeof packing !== 'string' || !packing || !Number.isSafeInteger(ea) || ea <= 0) throw Error('Product identity required');
  return JSON.stringify([company, barcode, packing, ea]);
}

// Converts ONE existing complete projection during migration/shadow validation only.
// The caller must supply company-scoped tasks and an already authenticated snapshot.
function convertProjectedStock({ snapshot, tasks, generation }) {
  if (!snapshot || !['NCT', 'GHR'].includes(snapshot.company) || !Array.isArray(snapshot.items)
    || !Array.isArray(tasks) || !count(generation)) throw Error('Complete stock snapshot required');
  const company = snapshot.company, taskMap = new Map();
  for (const task of tasks) {
    if (!task.id || taskMap.has(task.id) || task.company && task.company !== company) throw Error('Task identity conflict');
    taskMap.set(task.id, task);
  }
  const positions = [], claims = [], products = [], seenSources = new Set(), seenProducts = new Set();
  for (const item of snapshot.items) {
    if (item.company !== company || !Array.isArray(item.sources)) throw Error('Product company conflict');
    const key = stockKey(item);
    if (seenProducts.has(key)) throw Error('Duplicate product');
    seenProducts.add(key);
    const group = [];
    for (const source of item.sources) {
      const task = taskMap.get(source.sourceTaskId);
      if (!task || seenSources.has(task.id) || stockKey({ ...task, company }) !== key
        || !Array.isArray(source.reservations) || !Array.isArray(source.issues)) throw Error('Source identity conflict');
      if (typeof task.poId !== 'string' || !task.poId) throw Error('Resolved purchase order ID required');
      seenSources.add(task.id);
      for (const field of ['onHand', 'isolated', 'reservedUsable', 'available']) {
        if (!nullableCount(source[field])) throw Error('Invalid current quantity');
      }
      if (![source.received, source.replacementReceived, source.dispatched, source.returned].every(count)) throw Error('Cumulative source basis required');
      if (count(source.onHand) && source.onHand + source.dispatched + source.returned !== source.received + source.replacementReceived) throw Error('Physical source movement conflict');
      if ([source.onHand, source.isolated, source.reservedUsable, source.available].every(count)
        && source.onHand !== source.isolated + source.reservedUsable + source.available) throw Error('Physical balance conflict');
      const positionId = hash(company, key, 'PURCHASE_SOURCE', task.id);
      const issueCodes = [...new Set(source.issues)], targets = new Set();
      const reservationTotal = total(source.reservations, 'remaining');
      const exactClaims = count(source.reservedUsable) && reservationTotal === source.reservedUsable;
      const unknownIsolatedOwner = source.isolated !== 0 && source.reservations.length > 0;
      if (!exactClaims && source.reservations.length) issueCodes.push('CLAIM_USABLE_ATTRIBUTION_REQUIRES_REVIEW');
      if (unknownIsolatedOwner) issueCodes.push('ISOLATED_CLAIM_ATTRIBUTION_REQUIRES_REVIEW');
      for (const reservation of source.reservations) {
        const target = taskMap.get(reservation.taskId);
        if (!target || targets.has(target.id) || stockKey({ ...target, company }) !== key
          || !count(reservation.remaining) || !target.customerId) throw Error('Claim identity conflict');
        targets.add(target.id);
        claims.push({ _id: hash(company, positionId, target.id), schemaVersion: 1, company,
          stockKey: key, positionId, taskId: target.id, customerId: target.customerId,
          orderId: target.orderId || '', sourceLineId: target.sourceLineId || '',
          reservedUsable: exactClaims ? reservation.remaining : null,
          // Existing projection does not identify whose quarantined cartons these are.
          isolatedAttributed: source.isolated === 0 ? 0 : null,
          reviewCodes: [...(!exactClaims ? ['CLAIM_USABLE_ATTRIBUTION_REQUIRES_REVIEW'] : []),
            ...(unknownIsolatedOwner ? ['ISOLATED_CLAIM_ATTRIBUTION_REQUIRES_REVIEW'] : [])],
          revision: 0, checkpointGeneration: generation, status: exactClaims && reservation.remaining === 0 ? 'CLOSED' : 'ACTIVE' });
      }
      if (!source.reservations.length && source.reservedUsable !== 0 && source.reservedUsable !== null) throw Error('Missing ownership claims');
      const position = { _id: positionId, schemaVersion: 1, company, stockKey: key,
        barcode: item.barcode, name: item.name || '', packing: item.packing, ea: item.ea,
        sourceKind: 'PURCHASE_SOURCE', sourceId: task.id, sourceTaskId: task.id, poId: task.poId, poNumber: source.po || '',
        receiptAccepted: source.received, replacementReceived: source.replacementReceived, supplierReturned: source.returned, dispatched: source.dispatched,
        onHand: source.onHand, isolated: source.isolated, reservedUsable: source.reservedUsable,
        available: source.available, reviewCodes: [...new Set(issueCodes)], revision: 0,
        checkpointGeneration: generation,
        status: source.onHand === 0 && !issueCodes.length && reservationTotal === 0 ? 'CLOSED' : 'ACTIVE' };
      positions.push(position); group.push(position);
    }
    if (!group.length) continue;
    const summary = { _id: hash(company, key), schemaVersion: 1, company, stockKey: key,
      barcode: item.barcode, name: item.name || '', packing: item.packing, ea: item.ea,
      onHand: total(group, 'onHand'), isolated: total(group, 'isolated'),
      reservedUsable: total(group, 'reservedUsable'), available: total(group, 'available'),
      reviewRequired: group.some(row => row.reviewCodes.length > 0), revision: 0, checkpointGeneration: generation,
      status: group.every(row => row.status === 'CLOSED') ? 'CLOSED' : 'ACTIVE' };
    for (const field of ['onHand', 'isolated', 'reservedUsable', 'available']) {
      if (summary[field] !== item[field]) throw Error('Projection summary mismatch: ' + field);
    }
    products.push(summary);
  }
  return { company, generation, positions, claims, products,
    activationReady: !products.some(row => row.reviewRequired) };
}

// Repository must filter/sort/page R2StockProducts BEFORE returning rows; no Activity API.
async function readProductPage({ protocol, repository, company, page = 0, pageSize = 50, search = '' }) {
  if (!['NCT', 'GHR'].includes(company) || !count(page) || !count(pageSize) || !pageSize || pageSize > 100
    || typeof search !== 'string' || search.length > 120 || !count(page * pageSize)) throw Error('Invalid stock page');
  return protocol.readSnapshot(async () => {
    const result = await repository.queryProducts({ company, page, pageSize, search, status: 'ACTIVE',
      consistentRead: true, order: ['barcode', '_id'] });
    if (!Array.isArray(result?.items) || result.items.length > pageSize || !count(result.totalCount)
      || result.items.some(row => row.company !== company || row.status !== 'ACTIVE')) throw Error('Invalid product page');
    return result;
  });
}

module.exports = { stockKey, convertProjectedStock, readProductPage };

},
// commit-proof.cjs sha256:a31669b2154ee07fa2793274cd8ef829cf21db135a4d678684ef3f219d8af7dd
"commit-proof.cjs": (load, module) => {
module.exports = { hash: (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32) };
},
// original-product-state.cjs sha256:c4623ab91a9b23ad891ae124b26997901b4fa773d50d56240916db69a7fe99cc
"original-product-state.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const { stockKey } = load("current-model.cjs");
const { createPackingHoldSnapshot } = load("packing-hold-snapshot.cjs");
const { legacyPreparationGuard } = load("legacy-preparation-guard.cjs");
const { currentTaskContext } = load("current-task-context.cjs");
const clone = value => JSON.parse(JSON.stringify(value));
const count = value => Number.isSafeInteger(value) && value >= 0;
// Server-owned ORIGINAL facts plus exact current ownership rows. Shared by Purchase
// and Warehouse candidates, NOT a new staff entitlement or a legacy inc fallback.
function originalProductState({ company, context, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation }) {
  const key = stockKey(identity);
  if (identity.company !== company || context.company !== company || !Array.isArray(context.tasks)
    || !Array.isArray(context.activity) || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Authoritative company context required');
  const matching = context.tasks.filter(t => t.barcode === identity.barcode && t.packing === identity.packing && t.ea === identity.ea);
  if (matching.some(t => t.company && t.company !== company)) throw Error('Source company conflict');
  const demands = matching.filter(t => !t.procurementSource && !t.specialPurchase);
  const name = matching.find(t => typeof t.name === 'string' && t.name.trim())?.name || '';
  const candidates = matching.filter(t => t.po && t.procurement?.totalCtn > 0);
  const allocations = readAllocations(context.activity), shipments = readCustomerShipments(context.activity);
  if (shipments.some(s => s.company !== company)) throw Error('Shipment company conflict');
  const sources = candidates.map(source => {
    // ORIGINAL projector emits an explicit fixed customerCtn when shares exist.
    // Ordinary PO plans instead expose its already-computed expectedExtra. This
    // is the same original source/customer split, not a history/zero guess. An
    // explicitly unknown fixed share remains unknown and must still refuse.
    const customerShare=Object.hasOwn(source.procurement,'customerCtn')?source.procurement.customerCtn:
      count(source.procurement.expectedExtra)&&source.procurement.expectedExtra<=source.procurement.totalCtn
        ?source.procurement.totalCtn-source.procurement.expectedExtra:null;
    const po = orders.filter(p => p.company === company && p.taskIds.includes(source.id));
    const candidateOwner = source.customerDemandTaskId || source.id;
    const ownerTaskId = demands.some(t => t.id === candidateOwner) ? candidateOwner : null;
    if (po.length !== 1 || po[0].number !== source.po || source.procurement.draftPlan
      || ownerTaskId === null && customerShare !== 0 || !count(customerShare)
      || customerShare > source.procurement.totalCtn
      || source.warehouse && source.warehouse.hasPhysicalReceipt !== true && source.warehouse.accepted > 0) throw Error('Confirmed source PO and customer share required');
    const dispatchedByTask = {};
    for (const shipment of shipments.filter(s => s.status === 'DISPATCHED')) for (const line of shipment.lines) {
      const n = line.sources.find(s => s.sourceTaskId === source.id)?.quantity || 0;
      if (n) dispatchedByTask[line.taskId] = (dispatchedByTask[line.taskId] || 0) + n;
    }
    return { ...identity, id: source.id, ownerTaskId, poId: po[0].id, poNumber: po[0].number, orderId: source.orderId, sourceLineId: source.sourceLineId,
      poValid: true, reviewRequired: false, receiptPolicy: ownerTaskId === null || allocations.some(a => a.sourceTaskId === source.id) ? 'EXPLICIT_ONLY' : 'OWNER_DEMAND',
      ownerShare: customerShare, planned: source.procurement.totalCtn,
      accepted: source.warehouse?.hasPhysicalReceipt === true ? source.warehouse.accepted : 0, dispatchedByTask };
  });
  const holds = createPackingHoldSnapshot({ readPackingLists, packingHeld })({ company, activity: context.activity, taskIds: demands.map(t => t.id) });
  const legacyHeld = shipments.filter(s => ['REQUESTED', 'INVOICED'].includes(s.status));
  for (const shipment of legacyHeld) for (const line of shipment.lines) if (Object.hasOwn(holds.heldByTask, line.taskId)) holds.heldByTask[line.taskId] += line.quantity;
  const legacy = legacyPreparationGuard({ company, context, taskIds: demands.map(t => t.id), readPreparation, projectPreparation });
  holds.legacyBlockedByTask = legacy.blockedByTask;
  holds.version = hash(holds.version, legacyHeld.map(s => [s.id, s.revision]).sort((a, b) => a[0].localeCompare(b[0])), legacy.version);
  const scopeTaskIds = rows => {
    if (!Array.isArray(rows.sourceTaskIds) || !Array.isArray(rows.claims) || !Array.isArray(rows.transfers)) throw Error('Complete operational task scope required');
    return [...new Set([...(rows.demandTaskIds || []), ...sources.filter(s => rows.sourceTaskIds.includes(s.id)).map(s => s.ownerTaskId).filter(Boolean),
      ...rows.claims.map(c => c.taskId), ...rows.transfers.flatMap(r => [r.details.relation.borrowerTaskId, r.details.relation.lenderTaskId])])];
  };
  return { identity, demands, sources, scopeTaskIds, buildState: rows => {
    if (rows.product?.lifecycleVersion != null && rows.product.lifecycleVersion !== 2) throw Error('Unknown product lifecycle checkpoint');
    const currentLifecycle = rows.product?.lifecycleVersion === 2;
    const scoped = rows.scope === 'CURRENT_ACTIVE_PRODUCT';
    if (scoped && (!currentLifecycle || !Array.isArray(rows.sourceTaskIds))) throw Error('Scoped lifecycle checkpoint required');
    const positions = new Map(rows.positions.map(p => [p.sourceTaskId, p]));
    const selectedSources = scoped ? sources.filter(s => rows.sourceTaskIds.includes(s.id)) : sources;
    if (scoped && rows.sourceTaskIds.some(id => !selectedSources.some(s => s.id === id))) throw Error('Current source authority missing');
    const neededTasks = new Set(scoped ? scopeTaskIds(rows) : []);
    let selectedDemands = scoped ? demands.filter(t => neededTasks.has(t.id)) : demands;
    if (scoped && [...neededTasks].some(id => !selectedDemands.some(t => t.id === id))) throw Error('Current demand authority missing');
    if (scoped) selectedDemands = currentTaskContext({ company, context: { company, tasks: selectedDemands },
      taskRows: rows.taskRows, generation: rows.generation }).tasks;
    const currentDispatched = source => Object.fromEntries(rows.claims.filter(c => c.positionId === hash(company, key, 'PURCHASE_SOURCE', source.id))
      .filter(c => c.dispatchedCumulative > 0).map(c => [c.taskId, c.dispatchedCumulative]));
    const selected = selectedSources.map(s => scoped ? { ...s, dispatchedByTask: currentDispatched(s) } : s);
    const tasks = selectedDemands.map(t => {
      const inScope = selected.reduce((n, s) => n + (s.dispatchedByTask[t.id] || 0), 0);
      if (scoped && (t.stockCounterSchema !== 2 || !t.stockCommitVersion || !count(t.stockDispatchedCumulative)
        || t.stockDispatchedCumulative < inScope)) throw Error('Current task dispatch checkpoint required');
      return { ...identity, id: t.id, customerId: t.customerId, orderId: t.orderId, sourceLineId: t.sourceLineId,
        requested: t.requested ?? t.ord, dispatched: scoped ? t.stockDispatchedCumulative : inScope,
        ...(scoped ? { dispatchedOutsideScope: t.stockDispatchedCumulative - inScope } : {}) };
    });
    const selectedHolds = scoped ? { ...holds,
      heldByTask: Object.fromEntries(tasks.map(t => [t.id, holds.heldByTask[t.id]])),
      legacyBlockedByTask: Object.fromEntries(tasks.map(t => [t.id, holds.legacyBlockedByTask[t.id]])) } : holds;
    return { ...identity, name: rows.product?.name || name, complete: true, revision: rows.product?.revision || 0, tasks, packingHolds: selectedHolds,
      ...(scoped ? { scope: 'CURRENT_ACTIVE_PRODUCT' } : {}),
      ...(currentLifecycle ? { lifecycleVersion: 2, nextBorrowSequence: rows.product.nextBorrowSequence } : {}),
      sources: selected.map(s => {
        const p = positions.get(s.id), claims = {}, isolatedClaims = {};
        for (const c of rows.claims.filter(c => c.positionId === hash(company, key, 'PURCHASE_SOURCE', s.id))) {
          if (Object.hasOwn(claims, c.taskId) || !count(c.reservedUsable) || !count(c.isolatedAttributed)) throw Error('Known unique current claims required');
          claims[c.taskId] = c.reservedUsable;
          if (c.isolatedAttributed > 0) isolatedClaims[c.taskId] = c.isolatedAttributed;
        }
        return { ...s, replacementReceived: p?.replacementReceived ?? 0, supplierReturned: p?.supplierReturned ?? 0,
          ...(currentLifecycle ? { borrowRepaidCumulative: p ? p.borrowRepaidCumulative : 0 } : {}),
          onHand: p?.onHand ?? 0, isolated: p?.isolated ?? 0, available: p?.available ?? 0, claims,
          ...(Object.keys(isolatedClaims).length ? { isolatedClaims } : {}) };
      }), relations: rows.transfers.map(r => clone(r.details.relation)) };
  } };
}
module.exports = { originalProductState };

},
// packing-hold-snapshot.cjs sha256:9ea74ca229d6761cfe66274b3b9ae496895c40ec531be63901354cc9c0d02076
"packing-hold-snapshot.cjs": (load, module) => {
'use strict';

// Reuses the existing validated list parser and packingHeld implementation.
// Server-owned context only; no query, storage, source split or new authorization.
const { hash } = load("commit-proof.cjs");
function createPackingHoldSnapshot({ readPackingLists, packingHeld }) {
  if (typeof readPackingLists !== 'function' || typeof packingHeld !== 'function') throw Error('Existing packing readers required');
  return ({ company, activity, taskIds }) => {
    if (!['NCT', 'GHR'].includes(company) || !Array.isArray(activity) || !Array.isArray(taskIds)
      || taskIds.some(id => typeof id !== 'string' || !id) || new Set(taskIds).size !== taskIds.length) throw Error('Server packing context required');
    const lists = readPackingLists(activity, company);
    const heldByTask = Object.fromEntries(taskIds.map(taskId => {
      let held = 0;
      for (const list of lists) {
        const quantity = packingHeld(list, taskId);
        if (!Number.isSafeInteger(quantity) || quantity < 0) throw Error('Packing quantity requires review');
        held += quantity;
        if (!Number.isSafeInteger(held)) throw Error('Packing hold overflow');
      }
      return [taskId, held];
    }));
    return { company, complete: true, scope: 'TASK_TOTAL', heldByTask,
      version: hash(company, lists.map(list => [list.id, list.revision]).sort((a, b) => a[0].localeCompare(b[0]))) };
  };
}
module.exports = { createPackingHoldSnapshot };

},
// legacy-preparation-guard.cjs sha256:f9a98044465b7631ad15fb28d64949e45c082615c8dd341185e991661f27e8b2
"legacy-preparation-guard.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
// Old preparation and old invoices may refer to the SAME cartons, but have no
// stable cross-reference. Never sum them into a second invented quantity hold.
// Keep a conservative task guard for ownership changes, independent of invoice
// quantities; actual invoice dispatch and ordinary receipts remain permitted.
function legacyPreparationGuard({ company, context, taskIds, readPreparation, projectPreparation }) {
  const blockedByTask = Object.fromEntries(taskIds.map(id => [id, false]));
  if (!context.activity.some(e => e.action === 'WAREHOUSE_PREPARATION_SAVED' && e.result === 'SAVED')) return { blockedByTask, version: hash([]) };
  if (typeof readPreparation !== 'function') throw Error('Original legacy preparation parser required; ownership changes stay blocked');
  const states = readPreparation(context.activity);
  if (!states || typeof states.values !== 'function' || typeof states.get !== 'function') throw Error('Original legacy preparation states required');
  const versions = [], projected = typeof projectPreparation === 'function' ? projectPreparation(context) : [];
  for (const state of states.values()) {
    if (state.company !== company || typeof state.prepared !== 'boolean' || !Number.isSafeInteger(state.loaded) || state.loaded < 0) throw Error('Legacy preparation facts require review');
    if (!Object.hasOwn(blockedByTask, state.taskId)) continue;
    const matches = projected.filter(row => row.id === state.id);
    const row = matches.length === 1 ? matches[0] : null;
    // Retire only through ORIGINAL batch identity/signature and dispatched range,
    // never age or task-wide shipped totals that might belong to another batch.
    const retired = !!row && !row.stale && !row.orphaned && row.signature === state.signature
      && row.quantity === state.quantity && Number.isSafeInteger(row.dispatched) && row.dispatched >= state.quantity;
    blockedByTask[state.taskId] ||= !retired && (state.prepared || state.loaded > 0);
    versions.push([state.id, state.revision, state.prepared, state.loaded, retired, row?.dispatched ?? null]);
  }
  return { blockedByTask, version: hash(versions.sort((a, b) => a[0].localeCompare(b[0]))) };
}
module.exports = { legacyPreparationGuard };

},
// current-task-context.cjs sha256:7a6848802ea5868beed0001d5fd6deff0e2517929f82027196062f037c9a9f72
"current-task-context.cjs": (load, module) => {
'use strict';

const { copy } = load("segmented-plan.cjs");
const count = n => Number.isSafeInteger(n) && n >= 0;
// Original projection remains business authority. Add ONLY exact migrated/current
// task counters which that legacy projection does not expose. No history fallback.
function currentTaskContext({ company, context, taskRows, generation }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks)
    || !Array.isArray(taskRows) || !count(generation)) throw Error('Private current task context required');
  const rows = new Map(taskRows.map(row => [row._id, row]));
  if (rows.size !== taskRows.length || rows.size !== context.tasks.length
    || new Set(context.tasks.map(task => task.id)).size !== context.tasks.length) throw Error('Complete exact current task reads required');
  return { ...copy(context), tasks: context.tasks.map(task => {
    const row = rows.get(task.id), version = row?._version || row?.stockCommitVersion;
    if (!row || row.company !== company || typeof version !== 'string' || !version
      || row._version && row.stockCommitVersion && row._version !== row.stockCommitVersion
      || row.stockCounterSchema !== 2 || !count(row.stockDispatchedCumulative) || !count(row.stockCounterGeneration)
      || row.stockCounterGeneration > generation || row.description !== task.orderId || row.imageAltText !== task.sourceLineId) throw Error('Current task checkpoint missing or changed');
    return { ...copy(task), stockCounterSchema: 2, stockDispatchedCumulative: row.stockDispatchedCumulative,
      stockCounterGeneration: row.stockCounterGeneration, stockCommitVersion: version };
  }) };
}
module.exports = { currentTaskContext };

},
// segmented-plan.cjs sha256:e894fb98e045ce42b513ecc5a195bc0953d0e63ecc7e0403a078cc4dbd58f2ab
"segmented-plan.cjs": (load, module) => {
'use strict';

// Candidate only. Budgets are server policy, NOT measured Wix production capacity.
// No storage, endpoint, permission or business mutation is performed by this codec.
const { hash } = load("commit-proof.cjs");
const { planCollections } = load("domain-scope.cjs");
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const stringify = value => JSON.stringify(canonical(value));
const same = (a, b) => stringify(a) === stringify(b);
const copy = value => JSON.parse(JSON.stringify(value));
// Works in the generated backend without Node Buffer or a browser TextEncoder.
function utf8Bytes(value) {
  let bytes = 0;
  for (const character of value) {
    const cp = character.codePointAt(0);
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}
function assertJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') throw Error('Plain JSON plan required');
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== null && (Object.getPrototypeOf(proto) !== null
    || Object.getOwnPropertyDescriptor(proto, 'constructor')?.value?.name !== 'Object')) throw Error('Plain JSON plan required');
  for (const key of Object.keys(value)) assertJson(value[key]);
}
function createSegmentedPlanCodec({ company, domainWrites = false, recordBudgetBytes = 64000,
  maxPlanBytes = 8 * 1024 * 1024, maxWrites = 10000, maxFragments = 256 }) {
  if (!['NCT', 'GHR'].includes(company)) throw Error('Known company required');
  for (const value of [recordBudgetBytes, maxPlanBytes, maxWrites, maxFragments]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw Error('Positive codec policy required');
  }
  if (recordBudgetBytes < 2048 || recordBudgetBytes > 256000) throw Error('Conservative record budget required');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const scope = company + '/PURCHASE', lockId = hash(scope, 'LOCK'), controlId = hash(company, 'STOCK_CONTROL');
  const allowed = new Set(planCollections(company, domainWrites));
  const fragmentId = (key, attempt, index) => hash(key, 'PLAN_FRAGMENT', attempt, index);
  function normalize(plan, key, reserved = []) {
    assertJson(plan);
    if (!Array.isArray(plan?.writes) || !plan.writes.length || plan.writes.length > maxWrites) throw Error('Segmented plan write policy');
    const normalized = copy(plan), identities = new Set();
    const protectedIds = new Set([lockId, controlId, key, hash(key, 'RESULT'), ...reserved]);
    for (const change of normalized.writes) {
      const id = change.after?._id, identity = change.collection + '/' + id;
      if (!allowed.has(change.collection) || typeof id !== 'string' || !id || identities.has(identity)
        || change.after.company !== company || change.before !== null && (!change.before || change.before._id !== id
          || change.before.company !== company || typeof change.before._version !== 'string' || !change.before._version)
        || change.collection === journal && (protectedIds.has(id)
          || [change.before, change.after].some(row => row?.stockOperationProtocol != null))) throw Error('Plan identity conflict');
      identities.add(identity);
      const token = hash(key, change.collection, id);
      if (change.before?._version === token) throw Error('Version reuse');
      change.after._version = token;
    }
    if (utf8Bytes(stringify(normalized)) > maxPlanBytes) throw Error('Segmented plan byte policy');
    return normalized;
  }
  function identity({ key, digest, memberId, requestId, baseGeneration, attempt }) {
    if (typeof memberId !== 'string' || !memberId || !/^[a-f0-9-]{36}$/i.test(requestId || '')
      || key !== hash(scope, requestId, memberId) || typeof digest !== 'string' || !digest
      || !Number.isSafeInteger(baseGeneration) || baseGeneration < 0 || !Number.isSafeInteger(baseGeneration + 1)
      || typeof attempt !== 'string' || !attempt) throw Error('Segmented operation identity');
  }
  function encode(context) {
    identity(context);
    const { key, digest, memberId, requestId, baseGeneration, attempt } = context;
    // Business after-images retain original JSON key order: protected legacy
    // snapshot hashes can depend on it. Canonical comparison remains appropriate
    // for protocol metadata/equality, not for rewriting stored business payloads.
    const plan = normalize(context.plan, key), payload = JSON.stringify(plan), fragments = [];
    let offset = 0;
    while (offset < payload.length) {
      if (fragments.length >= maxFragments) throw Error('Segment count policy');
      const index = fragments.length, id = fragmentId(key, attempt, index);
      const wrap = text => ({ _id: id, company, stockOperationProtocol: 2, action: 'STOCK_PLAN_FRAGMENT',
        operationId: key, attempt, index, payload: text, payloadHash: hash(text) });
      let low = 1, high = Math.min(payload.length - offset, recordBudgetBytes), size = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (utf8Bytes(stringify(wrap(payload.slice(offset, offset + mid)))) <= recordBudgetBytes) { size = mid; low = mid + 1; }
        else high = mid - 1;
      }
      // Never split a surrogate pair. JSON escaping also counts against record budget.
      if (size && /[\uD800-\uDBFF]/.test(payload[offset + size - 1]) && /[\uDC00-\uDFFF]/.test(payload[offset + size] || '')) size--;
      if (!size) throw Error('Fragment metadata exceeds policy');
      fragments.push(wrap(payload.slice(offset, offset + size))); offset += size;
    }
    normalize(plan, key, fragments.map(row => row._id));
    const manifest = { _id: key, company, stockOperationProtocol: 2, action: 'STOCK_PLAN_MANIFEST', digest,
      memberId, requestId, attempt, baseGeneration, planHash: hash(payload), planBytes: utf8Bytes(payload),
      writeCount: plan.writes.length, fragments: fragments.map(row => ({ id: row._id, hash: row.payloadHash, bytes: utf8Bytes(row.payload) })) };
    if (utf8Bytes(stringify(manifest)) > recordBudgetBytes) throw Error('Manifest exceeds policy');
    return { manifest, fragments, plan };
  }
  function decode({ manifest, fragments, key, digest, memberId, requestId }) {
    if (!manifest || manifest.company !== company || manifest._id !== key || manifest.digest !== digest
      || manifest.memberId !== memberId || manifest.requestId !== requestId || manifest.stockOperationProtocol !== 2
      || manifest.action !== 'STOCK_PLAN_MANIFEST' || !Array.isArray(manifest.fragments) || !manifest.fragments.length
      || manifest.fragments.length > maxFragments || !Array.isArray(fragments) || fragments.length !== manifest.fragments.length
      || utf8Bytes(stringify(manifest)) > recordBudgetBytes) throw Error('Manifest integrity conflict');
    identity({ ...manifest, key });
    const parts = []; let payloadBytes = 0;
    for (let index = 0; index < fragments.length; index++) {
      const ref = manifest.fragments[index], row = fragments[index];
      const id = fragmentId(key, manifest.attempt, index);
      if (!row || !same(ref, { id, hash: row.payloadHash, bytes: typeof row.payload === 'string' ? utf8Bytes(row.payload) : -1 })
        || typeof row.payload !== 'string' || !same(row, { _id: id, company, stockOperationProtocol: 2, action: 'STOCK_PLAN_FRAGMENT',
          operationId: key, attempt: manifest.attempt, index, payload: row.payload, payloadHash: hash(row.payload) })
        || utf8Bytes(stringify(row)) > recordBudgetBytes) throw Error('Fragment integrity conflict');
      parts.push(row.payload); payloadBytes += ref.bytes;
      if (payloadBytes > maxPlanBytes) throw Error('Segmented plan byte policy');
    }
    const payload = parts.join('');
    if (manifest.planBytes !== utf8Bytes(payload) || manifest.planHash !== hash(payload)) throw Error('Plan hash conflict');
    const parsed = JSON.parse(payload), normalized = normalize(parsed, key, fragments.map(row => row._id));
    if (!same(parsed, normalized) || JSON.stringify(parsed) !== payload || manifest.writeCount !== normalized.writes.length) throw Error('Prepared plan changed');
    const expected = { _id: key, company, stockOperationProtocol: 2, action: 'STOCK_PLAN_MANIFEST', digest,
      memberId, requestId, attempt: manifest.attempt, baseGeneration: manifest.baseGeneration,
      planHash: manifest.planHash, planBytes: manifest.planBytes, writeCount: manifest.writeCount, fragments: manifest.fragments };
    if (!same(manifest, expected)) throw Error('Manifest fields conflict');
    return normalized;
  }
  return { encode, decode, normalize, ids: { journal, lockId, controlId }, policy: { recordBudgetBytes, maxPlanBytes, maxWrites, maxFragments } };
}
module.exports = { createSegmentedPlanCodec, utf8Bytes, same, copy };

},
// domain-scope.cjs sha256:cddb64affc043a9dda5fbf1c60b671f46611d21be8d6cf4797f243bb1df181e7
"domain-scope.cjs": (load, module) => {
'use strict';

// Exact existing collection map, verified against purchaseProjection.PURCHASE_COLLECTIONS.
// This changes no CMS/employee permission; optional conditional domain plans only.
function domainCollections(company) {
  if (company === 'NCT') return ['R2NCTOrders', 'R2NCTTasks', 'R2PurchaseOrders'];
  if (company === 'GHR') return ['R2NCTOrders1', 'R2NCTTasks1', 'R2PurchaseOrders'];
  throw Error('Known company domain scope required');
}
function planCollections(company, domainWrites = false) {
  if (!['NCT', 'GHR'].includes(company) || typeof domainWrites !== 'boolean') throw Error('Explicit server plan scope required');
  return [company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', 'R2StockPositions', 'R2StockClaims', 'R2StockProducts',
    ...(domainWrites ? domainCollections(company) : [])];
}
module.exports = { domainCollections, planCollections };

},
// original-receipt-validation.cjs sha256:6f315daa6a10a2a8d0b339e45c781bb9e54dd519222cea4300fd6e038a6c44f9
"original-receipt-validation.cjs": (load, module) => {
'use strict';

// Isolated compatibility bridge: execute the unchanged original receipt prepare
// against a private journal, stopping BEFORE its legacy apply. No real store is
// accepted here. The resulting event still needs the fenced multi-product plan.
const copy = value => JSON.parse(JSON.stringify(value));
async function validateOriginalReceipt({ createWarehouseOperations, company, staff, requestId, input, orders, activity, now }) {
  if (typeof createWarehouseOperations !== 'function' || !['NCT', 'GHR'].includes(company)
    || !Array.isArray(orders) || !Array.isArray(activity) || typeof now !== 'function') throw Error('Original receipt validation dependencies required');
  const collection = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const scratch = new Map(), stopped = new Error('Private receipt preparation boundary');
  let captured = null, orderReads = 0;
  const scope = c => { if (c !== collection) throw Error('Unexpected receipt journal collection'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    all: async c => { scope(c); return copy(activity); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || !row.details.plan?.event || scratch.size !== 1) throw Error('Unexpected receipt prepare sequence');
        captured = copy(row.details.plan);
        throw stopped;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK'
        || scratch.size || scratch.has(row._id)) throw Error('Legacy receipt apply is forbidden in validation');
      scratch.set(row._id, copy(row));
      return copy(row);
    },
    remove: async (c, id) => {
      scope(c);
      if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private validation lock may be removed');
      scratch.delete(id);
    }
  };
  const operations = createWarehouseOperations({ store, names: { [company]: { activity: collection } },
    readOrders: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++orderReads !== 1) throw Error('Unexpected receipt apply/read');
      return copy(orders);
    }, now });
  try {
    await operations.save({ company, staff: copy(staff), requestId, input: copy(input) });
    throw Error('Original receipt prepare boundary was not reached');
  } catch (error) {
    if (error !== stopped) throw error;
  }
  if (scratch.size || !captured || orderReads !== 1 || captured.event.action !== 'WAREHOUSE_RECEIPT_SAVED'
    || captured.event.details?.company !== company) throw Error('Original receipt preparation incomplete');
  return captured;
}
module.exports = { validateOriginalReceipt };

},
// warehouse-stock-reader.cjs sha256:d1a746eec893e3373a3081dc59dc52fdb12881bd356e2601ec497eeecc3d9acc
"warehouse-stock-reader.cjs": (load, module) => {
'use strict';

const { readCurrentProduct } = load("current-product-reader.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { prepareWarehouseReceipt } = load("warehouse-receipt-plan.cjs");
const { createReceiptReadSnapshot } = load("receipt-read-snapshot.cjs");
function createWarehouseStockReader({ company, items, store, protocol, readAuthority }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function' || typeof store?.read !== 'function'
    || typeof protocol?.readSnapshot !== 'function' || typeof readAuthority !== 'function') throw Error('Server Warehouse stock dependencies required');
  // Intended as fenced commit.prepare; not a standalone unauthenticated save route.
  return async () => {
    const metrics = { queries: 0, exactReads: 0 };
    const snapshot = await protocol.readSnapshot(async control => {
      const authority = await readAuthority();
      if (authority?.kind !== 'RECEIVE' || !authority.memberId || !authority.validated
        || !Array.isArray(authority.products) || !authority.products.length) throw Error('Verified Warehouse authority required');
      const products = [];
      const batched = protocol.planFormat === 'SEGMENTED_V2' ? await createReceiptReadSnapshot({ company, products: authority.products,
        items, store, metrics, transferIndexVersion: control?.transferIndexVersion }) : null;
      const prepared = [];
      for (const product of authority.products) {
        if (product.identity?.company !== company || typeof product.buildState !== 'function') throw Error('Server product authority required');
        if (protocol.planFormat === 'SEGMENTED_V2' && !product.stockScope) throw Error('Server receipt current scope required');
        const rows = protocol.planFormat === 'SEGMENTED_V2'
          ? await readScopedCurrentProduct({ ...product.stockScope, company, identity: product.identity, items, store: batched.store,
            snapshotSets: batched, transferIndexVersion: control?.transferIndexVersion })
          : await readCurrentProduct({ company, identity: product.identity, items, store, metrics });
        if (protocol.planFormat === 'SEGMENTED_V2') {
          if (typeof product.scopeTaskIds !== 'function' || typeof authority.readTaskRows !== 'function') throw Error('Private current task checkpoint reader required');
          prepared.push({ product, rows, taskIds: product.scopeTaskIds(rows) });
        } else {
          products.push({ state: product.buildState(rows), rows });
        }
      }
      if (batched) {
        const ids = [...new Set(prepared.flatMap(p => p.taskIds))], taskRows = await authority.readTaskRows(ids);
        if (!Array.isArray(taskRows) || taskRows.length !== ids.length
          || taskRows.some((row, i) => !row || row._id !== ids[i] || row.company !== company)) throw Error('Complete receipt task checkpoint batch required');
        const byId = new Map(taskRows.map(row => [row._id, row]));
        for (const { product, rows, taskIds } of prepared) {
          rows.taskRows = taskIds.map(id => byId.get(id)); rows.generation = control.generation;
          products.push({ state: product.buildState(rows), rows });
        }
      }
      return { validated: authority.validated, products, memberId: authority.memberId };
    });
    return { ...prepareWarehouseReceipt({ ...snapshot.rows, generation: snapshot.generation, planFormat: protocol.planFormat || 'PROOF_V1' }),
      memberId: snapshot.rows.memberId, generation: snapshot.generation, metrics };
  };
}
module.exports = { createWarehouseStockReader };

},
// current-product-reader.cjs sha256:2ad82f80acfdf3847611403d428653b4f8b448746fc8683b13aa0e3bbfc9021d
"current-product-reader.cjs": (load, module) => {
'use strict';

const { stockKey } = load("current-model.cjs");
const { hash } = load("commit-proof.cjs");
const copy = row => JSON.parse(JSON.stringify(row));
// Call only INSIDE a shared readSnapshot. Exact reads decode SDK/version metadata;
// list queries establish complete bounded identity sets, including CLOSED rows.
async function readCurrentProduct({ company, identity, items, store, metrics }) {
  const key = stockKey(identity), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  if (!['NCT', 'GHR'].includes(company) || identity.company !== company) throw Error('Current product company required');
  async function exact(collection, id) {
    metrics.exactReads++;
    const row = await store.read(collection, id);
    if (row && row._id !== id) throw Error('Current exact row identity conflict');
    return copy(row);
  }
  async function completeRows(collection, max, action) {
    let q = items.query(collection).eq('company', company).eq('stockKey', key);
    if (action) q = q.eq('action', action);
    const page = await q.ascending('_id').limit(max + 1).find({ consistentRead: true, returnTotalCount: true });
    metrics.queries++;
    if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0
      || page.totalCount > max || page.items.length !== page.totalCount
      || new Set(page.items.map(row => row._id)).size !== page.items.length) throw Error('Incomplete bounded borrowing snapshot');
    const rows = [];
    for (const listed of page.items) {
      if (typeof listed._id !== 'string' || !listed._id || listed.company !== company || listed.stockKey !== key
        || action && listed.action !== action) throw Error('Borrowing query scope conflict');
      const row = await exact(collection, listed._id);
      if (!row || row.company !== company || row.stockKey !== key || action && row.action !== action) throw Error('Borrowing snapshot changed');
      rows.push(row);
    }
    return rows;
  }
  const positions = await completeRows('R2StockPositions', 14);
  const claims = await completeRows('R2StockClaims', 60);
  const transfers = await completeRows(journal, 30, 'STOCK_TRANSFER_CURRENT');
  const product = await exact('R2StockProducts', hash(company, key));
  const knownRows = [...positions, ...claims, ...transfers, ...(product ? [product] : [])];
  if (knownRows.some(row => row.company !== company || row.stockKey !== key || !row._version || row.reviewRequired === true || row.reviewCodes?.length
      || ['onHand', 'isolated', 'available', 'reservedUsable', 'isolatedAttributed'].some(k => row[k] === null))
    || !product && (positions.length || claims.length || transfers.length)) throw Error('Current product requires review; no legacy quantity fallback');
  return { complete: true, positions, claims, transfers, product };
}
module.exports = { readCurrentProduct };

},
// scoped-current-reader.cjs sha256:f1e408ee775dd203cf52a6c499d864e2ed8471570b18d47d961bf8e960ffd8fe
"scoped-current-reader.cjs": (load, module) => {
'use strict';

// Server-only candidate. Call inside common readSnapshot, with migration-verified
// transfer index version from private control, never from the browser. No history
// fallback and no ACTIVE switch. Output is operational scope, not full history.
const { hash } = load("commit-proof.cjs");
const { stockKey } = load("current-model.cjs");
const { copy } = load("segmented-plan.cjs");
const count = n => Number.isSafeInteger(n) && n >= 0;
async function readScopedCurrentProduct({ company, identity, items, store, transferIndexVersion,
  sourceTaskIds = [], demandTaskIds = [], claimPairs = [], correctionSourceIds = [], pageSize = 50, maxRowsPerSet = 2000,
  metrics = { queries: 0, exactReads: 0 }, snapshotSets = null }) {
  const key = stockKey(identity), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  if (!['NCT', 'GHR'].includes(company) || identity.company !== company || typeof items?.query !== 'function'
    || typeof store?.read !== 'function' || transferIndexVersion !== 2) throw Error('Verified scoped current dependencies/index required');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isSafeInteger(maxRowsPerSet) || maxRowsPerSet < 1
    || !Array.isArray(sourceTaskIds) || !Array.isArray(demandTaskIds) || !Array.isArray(correctionSourceIds) || !Array.isArray(claimPairs)
    || sourceTaskIds.length + demandTaskIds.length + correctionSourceIds.length + claimPairs.length > maxRowsPerSet
    || [...sourceTaskIds, ...demandTaskIds, ...correctionSourceIds].some(id => typeof id !== 'string' || !id)
    || claimPairs.some(p => !p || typeof p.sourceTaskId !== 'string' || !p.sourceTaskId || typeof p.taskId !== 'string' || !p.taskId)) throw Error('Explicit bounded current scope required');
  function known(row, collection, id) {
    if (!row || row._id !== id || row.company !== company || row.stockKey !== key || !row._version
      || !count(row.revision) || !['ACTIVE', 'CLOSED'].includes(row.status) || row.reviewRequired === true || row.reviewCodes?.length) throw Error('Known exact current row required');
    if (collection === 'R2StockPositions' && (!['receiptAccepted', 'borrowRepaidCumulative', 'onHand', 'isolated', 'available', 'reservedUsable', 'dispatched'].every(f => count(row[f]))
      || row.borrowRepaidCumulative > row.receiptAccepted || row.onHand !== row.isolated + row.available + row.reservedUsable)) throw Error('Source current checkpoint requires review');
    if (collection === 'R2StockClaims' && (!count(row.dispatchedCumulative) || !count(row.reservedUsable) || !count(row.isolatedAttributed)
      || id !== hash(company, row.positionId, row.taskId))) throw Error('Claim current checkpoint requires review');
    if (collection === journal) {
      const r = row.details?.relation;
      if (row.action !== 'STOCK_TRANSFER_CURRENT' || !r || row._id !== hash(company, 'STOCK_TRANSFER_CURRENT', r.id)
        || row.replacementSourceId !== r.replacementSourceId || row.lenderSourceId !== r.lenderSourceId || row.repaidQuantity !== r.repaid
        || !count(r.quantity) || !r.quantity || !count(r.repaid) || !count(r.returned || 0) || r.repaid + (r.returned || 0) > r.quantity
        || row.status !== (r.quantity === r.repaid + (r.returned || 0) ? 'CLOSED' : 'ACTIVE')
        || !Array.isArray(row.participantTaskIds) || row.participantTaskIds.length !== 2
        || !row.participantTaskIds.includes(r.borrowerTaskId) || !row.participantTaskIds.includes(r.lenderTaskId)) throw Error('Transfer current index conflict');
    }
    return row;
  }
  const cache = new Map();
  async function exact(collection, id) {
    const address = collection + '/' + id;
    if (!cache.has(address)) {
      metrics.exactReads++;
      const row = await store.read(collection, id);
      cache.set(address, row ? copy(known(row, collection, id)) : null);
    }
    return cache.get(address);
  }
  // Cursor queries are complete sets, not first-page sums. Count changes, missing
  // pages, duplicates, overflow and network errors all stop before preparation.
  async function querySet(collection, filters) {
    if (snapshotSets) {
      const listed = await snapshotSets.readSet(collection, key, filters);
      if (!Array.isArray(listed) || listed.length > maxRowsPerSet) throw Error('Incomplete scoped current set');
      const result = []; let cursor = null;
      for (const candidate of listed) {
        if (typeof candidate?._id !== 'string' || !candidate._id || cursor && candidate._id <= cursor) throw Error('Scoped current cursor conflict');
        const row = await exact(collection, candidate._id);
        if (!row || filters.some(([method, field, value]) => method === 'eq' ? row[field] !== value : !(row[field] > value))) throw Error('Scoped current query changed');
        result.push(row); cursor = candidate._id;
      }
      return result;
    }
    const result = []; let cursor = null, total;
    do {
      let q = items.query(collection).eq('company', company).eq('stockKey', key);
      for (const [method, field, value] of filters) q = q[method](field, value);
      if (cursor) q = q.gt('_id', cursor);
      metrics.queries++;
      const page = await q.ascending('_id').limit(pageSize).find({ consistentRead: true, returnTotalCount: true });
      if (!Array.isArray(page?.items) || !count(page.totalCount) || page.totalCount > maxRowsPerSet
        || total !== undefined && page.totalCount !== total - result.length
        || page.items.length !== Math.min(pageSize, page.totalCount)) throw Error('Incomplete scoped current set');
      if (total === undefined) total = page.totalCount;
      for (const listed of page.items) {
        if (typeof listed?._id !== 'string' || !listed._id || cursor && listed._id <= cursor) throw Error('Scoped current cursor conflict');
        const row = await exact(collection, listed._id);
        if (!row || filters.some(([method, field, value]) => method === 'eq' ? row[field] !== value : !(row[field] > value))) throw Error('Scoped current query changed');
        result.push(row); cursor = listed._id;
      }
    } while (result.length < total);
    return result;
  }
  const product = await exact('R2StockProducts', hash(company, key));
  if (product && (product.lifecycleVersion !== 2 || !Number.isSafeInteger(product.nextBorrowSequence) || product.nextBorrowSequence < 1
    || !['onHand', 'reservedUsable', 'available', 'isolated'].every(f => count(product[f]))
    || product.onHand !== product.reservedUsable + product.available + product.isolated)) throw Error('Product lifecycle checkpoint requires review');
  const positions = new Map((await querySet('R2StockPositions', [['eq', 'status', 'ACTIVE']])).map(row => [row._id, row]));
  const claims = new Map((await querySet('R2StockClaims', [['eq', 'status', 'ACTIVE']])).map(row => [row._id, row]));
  const transfers = new Map((await querySet(journal, [['eq', 'action', 'STOCK_TRANSFER_CURRENT'], ['eq', 'status', 'ACTIVE']])).map(row => [row._id, row]));
  for (const sourceId of new Set(correctionSourceIds)) {
    const rows = await querySet(journal, [['eq', 'action', 'STOCK_TRANSFER_CURRENT'], ['eq', 'replacementSourceId', sourceId], ['gt', 'repaidQuantity', 0]]);
    for (const row of rows) transfers.set(row._id, row);
  }
  const requiredSources = new Set([...sourceTaskIds, ...correctionSourceIds, ...claimPairs.map(p => p.sourceTaskId)]), pairs = [...claimPairs];
  for (const claim of claims.values()) {
    const position = await exact('R2StockPositions', claim.positionId);
    if (!position) throw Error('Active claim source missing'); positions.set(position._id, position);
  }
  for (const row of transfers.values()) {
    const r = row.details.relation;
    requiredSources.add(r.lenderSourceId); requiredSources.add(r.replacementSourceId);
    for (const sourceTaskId of [r.lenderSourceId, r.replacementSourceId]) {
      for (const taskId of [r.lenderTaskId, r.borrowerTaskId]) pairs.push({ sourceTaskId, taskId });
    }
  }
  for (const id of requiredSources) {
    const row = await exact('R2StockPositions', hash(company, key, 'PURCHASE_SOURCE', id));
    if (row) { if (row.sourceTaskId !== id) throw Error('Source stable identity conflict'); positions.set(row._id, row); }
  }
  for (const position of positions.values()) {
    if (position._id !== hash(company, key, 'PURCHASE_SOURCE', position.sourceTaskId)) throw Error('Source stable identity conflict');
    requiredSources.add(position.sourceTaskId);
    // Only this source's nonzero dispatch provenance, not all CLOSED product claims.
    for (const row of await querySet('R2StockClaims', [['eq', 'positionId', position._id], ['gt', 'dispatchedCumulative', 0]])) claims.set(row._id, row);
  }
  for (const { sourceTaskId, taskId } of pairs) {
    const positionId = hash(company, key, 'PURCHASE_SOURCE', sourceTaskId);
    const row = await exact('R2StockClaims', hash(company, positionId, taskId));
    if (row) {
      if (row.positionId !== positionId || row.taskId !== taskId || !positions.has(positionId)) throw Error('Claim stable identity conflict');
      claims.set(row._id, row);
    }
  }
  if (positions.size > maxRowsPerSet || claims.size > maxRowsPerSet || transfers.size > maxRowsPerSet || requiredSources.size > maxRowsPerSet) throw Error('Scoped current fanout policy');
  if (!product && (positions.size || claims.size || transfers.size)) throw Error('Product checkpoint missing; no historical fallback');
  return { complete: true, scope: 'CURRENT_ACTIVE_PRODUCT', planFormat: 'SEGMENTED_V2', sourceTaskIds: [...requiredSources], demandTaskIds: [...new Set(demandTaskIds)],
    positions: [...positions.values()], claims: [...claims.values()], transfers: [...transfers.values()].sort((a, b) => a.details.relation.sequence - b.details.relation.sequence), product };
}
module.exports = { readScopedCurrentProduct };

},
// warehouse-receipt-plan.cjs sha256:f79f9771fb228327bc0792add498e75eff483a7fd89075c660c93d98c970592a
"warehouse-receipt-plan.cjs": (load, module) => {
'use strict';

const { stockKey } = load("current-model.cjs");
const { prepareBorrowingReceipt } = load("borrowing-stock-plan.cjs");
const { utf8Bytes } = load("segmented-plan.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
// One original PO receipt, potentially several products, ONE fenced commit.
// Product snapshots must be assembled together inside the same read barrier.
function prepareWarehouseReceipt({ validated, products, generation, planFormat = 'PROOF_V1' }) {
  if (!['PROOF_V1', 'SEGMENTED_V2'].includes(planFormat)) throw Error('Server receipt plan format required');
  const event = validated?.event;
  if (!validated?.expectedVersion || !event || event.action !== 'WAREHOUSE_RECEIPT_SAVED'
    || !Array.isArray(event.details?.lines) || !event.details.lines.length || !Array.isArray(products) || !products.length
    || !Number.isSafeInteger(generation) || generation < 0) throw Error('Validated PO receipt and complete product snapshots required');
  const keys = new Set(), consumed = new Set(), writes = [], states = [];
  for (const { state, rows } of products) {
    if (state?.company !== event.details.company) throw Error('Receipt product company conflict');
    const key = stockKey(state);
    if (keys.has(key)) throw Error('Duplicate receipt product snapshot');
    keys.add(key);
    const lines = event.details.lines.filter(line => state.sources.some(s => s.id === line.taskId));
    if (!lines.length) throw Error('Unrelated receipt product snapshot');
    for (const line of lines) {
      if (consumed.has(line.taskId)) throw Error('Ambiguous receipt product source');
      consumed.add(line.taskId);
    }
    const scoped = { ...copy(event), details: { ...copy(event.details), lines: copy(lines) } };
    const result = prepareBorrowingReceipt({ state, rows, event: scoped, generation });
    states.push(result.state);
    // Keep the ORIGINAL full event once, never save per-product partial receipts.
    for (const write of result.plan.writes) {
      if (write.after.action === 'WAREHOUSE_RECEIPT_SAVED') continue;
      writes.push(write);
    }
  }
  if (new Set(event.details.lines.map(l => l.taskId)).size !== event.details.lines.length
    || consumed.size !== event.details.lines.length) throw Error('Incomplete receipt product coverage');
  writes.unshift({ collection: event.details.company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1',
    before: null, after: { ...copy(event), company: event.details.company } });
  if (new Set(writes.map(w => w.collection + ':' + w.after._id)).size !== writes.length) throw Error('Combined receipt write identity conflict');
  // Only a server-composed v2 protocol requests the segmented envelope. Individual
  // product preparation is still subject to its current working-set guards.
  if (planFormat === 'PROOF_V1' && (writes.length > 30 || utf8Bytes(JSON.stringify({ writes })) > 180000)) throw Error('Combined receipt exceeds atomic proof bound');
  if (planFormat === 'SEGMENTED_V2' && (writes.length > 10000 || utf8Bytes(JSON.stringify({ writes })) > 8 * 1024 * 1024)) throw Error('Combined receipt exceeds segmented policy');
  return { states, expectedVersion: validated.expectedVersion, plan: { writes } };
}
module.exports = { prepareWarehouseReceipt };

},
// borrowing-stock-plan.cjs sha256:33127f5044ad293e62bb7c230a79b973e3dd363eb163261919dce7a468c72247
"borrowing-stock-plan.cjs": (load, module) => {
'use strict';

// Pure bounded mapping into the EXISTING fenced-plan contract. Not an endpoint,
// production schema installation or replacement for trusted business validators.
const { hash } = load("commit-proof.cjs");
const { stockKey } = load("current-model.cjs");
const { validate, approveBorrow, receive, correctAccepted, returnUnusedBorrow, allocateCumulative, adjustDemand, dispatchReserved, quarantineFree, quarantineReserved, freeCaseMovement, releaseFreeCase, relationRemaining } = load("borrowing-model.cjs");
const { guardProcurementStock } = load("procurement-stock-guard.cjs");
const { rollForwardProduct } = load("product-delta.cjs");
const copy = row => JSON.parse(JSON.stringify(row));
const count = n => Number.isSafeInteger(n) && n >= 0;
const total = values => {
  const n = values.reduce((a, b) => a + b, 0);
  if (!count(n)) throw Error('Quantity overflow');
  return n;
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const transferId = (company, id) => hash(company, 'STOCK_TRANSFER_CURRENT', id);
const sumClaims = source => total(Object.values(source.claims));
function checkRow(row, company, id, key) {
  if (!row || row._id !== id || row.company !== company || !row._version || !count(row.revision)
    || row.stockKey !== key || !['ACTIVE', 'CLOSED'].includes(row.status)
    || row.reviewRequired === true || row.reviewCodes?.length) throw Error('Known exact stock row required');
}
function checkEvent(event, company, action) {
  if (!event || event.action !== action || event.result !== 'SAVED' || !event._id || event._id !== event.title
    || event.details?.company !== company || !event.initiatedByStaffId || !event.activityTime) throw Error('Original validated business event required');
}
function mapTransition({ before, after, rows, event, generation }) {
  validate(before); validate(after);
  const company = before.company, key = stockKey(before), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const scoped = rows?.scope === 'CURRENT_ACTIVE_PRODUCT';
  if (scoped && (before.scope !== rows.scope || after.scope !== rows.scope || before.lifecycleVersion !== 2
    || rows.planFormat !== 'SEGMENTED_V2')) throw Error('Scoped current plan requires v2 lifecycle');
  if (!count(generation) || !rows || rows.complete !== true || !Array.isArray(rows.positions)
    || !Array.isArray(rows.claims) || !Array.isArray(rows.transfers) || before.sources.length > (scoped ? 2000 : 14)
    || before.tasks.length > (scoped ? 4000 : 30) || before.relations.length > (scoped ? 2000 : 30)
    || after.relations.length > (scoped ? 2000 : 30) || rows.claims.length > (scoped ? 2000 : 60)
    || after.company !== company || stockKey(after) !== key) throw Error('Complete bounded stock rows required');
  const positions = new Map(rows.positions.map(r => [r._id, r])), claims = new Map(rows.claims.map(r => [r._id, r]));
  const transfers = new Map(rows.transfers.map(r => [r._id, r])), tasks = new Map(before.tasks.map(t => [t.id, t]));
  if (positions.size !== rows.positions.length || claims.size !== rows.claims.length || transfers.size !== rows.transfers.length) throw Error('Duplicate snapshot row');
  const writes = [{ collection: journal, before: null, after: { ...copy(event), company } }];
  const consumedPositions = new Set(), consumedClaims = new Set(), consumedTransfers = new Set();
  const summary = state => ({ onHand: total(state.sources.map(s => s.onHand)), isolated: total(state.sources.map(s => s.isolated)),
    reservedUsable: total(state.sources.map(sumClaims)), available: total(state.sources.map(s => s.available)) });
  const beforeTotals = summary(before), productId = hash(company, key), product = rows.product;
  if (before.lifecycleVersion !== after.lifecycleVersion) throw Error('Lifecycle migration is not a business save');
  if (product) {
    checkRow(product, company, productId, key);
    if (product.revision !== before.revision || !Object.keys(beforeTotals).every(k => scoped ? product[k] >= beforeTotals[k] : product[k] === beforeTotals[k])) throw Error('Product snapshot conflict');
    if (before.lifecycleVersion === 2 && (product.lifecycleVersion !== 2 || product.nextBorrowSequence !== before.nextBorrowSequence)) throw Error('Product lifecycle checkpoint conflict');
  } else if (before.revision !== 0 || Object.values(beforeTotals).some(n => n !== 0)) throw Error('Product snapshot missing');
  for (const source of before.sources) {
    const next = after.sources.find(s => s.id === source.id), id = hash(company, key, 'PURCHASE_SOURCE', source.id), old = positions.get(id) || null;
    if (!next) throw Error('Source identity changed');
    if (old) {
      consumedPositions.add(id); checkRow(old, company, id, key);
      if (old.sourceTaskId !== source.id || old.poId !== source.poId || old.receiptAccepted !== source.accepted
        || old.replacementReceived !== (source.replacementReceived || 0) || (old.supplierReturned ?? 0) !== (source.supplierReturned || 0)
        || old.dispatched !== total(Object.values(source.dispatchedByTask || {}))
        || old.onHand !== source.onHand || old.isolated !== source.isolated
        || old.available !== source.available || old.reservedUsable !== sumClaims(source)) throw Error('Source snapshot conflict');
      if (before.lifecycleVersion === 2 && old.borrowRepaidCumulative !== source.borrowRepaidCumulative) throw Error('Source repayment snapshot conflict');
    } else if (source.accepted !== 0 || source.onHand !== 0 || sumClaims(source) !== 0) throw Error('Source snapshot missing');
    const positionChanged = !same(source, next);
    if (positionChanged) {
      const base = old || { _id: id, schemaVersion: 1, company, stockKey: key, barcode: before.barcode, packing: before.packing,
        ea: before.ea, name: before.name || '', sourceKind: 'PURCHASE_SOURCE', sourceId: source.id, sourceTaskId: source.id,
        poId: source.poId, replacementReceived: 0, supplierReturned: 0, reviewCodes: [] };
      writes.push({ collection: 'R2StockPositions', before: copy(old), after: { ...copy(base), poId: next.poId,
        ...(typeof next.poNumber === 'string' && next.poNumber ? { poNumber: next.poNumber } : {}), receiptAccepted: next.accepted,
        replacementReceived: next.replacementReceived || 0, supplierReturned: next.supplierReturned || 0,
        ...(after.lifecycleVersion === 2 ? { borrowRepaidCumulative: next.borrowRepaidCumulative } : {}),
        dispatched: total(Object.values(next.dispatchedByTask || {})), onHand: next.onHand, isolated: next.isolated,
        available: next.available, reservedUsable: sumClaims(next), revision: (old?.revision || 0) + 1,
        checkpointGeneration: generation + 1, status: next.onHand === 0 ? 'CLOSED' : 'ACTIVE' } });
    }
    const ids = new Set([...Object.keys(source.claims), ...Object.keys(next.claims), ...Object.keys(source.isolatedClaims || {}), ...Object.keys(next.isolatedClaims || {})]);
    for (const row of rows.claims.filter(c => c.positionId === id)) ids.add(row.taskId);
    for (const taskId of ids) {
      const claimId = hash(company, id, taskId), oldClaim = claims.get(claimId) || null, task = tasks.get(taskId);
      const prior = source.claims[taskId] || 0, quantity = next.claims[taskId] || 0;
      const priorIsolated = source.isolatedClaims?.[taskId] || 0, isolated = next.isolatedClaims?.[taskId] || 0;
      if (!task) throw Error('Claim task missing');
      if (oldClaim) {
        consumedClaims.add(claimId); checkRow(oldClaim, company, claimId, key);
        if (oldClaim.positionId !== id || oldClaim.taskId !== taskId || oldClaim.customerId !== task.customerId
          || oldClaim.reservedUsable !== prior || oldClaim.isolatedAttributed !== priorIsolated) throw Error('Claim snapshot conflict');
        if (before.lifecycleVersion === 2 && oldClaim.dispatchedCumulative !== (source.dispatchedByTask?.[taskId] || 0)) throw Error('Claim dispatch snapshot conflict');
      } else if (prior !== 0 || priorIsolated !== 0) throw Error('Claim snapshot missing');
      if (quantity === prior && isolated === priorIsolated && (source.dispatchedByTask?.[taskId] || 0) === (next.dispatchedByTask?.[taskId] || 0)) continue;
      const base = oldClaim || { _id: claimId, schemaVersion: 1, company, stockKey: key, positionId: id,
        taskId, customerId: task.customerId, orderId: task.orderId || '', sourceLineId: task.sourceLineId || '',
        isolatedAttributed: 0, reviewCodes: [] };
      writes.push({ collection: 'R2StockClaims', before: copy(oldClaim), after: { ...copy(base), reservedUsable: quantity, isolatedAttributed: isolated,
        ...(after.lifecycleVersion === 2 ? { dispatchedCumulative: next.dispatchedByTask?.[taskId] || 0 } : {}),
        revision: (oldClaim?.revision || 0) + 1, checkpointGeneration: generation + 1, status: quantity === 0 && isolated === 0 ? 'CLOSED' : 'ACTIVE' } });
    }
  }
  for (const relation of after.relations) {
    const id = transferId(company, relation.id), prior = before.relations.find(r => r.id === relation.id) || null, old = transfers.get(id) || null;
    if (old) {
      consumedTransfers.add(id);
      if (old.company !== company || !old._version || !count(old.revision) || old.stockKey !== key
        || old.action !== 'STOCK_TRANSFER_CURRENT' || old.status !== (prior && relationRemaining(prior) === 0 ? 'CLOSED' : 'ACTIVE')
        || !same(old.details?.relation, prior)) throw Error('Transfer snapshot conflict');
    } else if (prior) throw Error('Transfer snapshot missing');
    if (same(prior, relation)) continue;
    writes.push({ collection: journal, before: copy(old), after: { ...(old || {}), _id: id, title: relation.id,
      company, stockKey: key, description: relation.id, action: 'STOCK_TRANSFER_CURRENT', result: 'SAVED',
      participantTaskIds: [relation.borrowerTaskId, relation.lenderTaskId],
      lenderSourceId: relation.lenderSourceId, replacementSourceId: relation.replacementSourceId, repaidQuantity: relation.repaid,
      revision: (old?.revision || 0) + 1, activityTime: event.activityTime, checkpointGeneration: generation + 1,
      status: relationRemaining(relation) === 0 ? 'CLOSED' : 'ACTIVE', details: { relation: copy(relation) } } });
  }
  if (consumedPositions.size !== positions.size || consumedClaims.size !== claims.size || consumedTransfers.size !== transfers.size) throw Error('Snapshot contains unrelated stock rows');
  const productAfter = rollForwardProduct({ identity: before, product, beforeSources: before.sources,
    afterSources: after.sources, generation, revision: before.revision,
    lifecycle: after.lifecycleVersion === 2 ? { version: 2, nextBorrowSequence: after.nextBorrowSequence } : null });
  writes.push({ collection: 'R2StockProducts', before: copy(product || null), after: productAfter });
  const identities = writes.map(w => w.collection + ':' + w.after._id);
  if (new Set(identities).size !== writes.length || writes.length > (scoped ? 10000 : 30)
    || Buffer.byteLength(JSON.stringify({ writes })) > (scoped ? 8 * 1024 * 1024 : 180000)) throw Error('Borrowing plan exceeds atomic proof bound');
  return { writes };
}
function prepareBorrowApproval({ state, rows, input, event, generation }) {
  checkEvent(event, state.company, 'STOCK_TRANSFER_APPROVED');
  if (event.initiatedByStaffId !== input.approvedBy || !same(event.details.approval, input)) throw Error('Approval event mismatch');
  const { after } = approveBorrow(state, input);
  return { state: after, plan: mapTransition({ before: state, after, rows, event, generation }) };
}
function prepareBorrowingReceipt({ state, rows, event, generation }) {
  checkEvent(event, state.company, 'WAREHOUSE_RECEIPT_SAVED');
  if (!Array.isArray(event.details.lines) || !event.details.lines.length
    || new Set(event.details.lines.map(l => l.taskId)).size !== event.details.lines.length) throw Error('Distinct validated receipt lines required');
  let after = copy(state);
  for (const line of event.details.lines) {
    const source = after.sources.find(s => s.id === line.taskId);
    if (!source || source.poId !== event.description || source.accepted !== line.beforeAccepted
      || !source.orderId || !source.sourceLineId || line.orderId !== source.orderId || line.sourceLineId !== source.sourceLineId
      || source.planned !== line.planned || !count(line.beforeRejected) || !count(line.rejected)
      || line.kind !== 'CORRECTION' && line.rejected < line.beforeRejected
      || !['DELIVERY', 'PARTIAL', 'SHORT', 'DAMAGED', 'WRONG', 'OTHER', 'CORRECTION'].includes(line.kind)) throw Error('Original accepted receipt context mismatch');
    const input = { expectedRevision: after.revision, sourceId: source.id, cumulativeAccepted: line.accepted, reason: line.reason };
    after = (line.kind === 'CORRECTION' ? correctAccepted(after, input) : receive(after, input)).after;
  }
  // One product revision per atomic PO save, including multiple source lines.
  after.revision = state.revision + 1;
  return { state: after, plan: mapTransition({ before: state, after, rows, event, generation }) };
}
function prepareBorrowReturn({ state, rows, input, event, generation }) {
  checkEvent(event, state.company, 'STOCK_TRANSFER_RETURNED');
  if (event.initiatedByStaffId !== input.approvedBy || !same(event.details.return, input)) throw Error('Return approval event mismatch');
  const { after } = returnUnusedBorrow(state, input);
  return { state: after, plan: mapTransition({ before: state, after, rows, event, generation }) };
}
function prepareCurrentAllocation({ state, rows, event, generation }) {
  // Legacy original allocation details do not contain company. Server authority must
  // bind the workspace company; preserve original event details without adding fields.
  if (!event || event.action !== 'PLANNER_ALLOCATION_SAVED' || event.result !== 'SAVED'
    || !event._id || event._id !== event.title || !event.initiatedByStaffId || !event.activityTime
    || event.details?.sourceTaskId !== event.imageAltText) throw Error('Original validated allocation event required');
  const source = state.sources.find(s => s.id === event.details.sourceTaskId);
  if (!source || source.accepted !== event.details.accepted || event.description !== source.orderId) throw Error('Allocation source authority mismatch');
  for (const target of event.details.targets || []) {
    const task = state.tasks.find(t => t.id === target.taskId);
    if (!task || target.orderId !== task.orderId || target.sourceLineId !== task.sourceLineId || target.customerId !== task.customerId) throw Error('Allocation demand authority mismatch');
  }
  const { after } = allocateCumulative(state, { expectedRevision: state.revision, sourceId: source.id,
    targets: event.details.targets, reason: event.details.reason });
  return { state: after, plan: mapTransition({ before: state, after, rows, event, generation }) };
}
function prepareSalesDemand({ state, rows, event, generation }) {
  const d = event?.details, task = state.tasks.find(t => t.id === event?.imageAltText);
  if (!event || event.action !== 'SALES_ORDER_ADJUSTMENT_SAVED' || event.result !== 'SAVED' || !event._id || event._id !== event.title
    || !event.initiatedByStaffId || !event.activityTime || !task || event.image !== task.customerId
    || d?.customerId !== task.customerId || d.orderId !== task.orderId || d.sourceLineId !== task.sourceLineId
    || d.plan?.company !== state.company || d.plan?.id !== event.description) throw Error('Original validated Sales adjustment event required');
  const { after } = adjustDemand(state, { expectedRevision: state.revision, taskId: task.id, beforeRequested: d.beforeRequested,
    requested: d.requested, mode: d.mode, allocations: d.allocations });
  return { state: after, plan: mapTransition({ before: state, after, rows, event, generation }) };
}
function prepareShipmentDispatch({ state, rows, event, priorShipment, generation }) {
  const shipment = event?.details?.shipment;
  if (!event || event.action !== 'CUSTOMER_SHIPMENT_CHANGED' || event.result !== 'SAVED' || !event._id || event.title !== event._id
    || !event.initiatedByStaffId || !event.activityTime || shipment?.status !== 'DISPATCHED' || shipment.company !== state.company
    || event.description !== shipment.id || event.image !== shipment.customerId || !shipment.dispatch?.reference
    || priorShipment?.status !== 'INVOICED' || priorShipment.company !== state.company || priorShipment.id !== shipment.id
    || priorShipment.customerId !== shipment.customerId || priorShipment.revision !== event.details.beforeRevision
    || !priorShipment.invoice?.number || !same(priorShipment.invoice, shipment.invoice) || !same(priorShipment.lines, shipment.lines)) throw Error('Original invoiced dispatch transition required');
  for (const line of shipment.lines) {
    const task = state.tasks.find(t => t.id === line.taskId);
    if (!task || task.customerId !== shipment.customerId || task.orderId !== line.orderId || task.sourceLineId !== line.sourceLineId
      || line.barcode !== state.barcode || line.packing !== state.packing) throw Error('Dispatch task identity conflict');
  }
  const { after } = dispatchReserved(state, { expectedRevision: state.revision, lines: shipment.lines });
  return { state: after, plan: mapTransition({ before: state, after, rows, event, generation }) };
}
function prepareFreeQuarantine({ state, rows, event, generation }) {
  checkEvent(event, state.company, 'STOCK_EXCEPTION_REPORTED');
  const source = state.sources.find(s => s.id === event.imageAltText);
  if (!source || event.description !== source.orderId || event.image !== source.sourceLineId) throw Error('Original quarantine source identity mismatch');
  const reserved = event.details.quantity > source.available;
  const taskId = reserved ? Object.entries(source.claims).filter(([, quantity]) => quantity > 0)[0]?.[0] : null;
  const { after } = (reserved ? quarantineReserved : quarantineFree)(state, { expectedRevision: state.revision, sourceId: source.id,
    ...(reserved ? { taskId } : {}), quantity: event.details.quantity, kind: event.details.kind, reason: event.details.reason });
  const plan = mapTransition({ before: state, after, rows, event, generation });
  plan.writes[0].after.stockAttribution = reserved ? 'CUSTOMER' : 'FREE';
  if (reserved) plan.writes[0].after.stockCustomerTaskId = taskId;
  plan.writes[0].after.stockKey = stockKey(state);
  return { state: after, plan };
}
function prepareFreeCaseMovement({ state, rows, event, caseEvent, priorResolution, generation }) {
  const d = event?.details, previous = priorResolution || {}, next = d?.state, action = d?.action;
  if (!event || event.action !== 'STOCK_EXCEPTION_RESOLUTION_SAVED' || event.result !== 'SAVED' || !event._id || event._id !== event.title
    || !event.initiatedByStaffId || !event.activityTime || !['RETURN', 'REPLACEMENT'].includes(action)
    || caseEvent?.action !== 'STOCK_EXCEPTION_REPORTED' || caseEvent.result !== 'SAVED' || caseEvent._id !== caseEvent.title
    || !['FREE', 'CUSTOMER'].includes(caseEvent.stockAttribution) || caseEvent.stockAttribution === 'CUSTOMER' && !state.tasks.some(task => task.id === caseEvent.stockCustomerTaskId)
    || caseEvent.stockKey !== stockKey(state) || caseEvent.company !== state.company
    || event.description !== caseEvent.title || event.imageAltText !== caseEvent.imageAltText || next?.caseId !== caseEvent.title
    || d.beforeRevision !== (previous.revision || '') || previous.financeApproval || next.financeApproval || next.adminApproval
    || !next.decision || next.decision.value === 'PENDING'
    || action === 'RETURN' && next.decision.disposition !== 'RETURN'
    || action === 'REPLACEMENT' && next.decision.value !== 'REPLACE') throw Error('Original approved free-case movement required');
  const field = action === 'RETURN' ? 'returns' : 'replacements';
  const oldEntries = previous[field] || [], newEntries = next[field];
  const oldFixed = copy(previous), newFixed = copy(next); delete oldFixed.revision; delete oldFixed[field]; delete newFixed[field];
  if (!Array.isArray(newEntries) || newEntries.length !== oldEntries.length + 1 || !same(oldEntries, newEntries.slice(0, -1))
    || !same(oldFixed, newFixed) || newEntries.some(e => !count(e.quantity) || !e.quantity || !e.reference)
    || total(newEntries.map(e => e.quantity)) > caseEvent.details.quantity) throw Error('Immutable case movement history required');
  const { after } = freeCaseMovement(state, { expectedRevision: state.revision, sourceId: caseEvent.imageAltText,
    ...(caseEvent.stockAttribution === 'CUSTOMER' ? { customerTaskId: caseEvent.stockCustomerTaskId } : {}), action, quantity: newEntries.at(-1).quantity });
  return { state: after, plan: mapTransition({ before: state, after, rows, event, generation }) };
}
function prepareFreeCaseRelease({ state, rows, event, caseEvent, priorResolution, generation }) {
  const next = event?.details?.state, previous = priorResolution, approval = next?.financeApproval;
  if (!event || event.action !== 'STOCK_EXCEPTION_RESOLUTION_SAVED' || event.result !== 'SAVED' || event._id !== event.title || !event._id
    || !event.activityTime || !event.initiatedByStaffId || event.details.action !== 'CLOSE'
    || !['FREE', 'CUSTOMER'].includes(caseEvent?.stockAttribution) || caseEvent.stockAttribution === 'CUSTOMER' && !state.tasks.some(task => task.id === caseEvent.stockCustomerTaskId)
    || caseEvent.action !== 'STOCK_EXCEPTION_REPORTED' || caseEvent.result !== 'SAVED'
    || caseEvent.company !== state.company || caseEvent.stockKey !== stockKey(state) || caseEvent._id !== caseEvent.title
    || event.description !== caseEvent.title || event.imageAltText !== caseEvent.imageAltText || next?.caseId !== caseEvent.title
    || !previous || previous.financeApproval || event.details.beforeRevision !== previous.revision
    || previous.adminApproval?.outcome !== 'RELEASED' || previous.adminApproval.quantity !== caseEvent.details.quantity
    || approval?.outcome !== 'RELEASED' || approval.byStaffId !== event.initiatedByStaffId
    || approval.byStaffId === previous.adminApproval.byStaffId || !previous.adminApproval.byStaffId
    || (previous.returns || []).length || (previous.replacements || []).length) throw Error('Original separate Admin and Finance release approval required');
  const oldFixed = copy(previous), newFixed = copy(next); delete oldFixed.revision; delete newFixed.financeApproval;
  if (!same(oldFixed, newFixed)) throw Error('Release must preserve original case approval facts');
  const { after } = releaseFreeCase(state, { expectedRevision: state.revision, sourceId: caseEvent.imageAltText,
    ...(caseEvent.stockAttribution === 'CUSTOMER' ? { customerTaskId: caseEvent.stockCustomerTaskId } : {}), quantity: caseEvent.details.quantity });
  return { state: after, plan: mapTransition({ before: state, after, rows, event, generation }) };
}
function prepareProcurementTransition({ state, after, rows, event, generation }) {
  guardProcurementStock({ before: state, after });
  const next = { ...copy(after), revision: state.revision + 1 };
  return { state: next, plan: mapTransition({ before: state, after: next, rows, event, generation }) };
}
function preparePackingHoldTransition({ state, rows, event, generation, packingHolds }) {
  const after = { ...copy(state), revision: state.revision + 1, packingHolds: copy(packingHolds) };
  // validate(after) also retains explicitly customer-attributed damaged holds.
  // Original paired packing validation must prevent executing the isolated units.
  return { state: after, plan: mapTransition({ before: state, after, rows, event, generation }) };
}
module.exports = { prepareBorrowApproval, prepareBorrowReturn, prepareBorrowingReceipt, prepareCurrentAllocation, prepareSalesDemand, prepareShipmentDispatch, prepareFreeQuarantine, prepareFreeCaseMovement, prepareFreeCaseRelease, prepareProcurementTransition, preparePackingHoldTransition, transferId };

},
// borrowing-model.cjs sha256:6d3ad925af60b77fbe5484dfb16724cd97eafb2e47abac1f7406f4a897f9e6cf
"borrowing-model.cjs": (load, module) => {
'use strict';

// Isolated business specification. Complete, trusted product snapshots only.
// No CMS access or production authorization: caller must retain real permission,
// PO validity, financial locks, packing guards and conditional commit validation.
const { stockKey } = load("current-model.cjs");
const clone = value => JSON.parse(JSON.stringify(value));
const count = n => Number.isSafeInteger(n) && n >= 0;
const positive = n => count(n) && n > 0;
const sum = values => {
  const result = values.reduce((a, b) => a + b, 0);
  if (!count(result)) throw Error('Quantity overflow');
  return result;
};
const reserved = (state, taskId) => sum(state.sources.map(s => s.claims[taskId] || 0));
const isolatedFor = (state, taskId) => sum(state.sources.map(s => s.isolatedClaims?.[taskId] || 0));
const remaining = relation => relation.quantity - relation.repaid - (relation.returned || 0);
const outgoing = (state, sourceId) => sum(state.relations.filter(r => r.replacementSourceId === sourceId).map(remaining));
const incoming = (state, taskId) => sum(state.relations.filter(r => r.lenderTaskId === taskId).map(remaining));
const legacyHeld = (state, taskId) => state.packingHolds.legacyBlockedByTask?.[taskId] === true;
function validate(state) {
  if (state.complete !== true || !count(state.revision) || !Array.isArray(state.tasks)
    || !Array.isArray(state.sources) || !Array.isArray(state.relations)) throw Error('Complete snapshot required');
  if (state.scope != null && (state.scope !== 'CURRENT_ACTIVE_PRODUCT' || state.lifecycleVersion !== 2)) throw Error('Known current lifecycle scope required');
  const key = stockKey(state), tasks = new Map(), sources = new Map(), ids = new Set(), sequences = new Set();
  if (state.packingHolds?.complete !== true || state.packingHolds.company !== state.company
    || state.packingHolds.scope !== 'TASK_TOTAL' || !state.packingHolds.version
    || !state.packingHolds.heldByTask || Array.isArray(state.packingHolds.heldByTask)) throw Error('Verified task packing snapshot required');
  for (const task of state.tasks) {
    if (!task.id || tasks.has(task.id) || !task.customerId || !count(task.requested) || !count(task.dispatched)
      || task.dispatched > task.requested || stockKey(task) !== key) throw Error('Task identity or demand conflict');
    tasks.set(task.id, task);
  }
  if (state.packingHolds.legacyBlockedByTask && (typeof state.packingHolds.legacyBlockedByTask !== 'object'
    || Array.isArray(state.packingHolds.legacyBlockedByTask) || Object.entries(state.packingHolds.legacyBlockedByTask).some(([id, flag]) => !tasks.has(id) || typeof flag !== 'boolean'))) throw Error('Legacy preparation guard requires review');
  for (const source of state.sources) {
    const freeOnly = source.ownerTaskId === null && source.ownerShare === 0 && source.receiptPolicy === 'EXPLICIT_ONLY';
    if (!source.id || sources.has(source.id) || !tasks.has(source.ownerTaskId) && !freeOnly || !source.poId
      || source.poValid !== true || stockKey(source) !== key || source.reviewRequired !== false
      || !['OWNER_DEMAND', 'EXPLICIT_ONLY'].includes(source.receiptPolicy)
      || !['planned', 'accepted', 'onHand', 'isolated', 'available'].every(k => count(source[k]))
      || !count(source.ownerShare) || source.ownerShare > source.planned
      || source.accepted > source.planned || !source.claims) throw Error('Source identity or balance conflict');
    for (const [taskId, qty] of Object.entries(source.claims)) {
      if (!tasks.has(taskId) || !count(qty)) throw Error('Claim conflict');
    }
    if (source.isolatedClaims && (typeof source.isolatedClaims !== 'object' || Array.isArray(source.isolatedClaims))) throw Error('Isolated customer attribution conflict');
    for (const [taskId, qty] of Object.entries(source.isolatedClaims || {})) {
      if (!tasks.has(taskId) || !count(qty)) throw Error('Isolated customer attribution conflict');
    }
    if (sum(Object.values(source.isolatedClaims || {})) > source.isolated) throw Error('Isolated customer attribution exceeds physical stock');
    for (const [taskId, qty] of Object.entries(source.dispatchedByTask || {})) {
      if (!tasks.has(taskId) || !count(qty)) throw Error('Dispatch provenance conflict');
    }
    if (source.onHand !== sum([source.available, source.isolated, ...Object.values(source.claims)])) throw Error('Physical balance conflict');
    if (!count(source.replacementReceived ?? 0) || !count(source.supplierReturned ?? 0)
      || sum([source.onHand, source.supplierReturned || 0, ...Object.values(source.dispatchedByTask || {})])
        !== sum([source.accepted, source.replacementReceived || 0])) throw Error('Receipt/dispatch provenance conflict');
    sources.set(source.id, source);
  }
  for (const relation of state.relations) {
    const from = sources.get(relation.lenderSourceId), future = sources.get(relation.replacementSourceId);
    if (!relation.id || ids.has(relation.id) || !positive(relation.sequence) || sequences.has(relation.sequence)
      || !from || !future || from.id === future.id || !positive(relation.quantity) || !count(relation.repaid)
      || !count(relation.returned ?? 0) || relation.repaid + (relation.returned || 0) > relation.quantity
      || relation.returned > 0 && (!relation.returnReason || !relation.returnApprovedBy)
      || !relation.approvedBy || !relation.reason
      || !tasks.has(relation.lenderTaskId) || !tasks.has(relation.borrowerTaskId)
      || from.ownerTaskId !== relation.lenderTaskId || future.ownerTaskId !== relation.borrowerTaskId
      || relation.borrowerTaskId === relation.lenderTaskId
      || tasks.get(relation.borrowerTaskId).customerId === tasks.get(relation.lenderTaskId).customerId) throw Error('Borrowing relation conflict');
    ids.add(relation.id); sequences.add(relation.sequence);
  }
  // v2 current-state counters survive omission of CLOSED relationship history.
  // They must be initialized by verified parity, never inferred from a partial list.
  if (state.lifecycleVersion != null && state.lifecycleVersion !== 2) throw Error('Unknown stock lifecycle');
  if (state.lifecycleVersion === 2) {
    if (!positive(state.nextBorrowSequence) || state.relations.some(r => r.sequence >= state.nextBorrowSequence)) throw Error('Borrow sequence checkpoint conflict');
    for (const source of state.sources) {
      if (!count(source.borrowRepaidCumulative) || source.borrowRepaidCumulative > source.accepted
        || sum(state.relations.filter(r => r.replacementSourceId === source.id).map(r => r.repaid)) > source.borrowRepaidCumulative) throw Error('Source repayment checkpoint conflict');
    }
  }
  for (const task of state.tasks) {
    if (!Object.hasOwn(state.packingHolds.heldByTask, task.id) || !count(state.packingHolds.heldByTask[task.id])
      || state.packingHolds.heldByTask[task.id] > sum([reserved(state, task.id), isolatedFor(state, task.id)])
      || state.packingHolds.heldByTask[task.id] > task.requested - task.dispatched) throw Error('Packing task coverage requires review');
    const outside = state.scope === 'CURRENT_ACTIVE_PRODUCT' && state.lifecycleVersion === 2 ? task.dispatchedOutsideScope : 0;
    if (!count(outside) || sum([outside, ...state.sources.map(s => s.dispatchedByTask?.[task.id] || 0)]) !== task.dispatched) throw Error('Task dispatch provenance conflict');
    if (sum([task.dispatched, reserved(state, task.id), incoming(state, task.id)]) > task.requested) throw Error('Customer coverage exceeded');
  }
  for (const source of state.sources) {
    if (outgoing(state, source.id) > Math.max(0, source.ownerShare - source.accepted)) throw Error('Future supply already committed');
  }
  return state;
}
function transition(before, expectedRevision, change) {
  validate(before);
  if (before.revision !== expectedRevision) throw Error('Snapshot changed');
  const after = clone(before);
  change(after);
  after.revision += 1;
  validate(after);
  return { beforeRevision: expectedRevision, after };
}
function approveBorrow(before, input) {
  return transition(before, input.expectedRevision, state => {
    if (!positive(input.quantity) || !input.id || state.relations.some(r => r.id === input.id)
      || !String(input.approvedBy || '').trim() || !String(input.reason || '').trim()) throw Error('Approval evidence required');
    const donor = state.sources.find(s => s.id === input.lenderSourceId);
    const future = state.sources.find(s => s.id === input.replacementSourceId);
    const borrower = state.tasks.find(t => t.id === input.borrowerTaskId);
    if (!donor || !future || !borrower || !state.tasks.some(t => t.id === donor.ownerTaskId) || future.ownerTaskId !== borrower.id || donor.ownerTaskId === borrower.id
      || legacyHeld(state, borrower.id)
      || state.packingHolds.heldByTask[borrower.id] !== 0 && (input.quantity > isolatedFor(state, borrower.id)
        || input.quantity > borrower.requested - borrower.dispatched - reserved(state, borrower.id) - incoming(state, borrower.id))) throw Error('Eligible unheld borrower required');
    const lender = donor.ownerTaskId;
    if (state.packingHolds.heldByTask[lender] !== 0 || legacyHeld(state, lender)) throw Error('Packing task holds lender allocation');
    if (input.quantity > (donor.claims[lender] || 0)
      || input.quantity > Math.max(0, future.ownerShare - future.accepted) - outgoing(state, future.id)
      || input.quantity > borrower.requested - borrower.dispatched - reserved(state, borrower.id) - incoming(state, borrower.id)) throw Error('Insufficient eligible stock, demand or future supply');
    donor.claims[lender] -= input.quantity;
    donor.claims[borrower.id] = (donor.claims[borrower.id] || 0) + input.quantity;
    const sequence = state.lifecycleVersion === 2 ? state.nextBorrowSequence : Math.max(0, ...state.relations.map(r => r.sequence)) + 1;
    if (!positive(sequence) || sequence >= Number.MAX_SAFE_INTEGER) throw Error('Borrow sequence exhausted');
    if (state.lifecycleVersion === 2) state.nextBorrowSequence++;
    state.relations.push({ id: input.id, sequence, lenderSourceId: donor.id, replacementSourceId: future.id,
      lenderTaskId: lender, borrowerTaskId: borrower.id, quantity: input.quantity, repaid: 0, returned: 0,
      approvedBy: input.approvedBy, reason: input.reason });
  });
}
function receive(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    if (!source || !count(input.cumulativeAccepted) || input.cumulativeAccepted < source.accepted
      || input.cumulativeAccepted > source.planned) throw Error('Validated accepted receipt required');
    let left = input.cumulativeAccepted - source.accepted;
    source.accepted = input.cumulativeAccepted;
    source.onHand += left;
    for (const relation of state.relations.filter(r => r.replacementSourceId === source.id).sort((a, b) => a.sequence - b.sequence)) {
      const take = Math.min(left, remaining(relation));
      if (take) source.claims[relation.lenderTaskId] = (source.claims[relation.lenderTaskId] || 0) + take;
      relation.repaid += take;
      if (state.lifecycleVersion === 2) source.borrowRepaidCumulative = sum([source.borrowRepaidCumulative, take]);
      left -= take;
    }
    const owner = state.tasks.find(t => t.id === source.ownerTaskId);
    const need = owner ? owner.requested - owner.dispatched - reserved(state, owner.id) - incoming(state, owner.id) : 0;
    const repaidFromSource = state.lifecycleVersion === 2 ? source.borrowRepaidCumulative
      : sum(state.relations.filter(r => r.replacementSourceId === source.id).map(r => r.repaid));
    const ownCapacity = owner ? Math.max(0, source.ownerShare - repaidFromSource - (source.claims[owner.id] || 0) - (source.dispatchedByTask?.[owner.id] || 0)) : 0;
    const own = source.receiptPolicy === 'EXPLICIT_ONLY' ? 0 : Math.min(left, need, ownCapacity);
    if (own) source.claims[owner.id] = (source.claims[owner.id] || 0) + own;
    source.available += left - own;
  });
}
function dispatch(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId), task = state.tasks.find(t => t.id === input.taskId);
    if (!source || !task || !positive(input.quantity) || input.quantity > (source.claims[task.id] || 0)
      || state.packingHolds.heldByTask[task.id] !== 0 || legacyHeld(state, task.id)) throw Error('Validated dispatch source required');
    source.claims[task.id] -= input.quantity;
    source.onHand -= input.quantity;
    source.dispatchedByTask = { ...(source.dispatchedByTask || {}),
      [task.id]: (source.dispatchedByTask?.[task.id] || 0) + input.quantity };
    task.dispatched += input.quantity;
  });
}
function returnUnusedBorrow(before, input) {
  return transition(before, input.expectedRevision, state => {
    const r = state.relations.find(r => r.id === input.relationId);
    if (!r || !positive(input.quantity) || input.quantity > remaining(r)
      || !String(input.approvedBy || '').trim() || !String(input.reason || '').trim()) throw Error('Approved unused borrowing return required');
    const source = state.sources.find(s => s.id === r.lenderSourceId);
    // Conservative: do not guess which relationship supplied already shipped cartons.
    if ((source.dispatchedByTask?.[r.borrowerTaskId] || 0) > 0
      || state.packingHolds.heldByTask[r.borrowerTaskId] > 0 || state.packingHolds.heldByTask[r.lenderTaskId] > 0
      || legacyHeld(state, r.borrowerTaskId) || legacyHeld(state, r.lenderTaskId)
      || (source.claims[r.borrowerTaskId] || 0) < input.quantity) throw Error('Borrowed stock already used or held');
    source.claims[r.borrowerTaskId] -= input.quantity;
    source.claims[r.lenderTaskId] = (source.claims[r.lenderTaskId] || 0) + input.quantity;
    r.returned = (r.returned || 0) + input.quantity;
    r.returnApprovedBy = input.approvedBy; r.returnReason = input.reason;
  });
}
function correctAccepted(before, input) {
  if (!String(input.reason || '').trim()) throw Error('Receipt correction reason required');
  const prior = before.sources.find(s => s.id === input.sourceId);
  if (!prior || !count(input.cumulativeAccepted)) throw Error('Receipt correction basis required');
  if (input.cumulativeAccepted >= prior.accepted) return receive(before, input);
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    let reduction = source.accepted - input.cumulativeAccepted;
    const free = Math.min(reduction, source.available);
    source.available -= free; reduction -= free;
    const removeClaim = (taskId, max) => {
      const take = Math.min(reduction, source.claims[taskId] || 0, max);
      if (take && (state.packingHolds.heldByTask[taskId] > 0 || legacyHeld(state, taskId))) throw Error('Packing task holds corrected allocation');
      if (take) source.claims[taskId] = (source.claims[taskId] || 0) - take;
      reduction -= take; return take;
    };
    removeClaim(source.ownerTaskId, Number.MAX_SAFE_INTEGER);
    // Reverse most recently approved repayments first; original supplier PO never changes.
    for (const r of state.relations.filter(r => r.replacementSourceId === source.id).sort((a, b) => b.sequence - a.sequence)) {
      const take = removeClaim(r.lenderTaskId, r.repaid);
      r.repaid -= take;
      if (state.lifecycleVersion === 2) source.borrowRepaidCumulative -= take;
    }
    if (reduction) throw Error('Correction would consume shipped, isolated or unrelated allocations');
    source.onHand -= source.accepted - input.cumulativeAccepted;
    source.accepted = input.cumulativeAccepted;
  });
}
function procurementOutstanding(state, taskId) {
  validate(state);
  return state.relations.filter(r => remaining(r) > 0 && [r.borrowerTaskId, r.lenderTaskId].includes(taskId))
    .map(r => ({ relationId: r.id, remaining: remaining(r), direction: r.borrowerTaskId === taskId ? 'REPAY' : 'AWAIT' }));
}
// Display facts, not a replacement for existing invoice/financial archive gates.
function taskCoverage(state, taskId) {
  validate(state);
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) throw Error('Task missing');
  const usable = reserved(state, taskId), pendingReplacement = incoming(state, taskId);
  return { taskId, requested: task.requested, dispatched: task.dispatched, reservedUsable: usable,
    pendingReplacement, uncovered: task.requested - task.dispatched - usable - pendingReplacement,
    deliveryQuantityComplete: task.dispatched === task.requested,
    transfers: procurementOutstanding(state, taskId) };
}
// Legacy allocation targets are cumulative, including already dispatched cartons.
// Do not substitute current remaining claims into that existing contract.
function cumulativeTargets(state, sourceId) {
  validate(state);
  const source = state.sources.find(s => s.id === sourceId);
  if (!source) throw Error('Source missing');
  const ids = new Set([...Object.keys(source.claims), ...Object.keys(source.dispatchedByTask || {})]);
  return [...ids].sort().map(taskId => ({ taskId,
    quantity: sum([source.claims[taskId] || 0, source.dispatchedByTask?.[taskId] || 0]) })).filter(t => t.quantity > 0);
}
function allocateCumulative(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    if (!source || !Array.isArray(input.targets) || !String(input.reason || '').trim()
      || new Set(input.targets.map(t => t.taskId)).size !== input.targets.length) throw Error('Validated cumulative allocation required');
    const next = {};
    for (const target of input.targets) {
      const shipped = source.dispatchedByTask?.[target.taskId] || 0;
      if (!state.tasks.some(t => t.id === target.taskId) || !count(target.quantity) || target.quantity < shipped) throw Error('Allocation cannot remove dispatched provenance');
      next[target.taskId] = target.quantity - shipped;
    }
    for (const [taskId, shipped] of Object.entries(source.dispatchedByTask || {})) {
      if (shipped && !Object.hasOwn(next, taskId)) throw Error('Dispatched allocation target must remain');
    }
    const ids = new Set([...Object.keys(source.claims), ...Object.keys(next)]);
    for (const taskId of ids) {
      if ((next[taskId] || 0) < (source.claims[taskId] || 0)) {
        // Existing task-total packing evidence cannot prove source-specific release.
        if (state.packingHolds.heldByTask[taskId] > 0 || legacyHeld(state, taskId)) throw Error('Packing task holds allocation');
        if (state.relations.some(r => remaining(r) > 0
          && [r.lenderSourceId, r.replacementSourceId].includes(source.id)
          && [r.borrowerTaskId, r.lenderTaskId].includes(taskId))) throw Error('Outstanding borrowing allocation requires dedicated transfer return or repayment');
        // No release-then-reassign bypass of the both-PO borrowing approval rule.
        // Customer cancellation/approved release needs its own fact-bound transition.
        throw Error('Customer reservation release requires borrowing or approved cancellation workflow');
      }
    }
    const reserved = sum(Object.values(next));
    if (reserved > source.onHand - source.isolated) throw Error('Allocation exceeds usable physical stock');
    source.claims = next;
    source.available = source.onHand - source.isolated - reserved;
    source.receiptPolicy = 'EXPLICIT_ONLY';
  });
}
function adjustDemand(before, input) {
  return transition(before, input.expectedRevision, state => {
    const task = state.tasks.find(t => t.id === input.taskId);
    if (!task || !['INCREASE', 'SPLIT', 'REDUCE'].includes(input.mode) || !positive(input.requested)
      || input.requested > 9999 || input.beforeRequested !== task.requested || !Array.isArray(input.allocations)
      || new Set(input.allocations.map(a => a.sourceTaskId)).size !== input.allocations.length
      || (input.mode === 'INCREASE' ? input.requested <= task.requested : input.mode === 'SPLIT' ? input.requested !== task.requested : input.requested >= task.requested)
      || input.mode !== 'REDUCE' && input.allocations.length) throw Error('Validated demand adjustment required');
    for (const change of input.allocations) {
      const source = state.sources.find(s => s.id === change.sourceTaskId);
      if (!source || !Array.isArray(change.targets) || new Set(change.targets.map(t => t.taskId)).size !== change.targets.length) throw Error('Distinct cancellation source allocation required');
      const prior = cumulativeTargets(before, source.id), targets = new Map(change.targets.map(t => [t.taskId, t.quantity]));
      for (const [id, quantity] of targets) {
        if (!count(quantity) || !state.tasks.some(t => t.id === id)) throw Error('Known cancellation allocation required');
      }
      const ids = new Set([...prior.map(t => t.taskId), ...targets.keys()]);
      for (const id of ids) {
        if (id !== task.id && (targets.get(id) || 0) !== (prior.find(t => t.taskId === id)?.quantity || 0)) throw Error('Cancellation cannot alter another customer allocation');
      }
      const shipped = source.dispatchedByTask?.[task.id] || 0, current = source.claims[task.id] || 0;
      const cumulative = targets.get(task.id) || 0, release = current + shipped - cumulative;
      if (release < 0 || release > current) throw Error('Cancellation cannot create stock or remove dispatched provenance');
      if (release && (state.packingHolds.heldByTask[task.id] > 0 || legacyHeld(state, task.id))) throw Error('Packing task holds cancellation');
      if (release && state.relations.some(r => remaining(r) > 0 && [r.lenderSourceId, r.replacementSourceId].includes(source.id)
        && [r.borrowerTaskId, r.lenderTaskId].includes(task.id))) throw Error('Resolve borrowing before releasing linked customer stock');
      if (release) { source.claims[task.id] = current - release; source.available += release; source.receiptPolicy = 'EXPLICIT_ONLY'; }
    }
    task.requested = input.requested;
    // Missing implicit/batch ownership evidence fails final coverage validation; never
    // infer a release from an aggregate requested delta or steal another batch's stock.
  });
}
function dispatchReserved(before, input) {
  return transition(before, input.expectedRevision, state => {
    if (!Array.isArray(input.lines) || !input.lines.length || new Set(input.lines.map(l => l.taskId)).size !== input.lines.length) throw Error('Distinct validated shipment lines required');
    for (const line of input.lines) {
      const task = state.tasks.find(t => t.id === line.taskId);
      if (!task || !positive(line.quantity) || !Array.isArray(line.sources) || !line.sources.length
        || new Set(line.sources.map(s => s.sourceTaskId)).size !== line.sources.length
        || line.sources.some(s => !positive(s.quantity)) || sum(line.sources.map(s => s.quantity)) !== line.quantity
        || state.packingHolds.heldByTask[task.id] < line.quantity) throw Error('Confirmed shipment reservation required');
      // Consume THIS invoice reservation only; other active instructions stay held.
      state.packingHolds.heldByTask[task.id] -= line.quantity;
      for (const portion of line.sources) {
        const source = state.sources.find(s => s.id === portion.sourceTaskId);
        if (!source || portion.quantity > (source.claims[task.id] || 0)) throw Error('Dispatch exceeds source customer ownership');
        source.claims[task.id] -= portion.quantity; source.onHand -= portion.quantity;
        source.dispatchedByTask = { ...(source.dispatchedByTask || {}), [task.id]: (source.dispatchedByTask?.[task.id] || 0) + portion.quantity };
      }
      task.dispatched += line.quantity;
    }
  });
}
function quarantineFree(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    if (!source || !positive(input.quantity) || !['INTERNAL_DAMAGE', 'WRONG_ITEM', 'SHORT_EXPIRY'].includes(input.kind)
      || !String(input.reason || '').trim()) throw Error('Original stock exception required');
    // Only unassigned free quantity can be moved without choosing a customer's loss.
    // Reserved/held/borrowed attribution needs its own reviewed exception workflow.
    if (input.quantity > source.available) throw Error('Exception affects reserved stock; customer attribution review required');
    source.available -= input.quantity; source.isolated += input.quantity;
  });
}
function quarantineReserved(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    const owners = source ? Object.entries(source.claims).filter(([, qty]) => qty > 0) : [];
    // Existing source-only form supplies no customer allocation authority. Only
    // an entirely reserved source with ONE factual customer claim is unambiguous.
    // Mixed free/customer or multiple claims needs Purchase attribution review.
    if (!source || source.available !== 0 || owners.length !== 1 || owners[0][0] !== input.taskId
      || !positive(input.quantity) || input.quantity > owners[0][1]
      || !['INTERNAL_DAMAGE', 'WRONG_ITEM', 'SHORT_EXPIRY'].includes(input.kind)
      || !String(input.reason || '').trim()) throw Error('Reserved stock customer attribution review required');
    source.claims[input.taskId] -= input.quantity;
    source.isolatedClaims = { ...(source.isolatedClaims || {}), [input.taskId]: (source.isolatedClaims?.[input.taskId] || 0) + input.quantity };
    source.isolated += input.quantity;
  });
}
function restoreAttributed(state, source, taskId, quantity) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) throw Error('Original isolated customer unavailable');
  // This is replacement/restoration of the ALREADY accepted case goods, not a
  // new cumulative PO delivery. Do not consume or clear future-PO loan promises.
  const need = task.requested - task.dispatched - reserved(state, taskId) - incoming(state, taskId);
  const own = Math.min(quantity, need);
  source.claims[taskId] = (source.claims[taskId] || 0) + own;
  source.available += quantity - own;
}
function freeCaseMovement(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    if (!source || !positive(input.quantity) || !['RETURN', 'REPLACEMENT'].includes(input.action)) throw Error('Validated free-case physical movement required');
    if (input.action === 'RETURN') {
      if (input.quantity > source.isolated) throw Error('Supplier return exceeds isolated stock');
      if (input.customerTaskId) {
        if (input.quantity > (source.isolatedClaims?.[input.customerTaskId] || 0)) throw Error('Supplier return exceeds attributed isolated stock');
        if (state.packingHolds.heldByTask[input.customerTaskId] > reserved(state, input.customerTaskId)) throw Error('Confirm packing shortage correction before supplier return');
        source.isolatedClaims[input.customerTaskId] -= input.quantity;
      } else if (input.quantity > source.isolated - sum(Object.values(source.isolatedClaims || {}))) throw Error('Free return cannot consume customer isolation');
      source.isolated -= input.quantity; source.onHand -= input.quantity;
      source.supplierReturned = (source.supplierReturned || 0) + input.quantity;
    } else {
      source.onHand += input.quantity;
      if (input.customerTaskId) restoreAttributed(state, source, input.customerTaskId, input.quantity);
      else source.available += input.quantity;
      source.replacementReceived = (source.replacementReceived || 0) + input.quantity;
    }
  });
}
function releaseFreeCase(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    if (!source || !positive(input.quantity) || input.quantity > source.isolated) throw Error('Approved isolated release quantity required');
    if (input.customerTaskId) {
      if (input.quantity > (source.isolatedClaims?.[input.customerTaskId] || 0)) throw Error('Release exceeds attributed isolated stock');
      source.isolatedClaims[input.customerTaskId] -= input.quantity;
      restoreAttributed(state, source, input.customerTaskId, input.quantity);
    } else {
      if (input.quantity > source.isolated - sum(Object.values(source.isolatedClaims || {}))) throw Error('Free release cannot consume customer isolation');
      source.available += input.quantity;
    }
    source.isolated -= input.quantity;
  });
}
module.exports = { validate, approveBorrow, receive, correctAccepted, returnUnusedBorrow, dispatch, dispatchReserved, adjustDemand, quarantineFree, quarantineReserved, freeCaseMovement, releaseFreeCase,
  allocateCumulative, procurementOutstanding, taskCoverage, cumulativeTargets, relationRemaining: remaining };

},
// procurement-stock-guard.cjs sha256:641ade47290af5aee86953520a9386e8df9ad6b116e4f09c9887ea5bdc0c2db6
"procurement-stock-guard.cjs": (load, module) => {
'use strict';

const { stockKey } = load("current-model.cjs");
const { validate, relationRemaining } = load("borrowing-model.cjs");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Before and after are server projections of ORIGINAL domain before/after images,
// assembled over the SAME exact current rows. Not browser-proposed balance changes.
function guardProcurementStock({ before, after }) {
  validate(before); validate(after);
  if (stockKey(before) !== stockKey(after) || before.revision !== after.revision
    || !same(before.relations, after.relations) || !same(before.packingHolds, after.packingHolds)) throw Error('Procurement cannot rewrite stock generation, transfers or packing instructions');
  if (before.tasks.length !== after.tasks.length) throw Error('Procurement cannot create customer demand');
  const changedSources = [];
  for (const task of before.tasks) {
    const next = after.tasks.find(t => t.id === task.id);
    if (!next || ['customerId', 'orderId', 'sourceLineId', 'requested', 'dispatched'].some(k => next[k] !== task[k])) throw Error('Procurement cannot remove or retarget customer stock provenance');
  }
  for (const source of before.sources) {
    const next = after.sources.find(s => s.id === source.id);
    if (!next) throw Error('Existing stock source cannot disappear from procurement');
    if (['ownerTaskId', 'orderId', 'sourceLineId'].some(k => next[k] !== source[k])) throw Error('Procurement source ownership identity is immutable');
    const related = before.relations.filter(r => [r.lenderSourceId, r.replacementSourceId].includes(source.id));
    if (next.poId !== source.poId && (source.accepted > 0 || related.length)) throw Error('Received or transfer-bound PO substitution requires its dedicated workflow');
    if (before.packingHolds.legacyBlockedByTask?.[source.ownerTaskId] === true
      && (next.planned < source.planned || next.ownerShare < source.ownerShare || next.poId !== source.poId)) throw Error('Legacy Warehouse preparation blocks procurement reduction or substitution');
    if (['accepted', 'onHand', 'isolated', 'available'].some(k => next[k] !== source[k])
      || (next.replacementReceived || 0) !== (source.replacementReceived || 0) || (next.supplierReturned || 0) !== (source.supplierReturned || 0)
      || !same(next.claims, source.claims) || !same(next.dispatchedByTask || {}, source.dispatchedByTask || {})) throw Error('Procurement cannot release ownership or change physical movements');
    const lent = related.filter(r => r.lenderSourceId === source.id).reduce((n, r) => n + r.quantity - (r.returned || 0), 0);
    const committedOwner = (source.claims[source.ownerTaskId] || 0) + (source.dispatchedByTask?.[source.ownerTaskId] || 0) + lent;
    if (next.ownerShare < Math.min(source.ownerShare, committedOwner)) throw Error('Procurement share reduction would erase committed customer stock');
    const pending = related.filter(r => r.replacementSourceId === source.id).reduce((n, r) => n + relationRemaining(r), 0);
    if (Math.max(0, next.ownerShare - next.accepted) < pending) throw Error('Procurement reduction would remove approved replacement supply');
    if (next.planned !== source.planned || next.ownerShare !== source.ownerShare || next.poId !== source.poId) changedSources.push(source.id);
  }
  for (const source of after.sources.filter(s => !before.sources.some(old => old.id === s.id))) {
    if (source.accepted || source.onHand || source.isolated || source.available || source.replacementReceived || source.supplierReturned
      || Object.values(source.claims).some(Boolean) || Object.values(source.dispatchedByTask || {}).some(Boolean)) throw Error('New PO source is not a physical receipt');
    changedSources.push(source.id);
  }
  return { company: before.company, stockKey: stockKey(before), generationUnchanged: true, changedSources };
}
module.exports = { guardProcurementStock };

},
// product-delta.cjs sha256:c3d7cec57dfaf0eaae9fbf5c368731dcc779963eab3263d185521e7c5c736a29
"product-delta.cjs": (load, module) => {
'use strict';

// Inductive current balance: initial parity + every exact changed-source delta.
// This is a pure mapper, not an initializer, reader or permission boundary.
const { hash } = load("commit-proof.cjs");
const { stockKey } = load("current-model.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const fields = ['onHand', 'reservedUsable', 'available', 'isolated'];
const count = n => Number.isSafeInteger(n) && n >= 0;
function sourceTotals(source) {
  const reservedUsable = Object.values(source.claims || {}).reduce((sum, n) => {
    if (!count(n) || !count(sum + n)) throw Error('Source claim total overflow'); return sum + n;
  }, 0);
  const totals = { onHand: source.onHand, reservedUsable, available: source.available, isolated: source.isolated };
  if (!fields.every(k => count(totals[k])) || !count(reservedUsable + totals.available + totals.isolated)
    || totals.onHand !== reservedUsable + totals.available + totals.isolated) throw Error('Known source balance required');
  return totals;
}
function rollForwardProduct({ identity, product, beforeSources, afterSources, generation, revision, lifecycle }) {
  const company = identity?.company, key = stockKey(identity), id = hash(company, key);
  if (!['NCT', 'GHR'].includes(company) || !count(generation) || !count(revision)
    || !Array.isArray(beforeSources) || !Array.isArray(afterSources)
    || new Set(beforeSources.map(s => s.id)).size !== beforeSources.length
    || new Set(afterSources.map(s => s.id)).size !== afterSources.length) throw Error('Exact source delta scope required');
  if (product && (product._id !== id || product.company !== company || product.stockKey !== key || !product._version
    || product.revision !== revision || product.reviewRequired === true || product.reviewCodes?.length
    || !fields.every(k => count(product[k])) || product.onHand !== product.reservedUsable + product.available + product.isolated)) throw Error('Known product checkpoint required');
  if (product?.lifecycleVersion === 2 && !lifecycle) throw Error('Product lifecycle context missing');
  const afterById = new Map(afterSources.map(s => [s.id, s])), delta = Object.fromEntries(fields.map(k => [k, 0]));
  const beforeTotals = Object.fromEntries(fields.map(k => [k, 0]));
  const priorIds = new Set(beforeSources.map(s => s.id));
  for (const source of afterSources.filter(s => !priorIds.has(s.id))) {
    // Procurement may add a zero/nonphysical source before PO confirmation. The
    // existing source mapper has not written a physical position for it yet.
    if (!source.id || stockKey(source) !== key || Object.values(sourceTotals(source)).some(n => n !== 0)) throw Error('New source must remain nonphysical');
  }
  for (const before of beforeSources) {
    const after = afterById.get(before.id);
    if (!before.id || !after || stockKey(before) !== key || stockKey(after) !== key) throw Error('Source delta identity conflict');
    const old = sourceTotals(before), next = sourceTotals(after);
    if (!product && fields.some(k => old[k] !== 0)) throw Error('Product checkpoint missing');
    for (const field of fields) {
      beforeTotals[field] += old[field];
      if (!count(beforeTotals[field]) || product && beforeTotals[field] > product[field]) throw Error('Source delta exceeds product checkpoint');
      delta[field] += next[field] - old[field];
      if (!Number.isSafeInteger(delta[field])) throw Error('Product delta overflow');
    }
  }
  if (!product && revision !== 0) throw Error('Product checkpoint missing');
  const totals = Object.fromEntries(fields.map(k => [k, (product?.[k] || 0) + delta[k]]));
  if (!fields.every(k => count(totals[k])) || !count(totals.reservedUsable + totals.available + totals.isolated)
    || totals.onHand !== totals.reservedUsable + totals.available + totals.isolated || !count(revision + 1) || !count(generation + 1)) throw Error('Product delta balance conflict');
  const result = { ...(product || { _id: id, schemaVersion: 1, company, stockKey: key,
    barcode: identity.barcode, packing: identity.packing, ea: identity.ea, name: identity.name || '' }),
    ...totals, revision: revision + 1, checkpointGeneration: generation + 1, reviewRequired: false,
    status: totals.onHand === 0 ? 'CLOSED' : 'ACTIVE' };
  if (lifecycle) {
    if (lifecycle.version !== 2 || !Number.isSafeInteger(lifecycle.nextBorrowSequence) || lifecycle.nextBorrowSequence <= 0
      || product && (product.lifecycleVersion !== 2 || !Number.isSafeInteger(product.nextBorrowSequence)
        || lifecycle.nextBorrowSequence < product.nextBorrowSequence)) throw Error('Product lifecycle delta conflict');
    Object.assign(result, { lifecycleVersion: 2, nextBorrowSequence: lifecycle.nextBorrowSequence });
  }
  return copy(result);
}
module.exports = { rollForwardProduct, sourceTotals };

},
// receipt-read-snapshot.cjs sha256:dcb6c45312538c75a194aa7ec864374186e8050af310ee3bf28d85f12d37c581
"receipt-read-snapshot.cjs": (load, module) => {
'use strict';

// Private preparation-only read coalescing INSIDE the existing readSnapshot.
// Not a new stock authority: the unchanged scoped reader/model still validate
// every image. No cache escapes preparation, no writes/apply/verify use it.
const { hash } = load("commit-proof.cjs");
const { stockKey } = load("current-model.cjs");
const { copy, same, utf8Bytes } = load("segmented-plan.cjs");
const count = n => Number.isSafeInteger(n) && n >= 0;
async function createReceiptReadSnapshot({ company, products, items, store, transferIndexVersion,
  metrics = { queries: 0, exactReads: 0 }, maxRowsPerSet = 2000, maxSnapshotRows = 10000, maxSnapshotBytes = 8 * 1024 * 1024 }) {
  if (!['NCT', 'GHR'].includes(company) || transferIndexVersion !== 2 || typeof items?.query !== 'function'
    || typeof store?.readMany !== 'function' || typeof store?.normalizeListedRow !== 'function'
    || !Array.isArray(products) || !products.length || products.length > 300
    || !Number.isSafeInteger(maxRowsPerSet) || maxRowsPerSet < 1 || !Number.isSafeInteger(maxSnapshotRows)
    || maxSnapshotRows < 1 || !Number.isSafeInteger(maxSnapshotBytes) || maxSnapshotBytes < 1) throw Error('Private bounded receipt snapshot dependencies required');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', keys = new Set(), scopes = new Map(), images = new Map();
  let inputIdentities = 0, imageBytes = 0;
  for (const product of products) {
    const key = stockKey(product.identity), scope = product.stockScope;
    if (product.identity.company !== company || keys.has(key) || !scope
      || ['sourceTaskIds', 'correctionSourceIds', 'claimPairs'].some(field => !Array.isArray(scope[field]))
      || scope.sourceTaskIds.length + scope.correctionSourceIds.length + scope.claimPairs.length > maxRowsPerSet
      || [...scope.sourceTaskIds, ...scope.correctionSourceIds].some(id => typeof id !== 'string' || !id)
      || scope.claimPairs.some(p => !p || typeof p.sourceTaskId !== 'string' || !p.sourceTaskId || typeof p.taskId !== 'string' || !p.taskId)) throw Error('Explicit receipt product scope required');
    keys.add(key); scopes.set(key, scope);
    inputIdentities += 1 + scope.sourceTaskIds.length + scope.correctionSourceIds.length + scope.claimPairs.length;
    if (inputIdentities > maxSnapshotRows) throw Error('Receipt snapshot input policy');
  }
  function put(collection, id, row) {
    if (row && (row._id !== id || row.company !== company || !keys.has(row.stockKey))) throw Error('Receipt snapshot identity conflict');
    const address = collection + '/' + id;
    if (images.has(address) && !same(images.get(address), row)) throw Error('Receipt snapshot image changed');
    if (!images.has(address)) {
      imageBytes += utf8Bytes(JSON.stringify([address, row]));
      if (imageBytes > maxSnapshotBytes) throw Error('Receipt snapshot byte policy');
    }
    images.set(address, row ? copy(row) : null);
    if (images.size > maxSnapshotRows) throw Error('Receipt snapshot row policy');
  }
  function rows(collection) { return [...images].filter(([address, row]) => address.startsWith(collection + '/') && row).map(([, row]) => row); }
  async function exactMany(collection, ids) {
    const requested = [...new Set(ids)];
    // Preserve the old reader's exact confirmation of listed images, now one
    // complete strong batch per <=50 IDs rather than a request for each row.
    for (let offset = 0; offset < requested.length; offset += 2000) {
      const batch = requested.slice(offset, offset + 2000);
      metrics.exactReads += Math.ceil(batch.length / 50);
      const result = await store.readMany(collection, batch);
      if (!Array.isArray(result) || result.length !== batch.length) throw Error('Incomplete receipt exact batch');
      result.forEach((row, index) => put(collection, batch[index], row));
    }
  }
  const matches = (row, filters) => filters.every(([method, field, value]) => method === 'eq' ? row[field] === value : row[field] > value);
  async function loadSet(collection, field, values, filters) {
    const requested = [...new Set(values)];
    for (let offset = 0; offset < requested.length; offset += 50) {
      const batch = requested.slice(offset, offset + 50), allowed = new Set(batch), listedIds = [], perProduct = new Map();
      let cursor = null, total;
      do {
        let q = items.query(collection).eq('company', company).hasSome(field, batch);
        for (const [method, name, value] of filters) q = q[method](name, value);
        if (cursor) q = q.gt('_id', cursor);
        metrics.queries++;
        const page = await q.ascending('_id').limit(100).find({ consistentRead: true, returnTotalCount: true });
        if (!Array.isArray(page?.items) || !count(page.totalCount) || page.totalCount > maxSnapshotRows
          || total !== undefined && page.totalCount !== total - listedIds.length
          || page.items.length !== Math.min(100, page.totalCount)) throw Error('Incomplete receipt current set');
        if (total === undefined) total = page.totalCount;
        for (const raw of page.items) {
          if (typeof raw?._id !== 'string' || !raw._id || cursor && raw._id <= cursor) throw Error('Receipt snapshot cursor conflict');
          const row = store.normalizeListedRow(collection, raw);
          if (!row || !allowed.has(row[field]) || !matches(row, filters)) throw Error('Receipt snapshot query conflict');
          put(collection, raw._id, row); listedIds.push(raw._id); cursor = raw._id;
          perProduct.set(row.stockKey, (perProduct.get(row.stockKey) || 0) + 1);
          if (perProduct.get(row.stockKey) > maxRowsPerSet) throw Error('Receipt snapshot product fanout policy');
        }
      } while (listedIds.length < total);
      await exactMany(collection, listedIds);
    }
  }
  const active = [['eq', 'status', 'ACTIVE']], transfer = [['eq', 'action', 'STOCK_TRANSFER_CURRENT']];
  await exactMany('R2StockProducts', [...keys].map(key => hash(company, key)));
  await loadSet('R2StockPositions', 'stockKey', [...keys], active);
  await loadSet('R2StockClaims', 'stockKey', [...keys], active);
  await loadSet(journal, 'stockKey', [...keys], [...transfer, ...active]);
  const corrections = [...scopes.values()].flatMap(scope => scope.correctionSourceIds);
  await loadSet(journal, 'replacementSourceId', corrections, [...transfer, ['gt', 'repaidQuantity', 0]]);
  const sourceIds = new Set(rows('R2StockPositions').map(row => row._id)), pairs = [];
  for (const [key, scope] of scopes) {
    for (const source of [...scope.sourceTaskIds, ...scope.correctionSourceIds, ...scope.claimPairs.map(p => p.sourceTaskId)]) sourceIds.add(hash(company, key, 'PURCHASE_SOURCE', source));
    for (const pair of scope.claimPairs) pairs.push({ key, ...pair });
  }
  for (const claim of rows('R2StockClaims')) sourceIds.add(claim.positionId);
  for (const row of rows(journal)) {
    const r = row.details?.relation;
    if (!r || !r.lenderSourceId || !r.replacementSourceId || !r.lenderTaskId || !r.borrowerTaskId) throw Error('Receipt transfer scope conflict');
    for (const sourceTaskId of [r.lenderSourceId, r.replacementSourceId]) {
      sourceIds.add(hash(company, row.stockKey, 'PURCHASE_SOURCE', sourceTaskId));
      for (const taskId of [r.lenderTaskId, r.borrowerTaskId]) pairs.push({ key: row.stockKey, sourceTaskId, taskId });
    }
  }
  await exactMany('R2StockPositions', [...sourceIds]);
  const positions = rows('R2StockPositions');
  await loadSet('R2StockClaims', 'positionId', positions.map(row => row._id), [['gt', 'dispatchedCumulative', 0]]);
  await exactMany('R2StockClaims', pairs.map(p => hash(company, hash(company, p.key, 'PURCHASE_SOURCE', p.sourceTaskId), p.taskId)));
  const readablePositions = new Set(positions.map(row => row._id)), correctionSet = new Set(corrections);
  return {
    store: { read: async (collection, id) => {
      const address = collection + '/' + id;
      if (!images.has(address)) throw Error('Receipt snapshot exact scope not prepared');
      return copy(images.get(address));
    } },
    readSet: async (collection, key, filters) => {
      const valid = keys.has(key) && (collection === 'R2StockPositions' && same(filters, active)
        || collection === 'R2StockClaims' && (same(filters, active) || filters.length === 2
          && filters[0][0] === 'eq' && filters[0][1] === 'positionId' && readablePositions.has(filters[0][2]) && same(filters[1], ['gt', 'dispatchedCumulative', 0]))
        || collection === journal && (same(filters, [...transfer, ...active]) || filters.length === 3
          && same(filters[0], transfer[0]) && filters[1][0] === 'eq' && filters[1][1] === 'replacementSourceId'
          && correctionSet.has(filters[1][2]) && same(filters[2], ['gt', 'repaidQuantity', 0])));
      if (!valid) throw Error('Receipt snapshot set scope not prepared');
      const selected = rows(collection).filter(row => row.stockKey === key && matches(row, filters)).sort((a, b) => a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
      if (selected.length > maxRowsPerSet) throw Error('Receipt snapshot product fanout policy');
      return copy(selected);
    }
  };
}
module.exports = { createReceiptReadSnapshot };

},
// borrowing-authority.cjs sha256:f4501272505daed8f3ffd3a07d8269595756a11cb2a198fe620dd07a4a0deaf4
"borrowing-authority.cjs": (load, module) => {
'use strict';

// Server authority candidate using existing auth, PO projection, allocation/shipment
// parsers and packing rules. No browser-supplied staff/poValid/complete fields accepted.
const { hash } = load("commit-proof.cjs");
const { stockKey } = load("current-model.cjs");
const { transferId } = load("borrowing-stock-plan.cjs");
const { originalProductState } = load("original-product-state.cjs");
const count = value => Number.isSafeInteger(value) && value >= 0;
function createBorrowingAuthority({ readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords,
  projectPurchaseOrders, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation, readTransfer, readCurrentTaskRows, now = () => new Date() }) {
  for (const fn of [readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords, projectPurchaseOrders,
    readAllocations, readCustomerShipments, readPackingLists, packingHeld, readTransfer]) if (typeof fn !== 'function') throw Error('Existing server authority dependency required');
  return async ({ company, requestId, kind, input }) => {
    if (!['NCT', 'GHR'].includes(company) || !['APPROVE', 'RETURN'].includes(kind) || !input
      || !/^[a-f0-9-]{36}$/i.test(requestId || '') || !count(input.expectedRevision)
      || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000
      || !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 9999) throw Error('Valid stock transfer request required');
    const ids = kind === 'APPROVE' ? [input.borrowerTaskId, input.lenderSourceId, input.replacementSourceId] : [input.relationId];
    if (ids.some(id => typeof id !== 'string' || !id || id.length > 128)) throw Error('Stable stock transfer identities required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePurchaseStaff(member, []);
    const staff = requirePurchaseStaff(member, await readStaffRecords());
    // Existing auth grants Purchase/Super Admin/Top Management, not a newly invented Planner role.
    const context = await readContext(company, { ...staff, memberId: member._id });
    if (context.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
      || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Authoritative company context required');
    let relation = null, relationKey = null;
    if (kind === 'RETURN') {
      const record = await readTransfer(company, input.relationId);
      if (!record || record._id !== transferId(company, input.relationId) || record.company !== company
        || record.action !== 'STOCK_TRANSFER_CURRENT' || record.details?.relation?.id !== input.relationId) throw Error('Existing transfer unavailable');
      relation = record.details.relation;
      relationKey = record.stockKey;
    }
    const borrowerId = relation?.borrowerTaskId || input.borrowerTaskId;
    const borrower = context.tasks.find(t => t.id === borrowerId);
    if (!borrower || borrower.procurementSource || borrower.specialPurchase) throw Error('Customer demand task required');
    const identity = { company, barcode: borrower.barcode, packing: borrower.packing, ea: borrower.ea }, key = stockKey(identity);
    if (relation && relationKey !== key) throw Error('Transfer product identity conflict');
    const records = await readPurchaseRecords(company, staff);
    const orders = projectPurchaseOrders({ company, workspace: context, records });
    const product = originalProductState({ company, context, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
    const { sources, demands } = product;
    const donorId = relation?.lenderSourceId || input.lenderSourceId, futureId = relation?.replacementSourceId || input.replacementSourceId;
    const donor = sources.find(s => s.id === donorId), future = sources.find(s => s.id === futureId);
    if (!donor || !future || future.ownerTaskId !== borrowerId) throw Error('Matching lender and borrower POs required');
    const affected = [borrower, demands.find(t => t.id === donor.ownerTaskId)];
    if (affected.some(t => !t || t.salesInvoiceNumber || t.salesInvoiceLocked)) throw Error('Invoiced customer allocation requires its existing correction workflow');
    const safeInput = kind === 'APPROVE'
      ? { expectedRevision: input.expectedRevision, id: hash(company, requestId, member._id, 'BORROW'), quantity: input.quantity,
        lenderSourceId: donorId, replacementSourceId: futureId, borrowerTaskId: borrowerId, approvedBy: staff.staffId, reason: input.reason.trim() }
      : { expectedRevision: input.expectedRevision, relationId: input.relationId, quantity: input.quantity, approvedBy: staff.staffId, reason: input.reason.trim() };
    const eventId = hash(company, requestId, member._id, kind === 'APPROVE' ? 'BORROW_APPROVED' : 'BORROW_RETURNED');
    const event = { _id: eventId, title: eventId, description: safeInput.id || safeInput.relationId,
      action: kind === 'APPROVE' ? 'STOCK_TRANSFER_APPROVED' : 'STOCK_TRANSFER_RETURNED', result: 'SAVED',
      activityTime: now().toISOString(), actorType: 'STAFF', initiatedByStaffId: staff.staffId, initiatedByStaffName: staff.staffName,
      details: { company, [kind === 'APPROVE' ? 'approval' : 'return']: safeInput } };
    return { kind, identity, input: safeInput, event, memberId: member._id, buildState: product.buildState,
      readTaskRows: typeof readCurrentTaskRows === 'function' ? rows => readCurrentTaskRows(company, product.scopeTaskIds(rows), { ...staff, memberId: member._id }) : null,
      stockScope: { sourceTaskIds: [donorId, futureId], claimPairs: [donorId, futureId].flatMap(sourceTaskId =>
        [borrowerId, donor.ownerTaskId].map(taskId => ({ sourceTaskId, taskId }))) } };
  };
}
module.exports = { createBorrowingAuthority };

},
// borrowing-stock-reader.cjs sha256:cdbbd7556451053de6dbb8e89792f3408b971bd7dada656b4d05e4156069a7ac
"borrowing-stock-reader.cjs": (load, module) => {
'use strict';

// Bounded current-row preparation candidate. Authority callback is SERVER-owned and
// must retain existing permission/PO/packing/finance checks. No production imports.
const { readCurrentProduct } = load("current-product-reader.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { prepareBorrowApproval, prepareBorrowReturn, prepareBorrowingReceipt, prepareCurrentAllocation } = load("borrowing-stock-plan.cjs");
function createBorrowingStockReader({ company, items, store, protocol, readAuthority }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function' || typeof store?.read !== 'function'
    || typeof protocol?.readSnapshot !== 'function' || typeof readAuthority !== 'function') throw Error('Server borrowing dependencies required');
  return async () => {
    const metrics = { exactReads: 0, queries: 0 };
    const snapshot = await protocol.readSnapshot(async control => {
      const authority = await readAuthority();
      const identity = authority?.identity || authority?.state;
      if (!identity || identity.company !== company || !['APPROVE', 'RETURN', 'RECEIVE', 'ALLOCATE'].includes(authority.kind)
        || !authority.state && typeof authority.buildState !== 'function') throw Error('Verified borrowing authority required');
      if (protocol.planFormat === 'SEGMENTED_V2' && (!authority.stockScope || authority.state)) throw Error('Server borrowing current scope required');
      const rows = protocol.planFormat === 'SEGMENTED_V2'
        ? await readScopedCurrentProduct({ ...authority.stockScope, company, identity, items, store, metrics, transferIndexVersion: control?.transferIndexVersion })
        : await readCurrentProduct({ company, identity, items, store, metrics });
      if (protocol.planFormat === 'SEGMENTED_V2') {
        if (typeof authority.readTaskRows !== 'function') throw Error('Private current task checkpoint reader required');
        rows.taskRows = await authority.readTaskRows(rows); rows.generation = control.generation;
      }
      if (typeof authority.buildState === 'function') authority.state = authority.buildState(rows);
      if (typeof authority.prepareFromState === 'function') {
        const prepared = await authority.prepareFromState(authority.state);
        if (!prepared?.event) throw Error('Original current-state validation incomplete');
        authority.event = prepared.event; authority.expectedVersion = prepared.expectedVersion;
      }
      return { authority, rows };
    });
    const { authority, rows } = snapshot.rows;
    const args = { state: authority.state, rows, event: authority.event, generation: snapshot.generation };
    const result = authority.kind === 'ALLOCATE' ? prepareCurrentAllocation(args) : authority.kind === 'RECEIVE' ? prepareBorrowingReceipt(args)
      : (authority.kind === 'APPROVE' ? prepareBorrowApproval : prepareBorrowReturn)({ ...args, input: authority.input });
    return { ...result, memberId: authority.memberId, generation: snapshot.generation, metrics };
  };
}
module.exports = { createBorrowingStockReader };

},
// allocation-authority.cjs sha256:25ad6fc2b10b11a79de6583cc7ba74d272a970d5421eeac840dad47c6fe8a4ac
"allocation-authority.cjs": (load, module) => {
'use strict';

const { originalProductState } = load("original-product-state.cjs");
const { validateOriginalAllocation } = load("original-allocation-validation.cjs");
const { currentAllocationContext } = load("current-allocation-context.cjs");
// Ordinary free-stock assignment only. Moving existing customer reservations is
// handled by approved borrowing/cancellation, NOT unrestricted legacy redistribution.
function createAllocationAuthority({ readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords,
  projectPurchaseOrders, createPlannerAllocationOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation,
  readCurrentTaskRows, allocationViewVersion, currentPlan = false, now = () => new Date() }) {
  if (typeof currentPlan !== 'boolean') throw Error('Explicit server allocation mode required');
  if (currentPlan && allocationViewVersion !== 2) throw Error('Verified original CURRENT allocation view required');
  for (const fn of [readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords, projectPurchaseOrders,
    createPlannerAllocationOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld]) {
    if (typeof fn !== 'function') throw Error('Existing Purchase allocation dependency required');
  }
  return async ({ company, requestId, input, staffId: admittedStaffId }) => {
    if (!['NCT', 'GHR'].includes(company) || !/^[a-f0-9-]{36}$/i.test(requestId || '')
      || input?.action !== 'ALLOCATE' || typeof input.sourceTaskId !== 'string' || !input.sourceTaskId) throw Error('Valid allocation request required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePurchaseStaff(member, []);
    const staff = { ...requirePurchaseStaff(member, await readStaffRecords()), memberId: member._id };
    // Bound by the private current-save command, not browser actor/approval flags.
    if (admittedStaffId !== undefined && staff.staffId !== admittedStaffId) throw Error('Allocation identity changed');
    const context = await readContext(company, staff);
    if (context.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
      || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Authoritative company context required');
    if (currentPlan && (!Array.isArray(input.targets) || input.targets.length > 300
      || input.targets.some(t => typeof t.taskId !== 'string' || !t.taskId))) throw Error('Bounded original allocation targets required');
    const validated = currentPlan ? null : await validateOriginalAllocation({ createPlannerAllocationOperations, company, staff, requestId,
      input, workspace: context, activity: context.activity, now });
    const source = context.tasks.find(t => t.id === (validated?.event.details.sourceTaskId || input.sourceTaskId));
    if (!source) throw Error('Allocation source unavailable');
    const identity = { company, barcode: source.barcode, packing: source.packing, ea: source.ea };
    const records = await readPurchaseRecords(company, staff);
    const orders = projectPurchaseOrders({ company, workspace: context, records });
    const product = originalProductState({ company, context, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
    if (!product.sources.some(s => s.id === source.id && (!validated || s.accepted === validated.event.details.accepted))) throw Error('Allocation receipt authority mismatch');
    return { kind: 'ALLOCATE', memberId: member._id, identity, event: validated?.event,
      expectedVersion: validated?.expectedVersion, buildState: product.buildState,
      stockScope: { sourceTaskIds: [source.id], demandTaskIds: currentPlan ? input.targets.map(t => t.taskId) : [],
        claimPairs: currentPlan ? input.targets.map(t => ({ sourceTaskId: source.id, taskId: t.taskId })) : [] },
      readTaskRows: typeof readCurrentTaskRows === 'function' ? rows => readCurrentTaskRows(company, product.scopeTaskIds(rows), staff) : null,
      prepareFromState: currentPlan ? async state => {
        const workspace = currentAllocationContext({ state, context, readAllocations });
        const result = await validateOriginalAllocation({ createPlannerAllocationOperations, company, staff, requestId, input,
          workspace, activity: context.activity, now });
        if (result.event.details.accepted !== state.sources.find(s => s.id === source.id)?.accepted) throw Error('Allocation accepted receipt authority changed');
        return result;
      } : null };
  };
}
module.exports = { createAllocationAuthority };

},
// original-allocation-validation.cjs sha256:2ca48b4261ea465f53b4888ec2e9aace7d9130d33d0eb4786358ba50c0c234d8
"original-allocation-validation.cjs": (load, module) => {
'use strict';

const copy = value => JSON.parse(JSON.stringify(value));
// Private validation-only original journal. No real store is accepted. Its lock
// exists in local memory only; original apply is never allowed to save separately.
async function validateOriginalAllocation({ createPlannerAllocationOperations, company, staff, requestId, input, workspace, activity, now }) {
  if (typeof createPlannerAllocationOperations !== 'function' || !['NCT', 'GHR'].includes(company)
    || workspace?.company !== company || !Array.isArray(activity) || typeof now !== 'function') throw Error('Original allocation validation dependencies required');
  const collection = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const scratch = new Map(), boundary = new Error('Private allocation prepare boundary');
  let captured, reads = 0;
  const scope = c => { if (c !== collection) throw Error('Unexpected allocation journal collection'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    all: async c => { scope(c); return copy(activity); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'PLANNER_ALLOCATION_SAVED') throw Error('Unexpected allocation preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Legacy allocation apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    },
    remove: async (c, id) => { scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private allocation lock may be removed'); scratch.delete(id); }
  };
  const save = createPlannerAllocationOperations({ store, names: { [company]: { activity: collection } }, now,
    readWorkspace: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected allocation apply/read');
      return copy(workspace);
    } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original allocation boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original allocation preparation incomplete');
  return captured;
}
module.exports = { validateOriginalAllocation };

},
// current-allocation-context.cjs sha256:7000187d68b8c61e672d547690b9f30b9a75fee06c80be40eac54e2a4b6ea5f7
"current-allocation-context.cjs": (load, module) => {
'use strict';

const { validate, cumulativeTargets } = load("borrowing-model.cjs");
const clone = value => JSON.parse(JSON.stringify(value));
// Compatibility VIEW only, never an independent writer or a synthetic stored event.
// Current physical ownership + actual dispatched provenance is authoritative at ACTIVE.
// Existing allocation revision is kept for the original append-only history chain.
function currentAllocationContext({ state, context, readAllocations }) {
  validate(state);
  if (context.company !== state.company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
    || typeof readAllocations !== 'function' || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Original authenticated allocation context required');
  const prior = readAllocations(context.activity), currentSources = new Set(state.sources.map(s => s.id));
  const tasks = new Map(state.tasks.map(t => [t.id, t]));
  for (const task of state.tasks) {
    const original = context.tasks.find(t => t.id === task.id);
    if (!original || original.customerId !== task.customerId || original.orderId !== task.orderId || original.sourceLineId !== task.sourceLineId
      || original.barcode !== state.barcode || original.packing !== state.packing || original.ea !== state.ea
      || (original.requested ?? original.ord) !== task.requested) throw Error('Current demand and original task identity differ');
  }
  const converted = state.sources.map(source => {
    const old = prior.find(a => a.sourceTaskId === source.id);
    return { sourceTaskId: source.id, revision: old?.revision || '', at: old?.at || null, by: old?.by || '',
      targets: cumulativeTargets(state, source.id).map(target => {
        const task = tasks.get(target.taskId);
        return { taskId: target.taskId, orderId: task.orderId, sourceLineId: task.sourceLineId, customerId: task.customerId, quantity: target.quantity };
      }) };
  });
  return { ...clone(context), ...(state.lifecycleVersion === 2 ? { stockAllocationView: 'CURRENT_V2' } : {}),
    allocations: [...prior.filter(a => !currentSources.has(a.sourceTaskId)), ...converted],
    tasks: context.tasks.map(original => {
      const task = tasks.get(original.id);
      if (!task) return clone(original);
      // Original inc/customerReceived contract is cumulative, NOT current onHand.
      const inc = (task.dispatchedOutsideScope || 0) + converted.reduce((n, a) => n + (a.targets.find(t => t.taskId === task.id)?.quantity || 0), 0);
      return { ...clone(original), inc };
    }) };
}
module.exports = { currentAllocationContext };

},
// purchase-stock-preparation.cjs sha256:9a9fb849f6e8b9d049f22f9a016163d3cb7428ba9171195b6061bd3dc5bdb539
"purchase-stock-preparation.cjs": (load, module) => {
'use strict';

const { domainCollections } = load("domain-scope.cjs");
const { stockKey } = load("current-model.cjs");
const { validateOriginalPurchase } = load("original-purchase-validation.cjs");
const { preparePurchaseDomain } = load("purchase-domain-plan.cjs");
const { projectDomainAfter } = load("domain-after-snapshot.cjs");
const { originalProductState } = load("original-product-state.cjs");
const { readCurrentProduct } = load("current-product-reader.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { preparePurchaseStock } = load("purchase-stock-plan.cjs");
const { hash } = load("commit-proof.cjs");
const { validateOriginalSource, prepareSourceDomain } = load("original-source-validation.cjs");
// Server-owned adapter candidate, intended as fenced commit.prepare. It is not a
// gateway, does not apply a legacy save, and cannot certify unconnected co-writers.
function createPurchaseStockPreparation(deps) {
  const { company, readMember, readStaffRecords, requirePurchaseStaff, readTables, protocol, items, store,
    createPurchaseOperations, createPurchaseSourceOperations, taskEditVersion, operationId, projectPurchaseWorkspace, projectPurchaseOrders,
    readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation, now } = deps;
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requirePurchaseStaff, readTables,
    createPurchaseOperations, taskEditVersion, operationId, projectPurchaseWorkspace, projectPurchaseOrders,
    readAllocations, readCustomerShipments, readPackingLists, packingHeld, now].some(f => typeof f !== 'function')
    || typeof protocol?.readSnapshot !== 'function' || typeof items?.query !== 'function' || typeof store?.read !== 'function') throw Error('Server Purchase stock dependencies required');
  const current = protocol.planFormat === 'SEGMENTED_V2';
  if (current && typeof deps.readCurrentTaskRows !== 'function') throw Error('Private v2 Purchase task checkpoint reader required');
  const planFormat = current ? 'SEGMENTED_V2' : 'PROOF_V1';
  return async request => {
    if (request?.company !== company) throw Error('Purchase company conflict');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePurchaseStaff(member, []);
    const staff = { ...requirePurchaseStaff(member, await readStaffRecords()), memberId: member._id };
    // Private current-save admission identity, not an input/browser approval.
    if (request.staffId !== undefined && request.staffId !== staff.staffId) throw Error('Purchase preparation identity changed');
    const trusted = { company, staff: request.operation === 'ADD_SOURCE' ? { ...staff, canAddPurchaseSource: true } : staff,
      requestId: request.requestId, operation: request.operation, input: request.input };
    const metrics = { queries: 0, exactReads: 0 };
    const snapshot = await protocol.readSnapshot(async control => {
      let tables = await readTables(company, staff);
      const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
      const lockId = hash(company + '/PURCHASE', 'LOCK'), lock = tables[journal]?.find(row => row._id === lockId);
      if (lock) {
        const current = await store.read(journal, lockId), owner = hash(company + '/PURCHASE', request.requestId, member._id);
        // This is a private read-only snapshot for ORIGINAL validation, not removal
        // of the real lock. Other request, legacy, mismatched or unknown locks stay blocked.
        if (lock.company !== company || lock.owner !== owner || typeof lock.attempt !== 'string' || !lock.attempt
          || lock.action || lock.details || JSON.stringify(current) !== JSON.stringify(lock)) throw Error('Purchase preparation lock is not owned by this request');
        tables = { ...tables, [journal]: tables[journal].filter(row => row._id !== lockId) };
      }
      const beforeContext = { ...projectPurchaseWorkspace({ company, staff, orders: tables[orders], tasks: tables[tasks], activity: tables[journal], suppliers: tables.SharedSuppliers }), activity: tables[journal] };
      const source = request.operation === 'ADD_SOURCE';
      const validated = source ? await validateOriginalSource({ createPurchaseSourceOperations, request: trusted, tables, workspace: beforeContext, now })
        : await validateOriginalPurchase({ createPurchaseOperations, request: trusted, tables, now });
      const domainPlan = source ? prepareSourceDomain({ validated, request: trusted, tables })
        : preparePurchaseDomain({ validated, request: trusted, tables, taskEditVersion, operationId, planFormat,
          currentDisplayOrderVersion: deps.currentDisplayOrderVersion });
      if (current) for (const write of domainPlan.writes.filter(w => w.collection === tasks && w.before === null)) {
        Object.assign(write.after, { stockCounterSchema: 2, stockDispatchedCumulative: 0, stockCounterGeneration: control.generation + 1 });
      }
      const afterContext = projectDomainAfter({ company, staff, tables, plan: domainPlan, projectPurchaseWorkspace });
      const identities = new Map();
      const changedTaskIds = new Set(domainPlan.writes.filter(w => w.collection === tasks).map(w => w.after._id));
      for (const update of source ? [{ id: validated.task._id }] : validated.updates.filter(update => changedTaskIds.has(update.id))) {
        const found = [beforeContext, afterContext].flatMap(context => context.tasks.filter(t => t.id === update.id));
        if (!found.length) throw Error('Purchase changed task missing from original projection');
        const identity = { company, barcode: found[0].barcode, packing: found[0].packing, ea: found[0].ea }, key = stockKey(identity);
        if (found.some(t => stockKey({ company, barcode: t.barcode, packing: t.packing, ea: t.ea }) !== key)) throw Error('Purchase cannot replace product identity');
        identities.set(key, identity);
      }
      const products = [];
      for (const identity of identities.values()) {
        const builder = context => originalProductState({ company, context, identity,
          orders: projectPurchaseOrders({ company, workspace: context, records: tables.R2PurchaseOrders }),
          readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
        const before = builder(beforeContext), after = builder(afterContext);
        const changedIds = domainPlan.writes.filter(w => w.collection === tasks).map(w => w.after._id);
        const sourceIds = [...new Set([...before.sources, ...after.sources].filter(s => changedIds.includes(s.id)).map(s => s.id))];
        const demandTaskIds = [...new Set([...before.demands, ...after.demands].filter(t => changedIds.includes(t.id)
          || [...before.sources, ...after.sources].some(s => changedIds.includes(s.id) && s.ownerTaskId === t.id)).map(t => t.id))];
        const rows = current ? await readScopedCurrentProduct({ company, identity, items, store, metrics,
          transferIndexVersion: control?.transferIndexVersion, sourceTaskIds: sourceIds, demandTaskIds })
          : await readCurrentProduct({ company, identity, items, store, metrics });
        let beforeRows = rows, afterRows = rows;
        if (current) {
          // Intake/bootstrap must have initialized this product; a Purchase edit
          // is not permission to reconstruct a missing current checkpoint.
          if (!rows.product || rows.product.lifecycleVersion !== 2) throw Error('Current Purchase product checkpoint required');
          const forBuilder = builder => ({ ...rows, sourceTaskIds: rows.sourceTaskIds.filter(id => builder.sources.some(s => s.id === id)) });
          beforeRows = forBuilder(before); afterRows = forBuilder(after);
          const taskIds = [...new Set([...before.scopeTaskIds(beforeRows), ...after.scopeTaskIds(afterRows)])];
          const taskRows = await deps.readCurrentTaskRows(company, taskIds, staff);
          beforeRows = { ...beforeRows, taskRows, generation: control.generation };
          afterRows = { ...afterRows, taskRows, generation: control.generation };
        }
        const unconfirmedSourceIds = afterContext.tasks.filter(t => t.procurementSource && !t.po && t.procurement?.draftPlan
          && stockKey({ company, barcode: t.barcode, packing: t.packing, ea: t.ea }) === stockKey(identity))
          .map(t => t.id).filter(id => domainPlan.writes.some(w => w.collection === tasks && w.after._id === id));
        products.push({ state: before.buildState(beforeRows), after: after.buildState(afterRows), rows, unconfirmedSourceIds });
      }
      return { domainPlan, products };
    });
    // A split-display-only EDIT can legitimately have no changed raw task image.
    // Its one immutable event is still fenced; do not fabricate a stock revision.
    const displayOnly = request.operation === 'EDIT' && request.input?.edits?.length === 0 && request.input.displayRows !== undefined
      && snapshot.rows.domainPlan.writes.every(w => w.collection === (company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1')
        && w.after.action === 'PURCHASE_DISPLAY_ORDER_SAVED');
    return { ...(displayOnly ? { plan: snapshot.rows.domainPlan, states: [] }
      : preparePurchaseStock({ company, ...snapshot.rows, generation: snapshot.generation, planFormat })),
      memberId: staff.memberId, generation: snapshot.generation, metrics };
  };
}
module.exports = { createPurchaseStockPreparation };

},
// original-purchase-validation.cjs sha256:fb02cd51627b14d5e5a996e81179df7308a55f471c90cb32f340eb85cba13ac2
"original-purchase-validation.cjs": (load, module) => {
'use strict';

const { domainCollections } = load("domain-scope.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
// Validation-only invocation of the ORIGINAL prepare. Tables are an authenticated
// server snapshot; no real store, external service or legacy apply is invoked.
async function validateOriginalPurchase({ createPurchaseOperations, request, tables, now }) {
  const company = request?.company, [orders, tasks] = domainCollections(company);
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const allowed = new Set([orders, tasks, journal, 'SharedSuppliers', 'R2PurchaseOrders']);
  if (typeof createPurchaseOperations !== 'function' || typeof now !== 'function'
    || !tables || [...allowed].some(c => !Array.isArray(tables[c])) || Object.keys(tables).some(c => !allowed.has(c))) throw Error('Complete original Purchase snapshot required');
  const scratch = new Map(), boundary = new Error('Private Purchase prepare boundary'); let captured;
  const scope = c => { if (!allowed.has(c)) throw Error('Purchase snapshot scope violation'); };
  const store = {
    all: async c => { scope(c); return copy(tables[c]); },
    read: async (c, id) => { scope(c); return copy(c === journal && scratch.has(id) ? scratch.get(id) : tables[c].find(r => r._id === id) || null); },
    one: async (c, criteria) => { scope(c); return copy(tables[c].find(r => Object.entries(criteria).every(([k, v]) => r[k] === v)) || null); },
    insert: async (c, row) => {
      if (c !== journal) throw Error('Legacy Purchase domain write forbidden during validation');
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.operation !== request.operation) throw Error('Unexpected Purchase preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Legacy Purchase apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      if (c !== journal || scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private Purchase lock may be removed'); scratch.delete(id);
    }
  };
  try { await createPurchaseOperations({ store, now })(copy(request)); throw Error('Original Purchase boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || scratch.size || !Array.isArray(captured.updates) || !Array.isArray(captured.events)) throw Error('Original Purchase preparation incomplete');
  return captured;
}
module.exports = { validateOriginalPurchase };

},
// purchase-domain-plan.cjs sha256:c92088dc3c6726a78b6ac33fa4ae1ad3175b68862885dcda66007f566e9b5240
"purchase-domain-plan.cjs": (load, module) => {
'use strict';

const { domainCollections } = load("domain-scope.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const { utf8Bytes } = load("segmented-plan.cjs");
// Maps unchanged original domain intent. Requires migration-tagged exact row versions.
// Does NOT replace stock/share guards, cost locks or all-writer authorization.
function preparePurchaseDomain({ validated, request, tables, taskEditVersion, operationId, planFormat = 'PROOF_V1', currentDisplayOrderVersion }) {
  if (!['PROOF_V1', 'SEGMENTED_V2'].includes(planFormat)) throw Error('Server Purchase plan format required');
  const company = request.company, [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  if (!validated || validated.operation !== request.operation || !Array.isArray(validated.updates) || !Array.isArray(validated.events)
    || !validated.time || validated.displayOrder && (planFormat !== 'SEGMENTED_V2' || currentDisplayOrderVersion !== 2 || request.operation !== 'EDIT')
    || typeof taskEditVersion !== 'function' || typeof operationId !== 'function') throw Error('Supported original Purchase plan required; display order needs its own adapter');
  const changes = new Map(), writes = [];
  for (const change of validated.updates) {
    if (!change.id || changes.has(change.id) || !change.patch || !change.orderId || !change.lineId) throw Error('Distinct Purchase task intent required');
    changes.set(change.id, change);
    const before = tables[tasks].find(r => r._id === change.id) || null;
    const matches = tables[orders].filter(r => r.title === change.orderId && r.sourceLineId === change.lineId);
    if (matches.length !== 1 || matches[0].salesInvoiceNumber) throw Error('Original customer order unavailable or invoice locked');
    if (before && (before.company !== company || !before._version || taskEditVersion(before) !== change.expected)
      || !before && change.expected !== null) throw Error('Migration-tagged exact Purchase task before-image required');
    const costLock = operationId(company, change.patch.title || change.id, 'COST_LOCK');
    if (tables[journal].some(r => r._id === costLock)) throw Error('Original task cost lock still active');
    if (Object.hasOwn(change.patch, '_version') || Object.hasOwn(change.patch, 'company') || change.patch._id && change.patch._id !== change.id) throw Error('Purchase patch cannot replace protocol ownership');
    if (before && (before.description !== change.orderId || before.imageAltText !== change.lineId)) throw Error('Purchase task identity conflict');
    const after = { ...(before || {}), ...copy(change.patch), _id: change.id, company };
    if (!before || taskEditVersion(before) !== taskEditVersion(after)) writes.push({ collection: tasks, before: copy(before), after });
  }
  for (const event of validated.events) {
    const change = changes.get(event.taskId);
    if (!change || !event.action) throw Error('Original Purchase event task missing');
    const id = operationId(company, request.requestId, request.staff.memberId, event.taskId, event.action);
    writes.push({ collection: journal, before: null, after: { _id: id, title: id, company, description: change.orderId,
      image: change.lineId, imageAltText: event.shareRootId || event.taskId, action: event.action, activityTime: validated.time,
      actorType: 'STAFF', initiatedByStaffId: request.staff.staffId, initiatedByStaffName: request.staff.staffName,
      result: 'SAVED', message: event.action.replaceAll('_', ' '), details: { requestId: request.requestId, ...copy(event) } } });
  }
  if (validated.displayOrder) {
    const id = operationId(company,request.requestId,request.staff.memberId,'PURCHASE_DISPLAY_ORDER');
    writes.push({ collection: journal, before: null, after: { _id: id, title: id, company,
      description: request.input.customerId, action: 'PURCHASE_DISPLAY_ORDER_SAVED', result: 'SAVED', activityTime: validated.time,
      actorType: 'STAFF', initiatedByStaffId: request.staff.staffId, initiatedByStaffName: request.staff.staffName,
      details: { schema: 2, requestId: request.requestId, taskIds: validated.updates.map(row => row.id), displayOrder: copy(validated.displayOrder) } } });
  }
  if (!writes.length || writes.length > (planFormat === 'SEGMENTED_V2' ? 10000 : 30) || utf8Bytes(JSON.stringify({ writes })) > (planFormat === 'SEGMENTED_V2' ? 8 * 1024 * 1024 : 180000)
    || new Set(writes.map(w => w.collection + ':' + w.after._id)).size !== writes.length) throw Error('Purchase domain exceeds atomic proof bound');
  return { writes };
}
module.exports = { preparePurchaseDomain };

},
// domain-after-snapshot.cjs sha256:ce2dc765ba91f00992ebfb247a1ca690a4d445d4da39cfe50642b8ac66a48c44
"domain-after-snapshot.cjs": (load, module) => {
'use strict';

const { domainCollections } = load("domain-scope.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
// Pure simulation of the exact domain images to feed ORIGINAL projectors. Never
// save this snapshot or infer stock from caller-supplied after quantities.
function domainAfterSnapshot({ company, tables, plan }) {
  const journal = company === 'NCT' ? 'R2NCTActivity' : company === 'GHR' ? 'R2NCTActivity1' : null;
  if (!journal) throw Error('Supported company required');
  const allowed = new Set([...domainCollections(company), journal]), result = copy(tables), seen = new Set();
  if (!Array.isArray(plan?.writes)) throw Error('Original conditional domain plan required');
  for (const change of plan.writes) {
    const id = change.after?._id, identity = change.collection + ':' + id;
    if (!allowed.has(change.collection) || !Array.isArray(result[change.collection]) || !id || seen.has(identity)
      || change.after.company !== company) throw Error('Domain after-image scope conflict');
    seen.add(identity);
    const matches = result[change.collection].filter(r => r._id === id);
    if (matches.length > 1 || JSON.stringify(matches[0] || null) !== JSON.stringify(change.before)) throw Error('Exact domain before-image required');
    result[change.collection] = result[change.collection].filter(r => r._id !== id).concat(copy(change.after));
  }
  return result;
}
function projectDomainAfter({ company, staff, tables, plan, projectPurchaseWorkspace }) {
  if (typeof projectPurchaseWorkspace !== 'function') throw Error('Original Purchase projector required');
  const next = domainAfterSnapshot({ company, tables, plan }), [orders, tasks] = domainCollections(company), activity = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  return { ...projectPurchaseWorkspace({ company, staff, orders: next[orders], tasks: next[tasks], activity: next[activity], suppliers: next.SharedSuppliers }), activity: next[activity] };
}
module.exports = { domainAfterSnapshot, projectDomainAfter };

},
// purchase-stock-plan.cjs sha256:e2da6bf2e1e7c3be88cddce91ca4ae02b8fa5c4d96aa8b2b40efe4f5fd9e98cc
"purchase-stock-plan.cjs": (load, module) => {
'use strict';

const { stockKey } = load("current-model.cjs");
const { domainCollections } = load("domain-scope.cjs");
const { prepareProcurementTransition } = load("borrowing-stock-plan.cjs");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const { utf8Bytes } = load("segmented-plan.cjs");
// Private composition seam. Products MUST be server before/after projectors over
// the same exact current rows and original domain after-images, not client states.
// Called inside fenced prepare after original Purchase/auth/version validation.
function preparePurchaseStock({ company, domainPlan, products, generation, planFormat = 'PROOF_V1' }) {
  if (!['PROOF_V1', 'SEGMENTED_V2'].includes(planFormat) || planFormat === 'SEGMENTED_V2'
    && products?.some(p => p.rows?.planFormat !== planFormat || p.rows?.scope !== 'CURRENT_ACTIVE_PRODUCT')) throw Error('Server scoped Purchase plan format required');
  const [, tasks] = domainCollections(company), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  if (!Array.isArray(domainPlan?.writes) || !domainPlan.writes.length || !Array.isArray(products) || !products.length) throw Error('Complete Purchase stock composition required');
  const taskIds = domainPlan.writes.filter(w => w.collection === tasks).map(w => w.after._id);
  const originalEvents = domainPlan.writes.filter(w => w.collection === journal);
  if (!taskIds.length || !originalEvents.length || new Set(taskIds).size !== taskIds.length
    || domainPlan.writes.some(w => ![tasks, journal].includes(w.collection) || w.after?.company !== company)
    || originalEvents.some(w => w.before !== null || w.after.result !== 'SAVED' || !w.after.action?.startsWith('PURCHASE_'))) throw Error('Original Purchase domain intent required');
  const keys = new Set(), coverage = new Map(taskIds.map(id => [id, 0])), writes = [...domainPlan.writes], states = [];
  const event = originalEvents[0].after;
  for (const product of products) {
    const key = stockKey(product.state);
    if (product.state.company !== company || stockKey(product.after) !== key || keys.has(key)) throw Error('Distinct same-company Purchase product coverage required');
    keys.add(key);
    const drafts = product.unconfirmedSourceIds || [];
    if (!Array.isArray(drafts) || new Set(drafts).size !== drafts.length || drafts.some(id => {
      const row = domainPlan.writes.find(w => w.collection === tasks && w.after._id === id)?.after;
      return !row?.procurementSource || row.ourPoNumber || !originalEvents.some(w => w.after.imageAltText === id
        && w.after.action === 'PURCHASE_PLAN_SAVED' && w.after.details?.draftPlan === true);
    })) throw Error('Original unconfirmed source coverage required');
    const present = id => drafts.includes(id) || [product.state, product.after].some(s => s.tasks.some(t => t.id === id) || s.sources.some(t => t.id === id));
    const covered = taskIds.filter(present);
    if (!covered.length) throw Error('Unrelated Purchase product snapshot');
    for (const id of covered) coverage.set(id, coverage.get(id) + 1);
    const mapped = prepareProcurementTransition({ ...product, event, generation });
    const repeated = mapped.plan.writes.find(w => w.collection === journal && w.after._id === event._id);
    if (!repeated || !same(repeated, originalEvents[0])) throw Error('Original Purchase event mismatch');
    writes.push(...mapped.plan.writes.filter(w => w !== repeated)); states.push(mapped.state);
  }
  if ([...coverage.values()].some(n => n !== 1) || new Set(writes.map(w => w.collection + ':' + w.after._id)).size !== writes.length
    || writes.length > (planFormat === 'SEGMENTED_V2' ? 10000 : 30) || utf8Bytes(JSON.stringify({ writes })) > (planFormat === 'SEGMENTED_V2' ? 8 * 1024 * 1024 : 180000)) throw Error('Complete atomic Purchase stock coverage required');
  return { plan: { writes }, states };
}
module.exports = { preparePurchaseStock };

},
// original-source-validation.cjs sha256:f732b0a5cec207636e2c318c624bb0b35c3f57bb283b593160c1f1f20e401ba0
"original-source-validation.cjs": (load, module) => {
'use strict';

const { domainCollections } = load("domain-scope.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
// Read-only original ADD_SOURCE preparation, with a private in-memory journal.
// Staff flag is resolved by the authenticated server gateway, never from input.
async function validateOriginalSource({ createPurchaseSourceOperations, request, tables, workspace, now }) {
  const { company, staff } = request, [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const allowed = new Set([orders, tasks, journal, 'SharedSuppliers', 'R2PurchaseOrders']);
  if (typeof createPurchaseSourceOperations !== 'function' || typeof now !== 'function' || workspace?.company !== company
    || !tables || [...allowed].some(c => !Array.isArray(tables[c])) || Object.keys(tables).some(c => !allowed.has(c))) throw Error('Complete original source snapshot required');
  const scratch = new Map(), boundary = new Error('Private source prepare boundary'); let captured, reads = 0;
  const scope = c => { if (!allowed.has(c)) throw Error('Source snapshot scope violation'); };
  const store = {
    all: async c => { scope(c); return copy(tables[c]); },
    read: async (c, id) => { scope(c); return copy(scratch.get(c + ':' + id) || tables[c].find(r => r._id === id) || null); },
    one: async (c, criteria) => { scope(c); return copy(tables[c].find(r => Object.entries(criteria).every(([k, v]) => r[k] === v)) || null); },
    insert: async (c, row) => {
      if (c !== journal) throw Error('Source domain apply forbidden');
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || !row.details.plan?.task || !Array.isArray(row.details.plan.events)) throw Error('Unexpected source preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Source apply forbidden');
      scratch.set(c + ':' + row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      if (c !== journal || scratch.get(c + ':' + id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private source lock removal allowed');
      scratch.delete(c + ':' + id);
    }
  };
  const save = createPurchaseSourceOperations({ store, now, names: { [company]: { orders, tasks, activity: journal } },
    readWorkspace: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected source apply/read');
      return copy(workspace);
    } });
  try { await save({ ...copy(request), input: { ...copy(request.input), action: 'ADD_SOURCE' } }); throw Error('Original source boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original source preparation incomplete');
  return captured;
}
function prepareSourceDomain({ validated, request, tables }) {
  const { company } = request, [, tasks] = domainCollections(company), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const task = validated?.task, added = validated?.events?.filter(e => e.action === 'PURCHASE_SOURCE_ADDED');
  if (!task?._id || task.title !== task._id || task.procurementSource !== true || task.specialPurchase
    || task.purchaseQtyInCtn !== 0 || !task.customerDemandTaskId || tables[tasks].some(t => t._id === task._id)
    || added?.length !== 1 || added[0].imageAltText !== task._id || added[0].details?.parentTaskId !== task.customerDemandTaskId
    || task.company || task._version) throw Error('Original new procurement source required');
  const writes = [{ collection: tasks, before: null, after: { ...copy(task), company } }];
  for (const event of validated.events) {
    if (!event._id || event.title !== event._id || !event.action?.startsWith('PURCHASE_') || event.result !== 'SAVED'
      || tables[journal].some(e => e._id === event._id) || event.initiatedByStaffId !== request.staff.staffId) throw Error('Original source event required');
    writes.push({ collection: journal, before: null, after: { ...copy(event), company } });
  }
  if (new Set(writes.map(w => w.collection + ':' + w.after._id)).size !== writes.length || writes.length > 30
    || Buffer.byteLength(JSON.stringify({ writes })) > 180000) throw Error('Source domain plan exceeds atomic proof bounds');
  return { writes };
}
module.exports = { validateOriginalSource, prepareSourceDomain };

},
// quantity-case-preparation.cjs sha256:44fee935fa254ae585a0101734da938246b0e0b21c537e556e2fdfea8a071d68
"quantity-case-preparation.cjs": (load, module) => {
'use strict';

const { originalProductState } = load("original-product-state.cjs");
const { readCurrentProduct } = load("current-product-reader.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { prepareProcurementTransition } = load("borrowing-stock-plan.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
async function validateOriginalQuantityCase({ createQuantityCaseOperations, company, staff, requestId, input, context, now }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.activity)
    || !Array.isArray(context.tasks) || typeof createQuantityCaseOperations !== 'function' || typeof now !== 'function') throw Error('Original quantity decision context required');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', scratch = new Map(), boundary = new Error('Private quantity decision boundary');
  let captured, reads = 0;
  const scope = c => { if (c !== journal) throw Error('Quantity decision scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    all: async c => { scope(c); return copy(context.activity); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'PURCHASE_QUANTITY_CASE_DECIDED') throw Error('Unexpected quantity decision preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Quantity decision apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private quantity decision lock removal allowed'); scratch.delete(id);
    }
  };
  const save = createQuantityCaseOperations({ store, now, names: { [company]: { activity: journal } }, readWorkspace: async (c, employee) => {
    if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected quantity decision apply/read'); return copy(context);
  } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original quantity decision boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original quantity decision preparation incomplete');
  return captured;
}
// Original Purchase permission and quantity-case projector remain the authority.
// A decision is not Sales cancellation, stock release, physical return or repayment.
function createQuantityCasePreparation(deps) {
  const { company, readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords, projectPurchaseOrders,
    createQuantityCaseOperations, projectQuantityCases, readAllocations, readCustomerShipments, readPackingLists, packingHeld,
    readPreparation, projectPreparation, protocol, items, store, now } = deps;
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, createQuantityCaseOperations, projectQuantityCases, readAllocations, readCustomerShipments, readPackingLists,
    packingHeld, now].some(f => typeof f !== 'function') || typeof protocol?.readSnapshot !== 'function'
    || typeof items?.query !== 'function' || typeof store?.read !== 'function') throw Error('Server quantity decision dependencies required');
  const current = protocol.planFormat === 'SEGMENTED_V2';
  if (current && typeof deps.readCurrentTaskRows !== 'function') throw Error('Private v2 quantity task checkpoint reader required');
  return async request => {
    if (request?.company !== company || request.input?.action !== 'DECIDE' || typeof request.input.id !== 'string' || !request.input.id) throw Error('Known company quantity decision required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePurchaseStaff(member, []);
    const staff = { ...requirePurchaseStaff(member, await readStaffRecords()), memberId: member._id, canDecideQuantityCase: true };
    if (request.staffId !== undefined && request.staffId !== staff.staffId) throw Error('Quantity decision identity changed');
    const metrics = { queries: 0, exactReads: 0 };
    const snapshot = await protocol.readSnapshot(async control => {
      const context = await readContext(company, staff);
      if (context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)) throw Error('Original quantity company context required');
      const selected = projectQuantityCases(context, context.activity).filter(row => row.id === request.input.id);
      if (selected.length !== 1) throw Error('Exact original quantity case required');
      const item = selected[0], task = context.tasks.find(t => t.id === item.taskId);
      if (!task) throw Error('Original quantity source task unavailable');
      const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea };
      const orders = projectPurchaseOrders({ company, workspace: context, records: await readPurchaseRecords(company, staff) });
      const builder = originalProductState({ company, context, orders, identity, readAllocations, readCustomerShipments, readPackingLists,
        packingHeld, readPreparation, projectPreparation });
      const rows = current ? await readScopedCurrentProduct({ company, identity, items, store, metrics,
        transferIndexVersion: control.transferIndexVersion, sourceTaskIds: [task.id], demandTaskIds: [item.customerDemandTaskId] })
        : await readCurrentProduct({ company, identity, items, store, metrics });
      if (current) {
        if (!rows.product) throw Error('Current quantity product checkpoint required');
        rows.taskRows = await deps.readCurrentTaskRows(company, builder.scopeTaskIds(rows), staff); rows.generation = control.generation;
      }
      const state = builder.buildState(rows);
      const validated = await validateOriginalQuantityCase({ createQuantityCaseOperations, company, staff, requestId: request.requestId, input: request.input, context, now });
      if (validated.event.initiatedByStaffId !== staff.staffId || validated.event.description !== item.customerDemandTaskId
        || validated.event.imageAltText !== item.taskId || validated.event.details.caseId !== item.id) throw Error('Original quantity decision event conflict');
      return { state, rows, event: validated.event };
    });
    return { ...prepareProcurementTransition({ ...snapshot.rows, after: snapshot.rows.state, generation: snapshot.generation }),
      memberId: staff.memberId, generation: snapshot.generation, metrics };
  };
}
module.exports = { validateOriginalQuantityCase, createQuantityCasePreparation };

},
// shortage-stock-preparation.cjs sha256:e1f59d1da65e9e2032184edd2e92ad43fe51752740d4e9c664e9b80ff13ec74d
"shortage-stock-preparation.cjs": (load, module) => {
'use strict';

const { originalProductState } = load("original-product-state.cjs");
const { readCurrentProduct } = load("current-product-reader.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { currentAllocationContext } = load("current-allocation-context.cjs");
const { prepareProcurementTransition } = load("borrowing-stock-plan.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
async function validateOriginalShortage({ createShortageOperations, company, staff, requestId, input, workspace, now }) {
  if (!['NCT', 'GHR'].includes(company) || workspace?.company !== company || !Array.isArray(workspace.activity)
    || typeof createShortageOperations !== 'function' || typeof now !== 'function') throw Error('Original shortage context required');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', scratch = new Map(), boundary = new Error('Private shortage prepare boundary');
  let captured, reads = 0;
  const scope = c => { if (c !== journal) throw Error('Shortage context scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    all: async c => { scope(c); return copy(workspace.activity); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'PURCHASE_SHORTAGE_DECIDED') throw Error('Unexpected shortage prepare');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Shortage apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private shortage lock removal allowed'); scratch.delete(id);
    }
  };
  const save = createShortageOperations({ store, now, names: { [company]: { activity: journal } }, readWorkspace: async (c, employee) => {
    if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected shortage apply/read'); return copy(workspace);
  } });
  try { await save({ company, staff: copy(staff), requestId, input: { ...copy(input), action: 'SHORTAGE' } }); throw Error('Original shortage boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original shortage preparation incomplete');
  return captured;
}
function createShortageStockPreparation(deps) {
  const { company, readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, createShortageOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation,
    protocol, items, store, now } = deps;
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, createShortageOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld, now].some(f => typeof f !== 'function')
    || typeof protocol?.readSnapshot !== 'function' || typeof items?.query !== 'function' || typeof store?.read !== 'function') throw Error('Server shortage dependencies required');
  const current = protocol.planFormat === 'SEGMENTED_V2';
  if (current && typeof deps.readCurrentTaskRows !== 'function') throw Error('Private v2 shortage task checkpoint reader required');
  return async request => {
    if (request?.company !== company || typeof request.input?.taskId !== 'string' || !request.input.taskId) throw Error('Known company shortage task required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePurchaseStaff(member, []);
    const staff = { ...requirePurchaseStaff(member, await readStaffRecords()), memberId: member._id }, metrics = { queries: 0, exactReads: 0 };
    if (request.staffId !== undefined && request.staffId !== staff.staffId) throw Error('Shortage decision identity changed');
    const snapshot = await protocol.readSnapshot(async control => {
      const context = await readContext(company, staff), task = context?.tasks?.find(t => t.id === request.input.taskId);
      if (context?.company !== company || !task) throw Error('Original shortage task unavailable');
      const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea };
      const orders = projectPurchaseOrders({ company, workspace: context, records: await readPurchaseRecords(company, staff) });
      const builder = originalProductState({ company, context, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
      const rows = current ? await readScopedCurrentProduct({ company, identity, items, store, metrics,
        transferIndexVersion: control.transferIndexVersion, sourceTaskIds: [task.id], demandTaskIds: [task.customerDemandTaskId || task.id] })
        : await readCurrentProduct({ company, identity, items, store, metrics });
      if (current) {
        if (!rows.product) throw Error('Current shortage product checkpoint required');
        rows.taskRows = await deps.readCurrentTaskRows(company, builder.scopeTaskIds(rows), staff); rows.generation = control.generation;
      }
      const state = builder.buildState(rows);
      const workspace = currentAllocationContext({ state, context, readAllocations });
      const validated = await validateOriginalShortage({ createShortageOperations, company, staff, requestId: request.requestId, input: request.input, workspace, now });
      if (validated.event.initiatedByStaffId !== staff.staffId || validated.event.imageAltText !== task.id
        || validated.event.description !== task.orderId || validated.event.image !== task.sourceLineId) throw Error('Original shortage event identity conflict');
      return { state, rows, event: validated.event };
    });
    const { state, rows, event } = snapshot.rows;
    return { ...prepareProcurementTransition({ state, after: state, rows, event, generation: snapshot.generation }),
      memberId: staff.memberId, generation: snapshot.generation, metrics };
  };
}
module.exports = { validateOriginalShortage, createShortageStockPreparation };

},
// sdk-conditional-store.cjs sha256:544fec0c865dcf841a5766d2e36e50718afc32a7a41c74fafc0a4523c161c5a8
"sdk-conditional-store.cjs": (load, module) => {
'use strict';

// Candidate adapter only. Caller supplies authorized company and explicit collection scope.
// Not imported by production. Verified SDK1.0.528 uses plain WQL conditions, not Filter().
const metadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId']);
const own = (row, key) => Object.prototype.hasOwnProperty.call(row, key);
const { createSdkFieldCodec } = load("sdk-field-codec.cjs");
const { hash } = load("commit-proof.cjs");

function createSdkConditionalStore({ items, company, collections, dateTimeFields = {} }) {
  if (!['NCT', 'GHR'].includes(company) || !Array.isArray(collections) || !collections.length
    || collections.some(name => typeof name !== 'string' || !name)
    || !items || ['query', 'insert', 'patch', 'remove'].some(method => typeof items[method] !== 'function')) {
    throw Error('Explicit conditional store scope required');
  }
  const allowed = new Set(collections);
  const fieldCodec = createSdkFieldCodec({ collections, dateTimeFields });
  function scope(collection, id) {
    if (!allowed.has(collection) || typeof id !== 'string' || !id) throw Error('Storage scope violation');
  }
  function normalize(collection, row) {
    if (!row) return null;
    r2RequireControl(collection, row);
    if (row.company !== company) throw Error('Storage company conflict');
    const result = {};
    for (const [key, value] of Object.entries(row)) {
      if (!metadata.has(key) && key !== 'stockCommitVersion') result[key] = fieldCodec.decode(collection, key, value);
    }
    if (own(row, 'stockCommitVersion')) result._version = row.stockCommitVersion;
    return result;
  }
  function encode(collection, row) {
    if (!row || row.company !== company || own(row, 'stockCommitVersion')
      || Object.keys(row).some(key => metadata.has(key))) throw Error('Invalid owned storage image');
    const result = {};
    for (const [key, value] of Object.entries(row)) {
      if (key !== '_version') result[key] = fieldCodec.encode(collection, key, value);
    }
    if (own(row, '_version')) {
      if (typeof row._version !== 'string' || !row._version) throw Error('Storage version required');
      result.stockCommitVersion = row._version;
    }
    return result;
  }
  async function read(collection, id) {
    scope(collection, id);
    // Exact bounded query distinguishes missing from any permission/network/query failure.
    const page = await items.query(collection).eq('_id', id).limit(2).find({ consistentRead: true });
    if (!Array.isArray(page?.items) || page.items.length > 1) throw Error('Invalid exact storage read');
    return normalize(collection, page.items[0] || null);
  }
  // Server-only exact IDs within ONE caller-owned readSnapshot. No persistent
  // cache or write/verify reuse. Fifty is our request policy, not a claimed Wix
  // hasSome capacity. Missing is returned only after a complete strong result.
  async function readMany(collection, ids) {
    if (!allowed.has(collection) || !Array.isArray(ids) || ids.length > 2000
      || new Set(ids).size !== ids.length) throw Error('Bounded distinct storage IDs required');
    const requested = [...ids];
    for (const id of requested) scope(collection, id);
    const found = new Map();
    for (let offset = 0; offset < requested.length; offset += 50) {
      const batch = requested.slice(offset, offset + 50), expected = new Set(batch);
      // Match read(): do not hide a foreign row behind a company filter and
      // misreport an occupied exact ID as absent. normalize rejects that row.
      const page = await items.query(collection).hasSome('_id', batch)
        .limit(batch.length + 1).find({ consistentRead: true, returnTotalCount: true });
      if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0
        || page.totalCount > batch.length || page.items.length !== page.totalCount) throw Error('Incomplete exact storage batch');
      for (const row of page.items) {
        if (!expected.has(row?._id) || found.has(row._id)) throw Error('Exact storage batch identity conflict');
        found.set(row._id, normalize(collection, row));
      }
    }
    return requested.map(id => found.get(id) || null);
  }
  async function insert(collection, row) {
    scope(collection, row?._id);
    return normalize(collection, await items.insert(collection, encode(collection, row)));
  }
  async function compareAndSet(collection, id, expectedVersion, after) {
    scope(collection, id);
    if (typeof expectedVersion !== 'string' || !expectedVersion || after?._id !== id
      || !after._version || after._version === expectedVersion) throw Error('Fresh conditional version required');
    const current = await read(collection, id);
    if (!current || current._version !== expectedVersion) throw Error('Storage version conflict');
    const beforePayload = encode(collection, current), afterPayload = encode(collection, after);
    let patch = items.patch(collection, id);
    for (const key of Object.keys(beforePayload)) {
      if (key !== '_id' && !own(afterPayload, key)) patch = patch.removeField(key);
    }
    for (const [key, value] of Object.entries(afterPayload)) {
      if (key !== '_id') patch = patch.setField(key, value);
    }
    return normalize(collection, await patch.run({ condition: { company: { $eq: company }, stockCommitVersion: { $eq: expectedVersion } } }));
  }
  async function compareAndRemove(collection, id, expectedAttempt) {
    scope(collection, id);
    if (typeof expectedAttempt !== 'string' || !expectedAttempt) throw Error('Execution identity required');
    return normalize(collection, await items.remove(collection, id, {
      condition: { company: { $eq: company }, attempt: { $eq: expectedAttempt } }
    }));
  }
  // Private server-read boundary for rows ALREADY returned by the original paged
  // table reader. Same codec/ownership/version normalization, no extra per-row
  // SDK request and no new write capability. Not an authority for browser rows.
  function normalizeListedRow(collection, row) {
    scope(collection, row?._id);
    const companyLock = collection === (company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1')
      && row._id === hash(company+'/PURCHASE','LOCK') && typeof row.owner === 'string' && row.owner
      && typeof row.attempt === 'string' && row.attempt && !row.action && !row.details && !own(row,'stockCommitVersion');
    // Attempt-scoped protocol locks are intentionally unversioned; only that exact
    // reserved identity may use the same metadata normalization without a version.
    if (!companyLock && (typeof row.stockCommitVersion !== 'string' || !row.stockCommitVersion)) throw Error('Listed current row requires migrated version');
    return normalize(collection, row);
  }
  return { read, readMany, insert, compareAndSet, compareAndRemove, normalizeListedRow };
}

module.exports = { createSdkConditionalStore };

},
// sdk-field-codec.cjs sha256:74180c49305abb506dd0d2a26cd17a31038f947135f72b843c6f6ce64730781e
"sdk-field-codec.cjs": (load, module) => {
'use strict';

// Private SDK boundary only. Caller supplies field IDs read from the actual CMS
// schema; never infer types from names, ISO-looking strings or nested event JSON.
const isDate = value => Object.prototype.toString.call(value) === '[object Date]';
function createSdkFieldCodec({ collections, dateTimeFields = {} }) {
  const proto = dateTimeFields && typeof dateTimeFields === 'object' && Object.getPrototypeOf(dateTimeFields);
  if (!Array.isArray(collections) || !dateTimeFields || Array.isArray(dateTimeFields)
    || typeof dateTimeFields !== 'object' || (proto !== null && (Object.getPrototypeOf(proto) !== null
      || Object.getOwnPropertyDescriptor(proto, 'constructor')?.value?.name !== 'Object'))) throw Error('Explicit SDK field schema required');
  const allowed = new Set(collections), fields = new Map();
  for (const [collection, names] of Object.entries(dateTimeFields)) {
    if (!allowed.has(collection) || !Array.isArray(names) || new Set(names).size !== names.length
      || names.some(name => typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)
        || ['company', 'stockCommitVersion'].includes(name))) throw Error('Invalid SDK DateTime field scope');
    fields.set(collection, new Set(names));
  }
  function convert(collection, field, value, direction) {
    if (!allowed.has(collection)) throw Error('SDK field collection scope violation');
    if (!fields.get(collection)?.has(field) || value === null) return JSON.parse(JSON.stringify(value));
    if (direction === 'decode') {
      // A string in a DateTime field is not the same Wix type. Do not silently
      // repair legacy data or make a corrupt write appear verified.
      if (!isDate(value) || !Number.isFinite(value.getTime())) throw Error('SDK DateTime read type mismatch: ' + collection + '.' + field);
      return value.toISOString();
    }
    const canonical = isDate(value) && Number.isFinite(value.getTime()) ? value.toISOString() : value;
    if (typeof canonical !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(canonical)) {
      throw Error('Canonical DateTime write required: ' + collection + '.' + field);
    }
    const date = new Date(canonical);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonical) throw Error('Invalid DateTime write');
    return date;
  }
  return {
    encode: (collection, field, value) => convert(collection, field, value, 'encode'),
    decode: (collection, field, value) => convert(collection, field, value, 'decode')
  };
}
module.exports = { createSdkFieldCodec };

},
// current-purchase-reorder-save.cjs sha256:7019491fe358db3e7da94a86987a7242c97222fdb96cdedeecedfcaf83e2f582
"current-purchase-reorder-save.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { validateOriginalPurchase } = load("original-purchase-validation.cjs");
const { domainCollections } = load("domain-scope.cjs");
const { copy } = load("segmented-plan.cjs");
// Original REORDER is display only, but writes whole task rows. It must share the
// company fence so a stock counter cannot be overwritten by a late ordering save.
function createCurrentPurchaseReorderSave({ company, store, protocol, coverage, currentDisplayOrderVersion, authorityDependencies: d }) {
  if (!['NCT','GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || currentDisplayOrderVersion !== 2
    || typeof store?.read !== 'function'
    || [d?.readMember,d?.readStaffRecords,d?.requirePurchaseStaff,d?.readTables,d?.createPurchaseOperations,d?.taskEditVersion,d?.operationId,d?.now]
      .some(fn => typeof fn !== 'function')) throw Error('Private original current Purchase ordering dependencies required');
  const [orders,tasks] = domainCollections(company), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  return async request => {
    let staff;
    if (request?.operation !== 'REORDER') throw Error('Original display-only REORDER required');
    const result = await createCurrentStockSave({ company, writer: 'PURCHASE_TASK', protocol, coverage,
      authenticate: async () => {
        const member = await d.readMember();
        if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') d.requirePurchaseStaff(member, []);
        staff = { ...d.requirePurchaseStaff(member, await d.readStaffRecords()), memberId: member._id }; return staff;
      }, prepare: async command => {
        const snapshot = await protocol.readSnapshot(async control => {
          // ORIGINAL preparation remains authority for complete customer set,
          // task/display versions, split identities, invoice and archive guards.
          let tables = await d.readTables(company, staff);
          const lockId = d.operationId(company+'/PURCHASE','LOCK'), lock = tables[journal]?.find(row => row._id === lockId);
          if (lock) {
            const exact = await store.read(journal,lockId), owner = d.operationId(company+'/PURCHASE',command.requestId,staff.memberId);
            if (lock.company !== company || lock.owner !== owner || typeof lock.attempt !== 'string' || !lock.attempt
              || lock.action || lock.details || JSON.stringify(exact) !== JSON.stringify(lock)) throw Error('Purchase display lock is not owned by this request');
            tables = { ...tables, [journal]: tables[journal].filter(row => row._id !== lockId) };
          }
          const trusted = { company, staff,
            requestId: command.requestId, operation: 'REORDER', input: command.input };
          const validated = await validateOriginalPurchase({ createPurchaseOperations: d.createPurchaseOperations, request: trusted, tables, now: d.now });
          if (validated.operation !== 'REORDER' || validated.events.length || !validated.updates.length
            || new Set(validated.updates.map(row => row.id)).size !== validated.updates.length) throw Error('Original distinct display-only task intent required');
          const writes = [];
          for (const change of validated.updates) {
            const before = tables[tasks].find(row => row._id === change.id), patch = change.patch;
            if (!before || before.company !== company || !before._version || before.title !== change.id
              || d.taskEditVersion(before) !== change.expected || before.description !== change.orderId || before.imageAltText !== change.lineId
              || Object.keys(patch).length !== 1 || !Number.isSafeInteger(patch.rowPosition) || patch.rowPosition < 1
              || before.stockCounterSchema !== 2 || !Number.isSafeInteger(before.stockDispatchedCumulative) || before.stockDispatchedCumulative < 0
              || !Number.isSafeInteger(before.stockCounterGeneration) || before.stockCounterGeneration < 0 || before.stockCounterGeneration > control.generation
              || tables[journal].some(row => row._id === d.operationId(company,change.id,'COST_LOCK'))
              || tables[orders].filter(row => row.title === change.orderId && row.sourceLineId === change.lineId && !row.salesInvoiceNumber).length !== 1) {
              throw Error('Exact versioned original display task required');
            }
            if (before.rowPosition !== patch.rowPosition) writes.push({ collection: tasks, before: copy(before), after: { ...copy(before), rowPosition: patch.rowPosition } });
          }
          const id = d.operationId(company,command.requestId,staff.memberId,'PURCHASE_DISPLAY_ORDER');
          writes.push({ collection: journal, before: null, after: { _id: id, title: id, company,
            description: command.input.customerId, action: 'PURCHASE_DISPLAY_ORDER_SAVED', result: 'SAVED', activityTime: validated.time,
            actorType: 'STAFF', initiatedByStaffId: staff.staffId, initiatedByStaffName: staff.staffName,
            details: { schema: 2, requestId: command.requestId, taskIds: validated.updates.map(row => row.id),
              displayOrder: copy(validated.displayOrder || null) } } });
          return { writes };
        });
        return { plan: snapshot.rows, memberId: staff.memberId, generation: snapshot.generation };
      } })(request);
    if (result.ok !== true) return result;
    const id = d.operationId(company,request.requestId,staff.memberId,'PURCHASE_DISPLAY_ORDER');
    const receipt = await protocol.readSnapshot(() => store.read(journal,id)), event = receipt.rows;
    if (!event?._version || event._id !== id || event.title !== id || event.company !== company || event.result !== 'SAVED'
      || event.action !== 'PURCHASE_DISPLAY_ORDER_SAVED' || event.initiatedByStaffId !== staff.staffId
      || event.details?.schema !== 2 || event.details.requestId !== request.requestId
      || JSON.stringify(event.details.taskIds) !== JSON.stringify(request.input.taskIds)) throw Error('Committed original display ordering receipt requires review');
    return { ...result, company, operation: 'REORDER', savedAt: event.activityTime, taskIds: copy(event.details.taskIds) };
  };
}
module.exports = { createCurrentPurchaseReorderSave };

},
// current-purchase-tables.cjs sha256:c58d84844a5ddfcc3a96f0ac9e7906a22d5f0a32137dbcad609203d8f8696201
"current-purchase-tables.cjs": (load, module) => {
'use strict';
const { domainCollections } = load("domain-scope.cjs");
const { copy } = load("segmented-plan.cjs");
// Server-only bridge to ORIGINAL all()/pagination. No replacement query engine,
// synthetic stock facts or N+1 exact reads for every listed historical row.
function createCurrentPurchaseTables({ company, readOriginalTable, store }) {
  if (!['NCT','GHR'].includes(company) || typeof readOriginalTable !== 'function' || typeof store?.normalizeListedRow !== 'function') {
    throw Error('Original paged Purchase reader and conditional normalization required');
  }
  const [orders,tasks] = domainCollections(company), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  return async (selectedCompany, staff) => {
    if (selectedCompany !== company || !staff?.memberId || !staff.staffId) throw Error('Private original Purchase table scope required');
    const collections = [orders,tasks,journal,'SharedSuppliers','R2PurchaseOrders'];
    const listed = await Promise.all(collections.map(collection => readOriginalTable(collection)));
    return Object.fromEntries(collections.map((collection,index) => {
      let rows = listed[index];
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row._id !== 'string' || !row._id)
        || new Set(rows.map(row => row._id)).size !== rows.length) throw Error('Complete distinct original Purchase table required');
      // Shared supplier identities are intentionally global in the original system.
      if (collection === 'SharedSuppliers') return [collection,copy(rows)];
      if (collection === 'R2PurchaseOrders') rows = rows.filter(row => row.company === company);
      return [collection,rows.map(row => {
        if (collection === journal && !Object.hasOwn(row,'stockCommitVersion') && !(row.owner && row.attempt && !row.action && !row.details)) {
          // Immutable PRE-ACTIVE journal history need not be rewritten/versioned.
          // Keep original Date->JSON snapshots and identities. Such records are not
          // conditional before-images; current mutations still use exact SDK reads.
          if (row.company && row.company !== company) throw Error('Original Purchase journal company conflict');
          return copy(row);
        }
        return store.normalizeListedRow(collection,row);
      })];
    }));
  };
}
module.exports = { createCurrentPurchaseTables };

},
// current-purchase-task-gateway.cjs sha256:fca19fa24189f50262cdae55bccb1a4fa8b243001dc57b5beef8f5f2e02863c8
"current-purchase-task-gateway.cjs": (load, module) => {
'use strict';
const { createCurrentPurchaseSave, createCurrentAllocationSave, createCurrentShortageSave, createCurrentQuantityCaseSave } = load("current-department-saves.cjs");
const { createCurrentPurchaseReorderSave } = load("current-purchase-reorder-save.cjs");
const { createCurrentMarginReferenceSave } = load("current-margin-reference-save.cjs");
const { createCurrentPurchaseArrangementSave } = load("current-purchase-arrangement-save.cjs");
// Current-only authenticated root binding. Unsupported/missing metadata cannot
// reach an old unfenced writer through this gateway. No browser coverage/actor.
function createCurrentPurchaseTaskGateway(dependencies) {
  const { company } = dependencies;
  if (!['NCT','GHR'].includes(company)) throw Error('Private current Purchase company required');
  return async (requestCompany, request) => {
    if (requestCompany !== company || !request || request.company !== undefined && request.company !== company
      || typeof request.operation !== 'string' || !['EDIT','PLAN','PO','ADD_SOURCE','AVERAGE_COST','QTY','REORDER','ALLOCATE','SHORTAGE','QUANTITY_CASE','MARGIN_REFRESH','ARRANGE_AVAILABLE'].includes(request.operation)
      || JSON.stringify(request).length > 200000) throw Error('Supported bounded current Purchase task request required');
    if ((request.operation === 'REORDER' || request.operation === 'EDIT' && request.input?.displayRows !== undefined)
      && (dependencies.currentDisplayOrderVersion !== 2 || dependencies.authorityDependencies?.currentDisplayOrderVersion !== 2)) {
      throw Error('Paired original current display calculator required');
    }
    // Construct only the selected ORIGINAL authority. A shortage read must not
    // require a separate price/sort workspace or run another department command.
    const execute = request.operation === 'REORDER' ? createCurrentPurchaseReorderSave(dependencies)
      : request.operation === 'ARRANGE_AVAILABLE' ? createCurrentPurchaseArrangementSave(dependencies)
      : request.operation === 'ALLOCATE' ? createCurrentAllocationSave(dependencies)
      : request.operation === 'SHORTAGE' ? createCurrentShortageSave(dependencies)
      : request.operation === 'MARGIN_REFRESH' ? createCurrentMarginReferenceSave(dependencies)
      : request.operation === 'QUANTITY_CASE' ? createCurrentQuantityCaseSave(dependencies) : createCurrentPurchaseSave(dependencies);
    return execute({ requestId:request.requestId,operation:request.operation,input:request.operation === 'ADD_SOURCE' ? { ...request.input,action:'ADD_SOURCE' } : request.input,
      stockProtocol:request.stockProtocol,stockBuild:request.stockBuild,stockGeneration:request.stockGeneration,stockIdentity:request.stockIdentity });
  };
}
module.exports = { createCurrentPurchaseTaskGateway };

},
// current-margin-reference-save.cjs sha256:afedc9fb0b213120b9fef187baa83e2e84e33da9108ba3d4df641c351684dfb3
"current-margin-reference-save.cjs": (load, module) => {
'use strict';

const { createCurrentStockSave } = load("current-stock-save.cjs");
const { prepareMarginReferenceGroup } = load("margin-reference-plan.cjs");
const { domainCollections } = load("domain-scope.cjs");
const { hash } = load("commit-proof.cjs");
const copy=value=>JSON.parse(JSON.stringify(value));
// Private ORIGINAL Purchase cache co-writer. Does not start automatic refreshes,
// expose rates/prices, replace GP formulas or install an endpoint. A workspace
// orchestrator must retain this request BEFORE calling it, including after reload.
function createCurrentMarginReferenceSave({ company, store, protocol, coverage, authorityDependencies:d }) {
  if (!['NCT','GHR'].includes(company) || protocol?.planFormat!=='SEGMENTED_V2' || typeof store?.read!=='function'
    || [d?.readMember,d?.readStaffRecords,d?.requirePurchaseStaff,d?.readMarginContext,d?.createPurchaseMarginRefresh,d?.readRates,d?.now]
      .some(fn=>typeof fn!=='function')) throw Error('Private original margin reference dependencies required');
  const [orders,tasks]=domainCollections(company),journal=company==='NCT'?'R2NCTActivity':'R2NCTActivity1';
  function validateResults(results, allowed) {
    if (!Array.isArray(results) || new Set(results.map(row=>row?.[0])).size!==results.length
      || results.some(row=>!Array.isArray(row)||row.length!==2||!allowed.has(row[0])
        || row[1]!==null&&(typeof row[1]!=='number'||!Number.isFinite(row[1])))) throw Error('Known original margin results required');
  }
  return async request=>{
    if (!request?.input || Object.keys(request.input).some(key=>key!=='taskId') || typeof request.input.taskId!=='string'
      || !request.input.taskId || request.input.taskId.length>128) throw Error('Exact original margin demand required');
    let staff;
    const result=await createCurrentStockSave({company,writer:'MARGIN_REFERENCE',protocol,coverage,
      authenticate:async()=>{
        const member=await d.readMember();
        if (!member?._id||!member.loginEmail||member.status!=='APPROVED')d.requirePurchaseStaff(member,[]);
        staff={...d.requirePurchaseStaff(member,await d.readStaffRecords()),memberId:member._id};
        return staff;
      },prepare:async command=>{
        if (command.memberId!==staff.memberId)throw Error('Margin actor changed');
        const snapshot=await protocol.readSnapshot(async control=>{
          const context=await d.readMarginContext(company,staff,control),workspace=context?.workspace;
          if (workspace?.company!==company||workspace.stockAllocationView!=='CURRENT_V2'
            || workspace.staff?.staffId!==staff.staffId||workspace.staff?.memberId!==staff.memberId
            || !context.tables||[orders,tasks,journal].some(collection=>!Array.isArray(context.tables[collection]))) throw Error('Original authenticated current margin workspace required');
          const group=workspace.tasks?.filter(row=>row.id===command.input.taskId&&!row.procurementSource);
          if (group?.length!==1)throw Error('Exact original margin demand group required');
          const members=workspace.tasks.filter(row=>row.id===command.input.taskId||row.customerDemandTaskId===command.input.taskId);
          const allowed=new Set([command.input.taskId,...members.map(row=>'SOURCE:'+row.id)]);
          const prepared=await prepareMarginReferenceGroup({company,targetTaskId:command.input.taskId,
            tables:Object.fromEntries([orders,tasks,journal].map(collection=>[collection,context.tables[collection]])),workspace,
            createPurchaseMarginRefresh:d.createPurchaseMarginRefresh,readRates:d.readRates,now:d.now});
          validateResults(prepared.results,allowed);
          const id=hash(company,command.input.taskId,command.requestId,staff.memberId,'MARGIN_RESULT');
          const instant=new Date(prepared.plan.writes.find(write=>write.after.action==='GP_RECALCULATED')?.after.activityTime||d.now());
          if (!Number.isFinite(instant.getTime()))throw Error('Original margin receipt time required');
          const at=instant.toISOString();
          // Stable, immutable per-request receipt retains ORIGINAL calculation
          // results for replay. Only explicit refresh saves create it; ordinary
          // unchanged reads must not call this save merely to create a receipt.
          const receipt={_id:id,title:id,company,description:group[0].orderId,image:group[0].sourceLineId,
            imageAltText:command.input.taskId,action:'MARGIN_REFERENCE_RESULT',result:'RECORDED',actorType:'SYSTEM',activityTime:at,
            initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,
            details:{requestId:command.requestId,actorMemberId:staff.memberId,baseGeneration:control.generation,
              targetTaskId:command.input.taskId,allowedResultIds:[...allowed],results:copy(prepared.results)}};
          return {writes:[...prepared.plan.writes,{collection:journal,before:null,after:receipt}]};
        });
        return {plan:snapshot.rows,generation:snapshot.generation,memberId:staff.memberId};
      }})(request);
    if (result.ok!==true)return result;
    const id=hash(company,request.input.taskId,request.requestId,staff.memberId,'MARGIN_RESULT');
    const event=(await protocol.readSnapshot(()=>store.read(journal,id))).rows,detail=event?.details;
    const key=hash(company+'/PURCHASE',request.requestId,staff.memberId);
    if (event?.company!==company||event._id!==id||event.title!==id||event._version!==hash(key,journal,id)
      || event.action!=='MARGIN_REFERENCE_RESULT'||event.result!=='RECORDED'||event.imageAltText!==request.input.taskId
      || event.initiatedByStaffId!==staff.staffId||detail?.actorMemberId!==staff.memberId||detail.requestId!==request.requestId
      || detail.targetTaskId!==request.input.taskId||detail.baseGeneration+1!==result.stockGeneration
      || !Array.isArray(detail.allowedResultIds)||new Set(detail.allowedResultIds).size!==detail.allowedResultIds.length
      || !detail.allowedResultIds.includes(request.input.taskId))throw Error('Committed original margin receipt requires review');
    validateResults(detail.results,new Set(detail.allowedResultIds));
    // These are the RECEIPT's values, not a claim that later current GP stayed
    // unchanged. Re-read an authorized fresh workspace before updating live UI.
    return {...result,marginReceipt:{taskId:request.input.taskId,generation:result.stockGeneration,results:copy(detail.results)}};
  };
}
module.exports={createCurrentMarginReferenceSave};

},
// margin-reference-plan.cjs sha256:0f71dfe022f2e464de9f5824565e11b593b6d8bdda45f0dae77ea2fcffe73f53
"margin-reference-plan.cjs": (load, module) => {
'use strict';

const { domainCollections } = load("domain-scope.cjs");
const { hash } = load("commit-proof.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const cacheFields = new Set(['gp', 'adminFxSource', 'salesInvoiceSummary']);

// Private composition of ORIGINAL margin refresh, not an authenticated gateway or
// replacement GP formula. Results requiring a write must not be exposed as committed
// before the common fence succeeds. No legacy GP lock is ever deleted in real storage.
async function prepareMarginReference({ createPurchaseMarginRefresh, company, tables, workspace, readRates, now }) {
  const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const allowed = new Set([orders, tasks, journal]);
  if (typeof createPurchaseMarginRefresh !== 'function' || typeof readRates !== 'function' || typeof now !== 'function'
    || workspace?.company !== company || !Array.isArray(workspace.tasks) || !tables
    || Object.keys(tables).some(c => !allowed.has(c)) || [...allowed].some(c => !Array.isArray(tables[c]))) throw Error('Complete private margin context required');
  const initial = new Map(), overlay = new Map(), writes = new Map(), privateLocks = new Set(), audits = new Map(), updated = new Set();
  let violation;
  function refuse(message) { violation ||= new Error(message); throw violation; }
  for (const c of allowed) for (const row of tables[c]) {
    const key = c + ':' + row._id;
    if (!row._id || initial.has(key) || row.company && row.company !== company
      || c !== journal && (row.company !== company || !row._version)) throw Error('Exact migrated margin snapshot required');
    initial.set(key, copy(row)); overlay.set(key, copy(row));
  }
  const scope = c => { if (!allowed.has(c)) refuse('Margin context scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(overlay.get(c + ':' + id) || null); },
    insert: async (c, row) => {
      scope(c); const key = c + ':' + row._id;
      if (c !== journal || !row._id || row._id !== row.title || overlay.has(key)) refuse('Unexpected margin insert');
      if (row.action === undefined) {
        const task = tables[tasks].find(t => hash(company, t.title, 'GP_LOCK') === row._id);
        if (!task || row.description !== task.description || row.details?.actorMemberId !== 'SYSTEM_GP' || !row.details.requestId) refuse('Unexpected margin lock');
        privateLocks.add(key);
      } else {
        const task = tables[tasks].find(t => t.title === row.imageAltText);
        if (row.action !== 'GP_RECALCULATED' || row.result !== 'CALCULATED' || row.actorType !== 'SYSTEM' || !task
          || row.description !== task.description || row.image !== task.imageAltText
          || !privateLocks.has(journal + ':' + hash(company, task.title, 'GP_LOCK'))
          || !Number.isFinite(row.details?.after?.gp)) refuse('Unexpected margin audit');
        audits.set(key, copy(row)); writes.set(key, { collection: c, before: null, after: { ...copy(row), company } });
      }
      overlay.set(key, copy(row)); return copy(row);
    },
    update: async (c, row) => {
      scope(c); const key = c + ':' + row._id, before = initial.get(key);
      if (c !== orders || !before || before.company !== company || !before._version) refuse('Only exact margin order cache may change');
      const fixed = value => Object.fromEntries(Object.entries(value).filter(([field]) => !cacheFields.has(field)));
      if (!same(fixed(before), fixed(row))) refuse('Margin cannot change price, identity, invoice lock or quantity');
      const matches = [...audits.entries()].filter(([, event]) => event.description === before.title && event.image === before.sourceLineId
        && event.details.after.gp === row.gp && event.details.after.rateToMyr === row.adminFxSource);
      if (matches.length !== 1 || updated.has(matches[0][0])) refuse('Exact preceding margin evidence required');
      updated.add(matches[0][0]); overlay.set(key, copy(row)); writes.set(key, { collection: c, before: copy(before), after: copy(row) }); return copy(row);
    },
    remove: async (c, id) => {
      scope(c); const key = c + ':' + id;
      if (c !== journal || !privateLocks.has(key)) refuse('Only newly simulated margin lock may be removed');
      overlay.delete(key); privateLocks.delete(key);
    }
  };
  const results = await createPurchaseMarginRefresh({ store, readRates, now })({ company, names: { orders, tasks, activity: journal },
    orders: copy(tables[orders]), tasks: copy(tables[tasks]), activity: copy(tables[journal]), workspace: copy(workspace) });
  // ORIGINAL refresh intentionally catches cache failures. A rejected adapter write
  // must still invalidate the WHOLE private plan, never publish orphan audit evidence.
  if (violation) throw violation;
  if (privateLocks.size || audits.size !== updated.size || typeof results?.entries !== 'function'
    || writes.size > 30 || Buffer.byteLength(JSON.stringify({ writes: [...writes.values()] })) > 180000) throw Error('Complete bounded margin plan required');
  return { plan: { writes: [...writes.values()] }, results: [...results.entries()], mustCommit: writes.size > 0,
    activationReady: false, blockers: ['ORIGINAL_AUTH_READ_GATEWAY_REQUIRED', 'PRODUCTION_MARGIN_CAPACITY_REQUIRED'] };
}
// The ORIGINAL cache already saves each demand line independently. Preserve that
// boundary for a busy workroom instead of turning its entire read into one giant
// transaction. A group MUST retain all original supplier children of its mother.
async function prepareMarginReferenceGroup(args) {
  const target = args.workspace?.tasks?.filter(t => t.id === args.targetTaskId && !t.procurementSource);
  if (target?.length !== 1) throw Error('Exact original margin demand group required');
  const tasks = args.workspace.tasks.filter(t => t.id === args.targetTaskId || t.customerDemandTaskId === args.targetTaskId);
  return prepareMarginReference({ ...args, workspace: { ...args.workspace, tasks } });
}
// Preserve ORIGINAL workspace-wide open-currency selection without requesting
// rates for old locked/closed currencies. This pass exposes NO calculation result
// and has NO storage capability: any attempted original cache write is refused.
async function collectMarginCurrencies({ createPurchaseMarginRefresh, company, tables, workspace, now }) {
  const [orders,tasks]=domainCollections(company),journal=company==='NCT'?'R2NCTActivity':'R2NCTActivity1';
  let currencies=[],calls=0;
  const refuse=async()=>{throw Error('Currency inspection cannot write');};
  await createPurchaseMarginRefresh({store:{read:async()=>null,insert:refuse,update:refuse,remove:refuse},now,
    readRates:async requested=>{calls++;if(!Array.isArray(requested))throw Error('Original currency list required');currencies=copy(requested);throw Error('Currency inspection only');}})
    ({company,names:{orders,tasks,activity:journal},orders:copy(tables[orders]),tasks:copy(tables[tasks]),activity:copy(tables[journal]),workspace:copy(workspace)});
  if(calls>1||new Set(currencies).size!==currencies.length)throw Error('Original single FX snapshot required');
  return currencies;
}
module.exports = { prepareMarginReference, prepareMarginReferenceGroup, collectMarginCurrencies };

},
// current-purchase-arrangement-save.cjs sha256:177a702fb05dee66d58ae28f7c0acf0a189366470910c48af7576f96a8afbd40
"current-purchase-arrangement-save.cjs": (load, module) => {
'use strict';
const {createCurrentStockSave}=load("current-stock-save.cjs");
const {prepareArrangement,identity}=load("purchase-arrangement.cjs");
const {hash}=load("commit-proof.cjs");
function createCurrentPurchaseArrangementSave({company,store,protocol,coverage,authorityDependencies:d}){
 if(protocol?.planFormat!=='SEGMENTED_V2'||typeof store?.read!=='function'
   ||[d?.readMember,d?.readStaffRecords,d?.requirePurchaseStaff,d?.readMarginContext,d?.now].some(f=>typeof f!=='function'))throw Error('Private Purchase arrangement dependencies required');
 let staff;
 return createCurrentStockSave({company,writer:'PURCHASE_TASK',protocol,coverage,authenticate:async()=>{
   const member=await d.readMember();if(!member?._id||member.status!=='APPROVED'||!member.loginEmail)d.requirePurchaseStaff(member,[]);
   staff={...d.requirePurchaseStaff(member,await d.readStaffRecords()),memberId:member._id};return staff;
 },prepare:async command=>{
   const snapshot=await protocol.readSnapshot(async control=>{
    const {workspace}=await d.readMarginContext(company,staff,control);
    const before=await store.read(company==='NCT'?'R2NCTActivity':'R2NCTActivity1',identity(company,command.input.taskId,command.input.batchId));
    const linkedPackingRecord=before?.details?.status==='LINKED'?await store.read(company==='NCT'?'R2NCTActivity':'R2NCTActivity1',hash(company,before.details.packingListId,'PACKING_CURRENT')):null;
    return prepareArrangement({company,staff,requestId:command.requestId,input:command.input,workspace,before,linkedPackingRecord,at:d.now().toISOString()});
   });
   return {plan:snapshot.rows,memberId:staff.memberId,generation:snapshot.generation};
 }});
}
module.exports={createCurrentPurchaseArrangementSave};

},
// purchase-arrangement.cjs sha256:722d7d6b53020309b11e85258f239b35568a108f01aab54d41edba2fbf0e4cb6
"purchase-arrangement.cjs": (load, module) => {
'use strict';
const {hash}=load("commit-proof.cjs");
const whole=n=>Number.isSafeInteger(n)&&n>=0;
const copy=v=>JSON.parse(JSON.stringify(v));
const action='PURCHASE_ARRANGEMENT_CURRENT';
const identity=(company,taskId,batchId)=>hash(company,taskId,batchId||'WHOLE',action);
// An instruction for Support, not a stock hold, shipment or change of Sales demand.
function arrangementLimit(task,batchId=''){
 const f=task?.stockAllocationFacts;
 if(task?.archived||!f||f.review!==false||!['usable','held','dispatched','availableToArrange'].every(k=>whole(f[k]))
   ||f.usable+f.dispatched!==task.stockAllocatedCumulative||f.availableToArrange!==Math.max(0,f.usable-f.held))throw Error('Current arrangement stock requires review');
 if(!batchId)return f.availableToArrange;
 const batch=task.stockAllocatedBatches?.find(b=>b.id===batchId);
 if(!batch||!whole(batch.allocated)||!whole(batch.demand)||batch.allocated>batch.demand)throw Error('Confirmed arrangement batch required');
 if(task.stockBatchAllocationFacts!==undefined){
  const entries=task.stockBatchAllocationFacts,b=Array.isArray(entries)&&entries.find(row=>row.id===batchId);
  if(!b||entries.filter(row=>row.id===batchId).length!==1||b.demand!==batch.demand||b.allocated!==batch.allocated
    ||!['held','unscopedHeld','unscopedDispatched','availableToArrange'].every(k=>whole(b[k]))||b.review!==f.review
    ||b.held+b.unscopedHeld>f.held||b.unscopedDispatched!==f.dispatched
    ||b.availableToArrange!==(f.review?0:Math.min(f.availableToArrange,Math.max(0,b.allocated-b.held-b.unscopedHeld-f.dispatched))))throw Error('Confirmed batch availability required');
  return b.availableToArrange;
 }
 // Until per-batch physical holds are explicit, subtract ALL task holds/shipped
 // amounts. This can restrict availability, but cannot reuse another batch's stock.
 return Math.min(f.availableToArrange,Math.max(0,batch.allocated-f.held-f.dispatched));
}
function prepareArrangement({company,staff,requestId,input,workspace,before,linkedPackingRecord,at}){
 if(!['NCT','GHR'].includes(company)||workspace?.company!==company||workspace.stockAllocationView!=='CURRENT_V2'
   ||!staff?.memberId||!staff.staffId||!staff.staffName||workspace.staff?.memberId!==staff.memberId||workspace.staff.staffId!==staff.staffId
   ||!/^[a-f0-9-]{36}$/i.test(requestId||'')||!input||Object.keys(input).some(k=>!['taskId','batchId','quantity','expectedRevision','reason'].includes(k)))throw Error('Original Purchase arrangement authority required');
 const task=workspace.tasks.find(t=>t.id===input.taskId&&!t.procurementSource&&!t.specialPurchase),batchId=input.batchId||'';
 if(!task||typeof batchId!=='string'||batchId.length>200||!whole(input.quantity)||input.quantity<1||input.quantity>9999
   ||input.quantity>arrangementLimit(task,batchId)||typeof input.expectedRevision!=='string')throw Error('Available arrangement quantity changed');
 const reason=String(input.reason||'').trim();if(!reason||reason.length>1000||typeof at!=='string'||!Number.isFinite(Date.parse(at)))throw Error('Arrangement reason and time required');
 const id=identity(company,task.id,batchId);
 if(before&&before.details?.status!=='PENDING_SUPPORT'){
   const [prior]=projectArrangementLinks(company,readArrangements(company,[before]),linkedPackingRecord?[linkedPackingRecord]:[]);
   if(!prior?.mayRequestAgain)throw Error('Arrangement already linked to active packing; review that list first');
 }
 if(before&&(before._id!==id||before.company!==company||before.action!==action||before.details?.taskId!==task.id||before.details.batchId!==batchId||!before._version)
   ||(before?.details?.revision||'')!==input.expectedRevision)throw Error('Arrangement instruction changed');
 const revision=hash(company,requestId,staff.memberId,'ARRANGEMENT');
 const details={taskId:task.id,batchId,customerId:task.customerId,orderId:task.orderId,quantity:input.quantity,
   revision,status:'PENDING_SUPPORT',reason,availableAtApproval:arrangementLimit(task,batchId)};
 const after={_id:id,title:id,company,description:task.orderId,imageAltText:task.id,action,result:'SAVED',actorType:'STAFF',
   initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,activityTime:at,details};
 const audit={...copy(after),_id:revision,title:revision,action:'PURCHASE_ARRANGEMENT_REQUESTED',details:{...details,beforeRevision:input.expectedRevision,
   ...(before?.details?.packingListId?{previousPackingListId:before.details.packingListId,previousPackingRevision:linkedPackingRecord.details.list.revision}:{})}};
 return {writes:[{collection:company==='NCT'?'R2NCTActivity':'R2NCTActivity1',before:copy(before||null),after},
   {collection:company==='NCT'?'R2NCTActivity':'R2NCTActivity1',before:null,after:audit}]};
}
function readArrangements(company,activity){
 if(!['NCT','GHR'].includes(company)||!Array.isArray(activity))throw Error('Arrangement company activity required');
 const seen=new Set();
 return activity.filter(r=>r.action===action).map(r=>{
  const d=r.details;
  if(r.company!==company||r.title!==r._id||r.result!=='SAVED'||!d?.taskId||typeof d.batchId!=='string'||r._id!==identity(company,d.taskId,d.batchId)||seen.has(r._id)
    ||r.description!==d.orderId||!d.customerId||!d.revision||!['PENDING_SUPPORT','LINKED'].includes(d.status)||d.status==='LINKED'&&(!d.packingListId||!d.packingRevision)||!whole(d.quantity)||d.quantity<1||d.quantity>9999||!d.reason||!r.initiatedByStaffId
    ||!(typeof r.activityTime==='string'||Object.prototype.toString.call(r.activityTime)==='[object Date]')||!Number.isFinite(new Date(r.activityTime).getTime()))throw Error('Arrangement instruction requires review');
  seen.add(r._id);return {...copy(d),by:r.initiatedByStaffName,at:new Date(r.activityTime).toISOString()};
 });
}
function linkArrangement({company,before,reference,list,staff,requestId,at}){
 const [instruction]=readArrangements(company,before?[before]:[]);
 if(!instruction||!before._version||instruction.status!=='PENDING_SUPPORT'||reference?.revision!==instruction.revision
   ||reference.taskId!==instruction.taskId||reference.batchId!==instruction.batchId||Object.keys(reference).some(k=>!['taskId','batchId','revision'].includes(k))
   ||staff?.packingDepartment!=='SUPPORT'||!staff.staffId||!staff.memberId||!list?.id||list.status!=='DRAFT'||list.company!==company
   ||list.customerId!==instruction.customerId||list.lines.length!==1||list.lines[0].taskId!==instruction.taskId||list.lines[0].quantity!==instruction.quantity
   ||!/^[a-f0-9-]{36}$/i.test(requestId||'')||typeof at!=='string'||!Number.isFinite(Date.parse(at)))throw Error('Exact pending Purchase instruction and Support draft required');
 const revision=hash(company,requestId,staff.memberId,'ARRANGEMENT_LINKED'),after={...copy(before),activityTime:at,
   details:{...copy(before.details),revision,status:'LINKED',packingListId:list.id,packingRevision:list.revision,linkedByStaffId:staff.staffId}};
 const audit={...copy(after),_id:revision,title:revision,action:'PURCHASE_ARRANGEMENT_LINKED',initiatedByStaffId:staff.staffId,
   initiatedByStaffName:staff.staffName,details:{...copy(after.details),beforeRevision:instruction.revision}};
 return {writes:[{collection:company==='NCT'?'R2NCTActivity':'R2NCTActivity1',before:copy(before),after},
   {collection:company==='NCT'?'R2NCTActivity':'R2NCTActivity1',before:null,after:audit}]};
}
function projectArrangementLinks(company,instructions,records){
 if(!['NCT','GHR'].includes(company)||!Array.isArray(instructions)||!Array.isArray(records))throw Error('Arrangement packing context required');
 return instructions.map(instruction=>{
   if(instruction.status==='PENDING_SUPPORT')return {...copy(instruction),mayRequestAgain:true};
   if(instruction.status!=='LINKED')throw Error('Known arrangement status required');
   const matches=records.filter(r=>r.action==='SUPPORT_PACKING_LIST_CURRENT'&&r._id===hash(company,instruction.packingListId,'PACKING_CURRENT'));
   const record=matches[0],list=record?.details?.list,line=list?.lines?.find(l=>l.taskId===instruction.taskId);
   if(matches.length!==1||record.company!==company||list?.company!==company||list.id!==instruction.packingListId||list.customerId!==instruction.customerId
     ||!list.revision||!['DRAFT','SENT','PROCESSING','COMPLETED','CANCELLED'].includes(list.status)||!Array.isArray(list.lines)
     ||new Set(list.lines.map(l=>l.taskId)).size!==list.lines.length||line&&(![line.quantity,line.packed,line.loaded].every(whole)
       ||line.quantity<1||line.loaded>line.packed||line.packed>line.quantity))throw Error('Linked packing list requires review');
   return {...copy(instruction),packingStatus:list.status,currentPackingRevision:list.revision,
     currentPlanned:line?.quantity??0,currentPacked:line?.packed??0,currentLoaded:line?.loaded??0,
     changePending:Boolean(list.change),mayRequestAgain:!list.change&&(!line||['CANCELLED','COMPLETED'].includes(list.status))};
 });
}
module.exports={arrangementLimit,prepareArrangement,readArrangements,identity,linkArrangement,projectArrangementLinks};

},
// current-purchase-save-router.cjs sha256:8013d3584d586a5eb2f827f47f3a07c37935bda6ca8f82db5581a2542e4a7d46
"current-purchase-save-router.cjs": (load, module) => {
'use strict';
const { hash } = load("commit-proof.cjs");
// Private original authenticated wrapper only. Browser metadata does NOT choose
// between two active writers; actual server control is the authority.
function createCurrentPurchaseSaveRouter({ company, readControl, saveCurrent, saveLegacy }) {
  if (!['NCT','GHR'].includes(company) || [readControl,saveCurrent,saveLegacy].some(fn=>typeof fn!=='function')) throw Error('Original server Purchase routing dependencies required');
  return async request => {
    const control = await readControl();
    if (!control || control._id !== hash(company,'STOCK_CONTROL') || control.company !== company
      || typeof control.stockCommitVersion !== 'string' || !control.stockCommitVersion || control.schemaVersion !== 1
      || !Number.isSafeInteger(control.generation) || control.generation < 0
      || !['LEGACY','SHADOW','MAINTENANCE','ACTIVE'].includes(control.mode)) throw Error('Purchase stock control unconfirmed. Retain the original request. 采购库存控制尚未确认，请保留原请求。');
    if (control.mode === 'LEGACY') {
      if (control.pending !== null || request.stockCurrent?.stockProtocol !== undefined) throw Error('Purchase mode changed. Refresh before saving the retained draft. 采购模式已变更，请刷新核对原草稿。');
      return saveLegacy();
    }
    if (control.mode !== 'ACTIVE') throw Error('Purchase inventory maintenance is in progress. Keep the draft. 库存维护中，请保留草稿。');
    // The commit coordinator validates exact build/generation, pending ownership,
    // original grant and all-writer coverage again under its company fence.
    // Missing/wrong metadata or an unsupported command must NEVER reach legacy.
    return saveCurrent(company,{ requestId:request.requestId,operation:request.operation,input:request.input,
      stockProtocol:request.stockCurrent?.stockProtocol,stockBuild:request.stockCurrent?.stockBuild,
      stockGeneration:request.stockCurrent?.stockGeneration,stockIdentity:request.stockCurrent?.stockIdentity });
  };
}
module.exports = { createCurrentPurchaseSaveRouter };

},
// current-purchase-read-router.cjs sha256:56be4be53d09bf09fcc1f4632d1737297e4e3a33d88473bf15f87ceb2e02b5fb
"current-purchase-read-router.cjs": (load, module) => {
'use strict';
const { hash }=load("commit-proof.cjs");
// Invoked only after original Purchase auth. Missing control never authorizes the
// old workspace's implicit GP cache writer. Browser metadata does not choose mode.
function createCurrentPurchaseReadRouter({company,readControl,readLegacy,readCurrent}) {
  if(!['NCT','GHR'].includes(company)||[readControl,readLegacy,readCurrent].some(fn=>typeof fn!=='function'))throw Error('Private Purchase read routing dependencies required');
  return async()=>{
    const control=await readControl();
    if(!control||control._id!==hash(company,'STOCK_CONTROL')||control.company!==company||control.schemaVersion!==1
      ||typeof control.stockCommitVersion!=='string'||!control.stockCommitVersion||!Number.isSafeInteger(control.generation)||control.generation<0
      ||!['LEGACY','ACTIVE','SHADOW','MAINTENANCE'].includes(control.mode))throw Error('Purchase stock read mode unconfirmed');
    if(control.pending!==null)throw Error('Purchase inventory save pending; retain original request');
    if(control.mode==='LEGACY')return readLegacy();
    if(control.mode!=='ACTIVE')throw Error('Purchase inventory maintenance is in progress');
    return readCurrent(company);
  };
}
module.exports={createCurrentPurchaseReadRouter};

},
// current-warehouse-receipt-router.cjs sha256:8ce70ff3d660bb49337bbb8d0145405b505c48baa73e2bb29991e1680db69a59
"current-warehouse-receipt-router.cjs": (load, module) => {
'use strict';
const { hash }=load("commit-proof.cjs");
// Called only AFTER original Warehouse authentication. Browser cannot select mode.
function createCurrentWarehouseReceiptRouter({company,readControl,saveCurrent,saveLegacy}){
  if(!['NCT','GHR'].includes(company)||[readControl,saveCurrent,saveLegacy].some(fn=>typeof fn!=='function'))throw Error('Original Warehouse receipt routing dependencies required');
  return async request=>{
    const control=await readControl();
    if(control?._id!==hash(company,'STOCK_CONTROL')||control.company!==company||typeof control.stockCommitVersion!=='string'
      ||!control.stockCommitVersion||control.schemaVersion!==1||!Number.isSafeInteger(control.generation)||control.generation<0
      ||!['LEGACY','SHADOW','MAINTENANCE','ACTIVE'].includes(control.mode))throw Error('Warehouse inventory control unconfirmed. Retain the original receipt.');
    if(control.mode==='LEGACY'){
      if(control.pending!==null||request.stockCurrent?.stockProtocol!==undefined)throw Error('Warehouse inventory mode changed. Refresh the retained receipt.');
      return saveLegacy();
    }
    if(control.mode!=='ACTIVE')throw Error('Warehouse inventory maintenance. Retain the original receipt.');
    // Same-request resume owns pending validation inside the current coordinator.
    return saveCurrent(company,{requestId:request.requestId,input:request.input,stockProtocol:request.stockCurrent?.stockProtocol,
      stockBuild:request.stockCurrent?.stockBuild,stockGeneration:request.stockCurrent?.stockGeneration,stockIdentity:request.stockCurrent?.stockIdentity});
  };
}
function createCurrentWarehouseOrdersRouter({company,readControl,readCurrent,readLegacy}){
  if([readControl,readCurrent,readLegacy].some(fn=>typeof fn!=='function'))throw Error('Original Warehouse read routing dependencies required');
  const route=createCurrentWarehouseReceiptRouter({company,readControl:async()=>{
    const control=await readControl();if(control?.pending!==null)throw Error('Warehouse inventory pending. Retain the original input.');return control;
  },saveCurrent:selected=>readCurrent(selected),saveLegacy:readLegacy});
  return()=>route({});
}
module.exports={createCurrentWarehouseReceiptRouter,createCurrentWarehouseOrdersRouter};

},
// current-warehouse-orders-read.cjs sha256:3a4ffb9c4c498639df85042272ffba36017b67536fa554fe0f4bfcb3cb3a2163
"current-warehouse-orders-read.cjs": (load, module) => {
'use strict';
const {projectCurrentWarehouseReady}=load("current-warehouse-ready-context.cjs");
const {copy}=load("segmented-plan.cjs");
// PRIVATE composition. Receipt PO/version remains ORIGINAL physical-source facts;
// customer availability and Ready use current ownership. Neither is stored twice.
function createCurrentWarehouseOrdersRead({company,protocol,authenticate,readCurrentContext,projectPurchaseOrders,
  projectWarehouseOrders,projectWarehouseCustomerReadiness,projectPreparation,currentReadyVersion,readAllocations,
  readCustomerShipments,readPreparation,warehouseCbm,readCustomerShortNames,now}){
  if(!['NCT','GHR'].includes(company)||typeof protocol?.readSnapshot!=='function'||currentReadyVersion!==2
    ||[authenticate,readCurrentContext,projectPurchaseOrders,projectWarehouseOrders,projectWarehouseCustomerReadiness,
      projectPreparation,readAllocations,readCustomerShipments,readPreparation,warehouseCbm,readCustomerShortNames,now].some(fn=>typeof fn!=='function'))throw Error('Paired original current Warehouse read dependencies required');
  return async selected=>{
    if(selected!==company)throw Error('Warehouse orders company conflict');
    const staff=await authenticate(company);if(!staff?.staffId||!staff.memberId||!staff.staffName)throw Error('Original Warehouse identity required');
    const snapshot=await protocol.readSnapshot(async control=>{
      if(control?.company!==company||control.mode!=='ACTIVE'||control.pending||control.schemaVersion!==1||control.transferIndexVersion!==2
        ||!control.writerBuild||!Number.isSafeInteger(control.generation)||control.generation<0)throw Error('Current Warehouse control required');
      const data=await readCurrentContext(company,staff,control),workspace=data?.workspace,original=data?.originalContext;
      if(workspace?.company!==company||workspace.stockAllocationView!=='CURRENT_V2'||original?.company!==company
        ||!Array.isArray(workspace.tasks)||!Array.isArray(original.tasks)||!Array.isArray(original.activity)
        ||!Array.isArray(data.tables?.R2PurchaseOrders)||!Array.isArray(data.states)
        ||data.states.some(state=>state.scope!=='CURRENT_ACTIVE_PRODUCT'||state.lifecycleVersion!==2)
        ||workspace.tasks.length!==original.tasks.length||new Set(workspace.tasks.map(row=>row.id)).size!==workspace.tasks.length
        ||workspace.tasks.some(row=>!original.tasks.some(task=>task.id===row.id&&task.customerId===row.customerId
          &&task.orderId===row.orderId&&task.sourceLineId===row.sourceLineId&&task.po===row.po&&task.ord===row.ord)))throw Error('Complete original and current Warehouse facts required');
      const context={...copy(workspace),activity:copy(original.activity)};
      const loaded=[...readPreparation(context.activity).values()].filter(state=>state.loaded>0).map(state=>state.taskId);
      const requiredTaskIds=[...new Set([...context.tasks.filter(task=>!task.archived&&!task.specialPurchase&&!task.procurementSource).map(task=>task.id),...loaded])];
      if(requiredTaskIds.some(id=>!context.tasks.some(task=>task.id===id)))throw Error('Loaded Warehouse task requires review');
      const deliveryTasks=projectCurrentWarehouseReady({context,states:data.states,requiredTaskIds,projectPreparation,currentReadyVersion,
        readAllocations,readCustomerShipments}).map(item=>{
        const task=context.tasks.find(row=>row.id===item.taskId);
        return {...item,sourceLineId:task?.sourceLineId,cbmPerCtn:task?warehouseCbm(company,task,context.activity):null};
      });
      // Never feed borrowed inc into original physical receipt bootstrap guard,
      // nor change original PO version just because customer ownership moved.
      const orders=projectWarehouseOrders({company,purchaseOrders:projectPurchaseOrders({company,workspace:original,records:data.tables.R2PurchaseOrders}),
        tasks:original.tasks,activity:original.activity});
      const customerLines=projectWarehouseCustomerReadiness(workspace);let names=[];
      try{names=await readCustomerShortNames([...new Set([...orders.flatMap(row=>row.customerIds||[row.customerId]),...customerLines.map(row=>row.customerId)])]);}catch(_){}
      if(!Array.isArray(names))throw Error('Original Warehouse customer names require review');
      return{company,staff:{staffId:staff.staffId,staffName:staff.staffName,memberId:staff.memberId},deliveryTasks,
        customerLines:customerLines.map(row=>({...row,fullCustomerName:row.customerName,customerName:names.find(item=>item.customerId===row.customerId)?.shortName||row.customerName})),
        orders:orders.map(row=>({...row,fullCustomerName:row.customerName,customerName:(row.customers||[{id:row.customerId,name:row.customerName}])
          .map(customer=>names.find(item=>item.customerId===customer.id)?.shortName||customer.name).join(' · ')})),
        readAt:now().toISOString(),stockCurrent:{schema:'CURRENT_WAREHOUSE_V2',stockProtocol:1,stockBuild:control.writerBuild,stockGeneration:control.generation,generation:control.generation}};
    });return snapshot.rows;
  };
}
module.exports={createCurrentWarehouseOrdersRead};

},
// current-warehouse-ready-context.cjs sha256:58bc025e56523a568f30517567093ef75111dc32f195793aba455aa6a161a5a3
"current-warehouse-ready-context.cjs": (load, module) => {
'use strict';

const { currentAllocationContext } = load("current-allocation-context.cjs");
const { stockKey } = load("current-model.cjs");
const { hash } = load("commit-proof.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
// Explicit adapter ONLY for original Warehouse Ready/preparation consumers.
// Not a replacement for readFulfilmentContext or financial/exception case facts.
function currentWarehouseReadyContext({ context, states, readAllocations, readCustomerShipments, requiredTaskIds }) {
  if (!['NCT', 'GHR'].includes(context?.company) || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
    || !Array.isArray(states) || typeof readAllocations !== 'function' || typeof readCustomerShipments !== 'function') throw Error('Complete Warehouse ready context required');
  const products = new Set(), tasks = new Map(), sources = new Map(), allocations = [];
  const scoped = states.some(state => state.scope === 'CURRENT_ACTIVE_PRODUCT');
  if (scoped && (states.some(state => state.scope !== 'CURRENT_ACTIVE_PRODUCT' || state.lifecycleVersion !== 2)
    || !Array.isArray(requiredTaskIds) || new Set(requiredTaskIds).size !== requiredTaskIds.length)) throw Error('Explicit verified current Ready scope required');
  for (const state of states) {
    const key = stockKey(state);
    if (state.company !== context.company || products.has(key)) throw Error('Distinct company ready products required');
    products.add(key);
    const converted = currentAllocationContext({ state, context, readAllocations });
    for (const task of state.tasks) {
      if (tasks.has(task.id)) throw Error('Warehouse demand coverage is ambiguous');
      tasks.set(task.id, converted.tasks.find(t => t.id === task.id));
    }
    for (const source of state.sources) {
      if (sources.has(source.id)) throw Error('Warehouse source coverage is ambiguous'); sources.set(source.id, source);
      allocations.push(converted.allocations.find(a => a.sourceTaskId === source.id));
    }
  }
  for (const task of context.tasks) {
    if (!scoped && (!task.procurementSource && !task.specialPurchase && !tasks.has(task.id)
      || task.warehouse?.hasPhysicalReceipt === true && !sources.has(task.id))) throw Error('Complete current-ready task/source coverage required');
  }
  if (scoped && requiredTaskIds.some(id => typeof id !== 'string' || !tasks.has(id))) throw Error('Complete required Ready task coverage required');
  const shipments = scoped ? [] : readCustomerShipments(context.activity);
  if (shipments.some(s => s.company !== context.company)) throw Error('Warehouse shipment company conflict');
  const dispatched = shipments.filter(s => s.status === 'DISPATCHED'), actual = new Map(), expected = new Map();
  for (const shipment of dispatched) for (const line of shipment.lines) for (const source of line.sources) {
    if (!sources.has(source.sourceTaskId) || !tasks.has(line.taskId)) throw Error('Warehouse shipment provenance outside current snapshot');
    const key = hash(source.sourceTaskId, line.taskId); actual.set(key, (actual.get(key) || 0) + source.quantity);
  }
  for (const source of sources.values()) {
    for (const [taskId, qty] of Object.entries(source.dispatchedByTask || {})) if (qty) expected.set(hash(source.id, taskId), qty);
  }
  if (!scoped && (expected.size !== actual.size || [...expected].some(([key, qty]) => actual.get(key) !== qty))) throw Error('Warehouse dispatched provenance differs');
  const prior = scoped ? [] : readAllocations(context.activity);
  const visible = scoped ? context.tasks.filter(t => tasks.has(t.id) || sources.has(t.id)) : context.tasks;
  return { ...copy(context), ...(scoped ? { stockCurrentReadyVersion: 2,
    stockDispatchedByTask: Object.fromEntries(states.flatMap(s => s.tasks.map(t => [t.id, t.dispatched]))),
    stockDispatchedBySource: Object.fromEntries(states.flatMap(s => s.sources.map(p => [p.id, copy(p.dispatchedByTask || {})]))),
    stockRequiredTaskIds: [...requiredTaskIds] } : {}),
    allocations: [...prior.filter(a => !sources.has(a.sourceTaskId)), ...allocations], tasks: visible.map(original => {
    const row = copy(tasks.get(original.id) || original), source = sources.get(original.id);
    if (!source) return row;
    if ((original.warehouse?.hasPhysicalReceipt === true ? original.warehouse.accepted : 0) !== source.accepted
      || source.accepted > 0 && original.warehouse?.hasPhysicalReceipt !== true) throw Error('Warehouse accepted receipt provenance differs');
    if (original.warehouse?.hasPhysicalReceipt === true) row.warehouse = { ...copy(original.warehouse), stock: {
      ...copy(original.warehouse.stock || {}), availablePhysical: source.onHand - source.isolated } };
    return row;
  }) };
}
function projectCurrentWarehouseReady({ projectPreparation, currentReadyVersion, ...context }) {
  const scoped = context.states?.some(state => state.scope === 'CURRENT_ACTIVE_PRODUCT');
  if (typeof projectPreparation !== 'function' || scoped && currentReadyVersion !== 2) throw Error('Verified original current Ready calculator required');
  const view = currentWarehouseReadyContext(context), rows = projectPreparation(view);
  if (!Array.isArray(rows)) throw Error('Original Ready rows required');
  // Other customers' sources may be needed to calculate ownership, but do not
  // create extra outgoing tasks outside the server-selected instruction scope.
  return scoped ? rows.filter(row => context.requiredTaskIds.includes(row.taskId)) : rows;
}
module.exports = { currentWarehouseReadyContext, projectCurrentWarehouseReady };

},
// current-warehouse-preparation-save.cjs sha256:2c8a848dc1d025c1dac41e5d1ea0c8ed0cbe66397153ce6b9fb918b1f625499d
"current-warehouse-preparation-save.cjs": (load, module) => {
'use strict';
const {createCurrentStockSave}=load("current-stock-save.cjs");
const {currentWarehouseReadyContext}=load("current-warehouse-ready-context.cjs");
const {validateOriginalPreparation}=load("legacy-warehouse-preparation.cjs");
const {originalProductState}=load("original-product-state.cjs");
const {preparePackingHoldTransition}=load("borrowing-stock-plan.cjs");
const {hash}=load("commit-proof.cjs");
const {captureOriginalWarehousePhotoPlan}=load("warehouse-photo-plan.cjs");
const {prependWarehousePhotoReceipts}=load("warehouse-photo-fenced-store.cjs");
// PRIVATE co-writer. Files require the paired durable file adapter. Original
// preparation rules/identity stay; it posts
// neither physical departure nor invoice and never allocates another customer's stock.
function createCurrentWarehousePreparationSave({company,store,protocol,coverage,authenticateOriginalWarehouse,
  readCurrentContext,createPreparationOperations,projectPreparation,currentReadyVersion,projectPurchaseOrders,
  readPreparation,readAllocations,readCustomerShipments,readPackingLists,packingHeld,now,createPhotoProtocol,allocatePhotoSlots}){
  if(!['NCT','GHR'].includes(company)||protocol?.planFormat!=='SEGMENTED_V2'||typeof protocol.readSnapshot!=='function'||typeof store?.read!=='function'||currentReadyVersion!==2
    ||[authenticateOriginalWarehouse,readCurrentContext,createPreparationOperations,projectPreparation,projectPurchaseOrders,
      readPreparation,readAllocations,readCustomerShipments,readPackingLists,packingHeld,now].some(fn=>typeof fn!=='function'))throw Error('Paired private current Warehouse preparation dependencies required');
  return async request=>{
    const photoRequest=request?.input?.action==='PHOTOS'||Array.isArray(request?.input?.photos)&&request.input.photos.length>0;
    if(!['PACK','LOAD','UNPACK','PHOTOS'].includes(request?.input?.action)
      ||request.input.photos!==undefined&&(!Array.isArray(request.input.photos)||request.input.photos.length>3)
      ||photoRequest&&(typeof createPhotoProtocol!=='function'||typeof allocatePhotoSlots!=='function'))throw Error('Current non-photo Warehouse preparation required until paired private file protocol is supplied');
    if(photoRequest&&request.input.photos===undefined)request={...request,input:{...request.input,photos:[]}};
    let staff;
    let saveProtocol=protocol;
    if(photoRequest){
      const original=await authenticateOriginalWarehouse(company);
      if(!original?.staffId||!original.memberId||!original.staffName||original.customerId)throw Error('Original Warehouse photo grant required');
      staff={...original,canPrepareWarehouse:true};saveProtocol=createPhotoProtocol({request,staff});
      if(saveProtocol?.planFormat!=='SEGMENTED_V2'||typeof saveProtocol.commit!=='function'||typeof saveProtocol.readSnapshot!=='function')throw Error('Bounded private file protocol required');
    }
    const result=await createCurrentStockSave({company,writer:'WAREHOUSE_PREPARATION',protocol:saveProtocol,coverage,
      authenticate:async()=>{
        const original=await authenticateOriginalWarehouse(company);
        if(!original?.staffId||!original.memberId||!original.staffName||original.customerId)throw Error('Original Warehouse preparation grant required');
        if(photoRequest&&(original.staffId!==staff.staffId||original.memberId!==staff.memberId||original.staffName!==staff.staffName))throw Error('Original photo actor changed');
        staff={...original,canPrepareWarehouse:true};return staff;
      },prepare:async command=>{
        const snapshot=await protocol.readSnapshot(async control=>{
          if(control?.company!==company||control.mode!=='ACTIVE'||control.schemaVersion!==1||control.transferIndexVersion!==2||control.pending)throw Error('Current Warehouse preparation checkpoint required');
          const data=await readCurrentContext(company,staff,control),workspace=data?.workspace,products=data?.products;
          if(workspace?.company!==company||workspace.stockAllocationView!=='CURRENT_V2'||data.originalContext?.company!==company
            ||typeof products?.values!=='function'||!Array.isArray(data.tables?.R2PurchaseOrders))throw Error('Complete current Warehouse preparation context required');
          const selectedProducts=[...products.values()];
          if(selectedProducts.some(product=>product.state?.scope!=='CURRENT_ACTIVE_PRODUCT'||product.state.lifecycleVersion!==2||!product.rows))throw Error('Scoped Warehouse preparation products required');
          const originalContext={...workspace,activity:data.originalContext.activity};
          const requiredTaskIds=[...new Set([...workspace.tasks.filter(task=>!task.archived&&!task.specialPurchase&&!task.procurementSource).map(task=>task.id),
            ...[...readPreparation(originalContext.activity).values()].filter(state=>state.loaded>0).map(state=>state.taskId)])];
          const context=currentWarehouseReadyContext({context:originalContext,states:selectedProducts.map(product=>product.state),requiredTaskIds,readAllocations,readCustomerShipments});
          const selected=projectPreparation(context).filter(row=>row.id===command.input.id);
          if(selected.length!==1)throw Error('Exact current Warehouse preparation batch required');
          const product=selectedProducts.filter(product=>product.state.tasks.some(task=>task.id===selected[0].taskId));
          if(product.length!==1)throw Error('Exact current Warehouse preparation product required');
          let validated;
          if(photoRequest){
            const input={...command.input,photos:command.input.photos||[]},at=now(),fixedNow=()=>new Date(at);
            const args={company,staff,requestId:command.requestId,input,context,createPreparationOperations,now:fixedNow};
            // Run every ORIGINAL task/ownership/file validator before requesting
            // Drive generated IDs. ALLOCATE reserves IDs only; it creates no file.
            await captureOriginalWarehousePhotoPlan({...args,slots:input.photos.map((_,index)=>'pending-photo-'+hash(company,command.requestId,staff.memberId,index))});
            const slots=await allocatePhotoSlots(input.photos.length);
            validated=await captureOriginalWarehousePhotoPlan({...args,slots});
          }else validated=await validateOriginalPreparation({company,staff,requestId:command.requestId,input:command.input,context,createPreparationOperations,now});
          const event=validated.event;
          if(event.initiatedByStaffId!==staff.staffId||event.description!==selected[0].id||event.imageAltText!==selected[0].taskId
            ||event.image!==selected[0].customerId||validated.version!==command.input.version)throw Error('Original Warehouse preparation identity changed');
          const originalOrders=projectPurchaseOrders({company,workspace:data.originalContext,records:data.tables.R2PurchaseOrders});
          const after=originalProductState({company,context:{...context,activity:[...context.activity,event]},orders:originalOrders,
            identity:product[0].state,readAllocations,readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation}).buildState(product[0].rows);
          const plan=preparePackingHoldTransition({state:product[0].state,rows:product[0].rows,event,generation:control.generation,packingHolds:after.packingHolds}).plan;
          return photoRequest?prependWarehousePhotoReceipts({company,staff,requestId:command.requestId,input:{...command.input,photos:command.input.photos||[]},prepared:validated,plan}):plan;
        });return{plan:snapshot.rows,memberId:staff.memberId,generation:snapshot.generation};
      }})(request);
    if(result.ok!==true)return result;
    const id=hash(company,request.requestId,staff.memberId,'WAREHOUSE_PREPARATION');
    const snapshot=await protocol.readSnapshot(()=>store.read(company==='NCT'?'R2NCTActivity':'R2NCTActivity1',id)),event=snapshot.rows;
    if(!event?._version||event._id!==id||event.title!==id||event.company!==company||event.action!=='WAREHOUSE_PREPARATION_SAVED'||event.result!=='SAVED'
      ||event.initiatedByStaffId!==staff.staffId||event.description!==request.input.id||event.details?.state?.id!==request.input.id
      ||event.details.action!==request.input.action||typeof event.activityTime!=='string'||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Committed Warehouse preparation receipt requires review');
    return{...result,company,id:request.input.id,savedAt:event.activityTime};
  };
}
module.exports={createCurrentWarehousePreparationSave};

},
// legacy-warehouse-preparation.cjs sha256:ff763b0564021adefb61292d9d11c944c7776a8051d712afd7275f64753dfe1b
"legacy-warehouse-preparation.cjs": (load, module) => {
'use strict';

const { stockKey } = load("current-model.cjs");
const { originalProductState } = load("original-product-state.cjs");
const { readCurrentProduct } = load("current-product-reader.cjs");
const { currentWarehouseReadyContext } = load("current-warehouse-ready-context.cjs");
const { preparePackingHoldTransition } = load("borrowing-stock-plan.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const nonPhoto = input => ['PACK', 'LOAD', 'UNPACK'].includes(input?.action)
  && (input.photos === undefined || Array.isArray(input.photos) && input.photos.length === 0);

// Capture the ORIGINAL prepare, never its apply or external document protocol.
// Only a private journal exists here; no actual lock/event/file can be mutated.
async function validateOriginalPreparation({ createPreparationOperations, company, staff, requestId, input, context, now }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks)
    || !Array.isArray(context.activity) || !nonPhoto(input) || typeof createPreparationOperations !== 'function'
    || typeof now !== 'function') throw Error('Original non-photo Warehouse preparation required');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', scratch = new Map(), boundary = new Error('Private Warehouse prepare boundary');
  let captured, reads = 0;
  const scope = c => { if (c !== journal) throw Error('Warehouse preparation scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'WAREHOUSE_PREPARATION_SAVED'
          || !Array.isArray(row.details.plan.uploads) || row.details.plan.uploads.length) throw Error('Unexpected Warehouse preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Warehouse apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    },
    remove: async (c, id) => {
      scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private Warehouse lock removal allowed'); scratch.delete(id);
    }
  };
  const save = createPreparationOperations({ store, names: { [company]: { activity: journal } }, now,
    documentService: async () => { throw Error('External Warehouse documents forbidden'); },
    readContext: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected Warehouse apply/read'); return copy(context);
    } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original Warehouse boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original Warehouse preparation incomplete');
  return captured;
}

// Candidate composition for the existing authenticated Warehouse gateway. Not an
// endpoint or admission switch. All co-writers/apply-only guards must be fenced
// before adoption. PHOTOS still require the protected external upload protocol.
function createLegacyWarehousePreparation(deps) {
  const { company, readMember, readStaffRecords, requireWarehouseStaff, readContext, readPurchaseRecords, projectPurchaseOrders,
    createPreparationOperations, projectPreparation, readPreparation, readAllocations, readCustomerShipments, readPackingLists,
    packingHeld, protocol, items, store, now } = deps;
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requireWarehouseStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, createPreparationOperations, projectPreparation, readPreparation, readAllocations, readCustomerShipments,
    readPackingLists, packingHeld, now].some(f => typeof f !== 'function') || typeof protocol?.readSnapshot !== 'function'
    || typeof items?.query !== 'function' || typeof store?.read !== 'function') throw Error('Server Warehouse preparation dependencies required');
  async function load(request, save) {
    if (request?.company !== company || save && !nonPhoto(request.input)) throw Error('Supported company/non-photo Warehouse request required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requireWarehouseStaff(member, []);
    // Same permission boundary as the ORIGINAL saveWarehousePreparation wrapper.
    const staff = { ...requireWarehouseStaff(member, await readStaffRecords()), memberId: member._id, canPrepareWarehouse: true };
    const metrics = { queries: 0, exactReads: 0 };
    const snapshot = await protocol.readSnapshot(async () => {
      const original = await readContext(company, staff);
      if (original?.company !== company || !Array.isArray(original.tasks) || !Array.isArray(original.activity)) throw Error('Original Warehouse context required');
      const orders = projectPurchaseOrders({ company, workspace: original, records: await readPurchaseRecords(company, staff) });
      const identities = new Map(), products = [];
      for (const task of original.tasks.filter(t => !t.procurementSource && !t.specialPurchase || t.warehouse?.hasPhysicalReceipt === true)) {
        const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea }; identities.set(stockKey(identity), identity);
      }
      const build = (context, identity) => originalProductState({ company, context, orders, identity, readAllocations,
        readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
      for (const identity of identities.values()) {
        const rows = await readCurrentProduct({ company, identity, items, store, metrics });
        products.push({ identity, rows, state: build(original, identity).buildState(rows) });
      }
      const context = currentWarehouseReadyContext({ context: original, states: products.map(p => p.state), readAllocations, readCustomerShipments });
      const projected = projectPreparation(context);
      if (!save) return { projected };
      const selected = projected.filter(row => row.id === request.input.id);
      if (selected.length !== 1) throw Error('Exact Warehouse preparation task required');
      const product = products.find(p => p.state.tasks.some(t => t.id === selected[0].taskId));
      if (!product) throw Error('Warehouse preparation current product unavailable');
      const validated = await validateOriginalPreparation({ createPreparationOperations, company, staff, requestId: request.requestId,
        input: request.input, context, now }), event = validated.event;
      if (event.initiatedByStaffId !== staff.staffId || event.description !== selected[0].id || event.imageAltText !== selected[0].taskId
        || event.image !== selected[0].customerId || validated.version !== request.input.version) throw Error('Original Warehouse event identity conflict');
      const state = build(context, product.identity).buildState(product.rows);
      const after = build({ ...context, activity: [...context.activity, event] }, product.identity).buildState(product.rows);
      return { state, rows: product.rows, event, packingHolds: after.packingHolds };
    });
    if (!save) return { rows: snapshot.rows.projected, memberId: staff.memberId, generation: snapshot.generation, metrics };
    return { ...preparePackingHoldTransition({ ...snapshot.rows, generation: snapshot.generation }),
      memberId: staff.memberId, generation: snapshot.generation, metrics };
  }
  return { read: request => load(request, false), prepare: request => load(request, true) };
}
module.exports = { validateOriginalPreparation, createLegacyWarehousePreparation };

},
// warehouse-photo-plan.cjs sha256:fb23f8aae26f77ffb8ac0600d8dc3aca2d53207e56f9cb400088c7c26b1a3bd1
"warehouse-photo-plan.cjs": (load, module) => {
'use strict';
const {hash}=load("commit-proof.cjs");
const {same,copy}=load("segmented-plan.cjs");
const fileId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(value);
// PRIVATE boundary: slots must come from the server's durable plan, never browser
// file IDs. Capture ORIGINAL validation/prepare with no legacy apply or file call.
async function captureOriginalWarehousePhotoPlan({company,staff,requestId,input,context,createPreparationOperations,now,slots}){
 if(!['NCT','GHR'].includes(company)||context?.company!==company||!Array.isArray(context.tasks)||!Array.isArray(context.activity)
  ||!staff?.memberId||!staff.staffId||!staff.staffName||staff.canPrepareWarehouse!==true
  ||!/^[a-f0-9-]{36}$/i.test(requestId||'')||!['PACK','LOAD','UNPACK','PHOTOS'].includes(input?.action)
  ||!Array.isArray(input.photos)||input.photos.length>3||!Array.isArray(slots)||slots.length!==input.photos.length
  ||slots.some(id=>!fileId(id))||new Set(slots).size!==slots.length
  ||typeof createPreparationOperations!=='function'||typeof now!=='function')throw Error('Private original Warehouse photo plan scope required');
 const journal=company==='NCT'?'R2NCTActivity':'R2NCTActivity1',scratch=new Map(),boundary=Error('Private photo prepare boundary');
 let captured,reads=0,allocated=0;
 const scope=collection=>{if(collection!==journal)throw Error('Private Warehouse photo journal scope');};
 const store={
  read:async(collection,id)=>{scope(collection);return copy(scratch.get(id)||null);},
  insert:async(collection,row)=>{scope(collection);
   if(row.action==='PURCHASE_OPERATION_PREPARED'&&row.details?.kind==='PREPARED'){
    if(captured||scratch.size!==1||row.details.plan?.event?.action!=='WAREHOUSE_PREPARATION_SAVED')throw Error('Unexpected original photo prepare');
    captured=copy(row.details.plan);throw boundary;
   }
   if(row.action!=='PURCHASE_OPERATION_LOCK'||row.details?.kind!=='LOCK'||scratch.size)throw Error('Original photo apply forbidden');
   scratch.set(row._id,copy(row));return copy(row);
  },
  remove:async(collection,id)=>{scope(collection);if(scratch.get(id)?.action!=='PURCHASE_OPERATION_LOCK')throw Error('Only scratch photo lock removal allowed');scratch.delete(id);}
 };
 const save=createPreparationOperations({store,names:{[company]:{activity:journal}},now,
  readContext:async(c,actor)=>{if(c!==company||actor.memberId!==staff.memberId||++reads!==1)throw Error('Original photo context scope');return copy(context);},
  documentService:async command=>{
   if(!same(command,{action:'ALLOCATE',company})||allocated>=slots.length)throw Error('External photo call forbidden during capture');
   return{ok:true,fileId:slots[allocated++]};
  }});
 try{await save({company,staff:copy(staff),requestId,input:copy(input)});throw Error('Original photo prepare boundary not reached');}
 catch(error){if(error!==boundary)throw error;}
 if(!captured||reads!==1||scratch.size||allocated!==slots.length||captured.version!==input.version
  ||captured.event._id!==hash(company,requestId,staff.memberId,'WAREHOUSE_PREPARATION')||captured.event.initiatedByStaffId!==staff.staffId
  ||captured.event.description!==input.id||captured.event.details?.action!==input.action||captured.event.details.state?.id!==input.id
  ||captured.uploads.length!==slots.length||captured.uploads.some((upload,index)=>upload.fileId!==slots[index]))throw Error('Original photo plan identity conflict');
 assertWarehousePhotoUploads({company,staff,requestId,input,plan:captured});
 return captured;
}
// Validate ONLY exact immutable upload descriptors already captured from original
// prepare. The authenticated caller must hold durable pending before upload; this
// helper intentionally has NO network/storage/lock/allocate/trash capability.
function assertWarehousePhotoUploads({company,staff,requestId,input,plan}){
 const event=plan?.event,photos=input?.photos,uploads=plan?.uploads;
 if(!['NCT','GHR'].includes(company)||!staff?.staffId||!staff.memberId||!staff.staffName
  ||!/^[a-f0-9-]{36}$/i.test(requestId||'')||!['PACK','LOAD','UNPACK','PHOTOS'].includes(input?.action)
  ||!Array.isArray(photos)||photos.length>3||!Array.isArray(uploads)||uploads.length!==photos.length
  ||event?._id!==hash(company,requestId,staff.memberId,'WAREHOUSE_PREPARATION')||event.title!==event._id
  ||event.action!=='WAREHOUSE_PREPARATION_SAVED'||event.result!=='SAVED'||event.description!==input.id
  ||event.initiatedByStaffId!==staff.staffId||event.initiatedByStaffName!==staff.staffName
  ||event.details?.action!==input.action||event.details.state?.id!==input.id||plan.version!==input.version
  ||event.details.state.company!==company||!Array.isArray(event.details.state.photos)||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Immutable original photo plan required');
 const evidence=event.details.state.photos.slice(-uploads.length),seen=new Set();
 for(const[index,upload]of uploads.entries()){
  const photo=photos[index],ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[photo?.mimeType];
  const expected={action:'PHOTO_UPLOAD',company,department:'WAREHOUSE',poId:input.id,fileId:upload.fileId,type:input.photoStage,mimeType:photo?.mimeType,
   sha256:photo?.sha256,size:upload.size,name:company+'-'+event.details.state.barcode+'-'+input.photoStage+'-'+requestId+'-'+index+'.'+ext};
  if(!ext||!fileId(upload.fileId)||seen.has(upload.fileId)||!same(upload,expected)||!['PACKING','LOADING'].includes(upload.type)
   ||typeof photo?.base64!=='string'||photo.base64.length>2800000||!/^[a-f0-9]{64}$/i.test(photo.sha256||'')
   ||!Number.isSafeInteger(upload.size)||upload.size<12||upload.size>2*1024*1024
   ||!same(evidence[index],{fileId:upload.fileId,name:upload.name,sha256:upload.sha256,mimeType:upload.mimeType,size:upload.size,stage:upload.type,at:event.activityTime,by:staff.staffName}))throw Error('Immutable original photo upload conflict');
  seen.add(upload.fileId);
 }
 return true;
}
// A single deterministic slot is one bounded external action. Replays reuse the
// exact original file ID; legacy service is create-only + same-ID content check.
// A timeout/unknown response throws: caller must keep its pending operation. There
// is no TTL unlock or interpretation of a timeout as callback termination here.
async function uploadWarehousePhotoSlot({company,staff,requestId,input,plan,index,documentService}){
 assertWarehousePhotoUploads({company,staff,requestId,input,plan});
 if(!Number.isSafeInteger(index)||index<0||index>=plan.uploads.length||typeof documentService!=='function')throw Error('Exact original photo slot required');
 const upload=copy(plan.uploads[index]),receipt=await documentService({...upload,base64:input.photos[index].base64});
 if(receipt?.ok!==true||['fileId','company','poId','name','sha256','mimeType','size'].some(key=>receipt[key]!==upload[key]))throw Error('Original photo upload unconfirmed; retain same slot');
 return{fileId:upload.fileId,company,poId:upload.poId,name:upload.name,sha256:upload.sha256,mimeType:upload.mimeType,size:upload.size};
}
module.exports={captureOriginalWarehousePhotoPlan,assertWarehousePhotoUploads,uploadWarehousePhotoSlot};

},
// warehouse-photo-fenced-store.cjs sha256:6007cb90b32fb52dfbc95cf723671a2ae34c28e55aa80e077d888efcf07db3c6
"warehouse-photo-fenced-store.cjs": (load, module) => {
'use strict';
const {hash}=load("commit-proof.cjs");
const {createSegmentedPlanCodec,same,copy}=load("segmented-plan.cjs");
const {assertWarehousePhotoUploads,uploadWarehousePhotoSlot}=load("warehouse-photo-plan.cjs");
const ACTION='WAREHOUSE_PHOTO_CONFIRMED';
const withoutVersion=row=>{const result=copy(row);delete result._version;return result;};
function photoReceipt({company,staff,requestId,input,plan,index}){
 assertWarehousePhotoUploads({company,staff,requestId,input,plan});
 if(!Number.isSafeInteger(index)||index<0||index>=plan.uploads.length)throw Error('Exact photo receipt slot required');
 const id=hash(company,requestId,staff.memberId,ACTION,index);
 return{_id:id,title:id,company,stockPhotoProtocol:1,action:ACTION,result:'SAVED',actorType:'STAFF',activityTime:plan.event.activityTime,
  initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,description:input.id,imageAltText:plan.event.imageAltText,
  details:{requestId,memberId:staff.memberId,index,eventId:plan.event._id,upload:copy(plan.uploads[index])}};
}
// Insert-only receipts precede the ORIGINAL event and every stock/hold after-image.
// They contain descriptors, never photo bytes or a browser-chosen destination.
function prependWarehousePhotoReceipts({company,staff,requestId,input,prepared,plan}){
 assertWarehousePhotoUploads({company,staff,requestId,input,plan:prepared});
 const journal=company==='NCT'?'R2NCTActivity':'R2NCTActivity1';
 if(!Array.isArray(plan?.writes)||plan.writes.filter(change=>change.collection===journal&&same(change.after,{...prepared.event,company})).length!==1
  ||plan.writes.some(change=>change.after?.action===ACTION||change.after?.stockPhotoProtocol!==undefined))throw Error('Exact original preparation stock plan required');
 const writes=prepared.uploads.map((_,index)=>({collection:journal,before:null,after:photoReceipt({company,staff,requestId,input,plan:prepared,index})}));
 return{...copy(plan),writes:[...writes,...copy(plan.writes)]};
}
// PRIVATE request-scoped adapter. Use only with the existing SEGMENTED_V2 protocol
// and <=1 APPLY write per invocation for bounded external work. No protocol rewrite,
// allocation/trash/update-file/TTL unlock or alternate stock authority is introduced.
function createWarehousePhotoFencedStore({company,staff,request,store,documentService,codecPolicy={},coordination='EXCLUSIVE_LOCK'}){
 if(!['EXCLUSIVE_LOCK','CONTROL_CAS_CANDIDATE'].includes(coordination))throw Error('Explicit server photo coordination required');
 const exclusive=coordination==='EXCLUSIVE_LOCK';
 if(!['NCT','GHR'].includes(company)||!staff?.staffId||!staff.memberId||!staff.staffName||staff.canPrepareWarehouse!==true
  ||!/^[a-f0-9-]{36}$/i.test(request?.requestId||'')||request.stockProtocol!==1||!request.stockBuild
  ||!Number.isSafeInteger(request.stockGeneration)||request.stockGeneration<0||!Array.isArray(request.input?.photos)||request.input.photos.length>3
  ||['read','insert','compareAndSet','compareAndRemove'].some(method=>typeof store?.[method]!=='function')||typeof documentService!=='function')throw Error('Private fenced Warehouse photo dependencies required');
 const codec=createSegmentedPlanCodec({...codecPolicy,company,domainWrites:true}),{journal,lockId,controlId}=codec.ids,requestId=request.requestId;
 const key=hash(company+'/PURCHASE',requestId,staff.memberId),digest=hash({company,writer:'WAREHOUSE_PREPARATION',input:request.input,stockProtocol:request.stockProtocol,stockBuild:request.stockBuild,stockGeneration:request.stockGeneration,...(request.stockIdentity!==undefined?{stockIdentity:request.stockIdentity}:{})});
 async function boundPlan(collection,row){
  const control=await store.read(journal,controlId),lock=exclusive?await store.read(journal,lockId):null,manifest=await store.read(journal,key);
  if(!control?._version||control.company!==company||control.mode!=='ACTIVE'||control.generation!==request.stockGeneration
   ||control.pending?.key!==key||control.pending.digest!==digest||control.pending.phase!=='APPLY'
   ||manifest?.planHash!==control.pending.planHash||manifest.digest!==digest||manifest.baseGeneration!==request.stockGeneration
   ||exclusive&&(lock?.company!==company||lock.owner!==key||typeof lock.attempt!=='string'||!lock.attempt))throw Error('Durable pending photo operation required');
  if(!Array.isArray(manifest.fragments)||manifest.fragments.length>32)throw Error('Bounded photo manifest required');
  const fragments=[];for(const ref of manifest.fragments)fragments.push(await store.read(journal,ref.id));
  const plan=codec.decode({manifest,fragments,key,digest,memberId:staff.memberId,requestId});
  if(!plan.writes.some(change=>change.collection===collection&&same(change.after,row)))throw Error('Photo write absent from immutable plan');
  const events=plan.writes.filter(change=>change.collection===journal&&change.after.action==='WAREHOUSE_PREPARATION_SAVED');
  if(events.length!==1||events[0].before!==null)throw Error('Exact immutable photo preparation event required');
  const event=withoutVersion(events[0].after),evidence=event.details?.state?.photos;
  if(!Array.isArray(evidence)||evidence.length<request.input.photos.length)throw Error('Original photo evidence required');
  const uploads=evidence.slice(evidence.length-request.input.photos.length).map(photo=>({action:'PHOTO_UPLOAD',company,department:'WAREHOUSE',poId:request.input.id,
   fileId:photo.fileId,type:photo.stage,mimeType:photo.mimeType,sha256:photo.sha256,size:photo.size,name:photo.name}));
  if(typeof event.initiatedByStaffName!=='string'||!event.initiatedByStaffName||event.initiatedByStaffName.length>200)throw Error('Original recorded photo actor required');
  // Current role/member/staff ID are reauthorized by the gateway. A display-name
  // edit must neither rewrite the captured audit nor strand a valid same actor.
  const recordedStaff={...staff,staffName:event.initiatedByStaffName};
  const prepared={version:request.input.version,event,uploads};assertWarehousePhotoUploads({company,staff:recordedStaff,requestId,input:request.input,plan:prepared});
  const receiptWrites=plan.writes.filter(change=>change.after.action===ACTION||change.after.stockPhotoProtocol!==undefined);
  if(receiptWrites.length!==uploads.length)throw Error('Complete immutable photo receipts required');
  for(let index=0;index<uploads.length;index++){
   const expected=photoReceipt({company,staff:recordedStaff,requestId,input:request.input,plan:prepared,index}),change=plan.writes[index];
   if(change?.collection!==journal||change.before!==null||!same(withoutVersion(change.after),expected))throw Error('Photo receipts must precede original business writes');
  }
  return{control,lock,prepared,recordedStaff,receipts:receiptWrites};
 }
 const metadata=(collection,row)=>collection===journal&&(row?._id===lockId||row?._id===controlId||row?.stockOperationProtocol===2);
 async function beforeDomainWrite(collection,row){
  const state=await boundPlan(collection,row),isReceipt=row.action===ACTION;
  const index=isReceipt?row.details?.index:state.receipts.length;
  if(!Number.isSafeInteger(index)||index<0||index>state.receipts.length||isReceipt&&index===state.receipts.length)throw Error('Exact bounded photo receipt required');
  for(let prior=0;prior<index;prior++)if(!same(await store.read(journal,state.receipts[prior].after._id),state.receipts[prior].after))throw Error('Earlier photo receipt unconfirmed');
  if(isReceipt)await uploadWarehousePhotoSlot({company,staff:state.recordedStaff,requestId,input:request.input,plan:state.prepared,index,documentService});
  // R2 resumes the same immutable upload ID; a late callback still cannot apply
  // business evidence after control advances. Database writes remain insert/CAS.
  const control=await store.read(journal,controlId),lock=exclusive?await store.read(journal,lockId):null;
  if(!same(control,state.control)||!same(lock,state.lock))throw Error('Photo callback fence changed; original request remains pending');
 }
 return{
  read:(...args)=>store.read(...args),compareAndRemove:(collection,id,attempt)=>{
   if(collection!==journal||id!==lockId)throw Error('Only exact owned protocol lock release allowed');
   return store.compareAndRemove(collection,id,attempt);
  },
  compareAndSet:async(collection,id,version,row)=>{
   if(row?.action===ACTION||row?.stockPhotoProtocol!==undefined||row?.action==='WAREHOUSE_PREPARATION_SAVED')throw Error('Original photo evidence is insert-only');
   if(!metadata(collection,row))await beforeDomainWrite(collection,row);
   return store.compareAndSet(collection,id,version,row);
  },
  insert:async(collection,row)=>{
   if(!metadata(collection,row))await beforeDomainWrite(collection,row);
   return store.insert(collection,row);
  }
 };
}
module.exports={photoReceipt,prependWarehousePhotoReceipts,createWarehousePhotoFencedStore};

},
// current-warehouse-cbm-save.cjs sha256:663f948f9fd48af443bf2ddb228fee983ca328cf4d1a457cd84bbf67a876f477
"current-warehouse-cbm-save.cjs": (load, module) => {
'use strict';
const {createCurrentStockSave}=load("current-stock-save.cjs");
const {evaluateStockAdmission,WRITERS}=load("stock-admission.cjs");
const {hash}=load("commit-proof.cjs");
const {copy}=load("segmented-plan.cjs");
const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
// Capture the ORIGINAL CBM-only insert, not a second POINTBASE validator or its
// real write. Original already-known result remains a read, without a CMS row.
async function captureOriginalWarehouseCbm({company,staff,requestId,taskId,data,createWarehouseCbmCapture,captureCosts,now}){
 if(!['NCT','GHR'].includes(company)||data?.company!==company||!Array.isArray(data.deliveryTasks)
  ||[createWarehouseCbmCapture,captureCosts,now].some(fn=>typeof fn!=='function'))throw Error('Original private CBM capture scope required');
 const journal=company==='NCT'?'R2NCTActivity':'R2NCTActivity1',id=hash(company,taskId,'WAREHOUSE_CBM_CAPTURED'),boundary=Error('Private CBM insert boundary');let event;
 const capture=createWarehouseCbmCapture({names:{[company]:{activity:journal}},now,captureCosts,
  readData:async(c,actor)=>{if(c!==company||actor.memberId!==staff.memberId||actor.staffId!==staff.staffId)throw Error('Original CBM actor changed');return copy(data);},
  store:{read:async(c,key)=>{if(c!==journal||key!==id)throw Error('Original CBM read scope');return null;},
   insert:async(c,row)=>{if(c!==journal||row._id!==id||row.action!=='WAREHOUSE_CBM_CAPTURED'||event)throw Error('Only original CBM insertion may be captured');event=copy(row);throw boundary;}}});
 try{const outcome=await capture({company,staff,requestId,taskId});
  if(event||outcome?.ok!==true||outcome.retained!==true||outcome.requestId!==requestId||outcome.taskId!==taskId||!valid(outcome.cbmPerCtn))throw Error('Original retained CBM receipt required');
  return{outcome};
 }catch(error){if(error!==boundary)throw error;}
 if(!event||event.title!==id||event.result!=='SAVED'||event.imageAltText!==taskId||event.details?.company!==company
  ||event.initiatedByStaffId!==staff.staffId||!valid(event.details.cbmPerCtn)||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Original CBM event identity conflict');
 return{plan:{writes:[{collection:journal,before:null,after:{...event,company}}]}};
}
// COST_REFERENCE coverage includes BOTH original Purchase costs and this original
// Warehouse reference co-writer; it grants Warehouse no Purchase/financial right.
function createCurrentWarehouseCbmSave({company,store,protocol,coverage,authenticateOriginalWarehouse,readCurrentOrders,createWarehouseCbmCapture,captureCosts,now}){
 if(!['NCT','GHR'].includes(company)||protocol?.planFormat!=='SEGMENTED_V2'||typeof protocol.readSnapshot!=='function'||typeof protocol.commit!=='function'||typeof store?.read!=='function'
  ||[authenticateOriginalWarehouse,readCurrentOrders,createWarehouseCbmCapture,captureCosts,now].some(fn=>typeof fn!=='function'))throw Error('Private current Warehouse CBM dependencies required');
 return async request=>{
  if(!/^[a-f0-9-]{36}$/i.test(request?.requestId||'')||!/^[a-f0-9]{32}$/i.test(request.input?.taskId||'')
   ||Object.keys(request.input).length!==1||request.stockProtocol!==1||typeof request.stockBuild!=='string'||!request.stockBuild
   ||!Number.isSafeInteger(request.stockGeneration)||request.stockGeneration<0
   ||!request.stockIdentity||typeof request.stockIdentity!=='object'||Array.isArray(request.stockIdentity)
   ||Object.keys(request.stockIdentity).length!==2||['staffId','memberId'].some(key=>typeof request.stockIdentity[key]!=='string'||!request.stockIdentity[key]||request.stockIdentity[key].length>200))throw Error('Exact original current CBM request required');
  let staff;
  const authorize=async()=>{const actor=await authenticateOriginalWarehouse(company);
   if(!actor?.staffId||!actor.memberId||!actor.staffName||actor.customerId||request.stockIdentity?.staffId!==actor.staffId||request.stockIdentity?.memberId!==actor.memberId)throw Error('Original Warehouse CBM identity required');
   if(staff&&(actor.staffId!==staff.staffId||actor.memberId!==staff.memberId))throw Error('Original CBM actor changed');staff=actor;return actor;};
  await authorize();
  const journal=company==='NCT'?'R2NCTActivity':'R2NCTActivity1',key=hash(company+'/PURCHASE',request.requestId,staff.memberId);
  let prepared;
  if(!await store.read(journal,key)){
   prepared=await protocol.readSnapshot(async control=>{
    if(control.company!==company||!control._version||!Number.isSafeInteger(control.generation)||control.generation<0
     ||control.mode!=='ACTIVE'||control.schemaVersion!==1||control.writerBuild!==request.stockBuild||request.stockGeneration>control.generation)throw Error('Current CBM read checkpoint required');
    if(WRITERS.some(writer=>coverage?.[writer]?.verified!==true||coverage[writer].build!==control.writerBuild))throw Error('Inventory writer coverage incomplete; activation blocked');
    const data=await readCurrentOrders(company);
    if(data.stockCurrent?.schema!=='CURRENT_WAREHOUSE_V2'||data.stockCurrent.stockGeneration!==control.generation
     ||data.stockCurrent.stockBuild!==control.writerBuild||data.staff?.staffId!==staff.staffId||data.staff?.memberId!==staff.memberId)throw Error('Same-generation original Warehouse CBM data required');
    const captured=await captureOriginalWarehouseCbm({company,staff,requestId:request.requestId,taskId:request.input.taskId,data,createWarehouseCbmCapture,captureCosts,now});
    if(captured.plan&&evaluateStockAdmission({company,writer:'COST_REFERENCE',control,coverage,request}).route!=='FENCED_CURRENT')throw Error('Current CBM save admission required');
    return captured;
   });
   // Already-known immutable reference is a fresh ORIGINAL read, not a committed
   // quantity action. A stale form may read that value; no generation is rewritten
   // in its request and no CMS manifest/receipt is created. Existing manifests must
   // always take the coordinator replay below, even if their event is now visible.
   if(prepared.rows.outcome)return{...prepared.rows.outcome,company,stockGeneration:prepared.generation};
  }
  const result=await createCurrentStockSave({company,writer:'COST_REFERENCE',store,protocol,coverage,authenticate:authorize,
   prepare:async()=>{if(!prepared?.rows.plan)throw Error('Original CBM plan missing');return{plan:prepared.rows.plan,generation:prepared.generation,memberId:staff.memberId};}})(request);
  if(result.ok!==true)return result;
  const snapshot=await protocol.readSnapshot(()=>store.read(journal,hash(company,request.input.taskId,'WAREHOUSE_CBM_CAPTURED'))),event=snapshot.rows;
  if(!event?._version||event.company!==company||event.action!=='WAREHOUSE_CBM_CAPTURED'||event.result!=='SAVED'
   ||event._id!==event.title||event.imageAltText!==request.input.taskId||event.details?.company!==company||event.initiatedByStaffId!==staff.staffId
   ||!valid(event.details.cbmPerCtn))throw Error('Committed original CBM receipt unconfirmed');
  return{...result,company,taskId:request.input.taskId,cbmPerCtn:event.details.cbmPerCtn};
 };
}
module.exports={captureOriginalWarehouseCbm,createCurrentWarehouseCbmSave};

},
// packing-photo-fenced-store.cjs sha256:246f33a3a06259b5354c3bc857d62e43771a7066099f56096f1cdc10f876bae3
"packing-photo-fenced-store.cjs": (load, module) => {
'use strict';
const {hash}=load("commit-proof.cjs"),{createSegmentedPlanCodec,copy,same}=load("segmented-plan.cjs");
const {assertPackingPhotoUploads,uploadPackingPhotoSlot}=load("packing-photo-plan.cjs");
const ACTION='PACKING_PHOTO_CONFIRMED',unversion=row=>{const result=copy(row);delete result._version;return result;};
function packingPhotoReceipt({company,staff,requestId,input,plan,index}){
 assertPackingPhotoUploads({company,staff,requestId,input,plan});if(!Number.isSafeInteger(index)||index<0||index>=plan.uploads.length)throw Error('Exact packing photo receipt slot required');
 const id=hash(company,requestId,staff.memberId,ACTION,index);
 return{_id:id,title:id,company,stockPhotoProtocol:1,action:ACTION,result:'SAVED',actorType:'STAFF',activityTime:plan.record.activityTime,
  initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,description:input.id,imageAltText:input.taskId,
  details:{requestId,memberId:staff.memberId,index,recordId:plan.record._id,upload:copy(plan.uploads[index])}};
}
function prependPackingPhotoReceipts({company,staff,requestId,input,prepared,plan}){
 assertPackingPhotoUploads({company,staff,requestId,input,plan:prepared});const journal=company==='NCT'?'R2NCTActivity':'R2NCTActivity1';
 if(!Array.isArray(plan?.writes)||plan.writes.filter(change=>change.collection===journal&&same(change.after,{...prepared.record,company})).length!==1
  ||plan.writes.some(change=>change.after?.action===ACTION||change.after?.stockPhotoProtocol!==undefined))throw Error('Exact original packing stock plan required');
 return{...copy(plan),writes:[...prepared.uploads.map((_,index)=>({collection:journal,before:null,after:packingPhotoReceipt({company,staff,requestId,input,plan:prepared,index})})),...copy(plan.writes)]};
}
// Request-scoped private adapter, paired to segmented coordinator with one APPLY
// write per invocation. Mutable original packing record remains conditional CAS;
// file receipts insert-only. No allocation/file update/trash/lock theft capability.
function createPackingPhotoFencedStore({company,staff,request,store,documentService,codecPolicy={},coordination='EXCLUSIVE_LOCK'}){
 if(!['EXCLUSIVE_LOCK','CONTROL_CAS_CANDIDATE'].includes(coordination))throw Error('Explicit server photo coordination required');
 const exclusive=coordination==='EXCLUSIVE_LOCK';
 if(!['NCT','GHR'].includes(company)||staff?.packingDepartment!=='WAREHOUSE'||!staff.staffId||!staff.memberId||!staff.staffName||request?.department!=='WAREHOUSE'
  ||request.input?.action!=='PHOTOS'||!Array.isArray(request.input.photos)||request.input.photos.length<1||request.input.photos.length>3
  ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||request.stockProtocol!==1||!request.stockBuild||!Number.isSafeInteger(request.stockGeneration)||request.stockGeneration<0
  ||['read','insert','compareAndSet','compareAndRemove'].some(method=>typeof store?.[method]!=='function')||typeof documentService!=='function')throw Error('Private fenced packing photo dependencies required');
 const codec=createSegmentedPlanCodec({...codecPolicy,company,domainWrites:true}),{journal,lockId,controlId}=codec.ids,requestId=request.requestId;
 const key=hash(company+'/PURCHASE',requestId,staff.memberId),digest=hash({company,writer:'PACKING',input:{department:'WAREHOUSE',details:request.input},stockProtocol:request.stockProtocol,
  stockBuild:request.stockBuild,stockGeneration:request.stockGeneration,...(request.stockIdentity!==undefined?{stockIdentity:request.stockIdentity}:{})});
 async function boundPlan(collection,row){
  const control=await store.read(journal,controlId),lock=exclusive?await store.read(journal,lockId):null,manifest=await store.read(journal,key);
  if(!control?._version||control.company!==company||control.mode!=='ACTIVE'||control.generation!==request.stockGeneration||control.pending?.key!==key||control.pending.digest!==digest||control.pending.phase!=='APPLY'
   ||manifest?.planHash!==control.pending.planHash||manifest.digest!==digest||manifest.baseGeneration!==request.stockGeneration||exclusive&&(lock?.company!==company||lock.owner!==key||!lock.attempt))throw Error('Durable pending packing photo operation required');
  if(!Array.isArray(manifest.fragments)||manifest.fragments.length>32)throw Error('Bounded packing photo manifest required');const fragments=[];
  for(const ref of manifest.fragments)fragments.push(await store.read(journal,ref.id));const plan=codec.decode({manifest,fragments,key,digest,memberId:staff.memberId,requestId});
  if(!plan.writes.some(change=>change.collection===collection&&same(change.after,row)))throw Error('Packing photo write absent from immutable plan');
  const records=plan.writes.filter(change=>change.collection===journal&&change.after.action==='SUPPORT_PACKING_LIST_CURRENT');
  if(records.length!==1||!records[0].before?._version||records[0].before.details?.list?.revision!==request.input.revision)throw Error('Exact original conditional packing record required');
  const record=unversion(records[0].after),line=record.details?.list?.lines?.find(item=>item.taskId===request.input.taskId);
  if(!Array.isArray(line?.photos)||line.photos.length<request.input.photos.length||typeof record.initiatedByStaffName!=='string'||!record.initiatedByStaffName||record.initiatedByStaffName.length>200)throw Error('Original packing photo evidence/actor required');
  const uploads=line.photos.slice(-request.input.photos.length).map(photo=>({action:'PHOTO_UPLOAD',company,department:'WAREHOUSE',poId:hash(company,request.input.id,request.input.taskId,'PACKING_PHOTO'),
   fileId:photo.fileId,type:photo.stage,mimeType:photo.mimeType,sha256:photo.sha256,size:photo.size,name:photo.name}));
  const recordedStaff={...staff,staffName:record.initiatedByStaffName},prepared={record,uploads,beforeRevision:request.input.revision,expectedVersion:request.input.version};
  assertPackingPhotoUploads({company,staff:recordedStaff,requestId,input:request.input,plan:prepared});
  const receipts=plan.writes.filter(change=>change.after.action===ACTION||change.after.stockPhotoProtocol!==undefined);if(receipts.length!==uploads.length)throw Error('Complete original packing photo receipts required');
  for(let index=0;index<uploads.length;index++){
   const change=plan.writes[index],expected=packingPhotoReceipt({company,staff:recordedStaff,requestId,input:request.input,plan:prepared,index});
   if(change?.collection!==journal||change.before!==null||!same(unversion(change.after),expected))throw Error('Packing photo receipts must precede business writes');
  }
  return{control,lock,prepared,recordedStaff,receipts};
 }
 const metadata=(collection,row)=>collection===journal&&(row?._id===lockId||row?._id===controlId||row?.stockOperationProtocol===2);
 async function beforeDomainWrite(collection,row){
  const state=await boundPlan(collection,row),receipt=row.action===ACTION,index=receipt?row.details?.index:state.receipts.length;
  if(!Number.isSafeInteger(index)||index<0||index>state.receipts.length||receipt&&index===state.receipts.length)throw Error('Exact packing photo receipt required');
  for(let prior=0;prior<index;prior++)if(!same(await store.read(journal,state.receipts[prior].after._id),state.receipts[prior].after))throw Error('Earlier packing photo receipt unconfirmed');
  if(receipt)await uploadPackingPhotoSlot({company,staff:state.recordedStaff,requestId,input:request.input,plan:state.prepared,index,documentService});
  // The immutable file slot is retryable; mutable packing after-images are not:
  // they still require the original version even if a callback returns late.
  if(!same(await store.read(journal,controlId),state.control)||exclusive&&!same(await store.read(journal,lockId),state.lock))throw Error('Packing photo callback fence changed; retain request');
 }
 return{read:(...args)=>store.read(...args),compareAndRemove:(collection,id,attempt)=>{if(collection!==journal||id!==lockId)throw Error('Only exact owned packing protocol lock release allowed');return store.compareAndRemove(collection,id,attempt);},
  insert:async(collection,row)=>{if(!metadata(collection,row))await beforeDomainWrite(collection,row);return store.insert(collection,row);},
  compareAndSet:async(collection,id,version,row)=>{if(row?.action===ACTION||row?.stockPhotoProtocol!==undefined)throw Error('Packing photo receipts are insert-only');if(!metadata(collection,row))await beforeDomainWrite(collection,row);return store.compareAndSet(collection,id,version,row);}};
}
module.exports={packingPhotoReceipt,prependPackingPhotoReceipts,createPackingPhotoFencedStore};

},
// packing-photo-plan.cjs sha256:276e60a400e2d606dce746f4b6de3d5fbb9baf46fe2d2de728744bf48c398de6
"packing-photo-plan.cjs": (load, module) => {
'use strict';
const {hash}=load("commit-proof.cjs"),{copy,same}=load("segmented-plan.cjs");
const validFile=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(value);
// ORIGINAL packing validators and prepare only. Server-supplied generated IDs;
// no legacy apply or file upload may run inside this scratch capture.
async function captureOriginalPackingPhotoPlan({company,staff,requestId,input,context,createPackingListOperations,now,slots}){
 if(!['NCT','GHR'].includes(company)||context?.company!==company||!Array.isArray(context.tasks)||!Array.isArray(context.lists)
  ||staff?.packingDepartment!=='WAREHOUSE'||!staff.memberId||!staff.staffId||!staff.staffName||input?.action!=='PHOTOS'
  ||!Array.isArray(input.photos)||!input.photos.length||input.photos.length>3||!Array.isArray(slots)||slots.length!==input.photos.length
  ||slots.some(id=>!validFile(id))||new Set(slots).size!==slots.length||typeof createPackingListOperations!=='function'||typeof now!=='function')throw Error('Original private packing photo scope required');
 const journal=company==='NCT'?'R2NCTActivity':'R2NCTActivity1',scratch=new Map(),boundary=Error('Original private packing photo boundary');let captured,reads=0,allocated=0;
 const scope=collection=>{if(collection!==journal)throw Error('Original packing photo collection scope');};
 const store={read:async(collection,id)=>{scope(collection);return copy(scratch.get(id)||null);},
  insert:async(collection,row)=>{scope(collection);
   if(row.action==='PURCHASE_OPERATION_PREPARED'&&row.details?.kind==='PREPARED'){
    if(captured||scratch.size!==1||row.details.plan?.record?.action!=='SUPPORT_PACKING_LIST_CURRENT')throw Error('Original packing photo plan conflict');
    captured=copy(row.details.plan);throw boundary;
   }
   if(row.action!=='PURCHASE_OPERATION_LOCK'||row.details?.kind!=='LOCK'||scratch.size)throw Error('Original packing photo apply forbidden');scratch.set(row._id,copy(row));return copy(row);
  },remove:async(collection,id)=>{scope(collection);if(scratch.get(id)?.action!=='PURCHASE_OPERATION_LOCK')throw Error('Only original scratch lock removal allowed');scratch.delete(id);}};
 const save=createPackingListOperations({store,names:{[company]:{activity:journal}},now,
  readContext:async(selected,employee)=>{if(selected!==company||employee.memberId!==staff.memberId||employee.staffId!==staff.staffId||++reads!==1)throw Error('Original packing photo actor/context conflict');return copy(context);},
  documentService:async command=>{if(!same(command,{action:'ALLOCATE',company})||allocated>=slots.length)throw Error('Original external photo call forbidden during capture');return{ok:true,fileId:slots[allocated++]};}});
 try{await save({company,staff:copy(staff),requestId,input:copy(input)});throw Error('Original packing photo boundary missing');}catch(error){if(error!==boundary)throw error;}
 if(!captured||reads!==1||scratch.size||allocated!==slots.length||captured.uploads?.some((upload,index)=>upload.fileId!==slots[index]))throw Error('Original packing photo capture incomplete');
 assertPackingPhotoUploads({company,staff,requestId,input,plan:captured});return captured;
}
function assertPackingPhotoUploads({company,staff,requestId,input,plan}){
 const record=plan?.record,list=record?.details?.list,uploads=plan?.uploads,photos=input?.photos;
 if(!['NCT','GHR'].includes(company)||staff?.packingDepartment!=='WAREHOUSE'||!staff.staffId||!staff.memberId||!staff.staffName
  ||!/^[a-f0-9-]{36}$/i.test(requestId||'')||input?.action!=='PHOTOS'||!input.id||!input.taskId||!input.revision||!input.version
  ||!Array.isArray(photos)||photos.length<1||photos.length>3||!Array.isArray(uploads)||uploads.length!==photos.length
  ||record?._id!==hash(company,input.id,'PACKING_CURRENT')||record.title!==input.id||record.description!==input.id||record.action!=='SUPPORT_PACKING_LIST_CURRENT'||record.result!=='SAVED'
  ||record.initiatedByStaffId!==staff.staffId||record.initiatedByStaffName!==staff.staffName||!Number.isFinite(Date.parse(record.activityTime))
  ||list?.id!==input.id||list.company!==company||list.revision!==hash(company,requestId,staff.memberId,'PACKING_REVISION')
  ||list.updatedByStaffId!==staff.staffId||list.updatedBy!==staff.staffName||list.updatedAt!==record.activityTime||list.invoiceId||list.dispatchedAt
  ||plan.expectedVersion!==input.version||plan.beforeRevision!==input.revision||!Array.isArray(list.lines))throw Error('Immutable original packing photo plan required');
 const lines=list.lines.filter(line=>line.taskId===input.taskId),seen=new Set();if(lines.length!==1||!Array.isArray(lines[0].photos)||lines[0].photos.length<photos.length)throw Error('Original packing photo line required');
 const evidence=lines[0].photos.slice(-photos.length);
 for(const[index,upload]of uploads.entries()){
  const photo=photos[index],extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[photo?.mimeType];
  const expected={action:'PHOTO_UPLOAD',company,department:'WAREHOUSE',poId:hash(company,input.id,input.taskId,'PACKING_PHOTO'),fileId:upload.fileId,type:input.photoStage,
   mimeType:photo?.mimeType,sha256:photo?.sha256,size:upload.size,name:company+'-'+input.id+'-'+input.photoStage+'-'+requestId+'-'+index+'.'+extension};
  if(!extension||!['PACKING','LOADING'].includes(input.photoStage)||!validFile(upload.fileId)||seen.has(upload.fileId)||!same(upload,expected)
   ||typeof photo?.base64!=='string'||photo.base64.length>2800000||!/^[a-f0-9]{64}$/i.test(photo.sha256||'')||!Number.isSafeInteger(upload.size)||upload.size<12||upload.size>2*1024*1024
   ||!same(evidence[index],{fileId:upload.fileId,name:upload.name,sha256:upload.sha256,mimeType:upload.mimeType,size:upload.size,stage:upload.type,at:record.activityTime,by:staff.staffName}))throw Error('Immutable original packing photo upload conflict');
  seen.add(upload.fileId);
 }
 return true;
}
async function uploadPackingPhotoSlot({company,staff,requestId,input,plan,index,documentService}){
 assertPackingPhotoUploads({company,staff,requestId,input,plan});if(!Number.isSafeInteger(index)||index<0||index>=plan.uploads.length||typeof documentService!=='function')throw Error('Exact original packing photo slot required');
 const upload=copy(plan.uploads[index]),receipt=await documentService({...upload,base64:input.photos[index].base64});
 if(receipt?.ok!==true||['fileId','company','poId','name','sha256','mimeType','size'].some(key=>receipt[key]!==upload[key]))throw Error('Original packing photo upload unconfirmed; retain same slot');
 return{fileId:upload.fileId,company,poId:upload.poId,name:upload.name,sha256:upload.sha256,mimeType:upload.mimeType,size:upload.size};
}
module.exports={captureOriginalPackingPhotoPlan,assertPackingPhotoUploads,uploadPackingPhotoSlot};

},
// current-stock-exception-save.cjs sha256:7bde1801d29d9d22cfaaed716e4bbf5d0896ad2ffabbb3611f7ba0322c28f024
"current-stock-exception-save.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { originalProductState } = load("original-product-state.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { prepareFreeQuarantine } = load("borrowing-stock-plan.cjs");
const { hash } = load("commit-proof.cjs");
const copy = value => JSON.parse(JSON.stringify(value));

// Execute only the original validator's PREPARE in a private in-memory journal.
// Actual stock/event writes belong exclusively to the common current coordinator.
async function validateOriginalStockException({ company, staff, context, requestId, input, createStockExceptionOperations, now }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks)
    || !Array.isArray(context.activity) || typeof createStockExceptionOperations !== 'function' || typeof now !== 'function') {
    throw Error('Original stock exception context required');
  }
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', scratch = new Map(), boundary = new Error('Private exception preparation boundary');
  let captured, reads = 0;
  const scope = c => { if (c !== journal) throw Error('Stock exception collection scope violation'); };
  const store = { read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'STOCK_EXCEPTION_REPORTED') throw Error('Unexpected stock exception preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Legacy exception apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private exception lock removal allowed'); scratch.delete(id);
    } };
  const save = createStockExceptionOperations({ store, names: { [company]: { activity: journal } }, now,
    readContext: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected stock exception apply/read'); return copy(context);
    } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original stock exception boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original stock exception preparation incomplete');
  return captured;
}

// PRIVATE existing stockExceptions.web authentication dependencies only. This
// handles free isolation or one unambiguous reserved customer. Mixed ownership
// stays blocked; browser cannot choose which customer bears a loss.
function createCurrentStockExceptionSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  const d = authorityDependencies;
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || typeof items?.query !== 'function' || typeof store?.read !== 'function'
    || [d?.readMember, d?.readStaffRecords, d?.requireStockStaff, d?.readContext, d?.readPurchaseRecords, d?.projectPurchaseOrders,
      d?.createStockExceptionOperations, d?.readCurrentTaskRows, d?.readAllocations, d?.readCustomerShipments,
      d?.readPackingLists, d?.packingHeld, d?.now].some(fn => typeof fn !== 'function')) throw Error('Private original stock exception dependencies required');
  return async request => {
    let staff;
    const result = await createCurrentStockSave({ company, writer: 'STOCK_EXCEPTION', protocol, coverage,
      authenticate: async () => {
        const member = await d.readMember();
        if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') d.requireStockStaff(member, []);
        staff = d.requireStockStaff(member, await d.readStaffRecords());
        if (staff?.memberId !== member._id || staff.canReportStockException !== true || request?.input?.action !== 'QUARANTINE') throw Error('Original stock quarantine permission required');
        return { memberId: staff.memberId, staffId: staff.staffId };
      }, prepare: async command => {
        if (command.memberId !== staff.memberId) throw Error('Stock exception actor changed');
        const metrics = { queries: 0, exactReads: 0 };
        const snapshot = await protocol.readSnapshot(async control => {
          const context = await d.readContext(company, staff);
          if (context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)) throw Error('Original stock company context required');
          const validated = await validateOriginalStockException({ company, staff, context, requestId: command.requestId,
            input: command.input, createStockExceptionOperations: d.createStockExceptionOperations, now: d.now });
          const task = context.tasks.find(t => t.id === validated.event.imageAltText);
          if (!task || validated.event.initiatedByStaffId !== staff.staffId || validated.event.details?.company !== company
            || validated.event.imageAltText !== command.input.sourceTaskId) throw Error('Original stock exception identity conflict');
          const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea };
          const orders = d.projectPurchaseOrders({ company, workspace: context, records: await d.readPurchaseRecords(company, staff) });
          const builder = originalProductState({ company, context, orders, identity, readAllocations: d.readAllocations,
            readCustomerShipments: d.readCustomerShipments, readPackingLists: d.readPackingLists, packingHeld: d.packingHeld,
            readPreparation: d.readPreparation, projectPreparation: d.projectPreparation });
          const rows = await readScopedCurrentProduct({ company, identity, items, store, metrics,
            transferIndexVersion: control.transferIndexVersion, sourceTaskIds: [task.id] });
          if (!rows.product) throw Error('Current exception product checkpoint required');
          rows.taskRows = await d.readCurrentTaskRows(company, builder.scopeTaskIds(rows), staff); rows.generation = control.generation;
          const prepared = prepareFreeQuarantine({ state: builder.buildState(rows), rows, event: validated.event, generation: control.generation });
          const event = prepared.plan.writes.find(write => write.after.action === 'STOCK_EXCEPTION_REPORTED').after;
          if (event.stockAttribution === 'CUSTOMER') {
            const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
            const affected = d.readPackingLists(context.activity, company).filter(list => d.packingHeld(list, event.stockCustomerTaskId) > 0);
            event.stockPackingImpacts = [];
            for (const list of affected) {
              const id = hash(company, list.id, 'PACKING_CURRENT'), before = await store.read(journal, id); metrics.exactReads++;
              if (!before?._version || before.company !== company || before.action !== 'SUPPORT_PACKING_LIST_CURRENT'
                || JSON.stringify(before.details?.list) !== JSON.stringify(list)) throw Error('Exact affected packing list required');
              const pending = list.stockDamageCases || [];
              if (!Array.isArray(pending) || pending.some(item => !item?.caseId || !item.taskId) || pending.some(item => item.caseId === event._id)) throw Error('Packing damage review identity conflict');
              const after = copy(before), revision = hash(list.revision, event._id, 'DAMAGE_REVIEW');
              after.activityTime = event.activityTime; after.initiatedByStaffId = staff.staffId; after.initiatedByStaffName = staff.staffName;
              after.details.list = { ...copy(list), revision, stockDamageReviewRequired: true,
                stockDamageCases: [...copy(pending), { caseId: event._id, taskId: event.stockCustomerTaskId }], updatedAt: event.activityTime };
              // No planned/Packed/Loaded/PO/invoice/stock quantity is edited here.
              // Persist the required physical review on the SAME original list so
              // later replenishment cannot silently certify old Loaded evidence.
              prepared.plan.writes.push({ collection: journal, before, after });
              event.stockPackingImpacts.push({ listId: list.id, beforeRevision: list.revision, revision });
            }
          }
          return prepared;
        });
        return { ...snapshot.rows, memberId: staff.memberId, generation: snapshot.generation, metrics };
      } })(request);
    if (result.ok !== true) return result;
    const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
    const receipt = await protocol.readSnapshot(() => store.read(journal, hash(company, request.requestId, staff.memberId, 'STOCK_EXCEPTION')));
    const event = receipt.rows;
    if (!event?._version || event.company !== company || event._id !== event.title || event.result !== 'SAVED'
      || event.action !== 'STOCK_EXCEPTION_REPORTED' || !['FREE','CUSTOMER'].includes(event.stockAttribution) || event.initiatedByStaffId !== staff.staffId
      || event.stockAttribution === 'CUSTOMER' && (typeof event.stockCustomerTaskId !== 'string' || !event.stockCustomerTaskId)
      || event.imageAltText !== request.input.sourceTaskId || event.details?.company !== company) throw Error('Committed stock exception attribution receipt requires review');
    return { ...result, company, caseId: event.title };
  };
}
module.exports = { validateOriginalStockException, createCurrentStockExceptionSave };

},
// current-stock-resolution-save.cjs sha256:bb7079a85460fb3d52d74efcbfe3a9f8f5bd0814e0d7e250c75aabfa993a7137
"current-stock-resolution-save.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { originalProductState } = load("original-product-state.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { prepareFreeCaseMovement, prepareFreeCaseRelease, prepareProcurementTransition } = load("borrowing-stock-plan.cjs");
const { hash } = load("commit-proof.cjs");
const { stockKey } = load("current-model.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const permissions = { DECIDE: 'canPlanStockResolution', APPROVE_LOSS: 'canApproveStockLoss', APPROVE_VARIANCE: 'canApproveStockLoss',
  APPROVE_RELEASE: 'canApproveStockLoss', RETURN: 'canReportStockException', REPLACEMENT: 'canReportStockException', CLOSE: 'canCloseStockException' };

async function validateOriginalStockResolution({ company, staff, context, orders, requestId, input, createStockResolutionOperations, now }) {
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', scratch = new Map(), boundary = new Error('Private stock resolution boundary');
  let captured, reads = 0, orderReads = 0;
  const scope = c => { if (c !== journal) throw Error('Stock resolution collection scope violation'); };
  const store = { read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'STOCK_EXCEPTION_RESOLUTION_SAVED') throw Error('Unexpected stock resolution preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Legacy stock resolution apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private stock resolution lock removal allowed'); scratch.delete(id);
    } };
  const save = createStockResolutionOperations({ store, names: { [company]: { activity: journal } }, now,
    readContext: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected stock resolution apply/read'); return copy(context);
    }, listOrders: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++orderReads !== 1) throw Error('Unexpected stock resolution order read'); return copy(orders);
    } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original stock resolution boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || orderReads !== 1 || scratch.size) throw Error('Original stock resolution preparation incomplete');
  return captured;
}

// PRIVATE stockExceptions.web dependency composition. Original role and financial
// validators remain unchanged. Only explicitly attributed FREE cases are mapped.
function createCurrentStockResolutionSave({ company, items, store, protocol, coverage, authorityDependencies: d }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || typeof items?.query !== 'function' || typeof store?.read !== 'function'
    || [d?.readMember, d?.readStaffRecords, d?.requireStockStaff, d?.readContext, d?.readPurchaseRecords, d?.projectPurchaseOrders,
      d?.createStockResolutionOperations, d?.readStockExceptions, d?.readCurrentTaskRows, d?.readAllocations, d?.readCustomerShipments,
      d?.readPackingLists, d?.packingHeld, d?.now].some(fn => typeof fn !== 'function')) throw Error('Private original stock resolution dependencies required');
  return async request => {
    let staff;
    const result = await createCurrentStockSave({ company, writer: 'STOCK_RESOLUTION', protocol, coverage,
      authenticate: async () => {
        const member = await d.readMember();
        if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') d.requireStockStaff(member, []);
        staff = d.requireStockStaff(member, await d.readStaffRecords());
        const permission = permissions[request?.input?.action];
        if (staff?.memberId !== member._id || !permission || staff[permission] !== true) throw Error('Original stock resolution permission required');
        return { memberId: staff.memberId, staffId: staff.staffId };
      }, prepare: async command => {
        if (command.memberId !== staff.memberId) throw Error('Stock resolution actor changed');
        const metrics = { queries: 0, exactReads: 0 };
        const snapshot = await protocol.readSnapshot(async control => {
          const context = await d.readContext(company, staff);
          if (context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)) throw Error('Original stock company context required');
          const matches = d.readStockExceptions(context.activity).filter(c => c.id === command.input.id && c.company === company);
          if (matches.length !== 1) throw Error('Exact original stock case required');
          const item = matches[0], originalCase = context.activity.find(e => e._id === item.id && e.title === item.id && e.action === 'STOCK_EXCEPTION_REPORTED');
          const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
          const caseEvent = await store.read(journal, item.id); metrics.exactReads++;
          if (!originalCase || !caseEvent?._version || caseEvent.company !== company || !['FREE', 'CUSTOMER'].includes(caseEvent.stockAttribution)
            || JSON.stringify(copy(originalCase)) !== JSON.stringify(caseEvent)) throw Error('Verified current stock case attribution required');
          const task = context.tasks.find(t => t.id === item.sourceTaskId);
          if (!task) throw Error('Original stock case source unavailable');
          const orders = d.projectPurchaseOrders({ company, workspace: context, records: await d.readPurchaseRecords(company, staff) });
          const validated = await validateOriginalStockResolution({ company, staff, context, orders, requestId: command.requestId,
            input: command.input, createStockResolutionOperations: d.createStockResolutionOperations, now: d.now });
          const event = validated.event;
          if (event.initiatedByStaffId !== staff.staffId || event.description !== item.id || event.imageAltText !== task.id
            || event.details?.action !== command.input.action) throw Error('Original stock resolution identity conflict');
          // Legacy closing has no disposal evidence. Never turn financial closure
          // into physical outflow or assert remaining isolated goods disappeared.
          if (command.input.action === 'CLOSE' && command.input.outcome !== 'RELEASED'
            && item.quantity !== (item.resolution?.returns || []).reduce((n, row) => n + row.quantity, 0)) throw Error('Stock settled goods location requires review');
          const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea };
          if (caseEvent.stockKey !== stockKey(identity) || caseEvent.imageAltText !== task.id) throw Error('Free stock case product identity conflict');
          const builder = originalProductState({ company, context, orders, identity, readAllocations: d.readAllocations,
            readCustomerShipments: d.readCustomerShipments, readPackingLists: d.readPackingLists, packingHeld: d.packingHeld,
            readPreparation: d.readPreparation, projectPreparation: d.projectPreparation });
          const rows = await readScopedCurrentProduct({ company, identity, items, store, metrics,
            transferIndexVersion: control.transferIndexVersion, sourceTaskIds: [task.id],
            ...(caseEvent.stockAttribution === 'CUSTOMER' ? { demandTaskIds: [caseEvent.stockCustomerTaskId],
              claimPairs: [{ sourceTaskId: task.id, taskId: caseEvent.stockCustomerTaskId }] } : {}) });
          if (!rows.product) throw Error('Current resolution product checkpoint required');
          rows.taskRows = await d.readCurrentTaskRows(company, builder.scopeTaskIds(rows), staff); rows.generation = control.generation;
          const state = builder.buildState(rows), base = { state, rows, event, caseEvent, priorResolution: item.resolution, generation: control.generation };
          if (['RETURN', 'REPLACEMENT'].includes(command.input.action)) return prepareFreeCaseMovement(base);
          if (command.input.action === 'CLOSE' && command.input.outcome === 'RELEASED') return prepareFreeCaseRelease(base);
          return prepareProcurementTransition({ ...base, after: state });
        });
        return { ...snapshot.rows, memberId: staff.memberId, generation: snapshot.generation, metrics };
      } })(request);
    if (result.ok !== true) return result;
    const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
    const receipt = await protocol.readSnapshot(() => store.read(journal, hash(company, request.requestId, staff.memberId, 'STOCK_RESOLUTION')));
    const event = receipt.rows;
    if (!event?._version || event.company !== company || event._id !== event.title || event.result !== 'SAVED'
      || event.action !== 'STOCK_EXCEPTION_RESOLUTION_SAVED' || event.initiatedByStaffId !== staff.staffId
      || event.description !== request.input.id || event.details?.action !== request.input.action) throw Error('Committed stock resolution receipt requires review');
    return { ...result, company, caseId: event.description };
  };
}
module.exports = { validateOriginalStockResolution, createCurrentStockResolutionSave };

},
// current-cost-reference-save.cjs sha256:e7c93ac4db70a43fc568a94d5a21d11018894a2edcb4df8566fe99617fffacdb
"current-cost-reference-save.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { prepareCostReference } = load("cost-reference-plan.cjs");
const { hash } = load("commit-proof.cjs");
// PRIVATE original Purchase cost retry gateway composition. No browser actor,
// arbitrary row patch or TTL recovery can enter this reference-only operation.
function createCurrentCostReferenceSave({ company, store, protocol, coverage, authorityDependencies: d }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || typeof store?.read !== 'function'
    || [d?.readMember, d?.readStaffRecords, d?.requirePurchaseStaff, d?.readCostTables,
      d?.createPurchaseCostRetry, d?.captureCosts, d?.now].some(fn => typeof fn !== 'function')) throw Error('Private original cost reference dependencies required');
  return async request => {
    let staff;
    const result = await createCurrentStockSave({ company, writer: 'COST_REFERENCE', protocol, coverage,
      authenticate: async () => {
        const member = await d.readMember();
        if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') d.requirePurchaseStaff(member, []);
        staff = { ...d.requirePurchaseStaff(member, await d.readStaffRecords()), memberId: member._id };
        if (!/^[a-f0-9]{32}$/.test(request?.input?.taskId || '')) throw Error('Exact original cost retry task required');
        return { memberId: staff.memberId, staffId: staff.staffId };
      }, prepare: async command => {
        if (command.memberId !== staff.memberId) throw Error('Cost reference actor changed');
        const snapshot = await protocol.readSnapshot(async () => {
          const prepared = await prepareCostReference({ createPurchaseCostRetry: d.createPurchaseCostRetry,
            request: { company, taskId: command.input.taskId, requestId: command.requestId, staff },
            tables: await d.readCostTables(company, command.input.taskId, staff, command.requestId), captureCosts: d.captureCosts, now: d.now, recordProviderFailure: true });
          if ((prepared.outcome?.ok !== true && !(prepared.outcome?.ok === false && prepared.recordedFailure === true)) || prepared.outcome.requestId !== command.requestId || prepared.outcome.company !== company
            || prepared.outcome.taskId !== command.input.taskId) throw Error('Original cost retry receipt identity conflict');
          if (!prepared.plan.writes.length) throw Error('Prior legacy cost receipt requires reconciliation before current save');
          return prepared.plan;
        });
        return { plan: snapshot.rows, memberId: staff.memberId, generation: snapshot.generation };
      } })(request);
    if (result.ok !== true) return result;
    const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
    const receipt = await protocol.readSnapshot(() => store.read(journal,
      hash(company, request.input.taskId, request.requestId, staff.memberId, 'RESULT')));
    const event = receipt.rows, outcome = event?.details?.outcome;
    if (!event?._version || event.company !== company || event._id !== event.title || event.action !== 'COST_RETRY_RESULT'
      || event.result !== (outcome?.ok === true ? 'RECORDED' : 'FAILED') || event.initiatedByStaffId !== staff.staffId || event.imageAltText !== request.input.taskId
      || event.details?.actorMemberId !== staff.memberId || event.details.requestId !== request.requestId
      || ![true,false].includes(outcome?.ok) || outcome.ok === false && !/^(POINTBASE_[A-Z0-9_]+|COST_RETRY_SAVE_FAILED)$/.test(outcome.error || '')
      || outcome.company !== company || outcome.taskId !== request.input.taskId || outcome.requestId !== request.requestId) {
      throw Error('Committed cost reference receipt requires review');
    }
    return { ...result, ...outcome, ...(outcome.ok === false ? { stockFinal: true } : {}) };
  };
}
module.exports = { createCurrentCostReferenceSave };

},
// cost-reference-plan.cjs sha256:3885d1f7bef4dfe47f118bf905f9e0d4015fca3b96c4056c5c377141449eb803
"cost-reference-plan.cjs": (load, module) => {
'use strict';

const { domainCollections } = load("domain-scope.cjs");
const { hash } = load("commit-proof.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const taskFields = new Set(['lpPc', 'lpCtn', 'disc1', 'disc2', 'disc3', 'latestCostReference', 'costStatus', 'costErrorReason', 'lastCostCaptureTime']);
const events = new Set(['COST_RETRY_LOCK', 'COST_RETRY_ATTEMPT', 'COST_RETRY_CAPTURED', 'COST_RETRY_RESULT']);

// Trusted server composition only, NOT browser admission/auth or a live store.
// Run the ORIGINAL reference-only workflow against a private overlay. Collect its
// exact final writes for the common fence; never run its TTL lock deletion live.
async function prepareCostReference({ createPurchaseCostRetry, request, tables, captureCosts, now, recordProviderFailure = false }) {
  const Buffer=StockRuntimeBuffer;
  const company = request?.company, [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const allowed = new Set([orders, tasks, journal]);
  if (typeof createPurchaseCostRetry !== 'function' || typeof captureCosts !== 'function' || typeof now !== 'function'
    || !tables || Object.keys(tables).some(c => !allowed.has(c)) || [...allowed].some(c => !Array.isArray(tables[c]))) throw Error('Complete private cost reference snapshot required');
  const initial = new Map(), overlay = new Map(), writes = new Map(), privateLocks = new Set();
  for (const c of allowed) for (const row of tables[c]) {
    const key = c + ':' + row._id;
    if (!row._id || initial.has(key) || row.company && row.company !== company) throw Error('Cost reference snapshot identity conflict');
    initial.set(key, copy(row)); overlay.set(key, copy(row));
  }
  // Existing old executions cannot be fenced by age. Require operational recovery,
  // even when the ORIGINAL retry would consider the old per-task lock expired.
  const lockId = hash(company, request.taskId, 'COST_LOCK');
  if (overlay.has(journal + ':' + lockId)) throw Error('Existing cost retry lock requires recovery; no TTL takeover');
  const target = initial.get(tasks + ':' + request.taskId);
  if (!target || target.company !== company || !target._version) throw Error('Exact migrated cost task required');
  const scope = c => { if (!allowed.has(c)) throw Error('Cost reference scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(overlay.get(c + ':' + id) || null); },
    one: async (c, criteria) => {
      scope(c); const matches = [...overlay.entries()].filter(([id, row]) => id.startsWith(c + ':') && Object.entries(criteria).every(([k, v]) => row[k] === v));
      if (matches.length > 1) throw Error('Duplicate cost reference record'); return copy(matches[0]?.[1] || null);
    },
    insert: async (c, row) => {
      scope(c); const key = c + ':' + row._id;
      if (c !== journal || !events.has(row.action) || row._id !== row.title || row.imageAltText !== request.taskId
        || row.description !== target.description || row.initiatedByStaffId !== request.staff?.staffId || overlay.has(key)) throw Error('Unexpected cost reference event');
      overlay.set(key, copy(row));
      if (row.action === 'COST_RETRY_LOCK') privateLocks.add(key);
      else writes.set(key, { collection: c, before: null, after: { ...copy(row), company } });
      return copy(row);
    },
    update: async (c, row) => {
      scope(c); const key = c + ':' + row._id, before = initial.get(key);
      if (!before || before.company !== company || !before._version || ![orders, tasks].includes(c)
        || c === tasks && row._id !== target._id || c === orders && (before.title !== target.description || before.sourceLineId !== target.imageAltText)) throw Error('Exact migrated cost domain row required');
      const permitted = c === tasks ? taskFields : new Set(['cbmCtn']);
      const fixed = value => Object.fromEntries(Object.entries(value).filter(([field]) => !permitted.has(field)));
      if (!same(fixed(before), fixed(row))) throw Error('Cost reference cannot change stock, PO, identity or other business fields');
      overlay.set(key, copy(row)); writes.set(key, { collection: c, before: copy(before), after: copy(row) }); return copy(row);
    },
    remove: async (c, id) => {
      scope(c); const key = c + ':' + id;
      if (c !== journal || !privateLocks.has(key) || overlay.get(key)?.action !== 'COST_RETRY_LOCK') throw Error('Only newly simulated cost lock may be removed');
      overlay.delete(key); privateLocks.delete(key);
    }
  };
  if (typeof recordProviderFailure !== 'boolean') throw Error('Private cost failure policy required');
  let outcome, providerFailed = false, providerInvalid = false, recordedFailure = false;
  const capture = async barcodes => {
    let map;
    try { map = await captureCosts(barcodes); }
    catch (error) { providerFailed = true; throw error; }
    // Same original result contract. This is only evidence for a read-only
    // provider failure; it never replaces original validation or fabricates cost.
    const order = [...initial.values()].find(row => row.title === target.description && row.sourceLineId === target.imageAltText);
    const cost = map?.[order?.description];
    providerInvalid = !cost || cost.unitBarcode !== order?.description || cost.costCurrency !== 'MYR'
      || !['CAPTURED', 'ERROR'].includes(cost.costStatus) || !Array.isArray(cost.costIssues) || !Number.isFinite(Date.parse(cost.capturedAt));
    return map;
  };
  try { outcome = await createPurchaseCostRetry({ store, captureCosts: capture, now })(copy(request)); }
  catch (error) {
    // Preserve only the ORIGINAL known provider-failure attempt/result. A failed
    // task/row validation or private storage invariant must not become a terminal
    // business receipt, and no partially simulated task/order writes may escape.
    const resultId = hash(company, request.taskId, request.requestId, request.staff?.memberId, 'RESULT');
    const attemptId = hash(company, request.taskId, request.requestId, request.staff?.memberId, 'ATTEMPT');
    const failure = writes.get(journal + ':' + resultId)?.after;
    const attempt = writes.get(journal + ':' + attemptId)?.after;
    const expectedCode = /^POINTBASE_[A-Z0-9_]+$/.test(String(error?.code || error?.message || ''))
      ? String(error.code || error.message) : 'COST_RETRY_SAVE_FAILED';
    const expected = { ok: false, requestId: request.requestId, company, taskId: request.taskId, error: expectedCode };
    if (!recordProviderFailure || !(providerFailed || providerInvalid && error?.message === 'POINTBASE_RESULT_INVALID')
      || privateLocks.size || writes.size !== 2 || attempt?.action !== 'COST_RETRY_ATTEMPT' || attempt.result !== 'REQUESTED'
      || failure?.action !== 'COST_RETRY_RESULT' || failure.result !== 'FAILED' || !same(failure.details?.outcome, expected)) throw error;
    outcome = expected; recordedFailure = true;
  }
  if (privateLocks.size || writes.size > 30 || Buffer.byteLength(JSON.stringify([...writes.values()])) > 180000) throw Error('Cost reference atomic boundary exceeded');
  return { plan: { writes: [...writes.values()] }, outcome: copy(outcome), replay: writes.size === 0, ...(recordedFailure ? { recordedFailure: true } : {}) };
}
module.exports = { prepareCostReference };

},
// current-order-record-save.cjs sha256:fa9c7ad9c26818cc33c4ccaa1a6595cc424d2bd80caa35668131d9f8ce6eaef6
"current-order-record-save.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { preparePurchaseOrderRecord } = load("purchase-order-record-plan.cjs");
const { prepareAccountOrderRecord } = load("account-order-record-plan.cjs");
const { hash } = load("commit-proof.cjs");
// PRIVATE bindings of original non-file PO metadata writers, not new financial
// policy or public endpoints. Both share the same company fence as stock saves.
function createOrderRecordSave({ company, store, protocol, coverage, authorityDependencies: d }, department) {
  const purchase = department === 'PURCHASE', authorize = purchase ? d?.requirePurchaseStaff : d?.requireAccountStaff;
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || typeof store?.read !== 'function'
    || [d?.readMember, d?.readStaffRecords, authorize, d?.now,
      ...(purchase ? [d?.readContext, d?.readPurchaseRecords, d?.createPurchaseOrderOperations]
        : [d?.readOrders, d?.createAccountSettlementOperations])].some(fn => typeof fn !== 'function')) {
    throw Error('Private original order record dependencies required');
  }
  return async request => {
    let staff;
    const result = await createCurrentStockSave({ company, protocol, coverage,
      writer: purchase ? 'PURCHASE_ORDER_RECORD' : 'ACCOUNT_PURCHASE_RECORD',
      authenticate: async () => {
        const member = await d.readMember();
        if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') authorize(member, []);
        staff = { ...authorize(member, await d.readStaffRecords()), memberId: member._id };
        return { memberId: staff.memberId, staffId: staff.staffId };
      }, prepare: async command => {
        if (command.memberId !== staff.memberId) throw Error('Order record actor changed');
        const snapshot = await protocol.readSnapshot(async () => {
          if (purchase) {
            const context = await d.readContext(company, staff), records = await d.readPurchaseRecords(company, staff);
            return (await preparePurchaseOrderRecord({ company, staff, requestId: command.requestId, input: command.input,
              context, records, createPurchaseOrderOperations: d.createPurchaseOrderOperations, now: d.now })).plan;
          }
          const rows = await d.readOrders(company, staff), before = await store.read('R2PurchaseOrders', command.input.id);
          return (await prepareAccountOrderRecord({ company, staff, requestId: command.requestId, input: command.input,
            rows, before, createAccountSettlementOperations: d.createAccountSettlementOperations, now: d.now })).plan;
        });
        return { plan: snapshot.rows, memberId: staff.memberId, generation: snapshot.generation };
      } })(request);
    if (result.ok !== true) return result;
    // Original audit is retained in the shared PO record, even after later saves.
    // Replays must find ONE exact receipt, not infer success from latest row state.
    const receipt = await protocol.readSnapshot(() => store.read('R2PurchaseOrders', request.input.id));
    const row = receipt.rows, auditId = hash(company, request.requestId, staff.memberId, purchase ? 'PO_AUDIT' : 'FINANCE');
    const matches = Array.isArray(row?.details?.audit) ? row.details.audit.filter(event => event.id === auditId) : [];
    const audit = matches[0], action = purchase ? ({ ACK_PAYMENT: 'PAYMENT_NOTIFICATION_ACKNOWLEDGED',
      REQUEST_PAYMENT: 'PROCUREMENT_REQUEST_PAYMENT', SUBMIT_FINANCE: 'PROCUREMENT_SUBMIT_FINANCE',
      WITHDRAW_FINANCE: 'PROCUREMENT_WITHDRAW_FINANCE', REQUEST_RETURN: 'PROCUREMENT_REQUEST_RETURN',
      DOCUMENT_ISSUE_RESPONSE: 'SUPPLIER_DOCUMENT_ISSUE_RESPONSE', TERM: 'PAYMENT_TERM_CHANGED' }[request.input.action])
      : 'ACCOUNT_' + request.input.action;
    if (!row?._version || row._id !== request.input.id || row.title !== row._id || row.company !== company
      || matches.length !== 1 || audit.action !== action || audit.actorStaffId !== staff.staffId
      || audit.result !== 'SAVED' || typeof audit.time !== 'string' || !Number.isFinite(Date.parse(audit.time))) {
      throw Error('Committed original order record receipt requires review');
    }
    return { ...result, company, poId: row._id, savedAt: audit.time };
  };
}
const createCurrentPurchaseOrderRecordSave = dependencies => createOrderRecordSave(dependencies, 'PURCHASE');
const createCurrentAccountOrderRecordSave = dependencies => createOrderRecordSave(dependencies, 'ACCOUNT');
module.exports = { createCurrentPurchaseOrderRecordSave, createCurrentAccountOrderRecordSave };

},
// purchase-order-record-plan.cjs sha256:de527bd5d196647e36e087cc647981e08fcd5b3275db6a1ced1c03f57bf0edf6
"purchase-order-record-plan.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const patches = Object.freeze({ TERM: ['termDays'], ACK_PAYMENT: ['paymentHandoff'], REQUEST_PAYMENT: ['termDays', 'paymentRequestRevision', 'procurementHandoff', 'paymentHandoff'],
  SUBMIT_FINANCE: ['procurementHandoff', 'chasePayment'], WITHDRAW_FINANCE: ['procurementHandoff'], REQUEST_RETURN: ['procurementHandoff'], DOCUMENT_ISSUE_RESPONSE: ['documentIssues'] });

// Original authenticated Purchase gateway must supply staff/context. This capture
// cannot authenticate a browser and never runs legacy apply or Drive operations.
async function preparePurchaseOrderRecord({ company, staff, requestId, input, context, records, createPurchaseOrderOperations, now }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
    || !Array.isArray(records) || !Object.hasOwn(patches, input?.action) || typeof createPurchaseOrderOperations !== 'function'
    || typeof now !== 'function') throw Error('Original non-file Purchase order context required');
  if (records.some(r => r.company !== company || !r._id) || new Set(records.map(r => r._id)).size !== records.length) throw Error('Exact company PO records required');
  if (records.find(row => row._id === input.id)?.details?.audit?.some(event => event.id === hash(company,requestId,staff.memberId,'PO_AUDIT'))) throw Error('Preexisting original PO audit without current receipt requires review');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', scratch = new Map(), boundary = new Error('Private PO record prepare boundary');
  let captured, reads = 0;
  const scope = c => { if (![journal, 'R2PurchaseOrders'].includes(c)) throw Error('PO record scope violation'); };
  const store = {
    all: async c => { scope(c); if (c !== 'R2PurchaseOrders') throw Error('Unexpected PO journal scan'); return copy(records); },
    read: async (c, id) => { scope(c); return copy(c === journal ? scratch.get(id) || null : records.find(r => r._id === id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (c === journal && row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || !row.details.plan?.record || row.details.plan.upload || row.details.plan.trash) throw Error('Unexpected PO record preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (c !== journal || row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('PO record apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      scope(c); if (c !== journal || scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private PO lock removal allowed'); scratch.delete(id);
    }
  };
  const operations = createPurchaseOrderOperations({ store, now, names: { [company]: { activity: journal } },
    documentService: async () => { throw Error('External PO file operation forbidden'); }, readWorkspace: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected PO record apply/read'); return copy(context);
    } });
  try { await operations.save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original PO record boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  const record = captured?.record, event = captured?.event, before = records.find(r => r._id === input.id) || null;
  if (!record || !event || reads !== 1 || scratch.size || record._id !== input.id || record.title !== input.id || record.company !== company
    || before && !before._version || captured.expected !== (before ? hash(before) : null) || captured.expectedVersion !== input.version
    || event.actorStaffId !== staff.staffId || record.details.audit.at(-1)?.id !== event.id
    || !same(record.details.audit.slice(0, -1), before?.details?.audit || [])) throw Error('Original exact PO record/event required');
  const allowedDetails = new Set([...patches[input.action], 'taskIds', 'createdAt', 'createdBy', 'updatedAt', 'audit']);
  const fixed = details => Object.fromEntries(Object.entries(details || {}).filter(([k]) => !allowedDetails.has(k)));
  const top = value => Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'details'));
  if (before && !same(top(before), top(record)) || !same(fixed(before?.details), fixed(record.details))) throw Error('PO metadata action cannot change unrelated finance, document or identity fields');
  return { plan: { writes: [{ collection: 'R2PurchaseOrders', before: copy(before), after: record }] },
    event, expectedVersion: captured.expectedVersion, expectedBasis: captured.expectedBasis };
}
module.exports = { preparePurchaseOrderRecord };

},
// account-order-record-plan.cjs sha256:fa06e79004328593ac0300e4aae966b3a8f50557b320e949467adf39bd10086a
"account-order-record-plan.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const financeFields = Object.freeze({ CLOSE_ACCOUNT: ['closure', 'check'], REOPEN_ACCOUNT: ['closure', 'check'],
  DOCUMENT_ISSUE_REPORT: ['check'], DOCUMENT_ISSUE_REVIEW: ['check'], AMOUNTS: ['amounts', 'check'], CN_NOT_APPLICABLE: ['cnNotApplicable', 'check'],
  CHECK: ['check'], PLAN: ['plan', 'planUpdated'], RECOGNIZE_CREDIT: ['creditRecognition', 'check'], SHORTAGE_CLAIM: ['quantityClaims', 'check'],
  PAYMENT_REVIEW: [], REVIEW_LEGACY: [], TAKE_OWNERSHIP: [], RETURN_PROCUREMENT: [], PAYMENT_PROCESSING: [], PAYMENT_UNKNOWN: [], PAYMENT_RESOLVED: [] });
const procurementActions = new Set(['REVIEW_LEGACY', 'TAKE_OWNERSHIP', 'RETURN_PROCUREMENT', 'PAYMENT_PROCESSING', 'PAYMENT_UNKNOWN', 'PAYMENT_RESOLVED']);
// Private ORIGINAL non-file Account prepare only. No bank/file/stock action is
// inferred from a financial decision, and no actual legacy apply is called.
async function prepareAccountOrderRecord({ company, staff, requestId, input, rows, before, createAccountSettlementOperations, now }) {
  if (!['NCT', 'GHR'].includes(company) || !Object.hasOwn(financeFields, input?.action) || !Array.isArray(rows)
    || rows.some(row => row.company !== company) || new Set(rows.map(row => row.id)).size !== rows.length
    || typeof createAccountSettlementOperations !== 'function' || typeof now !== 'function'
    || before && (before._id !== input.id || before.company !== company || !before._version)) throw Error('Original non-file Account order snapshot required');
  if (before?.details?.audit?.some(event => event.id === hash(company,requestId,staff.memberId,'FINANCE'))) throw Error('Preexisting original Account audit without current receipt requires review');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', scratch = new Map(), boundary = new Error('Private Account record boundary');
  let captured, reads = 0;
  const store = {
    read: async (c, id) => {
      if (c === journal) return copy(scratch.get(id) || null);
      if (c !== 'R2PurchaseOrders' || id !== input.id) throw Error('Account record read scope violation'); return copy(before || null);
    },
    insert: async (c, row) => {
      if (c === journal && row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || !row.details.plan?.record || row.details.plan.upload || row.details.plan.trash
          || row.details.plan.extraUploads?.length) throw Error('Unexpected Account record preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (c !== journal || row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Account apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      if (c !== journal || scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private Account lock removal allowed'); scratch.delete(id);
    }
  };
  const operations = createAccountSettlementOperations({ store, now, names: { [company]: { activity: journal } },
    documentService: async () => { throw Error('External Account file operation forbidden'); }, listOrders: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected Account apply/read'); return copy(rows);
    } });
  try { await operations.save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original Account boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  const record = captured?.record, audit = captured?.audit;
  if (!record || !audit || reads !== 1 || scratch.size || record._id !== input.id || record.title !== input.id || record.company !== company
    || captured.expected !== (before ? hash(before) : null) || captured.expectedVersion !== input.version || audit.actorStaffId !== staff.staffId
    || audit.action !== 'ACCOUNT_' + input.action || !same(record.details.audit.at(-1), audit)
    || !same(record.details.audit.slice(0, -1), before?.details?.audit || [])) throw Error('Original Account record/audit identity conflict');
  const permitted = new Set(['finance', 'taskIds', 'createdAt', 'createdBy', 'updatedAt', 'audit',
    ...(procurementActions.has(input.action) ? ['procurementHandoff'] : []), ...(input.action === 'PAYMENT_REVIEW' ? ['paymentHandoff', 'chasePayment'] : []),
    ...(input.action.startsWith('DOCUMENT_ISSUE_') ? ['documentIssues'] : []), ...(input.action === 'DOCUMENT_ISSUE_REVIEW' ? ['documents'] : [])]);
  const fixed = (value, allowed) => Object.fromEntries(Object.entries(value || {}).filter(([k]) => !allowed.has(k)));
  if (before && !same(fixed(before, new Set(['details'])), fixed(record, new Set(['details'])))
    || !same(fixed(before?.details, permitted), fixed(record.details, permitted))
    || !same(fixed(before?.details?.finance, new Set(financeFields[input.action])), fixed(record.details.finance, new Set(financeFields[input.action])))) throw Error('Account decision cannot change payments, stock, files or unrelated fields');
  return { plan: { writes: [{ collection: 'R2PurchaseOrders', before: copy(before || null), after: record }] }, audit,
    expectedVersion: captured.expectedVersion, expectedBasis: captured.expectedBasis };
}
function createAccountRecordPreparation({ company, readMember, readStaffRecords, requireAccountStaff, readOrders, store, protocol, createAccountSettlementOperations, now }) {
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requireAccountStaff, readOrders, createAccountSettlementOperations, now].some(f => typeof f !== 'function')
    || typeof store?.read !== 'function' || typeof protocol?.readSnapshot !== 'function') throw Error('Server Account preparation dependencies required');
  return async request => {
    if (request?.company !== company || !Object.hasOwn(financeFields, request.input?.action)) throw Error('Supported company non-file Account request required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requireAccountStaff(member, []);
    const staff = { ...requireAccountStaff(member, await readStaffRecords()), memberId: member._id };
    const snapshot = await protocol.readSnapshot(async () => {
      const rows = await readOrders(company, staff), before = await store.read('R2PurchaseOrders', request.input.id);
      return prepareAccountOrderRecord({ company, staff, requestId: request.requestId, input: request.input, rows, before, createAccountSettlementOperations, now });
    });
    return { ...snapshot.rows, memberId: staff.memberId, generation: snapshot.generation };
  };
}
module.exports = { prepareAccountOrderRecord, createAccountRecordPreparation };

},
// current-account-auxiliary-save.cjs sha256:5acb046e70a3d9fb5a3c11a5377118b69452b8cff48530edf363fcede726f082
"current-account-auxiliary-save.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { prepareAccountOriginalAuxiliary } = load("account-original-auxiliary-plan.cjs");
const { hash } = load("commit-proof.cjs");
// These ORIGINAL co-writers must use the SAME barrier, not a competing finance
// workflow. This private adapter grants no role and performs no file/bank action.
function createCurrentAccountAuxiliarySave({ company, store, protocol, coverage, authorityDependencies: d }) {
  if (!['NCT','GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || typeof store?.read !== 'function'
    || [d?.readMember,d?.readStaffRecords,d?.requireAccountStaff,d?.readOrders,d?.createAccountReviewOperations,d?.createSupplierCreditOperations,d?.now].some(fn => typeof fn !== 'function')) throw Error('Original Account auxiliary private dependencies required');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  return async request => {
    if (!['INVOICE_CHECK','APPLY_CREDIT'].includes(request?.input?.action)) throw Error('Original Account auxiliary action required');
    const credit = request.input.action === 'APPLY_CREDIT'; let staff;
    const result = await createCurrentStockSave({ company, writer: 'ACCOUNT_PURCHASE_RECORD', protocol, coverage,
      authenticate: async () => {
        const member = await d.readMember(); if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') d.requireAccountStaff(member, []);
        staff = { ...d.requireAccountStaff(member, await d.readStaffRecords()), memberId: member._id }; return { memberId: staff.memberId, staffId: staff.staffId };
      }, prepare: async command => {
        if (command.memberId !== staff.memberId) throw Error('Original Account auxiliary actor changed');
        const snapshot = await protocol.readSnapshot(async () => prepareAccountOriginalAuxiliary({ company, staff, requestId: command.requestId, input: command.input,
          rows: await d.readOrders(company, staff), before: credit ? null : await store.read('R2PurchaseOrders', command.input.id),
          creditBefore: credit ? await store.read(journal, hash(company, command.requestId, staff.memberId, 'CREDIT')) : null,
          createAccountReviewOperations: d.createAccountReviewOperations, createSupplierCreditOperations: d.createSupplierCreditOperations, now: d.now }));
        return { plan: snapshot.rows, memberId: staff.memberId, generation: snapshot.generation };
      } })(request);
    if (result.ok !== true) return result;
    const id = hash(company, request.requestId, staff.memberId, credit ? 'CREDIT' : 'ACCOUNT_REVIEW');
    const receipt = await protocol.readSnapshot(() => store.read(credit ? journal : 'R2PurchaseOrders', credit ? id : request.input.id));
    const row = receipt.rows, matches = !credit && Array.isArray(row?.details?.audit) ? row.details.audit.filter(event => event.id === id) : [];
    const event = credit ? row : matches[0], at = credit ? event?.activityTime : event?.time;
    if (!row?._version || row.company !== company || credit && (row._id !== id || row.title !== id || row.action !== 'SUPPLIER_CREDIT_APPLIED'
      || row.result !== 'SAVED' || row.initiatedByStaffId !== staff.staffId || row.details?.company !== company || row.details.sourceId !== request.input.sourceId
      || row.details.targetId !== request.input.id || row.details.cents !== request.input.cents)
      || !credit && (row._id !== request.input.id || row.title !== row._id || matches.length !== 1 || event.action !== 'SUPPLIER_INVOICE_CHECK_CHANGED'
        || event.result !== 'SAVED' || event.actorStaffId !== staff.staffId)
      || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) throw Error('Original Account auxiliary receipt requires review');
    return { ...result, company, poId: request.input.id, savedAt: at };
  };
}
module.exports = { createCurrentAccountAuxiliarySave };

},
// account-original-auxiliary-plan.cjs sha256:eb5ca9c4e7151dc41f190af54efe70817c528893a828bfeec1f209afdb2b8511
"account-original-auxiliary-plan.cjs": (load, module) => {
'use strict';
const { hash } = load("commit-proof.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
// Capture ORIGINAL legacy invoice cancellation or supplier credit preparation.
// The original policies run; original apply/file/bank paths never run here.
async function prepareAccountOriginalAuxiliary({ company, staff, requestId, input, rows, before, creditBefore,
  createAccountReviewOperations, createSupplierCreditOperations, now }) {
  const credit = input?.action === 'APPLY_CREDIT', review = input?.action === 'INVOICE_CHECK';
  if (!['NCT','GHR'].includes(company) || !credit && !review || !Array.isArray(rows)
    || rows.some(row => row.company !== company || !row.id) || new Set(rows.map(row => row.id)).size !== rows.length
    || typeof now !== 'function' || typeof (credit ? createSupplierCreditOperations : createAccountReviewOperations) !== 'function'
    || review && before && (before._id !== input.id || before.company !== company || !before._version)
    || credit && creditBefore !== null) throw Error('Original Account auxiliary authority required');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', scratch = new Map(), boundary = new Error('Original Account auxiliary prepare boundary');
  let captured, reads = 0;
  const store = {
    read: async (collection, id) => {
      if (collection === journal) return copy(scratch.get(id) || null);
      if (credit || collection !== 'R2PurchaseOrders' || id !== input.id) throw Error('Original Account auxiliary read scope');
      return copy(before || null);
    }, insert: async (collection, row) => {
      if (collection === journal && row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || !row.details.plan || row.details.plan.upload || row.details.plan.trash || row.details.plan.extraUploads?.length) throw Error('Original auxiliary plan scope');
        captured = copy(row.details.plan); throw boundary;
      }
      if (collection !== journal || row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Original Account auxiliary apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (collection, id) => {
      if (collection !== journal || scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private auxiliary lock removal'); scratch.delete(id);
    }
  };
  const dependencies = { store, now, names: { [company]: { activity: journal } }, listOrders: async (selected, actor) => {
    if (selected !== company || actor.memberId !== staff.memberId || ++reads !== 1) throw Error('Original auxiliary apply/read forbidden'); return copy(rows);
  } };
  const operation = credit ? createSupplierCreditOperations(dependencies) : createAccountReviewOperations(dependencies).save;
  try { await operation({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original auxiliary boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original auxiliary preparation incomplete');
  if (credit) {
    const event = captured.event, id = hash(company, requestId, staff.memberId, 'CREDIT');
    if (Object.keys(captured).some(key => !['sourceVersion','targetVersion','event'].includes(key))
      || captured.sourceVersion !== input.sourceVersion || captured.targetVersion !== input.version
      || !event || event._id !== id || event.title !== id || event.description !== input.id || event.action !== 'SUPPLIER_CREDIT_APPLIED'
      || event.result !== 'SAVED' || event.actorType !== 'STAFF' || event.initiatedByStaffId !== staff.staffId || event.initiatedByStaffName !== staff.staffName
      || event.details?.company !== company || event.details.sourceId !== input.sourceId || event.details.targetId !== input.id
      || event.details.supplierId !== rows.find(row => row.id === input.id)?.supplierId || event.details.cents !== input.cents
      || event.details.reason !== String(input.reason || '').trim() || event.message !== event.details.reason
      || typeof event.activityTime !== 'string' || !Number.isFinite(Date.parse(event.activityTime))) throw Error('Original supplier credit event identity required');
    return { writes: [{ collection: journal, before: null, after: { ...event, company } }] };
  }
  const { record, event, expected } = captured, id = hash(company, requestId, staff.memberId, 'ACCOUNT_REVIEW');
  if (Object.keys(captured).some(key => !['record','event','expected'].includes(key)) || !record || !event || record._id !== input.id
    || record.title !== input.id || record.company !== company || expected !== (before ? hash(before) : null)
    || event.id !== id || event.action !== 'SUPPLIER_INVOICE_CHECK_CHANGED' || event.result !== 'SAVED'
    || event.actorStaffId !== staff.staffId || event.actor !== staff.staffName || !same(record.details?.audit?.at(-1), event)
    || !same(record.details.audit.slice(0,-1), before?.details?.audit || []) || typeof event.time !== 'string' || !Number.isFinite(Date.parse(event.time))) throw Error('Original invoice review record/audit identity required');
  const omit = (value, keys) => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !keys.includes(key)));
  if (before && !same(omit(record,['details']),omit(before,['details']))
    || !same(omit(record.details,['taskIds','createdAt','createdBy','updatedAt','audit','invoiceCheck']),omit(before?.details,['taskIds','createdAt','createdBy','updatedAt','audit','invoiceCheck']))) throw Error('Invoice cancellation cannot change finance, files or stock');
  return { writes: [{ collection: 'R2PurchaseOrders', before: copy(before || null), after: record }] };
}
module.exports = { prepareAccountOriginalAuxiliary };

},
// current-order-file-save.cjs sha256:fab6b6b0497e3f0460b43dcff7690dfbbd970fa4a51f068cc53cab278a5228d2
"current-order-file-save.cjs": (load, module) => {
'use strict';
const {createCurrentStockSave}=load("current-stock-save.cjs"),{prepareOriginalOrderFileWrite,captureOriginalOrderFilePlan}=load("original-order-file-plan.cjs");
const {hash}=load("commit-proof.cjs");
const {prepareOriginalPurchaseDeletionWrite}=load("purchase-delete-protocol.cjs");
// Original gateway role checks and same company protocol supplied privately. No
// web endpoint, real file action, bank instruction, or stock activation here.
function createCurrentOrderFileSave({company,department,store,coverage,authenticateOriginal,readOriginalContext,createFileProtocol,allocateDocumentSlot,
 createPurchaseOrderOperations,createAccountSettlementOperations,now=()=>new Date()}){
 const purchase=department==='PURCHASE';
 if(!['NCT','GHR'].includes(company)||!['PURCHASE','ACCOUNT'].includes(department)||typeof store?.read!=='function'
  ||[authenticateOriginal,readOriginalContext,createFileProtocol,allocateDocumentSlot,now,purchase?createPurchaseOrderOperations:createAccountSettlementOperations].some(fn=>typeof fn!=='function'))throw Error('Private original order file save dependencies required');
 return async request=>{
  let staff;
  const authenticate=async()=>{const current=await authenticateOriginal(company);
   if(!current?.staffId||!current.memberId||!current.staffName||request?.stockIdentity?.staffId!==current.staffId||request.stockIdentity.memberId!==current.memberId
    ||staff&&(staff.staffId!==current.staffId||staff.memberId!==current.memberId))throw Error('Original order file actor required');staff=current;return{staffId:staff.staffId,memberId:staff.memberId};};
  await authenticate();
  if(!(purchase?['DOCUMENT','DELETE_DOCUMENT'].includes(request.input?.action):['DOCUMENT_UPLOAD','PAYMENT_FILE_DELETE'].includes(request.input?.action)))throw Error('Original order file action required');
  const deleting=purchase&&request.input.action==='DELETE_DOCUMENT';
  const protocol=createFileProtocol({request,staff});
  if(protocol?.planFormat!=='SEGMENTED_V2'||typeof protocol.readSnapshot!=='function')throw Error('Original paired order file protocol required');
  if(deleting&&protocol.originalPurchaseDeletion!==true)throw Error('Original staged Purchase deletion protocol required');
  const result=await createCurrentStockSave({company,writer:purchase?'PURCHASE_ORDER_RECORD':'ACCOUNT_PURCHASE_RECORD',protocol,coverage,authenticate,prepare:async command=>{
   const snapshot=await protocol.readSnapshot(async()=>{
    const context=await readOriginalContext(company,staff),at=now().toISOString(),upload=!['PAYMENT_FILE_DELETE','DELETE_DOCUMENT'].includes(command.input.action),count=upload?1+(!purchase&&Array.isArray(command.input.attachments)?command.input.attachments.length:0):0;
    const args={...context,company,department,staff,requestId:command.requestId,input:command.input,now:()=>new Date(at),createPurchaseOrderOperations,createAccountSettlementOperations};
    const placeholders=Array.from({length:Math.min(count,7)},(_,index)=>'ORIGINAL_VALIDATION_SLOT_'+index);
    await captureOriginalOrderFilePlan({...args,slots:placeholders});
    const slots=[];for(let index=0;index<count;index++)slots.push(await allocateDocumentSlot(company));
    return deleting?prepareOriginalPurchaseDeletionWrite({...args,slots}):prepareOriginalOrderFileWrite({...args,slots});
   });return{memberId:staff.memberId,generation:snapshot.generation,plan:snapshot.rows};
  }})(request);
  if(result.ok!==true)return result;
  const snapshot=await protocol.readSnapshot(()=>store.read('R2PurchaseOrders',request.input.id)),row=snapshot.rows;
  const auditId=hash(company,request.requestId,staff.memberId,purchase?(deleting?'PO_DELETE_AUDIT':'PO_AUDIT'):'FINANCE'),matches=(row?.details?.audit||[]).filter(event=>event.id===auditId),audit=matches[0];
  if(!row?._version||row.company!==company||row._id!==request.input.id||row.title!==row._id||matches.length!==1||audit.actorStaffId!==staff.staffId
   ||audit.action!==(purchase?(deleting?'SUPPLIER_DOCUMENT_DELETED':'SUPPLIER_DOCUMENT_UPLOADED'):'ACCOUNT_'+request.input.action)||audit.result!=='SAVED'||!Number.isFinite(Date.parse(audit.time)))throw Error('Original committed order file receipt requires review');
  return{...result,company,poId:row._id,savedAt:audit.time};
 };
}
module.exports={createCurrentOrderFileSave};

},
// original-order-file-plan.cjs sha256:af5407e88310f286caaf9a67e5b02d0c58db20e0386cfa2deb3bb3e5b8e34602
"original-order-file-plan.cjs": (load, module) => {
'use strict';

const Buffer=StockRuntimeBuffer;
const { hash } = load("commit-proof.cjs"), { copy, same } = load("segmented-plan.cjs");
const fileId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(value);
const fieldsExcept = (value, fields) => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !fields.includes(key)));
const noPayload = value => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { if (key === 'base64') throw Error('PDF payload cannot enter prepared order metadata'); noPayload(child); }
};
// Private ORIGINAL prepare capture only. Scratch journal, preallocated fixed slots,
// no legacy apply, external upload/trash, domain write, or change to file policy.
async function captureOriginalOrderFilePlan({ department, company, staff, requestId, input, context, records, rows, suppliers = [],
  createPurchaseOrderOperations, createAccountSettlementOperations, now, slots = [] }) {
  const purchase = department === 'PURCHASE', upload = input?.action === (purchase ? 'DOCUMENT' : 'DOCUMENT_UPLOAD');
  if (!['PURCHASE','ACCOUNT'].includes(department) || !['NCT','GHR'].includes(company) || !staff?.staffId || !staff.memberId || !staff.staffName
    || !/^[a-f0-9-]{36}$/i.test(requestId || '') || ![purchase ? 'DOCUMENT' : 'DOCUMENT_UPLOAD', purchase ? 'DELETE_DOCUMENT' : 'PAYMENT_FILE_DELETE'].includes(input?.action)
    || typeof now !== 'function' || !Array.isArray(records) || records.some(row => row.company !== company || !row._id || !row._version)
    || new Set(records.map(row => row._id)).size !== records.length || !Array.isArray(slots) || slots.some(id => !fileId(id)) || new Set(slots).size !== slots.length
    || slots.length !== (upload ? 1 + (!purchase && Array.isArray(input.attachments) ? input.attachments.length : 0) : 0)
    || purchase && (context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity) || typeof createPurchaseOrderOperations !== 'function')
    || !purchase && (!Array.isArray(rows) || rows.some(row => row.company !== company) || new Set(rows.map(row => row.id)).size !== rows.length || !Array.isArray(suppliers) || typeof createAccountSettlementOperations !== 'function')) {
    throw Error('Private original order file context required');
  }
  const before = records.find(row => row._id === input.id) || null, journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const expectedAuditId = hash(company,requestId,staff.memberId,purchase ? (upload ? 'PO_AUDIT' : 'PO_DELETE_AUDIT') : 'FINANCE');
  if ((before?.details?.audit || []).some(event => event.id === expectedAuditId)) throw Error('Preexisting original file audit without current receipt requires review');
  const scratch = new Map(), boundary = Error('Original order file prepare boundary'); let captured, reads = 0, allocated = 0;
  const store = {
    all: async collection => {
      if (purchase && collection === 'R2PurchaseOrders') return copy(records);
      if (!purchase && collection === 'SharedSuppliers') return copy(suppliers);
      throw Error('Original file preparation table scope');
    },
    read: async (collection, id) => {
      if (collection === journal) return copy(scratch.get(id) || null);
      if (collection !== 'R2PurchaseOrders' || id !== input.id) throw Error('Original file preparation record scope'); return copy(before);
    },
    insert: async (collection, row) => {
      if (collection === journal && row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || !row.details.plan) throw Error('Original file preparation conflict'); captured = copy(row.details.plan); throw boundary;
      }
      if (collection !== journal || row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Original file legacy apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    },
    remove: async (collection, id) => { if (collection !== journal || scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private scratch file lock removal allowed'); scratch.delete(id); }
  };
  const documentService = async command => {
    if (!upload || !same(command, { action:'ALLOCATE',company }) || allocated >= slots.length) throw Error('External order file action forbidden during preparation');
    return { ok:true,fileId:slots[allocated++] };
  };
  const readOriginal = async (selected, employee) => {
    if (selected !== company || employee.memberId !== staff.memberId || employee.staffId !== staff.staffId || ++reads !== 1) throw Error('Original file preparation actor/context changed');
    return copy(purchase ? context : rows);
  };
  const shared = { store, now, documentService, names:{ [company]:{ activity:journal } } };
  const operations = purchase ? createPurchaseOrderOperations({ ...shared,readWorkspace:readOriginal }) : createAccountSettlementOperations({ ...shared,listOrders:readOriginal });
  try { await operations.save({ company,staff:copy(staff),requestId,input:copy(input) }); throw Error('Original file prepare boundary missing'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size || allocated !== slots.length || captured.expectedVersion !== input.version) throw Error('Original file preparation incomplete');
  noPayload(captured);
  const audit = purchase ? captured.event : captured.audit, record = captured.record;
  const expectedAction = purchase ? (upload ? 'SUPPLIER_DOCUMENT_UPLOADED' : 'SUPPLIER_DOCUMENT_DELETED') : 'ACCOUNT_' + input.action;
  if (audit?.id !== expectedAuditId || audit.action !== expectedAction || audit.actorStaffId !== staff.staffId || audit.actor !== staff.staffName || audit.result !== 'SAVED'
    || (purchase || upload) && captured.expected !== (before ? hash(before) : null)) throw Error('Original file audit/record identity conflict');
  if (upload || !purchase) {
    const allowed = purchase ? ['documents','finalInvoiceComplete','documentIssues','taskIds','createdAt','createdBy','updatedAt','audit']
      : upload ? ['finance','documents','chasePayment','taskIds','createdAt','createdBy','updatedAt','audit'] : ['finance','updatedAt','audit'];
    if (!record || record._id !== input.id || record.title !== input.id || record.company !== company
      || before && !same(fieldsExcept(before,['details']),fieldsExcept(record,['details']))
      || !same(fieldsExcept(before?.details,allowed),fieldsExcept(record.details,allowed))
      || !same(record.details.audit.at(-1),audit) || !same(record.details.audit.slice(0,-1),before?.details?.audit || [])) throw Error('Original file cannot alter unrelated record or audit');
    if (!purchase && !same(fieldsExcept(before?.details?.finance,upload ? ['payments','check'] : ['payments']),fieldsExcept(record.details.finance,upload ? ['payments','check'] : ['payments']))) throw Error('Original file cannot alter unrelated finance');
  } else if (!before || !same(captured.document,before.details?.documents?.find(doc => doc.fileId === input.fileId)) || !same(captured.taskIds,before.details.taskIds)
    || typeof captured.startedAt !== 'string' || !Number.isFinite(Date.parse(captured.startedAt))) throw Error('Original pending deletion identity conflict');
  const uploads = upload ? [captured.upload,...(captured.extraUploads || [])] : [];
  if (uploads.length !== slots.length || Boolean(captured.trash) === upload) throw Error('Original file side-effect shape conflict');
  for (const [index, command] of uploads.entries()) {
    const pdf = index ? input.attachments[index-1]?.base64 : input.base64;
    const bytes = Buffer.from(pdf,'base64');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (command.action !== 'UPLOAD' || command.company !== company || command.poId !== input.id || command.fileId !== slots[index]
      || command.sha256 !== sha256 || command.type !== input.type || !command.name || (command.department || 'PURCHASE') !== (!purchase && input.type === 'PAYMENT' ? 'ACCOUNT' : 'PURCHASE')) throw Error('Original fixed upload slot conflict');
  }
  if (!upload && (captured.trash.action !== 'TRASH' || captured.trash.company !== company || captured.trash.poId !== input.id || captured.trash.fileId !== input.fileId
    || !captured.trash.sha256 || !captured.trash.name || !purchase && (captured.trash.department !== 'ACCOUNT' || captured.trash.type !== 'PAYMENT'))) throw Error('Original exact trash scope required');
  return { before:copy(before),prepared:captured,uploads:copy(uploads),trash:captured.trash ? copy(captured.trash) : null };
}
async function prepareOriginalOrderFileWrite(args) {
  const captured = await captureOriginalOrderFilePlan(args);
  if (args.department === 'PURCHASE' && args.input.action === 'DELETE_DOCUMENT') throw Error('Original Purchase deletion requires pending-unlink stage; not a single-write upload');
  const after = copy(captured.prepared.record);
  if (args.department === 'PURCHASE') for (const command of captured.uploads) {
    const document = after.details.documents.find(doc => doc.fileId === command.fileId);
    if (!document) throw Error('Original uploaded document missing'); document.url = 'https://drive.google.com/file/d/'+command.fileId+'/view';
  }
  return { writes:[{ collection:'R2PurchaseOrders',before:captured.before,after,
    orderFile:{ department:args.department,uploads:captured.uploads,trash:captured.trash } }] };
}
module.exports = { captureOriginalOrderFilePlan,prepareOriginalOrderFileWrite };

},
// purchase-delete-protocol.cjs sha256:62e197580907c691a7a08ffe8917ec935a2ed346c6b7c444feb186f65990f2f0
"purchase-delete-protocol.cjs": (load, module) => {
'use strict';
const {hash}=load("commit-proof.cjs"),{copy,same,createSegmentedPlanCodec}=load("segmented-plan.cjs");
const {createSegmentedFencedProof}=load("segmented-fenced-proof.cjs"),{captureOriginalOrderFilePlan}=load("original-order-file-plan.cjs");
const {pendingImage,finalImage,deletionPlan,classifyPurchaseDeletionImage}=load("purchase-delete-images.cjs");
async function prepareOriginalPurchaseDeletionWrite(args){
 if(args.department!=='PURCHASE'||args.input?.action!=='DELETE_DOCUMENT')throw Error('Original Purchase deletion required');
 const captured=await captureOriginalOrderFilePlan({...args,slots:[]});
 return{writes:[{collection:'R2PurchaseOrders',before:captured.before,after:pendingImage(captured.before,captured.prepared,args.requestId),
  purchaseDeletion:{requestId:args.requestId,prepared:captured.prepared}}]};
}
// Existing segmented coordinator, same company lock/manifest/admission. Its private
// final validation hook completes ORIGINAL unlink→trash→final audit under FINALIZE.
// No duplicate plan identity, second authority/collection or inverse rollback.
function createPurchaseDeleteProtocol({company,staff,request,store,documentService,now=()=>new Date(),codecPolicy={},stepsPerInvocation=20,coordination='EXCLUSIVE_LOCK'}){
 if(!['EXCLUSIVE_LOCK','CONTROL_CAS_CANDIDATE'].includes(coordination))throw Error('Explicit server deletion coordination required');
 const exclusive=coordination==='EXCLUSIVE_LOCK';
 if(!['NCT','GHR'].includes(company)||!staff?.staffId||!staff.memberId||!staff.staffName||request?.input?.action!=='DELETE_DOCUMENT'
  ||request.stockProtocol!==1||request.stockIdentity?.staffId!==staff.staffId||request.stockIdentity?.memberId!==staff.memberId
  ||typeof request.stockBuild!=='string'||!request.stockBuild||!Number.isSafeInteger(request.stockGeneration)||request.stockGeneration<0
  ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||typeof documentService!=='function'||typeof now!=='function')throw Error('Private original Purchase staged deletion required');
 const base=createSegmentedFencedProof({company,store,domainWrites:true,codecPolicy,stepsPerInvocation,coordination}),codec=createSegmentedPlanCodec({...codecPolicy,company,domainWrites:true});
 const {journal,lockId,controlId}=base.ids,key=hash(company+'/PURCHASE',request.requestId,staff.memberId),digest=hash({company,writer:'PURCHASE_ORDER_RECORD',input:request.input,
  stockProtocol:request.stockProtocol,stockBuild:request.stockBuild,stockGeneration:request.stockGeneration,stockIdentity:request.stockIdentity});
 async function complete(originalPlan){
  const control=await store.read(journal,controlId),lock=exclusive?await store.read(journal,lockId):null,manifest=await store.read(journal,key);
  if(!control?._version||control.company!==company||control.mode!=='ACTIVE'||control.writerBuild!==request.stockBuild||control.generation!==request.stockGeneration
   ||control.pending?.key!==key||control.pending.digest!==digest||control.pending.phase!=='FINALIZE'||control.pending.cursor!==1||control.pending.count!==1
   ||manifest?.digest!==digest||manifest.baseGeneration!==request.stockGeneration||manifest.planHash!==control.pending.planHash||exclusive&&(lock?.company!==company||lock.owner!==key||!lock.attempt))throw Error('Original Purchase deletion FINALIZE fence required');
  if(!Array.isArray(manifest.fragments)||!manifest.fragments.length||manifest.fragments.length>32)throw Error('Bounded original deletion manifest required');
  const fragments=[];for(const ref of manifest.fragments)fragments.push(await store.read(journal,ref.id));
  const plan=codec.decode({manifest,fragments,key,digest,memberId:staff.memberId,requestId:request.requestId});
  if(plan.writes.length!==1||!same(plan,originalPlan))throw Error('Exact original deletion manifest required');
  const change=plan.writes[0],prepared=deletionPlan(change,key),current=await store.read(change.collection,change.after._id);
  if(change.after.company!==company||change.after._id!==request.input.id||change.purchaseDeletion.requestId!==request.requestId
   ||prepared.expectedVersion!==request.input.version||prepared.document.fileId!==request.input.fileId||prepared.event.actorStaffId!==staff.staffId
   ||prepared.event.id!==hash(company,request.requestId,staff.memberId,'PO_DELETE_AUDIT'))throw Error('Original deletion request/audit identity conflict');
  const fence=async()=>{if(!same(await store.read(journal,controlId),control)||exclusive&&!same(await store.read(journal,lockId),lock))throw Error('Original Purchase deletion callback fence changed; retain request');};
  const image=classifyPurchaseDeletionImage(change,current,key);
  if(image==='FILE_DELETE_COMPLETED'){await fence();return;}
  if(image!=='PENDING_UNLINK')throw Error('Original pending or completed deletion image conflict');
  await fence();const receipt=await documentService(copy(prepared.trash));
  if(receipt?.ok!==true||receipt.trashed!==true||['fileId','company','poId','sha256','name'].some(field=>receipt[field]!==prepared.trash[field]))throw Error('Original Purchase trash unconfirmed; retain request');
  await fence();if(!same(await store.read(change.collection,change.after._id),change.after))throw Error('Original pending deletion changed during callback');
  // Completion time is chosen AFTER the real trash receipt, as in original apply.
  // Once this exact final row is durable, retry adopts it without recomputing time.
  const completed=finalImage(change.after,prepared,now().toISOString());
  try{await store.compareAndSet(change.collection,completed._id,change.after._version,completed);}catch(error){if(!same(await store.read(change.collection,completed._id),completed))throw error;}
  if(!same(await store.read(change.collection,completed._id),completed))throw Error('Original deletion completion unconfirmed');await fence();
 }
 return{...base,originalPurchaseDeletion:true,commit:options=>{
  if(options.requestId!==request.requestId||options.memberId!==staff.memberId||hash(options.input)!==digest)throw Error('Original deletion protocol request changed');
  return base.commit({...options,authorize:async operation=>{
   await options.authorize?.(operation);
   const prior=await store.read(journal,hash(key,'RESULT'));
   // A corrupt/early RESULT must not clear the barrier while the physical-file
   // completion is still missing. Later generations use retained original audit.
   if(prior&&(operation.control.pending||operation.control.generation<=request.stockGeneration+1)){
    const manifest=await store.read(journal,key);if(!Array.isArray(manifest?.fragments)||!manifest.fragments.length||manifest.fragments.length>32)throw Error('Original deletion result plan requires review');
    const fragments=[];for(const ref of manifest.fragments)fragments.push(await store.read(journal,ref.id));
    const plan=codec.decode({manifest,fragments,key,digest,memberId:staff.memberId,requestId:request.requestId});
    if(plan.writes.length!==1||classifyPurchaseDeletionImage(plan.writes[0],await store.read('R2PurchaseOrders',request.input.id),key)!=='FILE_DELETE_COMPLETED')throw Error('Original deletion result lacks completed file image');
   }
  },validate:async plan=>{if(options.validate)await options.validate(copy(plan));await complete(plan);}});
 }};
}
module.exports={prepareOriginalPurchaseDeletionWrite,createPurchaseDeleteProtocol,classifyPurchaseDeletionImage};

},
// segmented-fenced-proof.cjs sha256:567ec0398e6337ef4db861fa2ba1bbc3206183fb0e333b20499606396998da88
"segmented-fenced-proof.cjs": (load, module) => {
'use strict';

// OFFLINE v2 candidate. Same company fence/CAS contract as v1, no live endpoint.
// Runtime/staging budgets still require actual platform acceptance before activation.
const randomUUID = () => randomBytes(16).toString('hex');
const { hash } = load("commit-proof.cjs");
const { createSegmentedPlanCodec, same, copy } = load("segmented-plan.cjs");
function createSegmentedFencedProof({ store, company = 'NCT', newAttempt = randomUUID,
  domainWrites = false, codecPolicy = {}, stepsPerInvocation = 20, maxStagedFragments = 32,
  coordination = 'EXCLUSIVE_LOCK', batchApplyReads = false }) {
  for (const method of ['read', 'insert', 'compareAndSet', 'compareAndRemove']) {
    if (typeof store?.[method] !== 'function') throw Error('Conditional storage required');
  }
  if (!Number.isSafeInteger(stepsPerInvocation) || stepsPerInvocation < 1
    || !Number.isSafeInteger(maxStagedFragments) || maxStagedFragments < 1
    || !['EXCLUSIVE_LOCK', 'CONTROL_CAS_CANDIDATE'].includes(coordination)
    || typeof batchApplyReads !== 'boolean') throw Error('Bounded execution policy required');
  const codec = createSegmentedPlanCodec({ ...codecPolicy, company, domainWrites });
  const { journal, lockId, controlId } = codec.ids, scope = company + '/PURCHASE';
  async function readControl() {
    const row = await store.read(journal, controlId);
    if (!row || row.company !== company || !row._version || !Number.isSafeInteger(row.generation) || row.generation < 0) throw Error('Control missing or invalid');
    return row;
  }
  async function initialize() { await store.insert(journal, { _id: controlId, company, generation: 0, pending: null, _version: 'GENESIS' }); }
  async function writeExpected(collection, before, after) {
    try {
      if (before) await store.compareAndSet(collection, after._id, before._version, copy(after));
      else await store.insert(collection, copy(after));
    } catch (error) {
      if (!same(await store.read(collection, after._id), after)) throw error;
    }
  }
  async function transition(collection, before, after) {
    await writeExpected(collection, before, after);
    if (!same(await store.read(collection, after._id), after)) throw Error('Conditional write unconfirmed');
  }
  const nextControl = (before, fields) => ({ ...before, ...fields, _version: hash(before._version, fields) });
  async function readImages(collection, ids) {
    // Same complete exact-ID adapter already used during preparation. A failed
    // or malformed batch NEVER falls back to individual queries or partial rows.
    const rows = [];
    if (typeof store.readMany === 'function') rows.push(...await store.readMany(collection, ids));
    else for (const id of ids) rows.push(await store.read(collection, id));
    if (rows.length !== ids.length || rows.some((row, index) => row !== null
      && (!row || row._id !== ids[index] || row.company !== company))) throw Error('Exact complete image batch required');
    return rows;
  }
  async function readSnapshot(readRows) {
    const before = await readControl();
    if (before.pending) throw Error('Inventory pending');
    const rows = await readRows(copy(before)), after = await readControl();
    if (after.pending || before._version !== after._version) throw Error('Inventory changed during read');
    return { generation: after.generation, rows };
  }
  async function commit({ requestId, memberId, input, prepare, validate = () => {}, authorize = () => {} }) {
    if (!/^[a-f0-9-]{36}$/i.test(requestId || '') || typeof memberId !== 'string' || !memberId
      || typeof prepare !== 'function' || typeof validate !== 'function' || typeof authorize !== 'function') throw Error('Operation identity required');
    const key = hash(scope, requestId, memberId), digest = hash(input), resultId = hash(key, 'RESULT'), attempt = newAttempt();
    if (typeof attempt !== 'string' || !attempt) throw Error('Attempt identity required');
    // Default deployed candidate retains its original lock contract. The opt-in
    // LOCAL review policy coordinates through the existing conditional control
    // transition; it never touches, releases or adopts a native UNKNOWN lock.
    const exclusive = coordination === 'EXCLUSIVE_LOCK';
    if (exclusive) await store.insert(journal, { _id: lockId, company, owner: key, attempt });
    try {
      let control = await readControl();
      if (control.pending && (control.pending.key !== key || control.pending.digest !== digest)) throw Error('Prior inventory save pending');
      const prior = await store.read(journal, resultId);
      let manifest = await store.read(journal, key);
      if (manifest && manifest.digest !== digest) throw Error('Request identity reused');
      if (manifest && (manifest.company !== company || manifest._id !== key
        || manifest.memberId !== memberId || manifest.requestId !== requestId || manifest.stockOperationProtocol !== 2
        || !Number.isSafeInteger(manifest.baseGeneration) || manifest.baseGeneration < 0)) throw Error('Operation manifest identity conflict');
      if (prior && (!manifest || prior.company !== company || prior._id !== resultId || prior.digest !== digest
        || prior.baseGeneration !== manifest.baseGeneration || prior.stockOperationProtocol !== 2
        || prior.outcome?.ok !== true || prior.outcome.operationId !== key
        || prior.outcome.generation !== manifest.baseGeneration + 1
        || !control.pending && control.generation < prior.outcome.generation)) throw Error('Operation result requires review');
      await authorize(copy({ control, key, digest, replay: !!manifest, baseGeneration: manifest?.baseGeneration ?? control.generation }));
      if (prior) {
        if (control.pending) {
          if (control.generation !== manifest.baseGeneration || control.pending.planHash !== manifest.planHash
            || control.pending.phase !== 'FINALIZE' || control.pending.cursor !== manifest.writeCount) throw Error('Result generation conflict');
          await transition(journal, control, nextControl(control, { generation: manifest.baseGeneration + 1, pending: null }));
        }
        return copy(prior.outcome);
      }
      if (!manifest) {
        if (control.pending) throw Error('Pending manifest missing');
        if (!Number.isSafeInteger(control.generation + 1)) throw Error('Inventory generation exhausted');
        const encoded = codec.encode({ key, digest, memberId, requestId, attempt, baseGeneration: control.generation, plan: await prepare() });
        // Refuse before staging, never silently truncate or pretend this is a measured
        // production limit. All fragments must be durable before unique root insert.
        if (encoded.fragments.length > maxStagedFragments) throw Error('Staging capacity requires review');
        for (const fragment of encoded.fragments) await transition(journal, null, fragment);
        manifest = encoded.manifest;
        await transition(journal, null, manifest);
      }
      if (manifest.baseGeneration !== control.generation) throw Error('Prepared generation stale');
      if (!Array.isArray(manifest.fragments) || manifest.fragments.length > maxStagedFragments) throw Error('Manifest capacity conflict');
      const fragments = await readImages(journal, manifest.fragments.map(ref => ref.id));
      const plan = codec.decode({ manifest, fragments, key, digest, memberId, requestId });
      const count = plan.writes.length;
      if (!control.pending) {
        const pending = { key, digest, planHash: manifest.planHash, phase: 'BEFORE', cursor: 0, count };
        const next = nextControl(control, { pending }); await transition(journal, control, next); control = next;
      }
      const p = control.pending;
      if (p.planHash !== manifest.planHash || p.count !== count || !['BEFORE', 'APPLY', 'VERIFY', 'FINALIZE'].includes(p.phase)
        || !Number.isSafeInteger(p.cursor) || p.cursor < 0 || p.cursor > count
        || p.phase === 'FINALIZE' && p.cursor !== count) throw Error('Pending progress conflict');
      let phase = p.phase, cursor = p.cursor, steps = 0;
      while (steps < stepsPerInvocation && phase !== 'FINALIZE') {
        if (cursor === count) {
          phase = phase === 'BEFORE' ? 'APPLY' : phase === 'APPLY' ? 'VERIFY' : 'FINALIZE'; cursor = phase === 'FINALIZE' ? count : 0;
          // Persist phase boundary BEFORE any following-phase action. Particularly,
          // an interrupted APPLY cannot accidentally re-enter BEFORE verification.
          const next = nextControl(control, { pending: { ...p, phase, cursor } });
          await transition(journal, control, next); control = next;
          continue;
        }
        if (phase !== 'APPLY' && typeof store.readMany === 'function') {
          const span = plan.writes.slice(cursor, cursor + Math.min(count - cursor, stepsPerInvocation - steps));
          const groups = new Map(), found = new Map();
          for (const change of span) {
            if (!groups.has(change.collection)) groups.set(change.collection, []);
            groups.get(change.collection).push(change.after._id);
          }
          for (const [collection, ids] of groups) {
            const rows = await readImages(collection, ids);
            ids.forEach((id, index) => found.set(collection + '/' + id, rows[index]));
          }
          for (const change of span) if (!same(found.get(change.collection + '/' + change.after._id), phase === 'BEFORE' ? change.before : change.after)) {
            throw Error(phase === 'BEFORE' ? 'Prepared before-image stale' : 'Final image conflict');
          }
          cursor += span.length; steps += span.length;
          continue;
        }
        if (phase === 'APPLY' && batchApplyReads && typeof store.readMany === 'function') {
          const span = plan.writes.slice(cursor, cursor + Math.min(count - cursor, stepsPerInvocation - steps));
          const groups = new Map(), found = new Map();
          for (const change of span) {
            if (!groups.has(change.collection)) groups.set(change.collection, []);
            groups.get(change.collection).push(change.after._id);
          }
          for (const [collection, ids] of groups) {
            const rows = await readImages(collection, ids);
            ids.forEach((id, index) => found.set(collection + '/' + id, rows[index]));
          }
          for (const change of span) {
            const current = found.get(change.collection + '/' + change.after._id);
            if (!same(current, change.before) && !same(current, change.after)) throw Error('Write version conflict');
          }
          for (const change of span) if (!same(found.get(change.collection + '/' + change.after._id), change.after)) {
            await writeExpected(change.collection, change.before, change.after);
          }
          // Exact complete strong readback precedes the durable cursor. A failed
          // batch or partial write leaves the original checkpoint unchanged.
          for (const [collection, ids] of groups) {
            const rows = await readImages(collection, ids);
            ids.forEach((id, index) => found.set(collection + '/' + id, rows[index]));
          }
          for (const change of span) if (!same(found.get(change.collection + '/' + change.after._id), change.after)) throw Error('Conditional batch write unconfirmed');
          cursor += span.length; steps += span.length;
          continue;
        }
        const change = plan.writes[cursor], current = await store.read(change.collection, change.after._id);
        if (phase === 'BEFORE') {
          if (!same(current, change.before)) throw Error('Prepared before-image stale');
        } else if (phase === 'APPLY') {
          if (!same(current, change.after)) {
            if (!same(current, change.before)) throw Error('Write version conflict');
            await transition(change.collection, change.before, change.after);
          }
        } else if (!same(current, change.after)) throw Error('Final image conflict');
        cursor++; steps++;
      }
      // Checkpoint may lag completed row writes after an interruption; replay checks
      // exact after-images, not blind increments. Never advances before row confirms.
      if (phase !== control.pending.phase || cursor !== control.pending.cursor) {
        const next = nextControl(control, { pending: { ...p, phase, cursor } });
        await transition(journal, control, next); control = next;
      }
      if (phase !== 'FINALIZE') return { ok: false, pending: true, phase, completedCount: cursor, totalRecords: count, requestId };
      await validate(copy(plan));
      const outcome = { ok: true, operationId: key, generation: manifest.baseGeneration + 1 };
      await transition(journal, null, { _id: resultId, company, stockOperationProtocol: 2, digest, baseGeneration: manifest.baseGeneration, outcome });
      await transition(journal, control, nextControl(control, { generation: manifest.baseGeneration + 1, pending: null }));
      return outcome;
    } finally {
      if (exclusive) await store.compareAndRemove(journal, lockId, attempt);
    }
  }
  return { initialize, readControl, readSnapshot, commit, ids: codec.ids, planFormat: 'SEGMENTED_V2' };
}
module.exports = { createSegmentedFencedProof };

},
// purchase-delete-images.cjs sha256:b2769aa55140081d48a666413f9039a71315d6eb2d1c636ba1e3dc75e4920564
"purchase-delete-images.cjs": (load, module) => {
'use strict';
const {hash}=load("commit-proof.cjs");
const {copy,same}=load("segmented-plan.cjs");
// Pure original image checks only. Safe to bundle in READ-ONLY recovery without
// importing file services, mutation protocols or original business writers.
function pendingImage(before,prepared,requestId){
 const document=before?.details?.documents?.find(doc=>doc.fileId===prepared?.document?.fileId),event=prepared?.event;
 if(!before?._version||!document||!same(document,prepared.document)||!same(before.details.taskIds,prepared.taskIds)
  ||prepared.expected!==hash(before)||!event?.actorStaffId||!event.actor||event.action!=='SUPPLIER_DOCUMENT_DELETED'||event.result!=='SAVED'
  ||!event.message||!Number.isFinite(Date.parse(prepared.startedAt))||Object.hasOwn(event,'time')
  ||!same(prepared.trash,{action:'TRASH',company:before.company,poId:before._id,fileId:document.fileId,sha256:document.sha256,name:document.name,type:document.type}))throw Error('Original Purchase pending deletion contract required');
 const deletion={requestId,fileId:document.fileId,by:event.actor,byStaffId:event.actorStaffId,at:prepared.startedAt};
 return{...copy(before),details:{...copy(before.details),documentDeletion:deletion,documents:before.details.documents.map(doc=>doc.fileId===document.fileId?{...copy(doc),linked:false,deletion:{...deletion,state:'PENDING'}}:copy(doc))}};
}
function finalImage(pending,prepared,at){
 if(typeof at!=='string'||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)throw Error('Original Purchase deletion completion time required');
 const event={...copy(prepared.event),time:at};
 return{...copy(pending),_version:hash(pending._version,'PURCHASE_FILE_DELETED',at),details:{...copy(pending.details),documentDeletion:null,updatedAt:at,
  documents:pending.details.documents.map(doc=>doc.fileId===prepared.document.fileId?{...copy(doc),linked:false,deletion:{...copy(doc.deletion),state:'DELETED',at}}:copy(doc)),
  audit:[...(copy(pending.details.audit||[])),event]}};
}
function deletionPlan(change,key){
 const metadata=change?.purchaseDeletion,prepared=metadata?.prepared,before=change?.before,after=change?.after;
 if(change?.collection!=='R2PurchaseOrders'||!metadata||!same(Object.keys(metadata).sort(),['prepared','requestId'])
  ||!/^[a-f0-9-]{36}$/i.test(metadata.requestId||'')||before?._id!==after?._id||before?.company!==after?.company)throw Error('Exact original Purchase unlink plan required');
 const expected=pendingImage(before,prepared,metadata.requestId);expected._version=hash(key,'R2PurchaseOrders',after._id);
 if(!same(expected,after))throw Error('Original Purchase unlink image changed');return prepared;
}
// Evidence classification never authorizes a callback, unlock or write.
function classifyPurchaseDeletionImage(change,current,key){
 try{const prepared=deletionPlan(change,key);if(same(current,change.after))return'PENDING_UNLINK';
  const matches=(current?.details?.audit||[]).filter(event=>event.id===prepared.event.id);
  return matches.length===1&&same(current,finalImage(change.after,prepared,matches[0].time))?'FILE_DELETE_COMPLETED':null;
 }catch(_){return null;}
}
module.exports = {pendingImage,finalImage,deletionPlan,classifyPurchaseDeletionImage};

},
// order-file-fenced-store.cjs sha256:ab472a6fd6d4e81b758254491aeff8a2b5f1f1c8d7a61d6c6bfb528a5239362f
"order-file-fenced-store.cjs": (load, module) => {
'use strict';

const Buffer=StockRuntimeBuffer;
const { hash } = load("commit-proof.cjs"), { copy,same,createSegmentedPlanCodec } = load("segmented-plan.cjs");
// Private original file callbacks under the SAME pending manifest/owner. No lease
// theft, automatic cleanup, PDF journal payload, new collection, or legacy write.
function createOrderFileFencedStore({ company,department,staff,request,store,documentService,codecPolicy={},coordination='EXCLUSIVE_LOCK' }) {
  if(!['EXCLUSIVE_LOCK','CONTROL_CAS_CANDIDATE'].includes(coordination))throw Error('Explicit server file coordination required');
  const exclusive=coordination==='EXCLUSIVE_LOCK';
  const purchase=department==='PURCHASE',upload=request?.input?.action===(purchase?'DOCUMENT':'DOCUMENT_UPLOAD');
  if (!['NCT','GHR'].includes(company)||!['PURCHASE','ACCOUNT'].includes(department)||!staff?.staffId||!staff.memberId
    ||request?.stockProtocol!==1||request.stockIdentity?.staffId!==staff.staffId||request.stockIdentity?.memberId!==staff.memberId
    ||typeof request.stockBuild!=='string'||!request.stockBuild||!Number.isSafeInteger(request.stockGeneration)||request.stockGeneration<0
    ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||!(upload||!purchase&&request.input?.action==='PAYMENT_FILE_DELETE')
    ||['read','insert','compareAndSet','compareAndRemove'].some(method=>typeof store?.[method]!=='function')||typeof documentService!=='function')throw Error('Private original order file fence required');
  const codec=createSegmentedPlanCodec({...codecPolicy,company,domainWrites:true}),{journal,controlId,lockId}=codec.ids;
  const key=hash(company+'/PURCHASE',request.requestId,staff.memberId),digest=hash({company,writer:purchase?'PURCHASE_ORDER_RECORD':'ACCOUNT_PURCHASE_RECORD',input:request.input,
    stockProtocol:request.stockProtocol,stockBuild:request.stockBuild,stockGeneration:request.stockGeneration,stockIdentity:request.stockIdentity});
  async function beforeWrite(collection,row,expectedVersion) {
    const control=await store.read(journal,controlId),lock=exclusive?await store.read(journal,lockId):null,manifest=await store.read(journal,key);
    if(collection!=='R2PurchaseOrders'||row?._id!==request.input.id||row.company!==company||!control?._version||control.company!==company||control.mode!=='ACTIVE'
      ||control.writerBuild!==request.stockBuild||control.generation!==request.stockGeneration||control.pending?.key!==key||control.pending.digest!==digest
      ||control.pending.phase!=='APPLY'||control.pending.cursor!==0||control.pending.count!==1||manifest?.digest!==digest||manifest.planHash!==control.pending.planHash
      ||manifest.baseGeneration!==request.stockGeneration||exclusive&&(lock?.company!==company||lock.owner!==key||!lock.attempt))throw Error('Durable original order file APPLY fence required');
    if(!Array.isArray(manifest.fragments)||!manifest.fragments.length||manifest.fragments.length>codec.policy.maxFragments)throw Error('Bounded original order file manifest required');
    const fragments=[];for(const ref of manifest.fragments)fragments.push(await store.read(journal,ref.id));
    const plan=codec.decode({manifest,fragments,key,digest,memberId:staff.memberId,requestId:request.requestId}),change=plan.writes[0],side=change?.orderFile;
    if(plan.writes.length!==1||change.collection!==collection||!same(change.after,row)||(change.before?._version||null)!==expectedVersion
      ||!side||!same(Object.keys(side).sort(),['department','trash','uploads'])||side.department!==department||!Array.isArray(side.uploads))throw Error('Exact original order file image required');
    if(!same(await store.read(collection,row._id),change.before))throw Error('Original file before-image changed');
    const auditId=hash(company,request.requestId,staff.memberId,purchase?'PO_AUDIT':'FINANCE'),audit=row.details?.audit?.at(-1);
    if(audit?.id!==auditId||audit.actorStaffId!==staff.staffId||audit.result!=='SAVED'||audit.action!==(purchase?'SUPPLIER_DOCUMENT_UPLOADED':'ACCOUNT_'+request.input.action)
      ||!same(row.details.audit.slice(0,-1),change.before?.details?.audit||[]))throw Error('Original file audit fence conflict');
    // Fixed upload IDs cannot overwrite/untrash an existing file; exact TRASH is
    // monotonic. A late callback still cannot authorize a stale CMS after-image.
    const assertFence=async()=>{if(!same(await store.read(journal,controlId),control)||exclusive&&!same(await store.read(journal,lockId),lock))throw Error('Original order file callback fence changed; retain request');};
    if(upload){
      const payloads=[request.input.base64,...(!purchase&&Array.isArray(request.input.attachments)?request.input.attachments.map(file=>file.base64):[])];
      if(side.trash!==null||side.uploads.length!==payloads.length||!payloads.length||payloads.length>(purchase?1:6)||new Set(side.uploads.map(command=>command.fileId)).size!==payloads.length)throw Error('Original upload count conflict');
      for(const [index,command]of side.uploads.entries()){
        const bytes=Buffer.from(payloads[index],'base64');
        if(bytes.length<5||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.toString('base64')!==payloads[index]||command.action!=='UPLOAD'||command.company!==company
          ||command.poId!==row._id||command.type!==request.input.type||typeof command.fileId!=='string'||!/^[A-Za-z0-9_-]{10,200}$/.test(command.fileId)
          ||command.sha256!==createHash('sha256').update(bytes).digest('hex')||(command.department||'PURCHASE')!==(!purchase&&request.input.type==='PAYMENT'?'ACCOUNT':'PURCHASE'))throw Error('Original immutable PDF/slot conflict');
        const documents=purchase||request.input.type==='DO'?row.details.documents:(row.details.finance?.payments||[]).flatMap(payment=>payment.proofs||[payment.proof]);
        const matches=(documents||[]).filter(doc=>doc?.fileId===command.fileId);
        if(matches.length!==1||matches[0].linked!==true||matches[0].sha256!==command.sha256||matches[0].name!==command.name||matches[0].type!==command.type||matches[0].size!==bytes.length
          ||matches[0].uploadedByStaffId!==staff.staffId||purchase&&matches[0].url!=='https://drive.google.com/file/d/'+command.fileId+'/view')throw Error('Original uploaded association conflict');
        await assertFence();const receipt=await documentService({...copy(command),base64:payloads[index]});
        if(receipt?.ok!==true||['fileId','company','poId','sha256','name'].some(field=>receipt[field]!==command[field]))throw Error('Original order file upload unconfirmed; retain slot/request');
        await assertFence();
      }
    }else{
      const command=side.trash,payment=change.before?.details?.finance?.payments?.find(value=>value.id===request.input.paymentId),proof=(payment?.proofs||[payment?.proof]).find(value=>value?.fileId===request.input.fileId);
      if(side.uploads.length||!proof||!same(command,{action:'TRASH',department:'ACCOUNT',company,poId:row._id,fileId:proof.fileId,sha256:proof.sha256,name:proof.name,type:'PAYMENT'}))throw Error('Original payment trash identity conflict');
      await assertFence();const receipt=await documentService(copy(command));
      if(receipt?.ok!==true||receipt.trashed!==true||['fileId','company','poId','sha256','name','type'].some(field=>receipt[field]!==command[field]))throw Error('Original payment trash unconfirmed; retain request');
      await assertFence();
    }
  }
  const metadata=(collection,row)=>collection===journal&&(row?._id===lockId||row?._id===controlId||row?.stockOperationProtocol===2);
  return{read:(...args)=>store.read(...args),
    insert:async(collection,row)=>{if(!metadata(collection,row))await beforeWrite(collection,row,null);return store.insert(collection,row);},
    compareAndSet:async(collection,id,version,row)=>{if(id!==row._id)throw Error('Original file conditional identity conflict');if(!metadata(collection,row))await beforeWrite(collection,row,version);return store.compareAndSet(collection,id,version,row);},
    compareAndRemove:(collection,id,attempt)=>{if(collection!==journal||id!==lockId)throw Error('Only exact owned order file protocol lock release allowed');return store.compareAndRemove(collection,id,attempt);}};
}
module.exports={createOrderFileFencedStore};

},
// fenced-proof.cjs sha256:b05eaa71128cd2cd490567b47372c1ce0c744b0d55df8c3001f640f8994a85f9
"fenced-proof.cjs": (load, module) => {
'use strict';

// OFFLINE CONTRACT PROOF. No Wix adapter, authorization endpoint or production imports.
// compareAndSet/compareAndRemove MUST test their condition atomically at mutation time.
const randomUUID = () => randomBytes(16).toString('hex');
const { hash } = load("commit-proof.cjs");
const { planCollections } = load("domain-scope.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function createFencedProof({ store, company = 'NCT', newAttempt = randomUUID, domainWrites = false }) {
  if (!['NCT', 'GHR'].includes(company)) throw Error('Invalid company');
  for (const method of ['read', 'insert', 'compareAndSet', 'compareAndRemove']) {
    if (typeof store[method] !== 'function') throw Error('Conditional storage required');
  }
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const scope = company + '/PURCHASE', lockId = hash(scope, 'LOCK');
  const controlId = hash(company, 'STOCK_CONTROL');
  const allowed = new Set(planCollections(company, domainWrites));
  const initial = () => ({ _id: controlId, company, generation: 0, pending: null, _version: 'GENESIS' });
  const readControl = async () => {
    const row = await store.read(journal, controlId);
    if (!row || row.company !== company || !row._version || !Number.isSafeInteger(row.generation)
      || row.generation < 0) throw Error('Control missing or invalid');
    return row;
  };
  // Initialization is an explicit offline setup step; production migration is not implemented.
  async function initialize() { await store.insert(journal, initial()); }
  async function transition(collection, before, after) {
    try {
      if (before) await store.compareAndSet(collection, after._id, before._version, copy(after));
      else await store.insert(collection, copy(after));
    } catch (error) {
      // Only exact after-image confirms a lost reply. A before-image does NOT mean cancelled.
      if (!same(await store.read(collection, after._id), after)) throw error;
    }
    if (!same(await store.read(collection, after._id), after)) throw Error('Conditional write unconfirmed');
  }
  const nextControl = (before, fields) => ({ ...before, ...fields,
    _version: hash(before._version, fields) });
  function checkPlan(plan, key) {
    if (!plan || !Array.isArray(plan.writes) || !plan.writes.length || plan.writes.length > 30
      || Buffer.byteLength(JSON.stringify(plan)) > 180000) throw Error('Proof plan limit');
    const keys = new Set();
    for (const change of plan.writes) {
      const id = change.after?._id, identity = change.collection + '/' + id;
      if (!allowed.has(change.collection) || !id || keys.has(identity) || change.after.company !== company
        || change.before && (change.before._id !== id || change.before.company !== company || !change.before._version)
        || change.collection === journal && [lockId, controlId, key, hash(key, 'RESULT')].includes(id)) {
        throw Error('Plan identity conflict');
      }
      keys.add(identity);
      const token = hash(key, change.collection, id);
      if (change.before?._version === token) throw Error('Version reuse');
      change.after._version = token;
    }
  }
  async function readSnapshot(readRows) {
    const before = await readControl();
    if (before.pending) throw Error('Inventory pending');
    const rows = await readRows(), after = await readControl();
    if (after.pending || before._version !== after._version) throw Error('Inventory changed during read');
    return { generation: after.generation, rows };
  }
  async function commit({ requestId, memberId, input, prepare, validate = () => {}, authorize = () => {} }) {
    if (!/^[a-f0-9-]{36}$/i.test(requestId || '') || !memberId || typeof authorize !== 'function') throw Error('Proof identity required');
    const key = hash(scope, requestId, memberId), digest = hash(input), resultId = hash(key, 'RESULT');
    const attempt = newAttempt();
    if (typeof attempt !== 'string' || !attempt) throw Error('Attempt identity required');
    // An uncertain acquisition is not auto-removed or stolen; no domain writes have begun.
    await store.insert(journal, { _id: lockId, company, owner: key, attempt });
    try {
      let control = await readControl();
      if (control.pending && (control.pending.key !== key || control.pending.digest !== digest)) {
        throw Error('Prior inventory save pending');
      }
      const prior = await store.read(journal, resultId);
      let receipt = await store.read(journal, key);
      if (prior && (prior.company !== company || prior._id !== resultId || !Number.isSafeInteger(prior.baseGeneration) || prior.baseGeneration < 0)
        || receipt && (receipt.company !== company || receipt._id !== key || !Number.isSafeInteger(receipt.baseGeneration) || receipt.baseGeneration < 0)) throw Error('Operation receipt scope conflict');
      if (prior && prior.digest !== digest || receipt && receipt.digest !== digest) throw Error('Request identity reused');
      if (prior && receipt && prior.baseGeneration !== receipt.baseGeneration) throw Error('Operation receipt generation conflict');
      if (prior && (prior.outcome?.ok !== true || prior.outcome.operationId !== key || prior.outcome.generation !== prior.baseGeneration + 1
        || !control.pending && control.generation < prior.outcome.generation)) throw Error('Operation result requires review');
      // Runs under the owned fence on EVERY invocation, including completed or pending
      // replays. Replay identity comes only from exact server receipts, never UI flags.
      await authorize(copy({ control, key, digest, replay: !!(prior || receipt), baseGeneration: (prior || receipt)?.baseGeneration ?? control.generation }));
      if (prior) {
        if (control.pending) {
          if (control.generation !== prior.baseGeneration) throw Error('Result generation conflict');
          await transition(journal, control, nextControl(control, { generation: prior.baseGeneration + 1, pending: null }));
        }
        return copy(prior.outcome);
      }
      if (!receipt) {
        const plan = copy(await prepare()); checkPlan(plan, key);
        receipt = { _id: key, company, digest, baseGeneration: control.generation, plan };
        await transition(journal, null, receipt);
      }
      const plan = copy(receipt.plan); checkPlan(plan, key);
      if (!same(plan, receipt.plan)) throw Error('Prepared plan changed');
      if (receipt.baseGeneration !== control.generation) throw Error('Prepared generation stale');
      if (!control.pending) {
        for (const change of plan.writes) {
          if (!same(await store.read(change.collection, change.after._id), change.before)) throw Error('Prepared before-image stale');
        }
        const pending = nextControl(control, { pending: { key, digest } });
        await transition(journal, control, pending); control = pending;
      }
      for (const change of plan.writes) {
        const current = await store.read(change.collection, change.after._id);
        if (same(current, change.after)) continue;
        if (!same(current, change.before)) throw Error('Write version conflict');
        await transition(change.collection, change.before, change.after);
      }
      for (const change of plan.writes) {
        if (!same(await store.read(change.collection, change.after._id), change.after)) throw Error('Final image conflict');
      }
      await validate(copy(plan));
      const outcome = { ok: true, operationId: key, generation: receipt.baseGeneration + 1 };
      await transition(journal, null, { _id: resultId, company, digest, baseGeneration: receipt.baseGeneration, outcome });
      await transition(journal, control, nextControl(control, { generation: receipt.baseGeneration + 1, pending: null }));
      return outcome;
    } finally {
      // No domain mutation follows release. A late copy must recheck attempt at execution.
      await store.compareAndRemove(journal, lockId, attempt);
    }
  }
  return { initialize, commit, readSnapshot, readControl, ids: { journal, lockId, controlId } };
}

module.exports = { createFencedProof };

},
// purchase-transfer-workspace.cjs sha256:c70728112f527a6f10994190234bdb3db3e88c55658999fb37862a5ceb24ef1c
"purchase-transfer-workspace.cjs": (load, module) => {
'use strict';

const { copy } = load("segmented-plan.cjs");
const count = n => Number.isSafeInteger(n) && n >= 0;
// Read-only composition. Original Purchase auth/workspace supplied by real gateway.
// A failed/incomplete relation index must fail the refresh, not clear existing halos.
function createPurchaseTransferWorkspace({ company, protocol, authenticate, readWorkspace, readOutstanding, maxRelations = 2000 }) {
  if (!['NCT', 'GHR'].includes(company) || typeof protocol?.readSnapshot !== 'function' || typeof authenticate !== 'function'
    || typeof readWorkspace !== 'function' || typeof readOutstanding !== 'function' || !Number.isSafeInteger(maxRelations) || maxRelations < 1) throw Error('Private Purchase workspace dependencies required');
  return async requestCompany => {
    if (requestCompany !== company) throw Error('Purchase workspace company conflict');
    const actor = await authenticate(company);
    if (!actor?.memberId || !actor.staffId) throw Error('Original Purchase authorization required');
    const snapshot = await protocol.readSnapshot(async control => {
      if (control?.company !== company || control.pending || !count(control.generation) || !['LEGACY', 'ACTIVE'].includes(control.mode)) throw Error('Purchase stock workspace unavailable');
      if (control.mode === 'ACTIVE' && (control.transferIndexVersion !== 2 || !control.writerBuild)) throw Error('Purchase source transfer index/build not verified');
      const workspace = await readWorkspace(company, actor);
      if (workspace?.company !== company || !Array.isArray(workspace.tasks) || new Set(workspace.tasks.map(t => t.id)).size !== workspace.tasks.length) throw Error('Original Purchase workspace required');
      if (control.mode === 'LEGACY') return copy(workspace);
      const relations = [], seen = new Set(); let cursor, expectedTotal, expectedVersion;
      do {
        const page = await readOutstanding(company, { view: 'OUTSTANDING', pageSize: 50, ...(cursor ? { cursor } : {}) });
        if (page?.schema !== 'CURRENT_BORROW_RELATIONS_V1' || page.company !== company || page.view !== 'OUTSTANDING'
          || page.generation !== control.generation || !/^[a-f0-9]{32}$/.test(page.version || '') || page.offset !== relations.length || !Array.isArray(page.items)
          || !count(page.total) || page.total > maxRelations || page.items.length !== Math.min(50, page.total - relations.length)
          || expectedTotal !== undefined && (page.total !== expectedTotal || page.version !== expectedVersion)) throw Error('Complete current transfer workspace required');
        expectedTotal = page.total; expectedVersion = page.version;
        for (const r of page.items) {
          if (!r.id || seen.has(r.id) || !r.borrowerTaskId || !r.lenderTaskId || r.borrowerTaskId === r.lenderTaskId || !r.lenderSourceId || !r.replacementSourceId
            || !count(r.quantity) || !r.quantity || !count(r.repaid) || !count(r.returned) || r.repaid + r.returned >= r.quantity
            || r.remaining !== undefined && r.remaining !== r.quantity - r.repaid - r.returned) throw Error('Known outstanding relation required');
          seen.add(r.id); relations.push(r);
        }
        cursor = page.nextCursor;
        if (relations.length < expectedTotal && (!cursor || cursor.offset !== relations.length || cursor.version !== expectedVersion)
          || relations.length === expectedTotal && cursor) throw Error('Transfer workspace cursor incomplete');
      } while (cursor);
      const sourceIds = new Set(relations.flatMap(r => [r.lenderSourceId, r.replacementSourceId]));
      // Borrower obligation only, not Warehouse receipt or additional allocation.
      // Publish only after every same-generation relation page was verified.
      const repayments = new Map();
      for (const r of relations) {
        const remaining = r.quantity - r.repaid - r.returned;
        const due = (repayments.get(r.borrowerTaskId) || 0) + remaining;
        if (!count(due)) throw Error('Known outstanding repayment total required');
        repayments.set(r.borrowerTaskId, due);
      }
      return { ...copy(workspace), stockCurrent: { schema: 'PURCHASE_TRANSFERS_V2', generation: control.generation,
        stockProtocol: 1, stockBuild: control.writerBuild, stockGeneration: control.generation },
        tasks: workspace.tasks.map(task => ({ ...copy(task), stockTransferOutstanding: sourceIds.has(task.id),
          stockBorrowedOutstanding: repayments.get(task.id) || 0,
          stockTransferTaskId: task.customerDemandTaskId || task.id })) };
    });
    return snapshot.rows;
  };
}
module.exports = { createPurchaseTransferWorkspace };

},
// borrow-current-query.cjs sha256:0b7dad852c7cde57adbbc3aeb233baf03e38abbecdb07ca619bf8b9b3c5bea6b
"borrow-current-query.cjs": (load, module) => {
'use strict';
const { hash } = load("commit-proof.cjs");
const { transferId } = load("borrowing-stock-plan.cjs");
const count = n => Number.isSafeInteger(n) && n >= 0;
const text = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;
// Purchase-only relation detail/outstanding read. CLOSED relationship history does
// not enter the active query. One current row per relationship, no task archive flag.
function createBorrowCurrentQuery({ company, items, protocol, authenticate }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function' || typeof protocol?.readSnapshot !== 'function'
    || typeof authenticate !== 'function') throw Error('Private Purchase relation dependencies required');
  return async (requestCompany, input = {}) => {
    const view = input.view ?? 'TASK', taskId = view === 'OUTSTANDING' ? null : input.taskId, pageSize = input.pageSize ?? 25, cursor = input.cursor;
    if (requestCompany !== company || !['TASK', 'OUTSTANDING'].includes(view) || view === 'TASK' && !text(taskId, 128)
      || view === 'OUTSTANDING' && input.taskId !== undefined || !count(pageSize) || pageSize < 1 || pageSize > 50
      || cursor != null && (!/^[a-f0-9]{32}$/.test(cursor.version || '') || !count(cursor.offset) || cursor.offset % pageSize)) throw Error('Bounded task relation request required');
    const actor = await authenticate(company);
    if (!actor?.memberId || !actor.staffId) throw Error('Original Purchase authorization required');
    const offset = cursor?.offset || 0, journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
    const snapshot = await protocol.readSnapshot(async control => {
      // Index marker may be installed only after complete private migration/parity
      // verifies all current rows. Missing index must NOT look like zero relations.
      if (control?.company !== company || control.mode !== 'ACTIVE' || control.pending || ![1, 2].includes(control.transferIndexVersion)) throw Error('Borrowing relation index not verified');
      let query = items.query(journal).eq('company', company).eq('action', 'STOCK_TRANSFER_CURRENT').eq('status', 'ACTIVE');
      if (taskId) query = query.eq('participantTaskIds', taskId);
      const page = await query.ascending('_id').skip(offset).limit(pageSize).find({ consistentRead: true, returnTotalCount: true });
      if (!Array.isArray(page?.items) || !count(page.totalCount) || offset > page.totalCount
        || page.items.length !== Math.min(pageSize, page.totalCount - offset) || new Set(page.items.map(row => row._id)).size !== page.items.length) throw Error('Incomplete relation page');
      return { total: page.totalCount, items: page.items.map(row => {
        const r = row.details?.relation, participants = r && [r.borrowerTaskId, r.lenderTaskId];
        if (row.company !== company || row.action !== 'STOCK_TRANSFER_CURRENT' || row.status !== 'ACTIVE'
          || !r || row._id !== transferId(company, r.id) || !text(r.id, 128) || !text(r.borrowerTaskId, 128) || !text(r.lenderTaskId, 128)
          || r.borrowerTaskId === r.lenderTaskId || taskId && !participants.includes(taskId) || JSON.stringify(row.participantTaskIds) !== JSON.stringify(participants)
          || !text(r.lenderSourceId, 128) || !text(r.replacementSourceId, 128) || !count(r.quantity) || !r.quantity || !count(r.repaid)
          || !count(r.returned ?? 0) || r.repaid + (r.returned || 0) >= r.quantity || !count(row.revision)
          || !count(row.checkpointGeneration) || row.checkpointGeneration > control.generation) throw Error('Current relationship requires review');
        if (control.transferIndexVersion === 2 && (row.lenderSourceId !== r.lenderSourceId
          || row.replacementSourceId !== r.replacementSourceId || row.repaidQuantity !== r.repaid)) throw Error('Current relationship source index requires review');
        // No private plan/version, cost, arbitrary details or old history payload.
        return { id: r.id, borrowerTaskId: r.borrowerTaskId, lenderTaskId: r.lenderTaskId, lenderSourceId: r.lenderSourceId,
          replacementSourceId: r.replacementSourceId, quantity: r.quantity, repaid: r.repaid, returned: r.returned || 0,
          remaining: r.quantity - r.repaid - (r.returned || 0), revision: row.revision };
      }) };
    });
    const version = hash('CURRENT_BORROW_RELATIONS_V1', company, snapshot.generation, view, taskId, pageSize);
    if (cursor && cursor.version !== version) throw Error('Borrowing changed while paging; refresh');
    return { schema: 'CURRENT_BORROW_RELATIONS_V1', company, view, taskId, generation: snapshot.generation, version, offset,
      ...snapshot.rows, halo: snapshot.rows.total > 0,
      nextCursor: offset + snapshot.rows.items.length < snapshot.rows.total ? { version, offset: offset + snapshot.rows.items.length } : null };
  };
}
module.exports = { createBorrowCurrentQuery };

},
// purchase-current-projection.cjs sha256:7953732dc3e02d50fb23d7719846f3527aba9caa11e5c9814e9e83a5c268d2b4
"purchase-current-projection.cjs": (load, module) => {
'use strict';

const { stockKey } = load("current-model.cjs");
const { currentAllocationContext } = load("current-allocation-context.cjs");
const { originalProductState } = load("original-product-state.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { copy } = load("segmented-plan.cjs");
const { attachBatchAvailability } = load("purchase-batch-availability.cjs");
// Private snapshot adapter. It does not authenticate, refresh GP, apply a save,
// create a workspace route, mark writer coverage or authorize activation.
function prepareCurrentPurchaseProjection({ context, states, readAllocations, generation }) {
  if (!['NCT','GHR'].includes(context?.company) || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
    || !Array.isArray(states) || !Number.isSafeInteger(generation) || generation < 0 || typeof readAllocations !== 'function') throw Error('Complete private Purchase projection required');
  const products=new Set(), demands=new Map(), sources=new Map(), allocations=[];
  const prior=readAllocations(context.activity);
  for (const state of states) {
    const key=stockKey(state);
    if (state.company !== context.company || state.scope !== 'CURRENT_ACTIVE_PRODUCT' || state.lifecycleVersion !== 2 || products.has(key)) throw Error('Distinct verified Purchase current products required');
    products.add(key);
    const current=currentAllocationContext({state,context,readAllocations:()=>prior});
    for (const task of state.tasks) {
      if (demands.has(task.id)) throw Error('Ambiguous Purchase demand coverage');
      const usable=state.sources.reduce((n,s)=>n+(s.claims[task.id]||0),0),held=state.packingHolds.heldByTask[task.id];
      const review=state.packingHolds.legacyBlockedByTask?.[task.id]===true;
      demands.set(task.id,{taskId:task.id,quantity:current.tasks.find(row=>row.id===task.id).inc,
        allocationFacts:{usable,held,dispatched:task.dispatched,availableToArrange:review?0:Math.max(0,usable-held),review}});
    }
    for (const source of state.sources) {
      if (sources.has(source.id)) throw Error('Ambiguous Purchase source coverage');
      sources.set(source.id,{taskId:source.id,accepted:source.accepted,availableCtn:source.available,availablePhysical:source.onHand-source.isolated});
      allocations.push(current.allocations.find(row=>row.sourceTaskId===source.id));
    }
  }
  for (const task of context.tasks.filter(row=>!row.archived)) {
    if (!task.procurementSource && !task.specialPurchase && !demands.has(task.id)
      || task.po && task.procurement?.totalCtn > 0 && !sources.has(task.id)) throw Error('Complete working Purchase demand/source coverage required');
  }
  return {schema:'PURCHASE_CURRENT_PROJECTION_V2',company:context.company,generation,
    taskReceived:[...demands.values()],sourceAvailable:[...sources.values()],
    allocations:[...prior.filter(row=>!sources.has(row.sourceTaskId)),...allocations].map(copy)};
}

// Call INSIDE the common generation barrier after original Purchase auth. Current
// values enter the ORIGINAL projector before split/batch metrics, not afterward.
async function readCurrentPurchaseProjection({ company, context, staff, control, items, store, originalArguments,
  projectPurchaseWorkspace, currentProjectionVersion, readCurrentTaskRows, readPurchaseRecords, projectPurchaseOrders,
  readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation,
  metrics={queries:0,exactReads:0},retainedTaskIds=[] }) {
  if (!['NCT','GHR'].includes(company) || !control || control.company !== company || control.mode !== 'ACTIVE' || control.schemaVersion !== 1 || control.pending
    || control.transferIndexVersion !== 2 || !control.writerBuild || !Number.isSafeInteger(control.generation) || control.generation < 0
    || context?.company !== company || !staff?.staffId || !staff.memberId || originalArguments?.company !== company
    || currentProjectionVersion !== 2 || typeof projectPurchaseWorkspace !== 'function' || typeof readCurrentTaskRows !== 'function'
    || typeof readPurchaseRecords !== 'function' || typeof projectPurchaseOrders !== 'function'
    ||!Array.isArray(retainedTaskIds)||new Set(retainedTaskIds).size!==retainedTaskIds.length
    ||retainedTaskIds.some(id=>typeof id!=='string'||!context.tasks.some(task=>task.id===id))) throw Error('Paired private current Purchase snapshot required');
  const groups=new Map();
  for (const task of context.tasks.filter(row=>!row.archived||retainedTaskIds.includes(row.id))) {
    const identity={company,barcode:task.barcode,packing:task.packing,ea:task.ea},key=stockKey(identity);
    if (!groups.has(key)) groups.set(key,{identity,taskIds:[],sourceIds:[]});
    if (!task.procurementSource && !task.specialPurchase) groups.get(key).taskIds.push(task.id);
    if (task.po && task.procurement?.totalCtn > 0) groups.get(key).sourceIds.push(task.id);
  }
  const orders=groups.size?projectPurchaseOrders({company,workspace:context,records:await readPurchaseRecords(company,staff)}):[];
  const states=[],products=new Map(),prior=readAllocations(context.activity);
  for (const [key,group] of groups) {
    const builder=originalProductState({company,context,orders,identity:group.identity,readAllocations:()=>prior,
      readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation});
    const rows=await readScopedCurrentProduct({company,identity:group.identity,items,store,metrics,
      transferIndexVersion:control.transferIndexVersion,sourceTaskIds:group.sourceIds,demandTaskIds:group.taskIds,
      claimPairs:builder.sources.filter(source=>group.sourceIds.includes(source.id)&&source.ownerTaskId)
        .map(source=>({sourceTaskId:source.id,taskId:source.ownerTaskId}))});
    if (!rows.product || rows.product.lifecycleVersion !== 2) throw Error('Current Purchase product checkpoint missing');
    rows.taskRows=await readCurrentTaskRows(company,builder.scopeTaskIds(rows),staff);rows.generation=control.generation;
    const state=builder.buildState(rows);states.push(state);products.set(key,{state,rows});
  }
  const currentStock=prepareCurrentPurchaseProjection({context,states,readAllocations:()=>prior,generation:control.generation});
  const workspace=projectPurchaseWorkspace({...originalArguments,staff,currentStock});
  if (workspace?.company !== company || workspace.stockAllocationView !== 'CURRENT_V2' || !Array.isArray(workspace.tasks)
    || workspace.tasks.length !== context.tasks.length || new Set(workspace.tasks.map(row=>row.id)).size !== workspace.tasks.length) throw Error('Original current Purchase projector not connected');
  for (const row of workspace.tasks) {
    const original=context.tasks.find(task=>task.id===row.id);
    if (!original || ['id','customerId','orderId','sourceLineId','barcode','packing','ea','po','ord','requested'].some(field=>row[field]!==original[field])
      || Boolean(row.procurementSource)!==Boolean(original.procurementSource) || Boolean(row.specialPurchase)!==Boolean(original.specialPurchase)
      || (row.customerDemandTaskId||null)!==(original.customerDemandTaskId||null)
      || row.procurement?.totalCtn!==original.procurement?.totalCtn) throw Error('Original current Purchase authority changed');
  }
  attachBatchAvailability({company,workspace,activity:context.activity,readPackingLists,packingHeld});
  return {workspace,products,metrics};
}
module.exports={prepareCurrentPurchaseProjection,readCurrentPurchaseProjection};

},
// purchase-batch-availability.cjs sha256:afab3830a2d882003c5659a913b5251c282997a485ff5db7383fba489d003f20
"purchase-batch-availability.cjs": (load, module) => {
'use strict';
const {readArrangements,projectArrangementLinks}=load("purchase-arrangement.cjs");
const whole=n=>Number.isSafeInteger(n)&&n>=0;
// Read-only attribution of existing CURRENT instruction links to actual list holds.
// Immutable link audit retains identity after the CURRENT instruction is replaced.
// No quantity comes from audit; actual holds still come only from current lists.
function attachBatchAvailability({company,workspace,activity,readPackingLists,packingHeld}){
 if(workspace?.company!==company||!Array.isArray(workspace.tasks)||!Array.isArray(activity)
   ||typeof readPackingLists!=='function'||typeof packingHeld!=='function')throw Error('Current batch availability context required');
 const linked=projectArrangementLinks(company,readArrangements(company,activity),activity).filter(i=>i.status==='LINKED');
 const bindings=new Map();
 function bind(d){
  const prior=bindings.get(d.packingListId);
  if(prior&&['taskId','batchId','customerId','orderId'].some(k=>prior[k]!==d[k]))throw Error('Ambiguous batch packing link');
  bindings.set(d.packingListId,d);
 }
 for(const d of linked)bind(d);
 const audits=new Set();
 for(const row of activity.filter(r=>r.action==='PURCHASE_ARRANGEMENT_LINKED')){
  const d=row.details;
  if(!d||row.company!==company||row.result!=='SAVED'||row.title!==row._id||row._id!==d.revision||audits.has(row._id)
    ||row.description!==d.orderId||d.status!=='LINKED'||!d.taskId||typeof d.batchId!=='string'||!d.customerId
    ||!d.orderId||!d.packingListId||!d.packingRevision||!d.linkedByStaffId||!row.initiatedByStaffId
    ||!whole(d.quantity)||d.quantity<1)throw Error('Batch packing link audit requires review');
  audits.add(row._id);bind(d);
 }
 const lists=readPackingLists(activity,company);
 for(const task of workspace.tasks.filter(t=>!t.procurementSource&&!t.specialPurchase&&Array.isArray(t.stockAllocatedBatches))){
  const f=task.stockAllocationFacts,batches=task.stockAllocatedBatches;
  if(!f||!['usable','held','dispatched','availableToArrange'].every(k=>whole(f[k]))||typeof f.review!=='boolean'
    ||f.usable+f.dispatched!==task.stockAllocatedCumulative||f.availableToArrange!==(f.review?0:Math.max(0,f.usable-f.held))
    ||new Set(batches.map(b=>b.id)).size!==batches.length||batches.some(b=>!b.id||!whole(b.demand)||!whole(b.allocated)||b.allocated>b.demand)
    ||batches.reduce((n,b)=>n+b.allocated,0)!==task.stockAllocatedCumulative)throw Error('Current batch allocation requires review');
  const held=new Map(batches.map(b=>[b.id,0]));
  for(const instruction of [...bindings.values()].filter(i=>i.taskId===task.id&&held.has(i.batchId))){
   const list=lists.find(l=>l.id===instruction.packingListId);
   if(!list||list.company!==company||list.customerId!==task.customerId||instruction.customerId!==task.customerId
     ||instruction.orderId!==task.orderId)throw Error('Actual batch packing list required');
   const quantity=packingHeld(list,task.id);
   if(!whole(quantity))throw Error('Actual batch packing hold required');
   held.set(instruction.batchId,held.get(instruction.batchId)+quantity);
  }
  const known=[...held.values()].reduce((n,q)=>n+q,0),unscopedHeld=f.held-known;
  if(!whole(known)||!whole(unscopedHeld))throw Error('Batch hold exceeds authoritative task holds');
  task.stockBatchAllocationFacts=batches.map(b=>({id:b.id,demand:b.demand,allocated:b.allocated,held:held.get(b.id),unscopedHeld,
    unscopedDispatched:f.dispatched,review:f.review,
    availableToArrange:f.review?0:Math.min(f.availableToArrange,Math.max(0,b.allocated-held.get(b.id)-unscopedHeld-f.dispatched))}));
 }
 return workspace;
}
module.exports={attachBatchAvailability};

},
// current-purchase-workspace-read.cjs sha256:ccf83a35439e0268fcefc52b6ee08406f2c440edbc44eeb261df1be9c5dbe28b
"current-purchase-workspace-read.cjs": (load, module) => {
'use strict';

const { prepareMarginReferenceGroup, collectMarginCurrencies } = load("margin-reference-plan.cjs");
const { createPurchaseTransferWorkspace } = load("purchase-transfer-workspace.cjs");
const { domainCollections } = load("domain-scope.cjs");
const { copy } = load("segmented-plan.cjs");
const {readArrangements,projectArrangementLinks}=load("purchase-arrangement.cjs");
// READ ONLY. Refresh suggestions contain no draft GP/rate/order data. The caller
// must durably retain an original authenticated save request BEFORE acting on one.
function createCurrentPurchaseWorkspaceRead({ company, protocol, authenticate, readCurrentContext, readRates,
  createPurchaseMarginRefresh, readCustomerShortNames, projectPurchaseOrders, applyPurchaseProgress, readOutstanding, now }) {
  if (!['NCT','GHR'].includes(company) || typeof protocol?.readSnapshot!=='function'
    || [authenticate,readCurrentContext,readRates,createPurchaseMarginRefresh,readCustomerShortNames,projectPurchaseOrders,
      applyPurchaseProgress,readOutstanding,now].some(fn=>typeof fn!=='function')) throw Error('Original current Purchase workspace dependencies required');
  const [orders,tasks]=domainCollections(company),journal=company==='NCT'?'R2NCTActivity':'R2NCTActivity1';
  return async selectedCompany=>{
    if (selectedCompany!==company)throw Error('Purchase workspace company conflict');
    const staff=await authenticate(company);
    if (!staff?.staffId||!staff.memberId)throw Error('Original Purchase workspace authorization required');
    const snapshot=await protocol.readSnapshot(async control=>{
      if (control?.company!==company||control.mode!=='ACTIVE'||control.schemaVersion!==1||control.pending
        || !control.writerBuild||control.transferIndexVersion!==2||!Number.isSafeInteger(control.generation)||control.generation<0) throw Error('Verified current Purchase workspace required');
      const data=await readCurrentContext(company,staff,control),workspace=data?.workspace,tables=data?.tables;
      if (workspace?.company!==company||workspace.stockAllocationView!=='CURRENT_V2'||workspace.staff?.staffId!==staff.staffId
        || workspace.staff?.memberId!==staff.memberId||!Array.isArray(workspace.tasks)||new Set(workspace.tasks.map(row=>row.id)).size!==workspace.tasks.length
        || !tables||[orders,tasks,journal,'R2PurchaseOrders'].some(collection=>!Array.isArray(tables[collection]))) throw Error('Original complete current Purchase workspace required');
      const currencies=await collectMarginCurrencies({company,tables,workspace,createPurchaseMarginRefresh,now});
      let rates;
      const currentRates=()=>rates||(rates=Promise.resolve().then(()=>readRates(currencies)));
      const margins=new Map();let refreshTaskId=null;
      for (const target of workspace.tasks.filter(row=>!row.procurementSource)) {
        const group=workspace.tasks.filter(row=>row.id===target.id||row.customerDemandTaskId===target.id);
        const allowed=new Set([target.id,...group.map(row=>'SOURCE:'+row.id)]);
        const prepared=await prepareMarginReferenceGroup({company,targetTaskId:target.id,workspace,
          tables:Object.fromEntries([orders,tasks,journal].map(collection=>[collection,tables[collection]])),
          createPurchaseMarginRefresh,readRates:currentRates,now});
        if (prepared.results.some(row=>!allowed.has(row[0])||row[1]!==null&&(typeof row[1]!=='number'||!Number.isFinite(row[1])))) throw Error('Known original Purchase margins required');
        if (prepared.mustCommit) {refreshTaskId=target.id;break;}
        for (const [id,gp] of prepared.results) {
          if(margins.has(id))throw Error('Ambiguous original Purchase margin group');margins.set(id,gp);
        }
      }
      let customerNamesError='',names=[];
      try {names=await readCustomerShortNames(workspace.customers.map(row=>row.id));}
      catch (_) {customerNamesError='客户 Short Name 暂时无法读取，请核对客户资料。';}
      if(!Array.isArray(names))throw Error('Original customer short names required');
      const arrangements=projectArrangementLinks(company,readArrangements(company,tables[journal]),tables[journal]);
      const result={...copy(workspace),customerNamesError,
        customers:workspace.customers.map(row=>({...copy(row),shortName:names.find(item=>item.customerId===row.id)?.shortName||''})),
        tasks:workspace.tasks.map(row=>({...copy(row),stockArrangements:arrangements.filter(a=>a.taskId===row.id),gp:refreshTaskId?null:margins.get(row.id)??null,sourceGp:refreshTaskId?null:margins.get('SOURCE:'+row.id)??null}))};
      const purchaseOrders=projectPurchaseOrders({company,workspace:result,records:tables.R2PurchaseOrders});
      applyPurchaseProgress(result,tables[journal],purchaseOrders);
      // Original archived/stage decisions above remain untouched; relation loading
      // is independent and may still put halos on either archived participant.
      const completed=await createPurchaseTransferWorkspace({company,protocol,authenticate:async()=>staff,
        readWorkspace:async()=>result,readOutstanding:(c,input)=>readOutstanding(c,input,staff)})(company);
      if(refreshTaskId)return {schema:'PURCHASE_MARGIN_REFRESH_REQUIRED_V1',company,taskId:refreshTaskId,
        staff:{staffId:staff.staffId,memberId:staff.memberId,staffName:staff.staffName},stockCurrent:completed.stockCurrent,
        // Not renderable/actionable. Only ORIGINAL draft reconciliation may use
        // these current public fields after its exact completed save receipt.
        reconciliationWorkspace:{...completed,stockReconciliationOnly:true}};
      return completed;
    });
    return snapshot.rows;
  };
}
module.exports={createCurrentPurchaseWorkspaceRead};

},
// purchase-borrow-options.cjs sha256:441924522a2e30c49a0ff3d4f26a32441f88581f79a65fbae8cc198bb60b6180
"purchase-borrow-options.cjs": (load, module) => {
'use strict';
const { originalProductState } = load("original-product-state.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { approveBorrow, validate } = load("borrowing-model.cjs");
// Pure quote, not approval. Reuse the actual approval rules rather than a second
// UI definition of free stock/future capacity. No event/plan/storage mutation.
function quoteBorrowOptions({ state, borrowerTaskId, blockedTaskIds = [], maxPairs = 2000 }) {
  validate(state);
  if (!Number.isSafeInteger(maxPairs) || maxPairs < 1 || !Array.isArray(blockedTaskIds)) throw Error('Bounded borrowing quote scope required');
  const borrower = state.tasks.find(t => t.id === borrowerTaskId);
  if (!borrower) throw Error('Customer borrowing demand unavailable');
  const futures = state.sources.filter(s => s.ownerTaskId === borrowerTaskId && s.ownerShare > s.accepted);
  const donors = state.sources.filter(s => s.ownerTaskId && s.ownerTaskId !== borrowerTaskId && (s.claims[s.ownerTaskId] || 0) > 0);
  if (futures.length * donors.length > maxPairs) throw Error('Borrowing option fanout requires a narrower scope');
  let id = 'READ_ONLY_BORROW_QUOTE'; while (state.relations.some(r => r.id === id)) id += '_';
  const options = [];
  for (const future of futures) for (const donor of donors) {
    if (blockedTaskIds.includes(borrowerTaskId) || blockedTaskIds.includes(donor.ownerTaskId)) continue;
    const possible = quantity => {
      try {
        approveBorrow(state, { expectedRevision: state.revision, id, quantity, borrowerTaskId,
          lenderSourceId: donor.id, replacementSourceId: future.id, approvedBy: 'READ_ONLY_QUOTE', reason: 'Read-only eligibility check' });
        return true;
      } catch (error) {
        if (['Eligible unheld borrower required', 'Packing task holds lender allocation',
          'Insufficient eligible stock, demand or future supply'].includes(error.message)) return false;
        throw error;
      }
    };
    if (!possible(1)) continue;
    let low = 1, high = 9999;
    while (low < high) { const mid = Math.floor((low + high + 1) / 2); if (possible(mid)) low = mid; else high = mid - 1; }
    options.push({ borrowerTaskId, lenderTaskId: donor.ownerTaskId, lenderSourceId: donor.id,
      replacementSourceId: future.id, lenderPoId: donor.poId, replacementPoId: future.poId, maximumQuantity: low });
  }
  return { expectedRevision: state.revision, options };
}
// Private original Purchase gateway composition. The browser supplies a task ID,
// never a staff member, approved PO flag, quantity balance or replacement promise.
function createPurchaseBorrowOptions({ company, items, store, protocol, authorityDependencies: deps, maxPairs = 2000 }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2'
    || typeof protocol.readSnapshot !== 'function' || typeof items?.query !== 'function' || typeof store?.read !== 'function'
    || [deps?.readMember, deps?.readStaffRecords, deps?.requirePurchaseStaff, deps?.readContext, deps?.readPurchaseRecords,
      deps?.projectPurchaseOrders, deps?.readCurrentTaskRows].some(fn => typeof fn !== 'function')) throw Error('Private Purchase options dependencies required');
  return async (requestCompany, input = {}) => {
    if (requestCompany !== company || typeof input.borrowerTaskId !== 'string' || !input.borrowerTaskId || input.borrowerTaskId.length > 128) throw Error('Exact Purchase borrower task required');
    const member = await deps.readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') deps.requirePurchaseStaff(member, []);
    const staff = { ...deps.requirePurchaseStaff(member, await deps.readStaffRecords()), memberId: member._id };
    const snapshot = await protocol.readSnapshot(async control => {
      if (control.company !== company || control.mode !== 'ACTIVE' || control.pending || control.transferIndexVersion !== 2
        || !control.writerBuild) throw Error('Current borrowing options unavailable');
      const context = await deps.readContext(company, staff), borrower = context?.tasks?.find(t => t.id === input.borrowerTaskId && !t.procurementSource && !t.specialPurchase);
      if (!borrower) throw Error('Customer borrowing demand unavailable');
      const identity = { company, barcode: borrower.barcode, packing: borrower.packing, ea: borrower.ea };
      const orders = deps.projectPurchaseOrders({ company, workspace: context, records: await deps.readPurchaseRecords(company, staff) });
      const product = originalProductState({ ...deps, company, context, orders, identity });
      const rows = await readScopedCurrentProduct({ company, identity, items, store, transferIndexVersion: control.transferIndexVersion,
        sourceTaskIds: product.sources.filter(s => s.ownerTaskId === borrower.id && s.ownerShare > s.accepted).map(s => s.id), demandTaskIds: [borrower.id] });
      if (!rows.product) throw Error('Current borrowing product checkpoint missing');
      rows.taskRows = await deps.readCurrentTaskRows(company, product.scopeTaskIds(rows), staff); rows.generation = control.generation;
      const quoted = quoteBorrowOptions({ state: product.buildState(rows), borrowerTaskId: borrower.id, maxPairs,
        blockedTaskIds: context.tasks.filter(t => t.salesInvoiceLocked || t.salesInvoiceNumber).map(t => t.id) });
      const labels = new Map(context.tasks.map(t => [t.id, t]));
      return { schema: 'CURRENT_BORROW_OPTIONS_V2', company, borrowerTaskId: borrower.id, ...quoted,
        options: quoted.options.map(option => ({ ...option, lenderPoNumber: labels.get(option.lenderSourceId)?.po,
          replacementPoNumber: labels.get(option.replacementSourceId)?.po,
          lenderCustomerId: labels.get(option.lenderTaskId)?.customerId })),
        stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: control.writerBuild, stockGeneration: control.generation } };
    });
    return snapshot.rows;
  };
}
module.exports = { quoteBorrowOptions, createPurchaseBorrowOptions };

},
// current-purchase-borrow-gateway.cjs sha256:d956efbe40236c63c51ce635cd32f2051793a3c71ef3b0411073389280ffe1f7
"current-purchase-borrow-gateway.cjs": (load, module) => {
'use strict';
const { createPurchaseBorrowOptions } = load("purchase-borrow-options.cjs");
const { createCurrentBorrowingSave } = load("current-department-saves.cjs");
const { createPurchaseBorrowReturnOptions } = load("purchase-borrow-return-options.cjs");
// Private original Purchase gateway binding. Its server-owned dependencies retain
// actual Purchase permissions; this adapter is not a public permission grant.
function createCurrentPurchaseBorrowGateway(dependencies) {
  const { company } = dependencies;
  const options = createPurchaseBorrowOptions(dependencies), save = createCurrentBorrowingSave(dependencies);
  const returnOptions = createPurchaseBorrowReturnOptions(dependencies);
  function bounded(requestCompany, value) {
    if (requestCompany !== company || !value || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(value).length > 6000) throw Error('Bounded original Purchase borrowing request required');
  }
  return {
    readOptions: async (requestCompany, input) => {
      bounded(requestCompany, input);
      return { ok: true, ...await options(company, { borrowerTaskId: input.borrowerTaskId }) };
    },
    readReturnOptions: async (requestCompany, input) => {
      bounded(requestCompany, input);
      return { ok: true, ...await returnOptions(company, { relationId: input.relationId }) };
    },
    save: async (requestCompany, request) => {
      bounded(requestCompany, request);
      if (request.company !== undefined && request.company !== company) throw Error('Purchase borrowing company conflict');
      const kind = request.operation === 'BORROW_APPROVE' ? 'APPROVE' : request.operation === 'BORROW_RETURN' ? 'RETURN' : null;
      if (!kind) throw Error('Supported original Purchase borrowing action required');
      return save({ requestId: request.requestId, kind, input: request.input, stockProtocol: request.stockProtocol,
        stockBuild: request.stockBuild, stockGeneration: request.stockGeneration, stockIdentity: request.stockIdentity });
    }
  };
}
module.exports = { createCurrentPurchaseBorrowGateway };

},
// purchase-borrow-return-options.cjs sha256:1b788b1cd91a1b6dc00d2e5c9d5bd83b3e9f22434c7b390ee788b8d4280026a6
"purchase-borrow-return-options.cjs": (load, module) => {
'use strict';
const { createBorrowingAuthority } = load("borrowing-authority.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { returnUnusedBorrow, validate } = load("borrowing-model.cjs");
// A remaining debt is NOT proof that its physical cartons can be returned. Quote
// the actual unchanged return rules using current claims/holds/dispatch counters.
function quoteUnusedBorrowReturn({ state, relationId }) {
  validate(state);
  const relation = state.relations.find(r => r.id === relationId);
  if (!relation) throw Error('Current borrowing relationship unavailable');
  const remaining = relation.quantity - relation.repaid - (relation.returned || 0);
  const possible = quantity => {
    try { returnUnusedBorrow(state, { expectedRevision: state.revision, relationId, quantity,
      approvedBy: 'READ_ONLY_QUOTE', reason: 'Read-only unused return eligibility' }); return true; }
    catch (error) {
      if (['Approved unused borrowing return required', 'Borrowed stock already used or held'].includes(error.message)) return false;
      throw error;
    }
  };
  let low = 0, high = Math.min(remaining, 9999);
  while (low < high) { const mid = Math.floor((low + high + 1) / 2); if (possible(mid)) low = mid; else high = mid - 1; }
  return { relationId, borrowerTaskId: relation.borrowerTaskId, lenderTaskId: relation.lenderTaskId,
    lenderSourceId: relation.lenderSourceId, replacementSourceId: relation.replacementSourceId,
    remaining, maximumQuantity: low, expectedRevision: state.revision };
}
function createPurchaseBorrowReturnOptions({ company, items, store, protocol, authorityDependencies: deps }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2'
    || typeof protocol.readSnapshot !== 'function' || typeof items?.query !== 'function' || typeof store?.read !== 'function') {
    throw Error('Private Purchase unused return dependencies required');
  }
  const authority = createBorrowingAuthority(deps);
  return async (requestCompany, input = {}) => {
    if (requestCompany !== company || typeof input.relationId !== 'string' || !input.relationId || input.relationId.length > 128) {
      throw Error('Exact current borrowing relationship required');
    }
    const member = await deps.readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') deps.requirePurchaseStaff(member, []);
    deps.requirePurchaseStaff(member, await deps.readStaffRecords());
    const snapshot = await protocol.readSnapshot(async control => {
      if (control.company !== company || control.mode !== 'ACTIVE' || control.pending || control.transferIndexVersion !== 2
        || !control.writerBuild) throw Error('Current unused return quote unavailable');
      // In-memory ORIGINAL authority/event only, INSIDE the barrier. No write,
      // journal lock or real request. Actual save reauthorizes and revalidates.
      const current = await authority({ company, requestId: '00000000-0000-4000-8000-000000000000', kind: 'RETURN',
        input: { relationId: input.relationId, expectedRevision: 0, quantity: 1, reason: 'Read-only unused return eligibility' } });
      if (typeof current.readTaskRows !== 'function') throw Error('Private current return task reader required');
      const rows = await readScopedCurrentProduct({ ...current.stockScope, company, identity: current.identity,
        items, store, transferIndexVersion: control.transferIndexVersion });
      if (!rows.product) throw Error('Current borrowing product checkpoint missing');
      rows.taskRows = await current.readTaskRows(rows); rows.generation = control.generation;
      return { schema: 'CURRENT_BORROW_RETURN_OPTIONS_V2', company,
        ...quoteUnusedBorrowReturn({ state: current.buildState(rows), relationId: input.relationId }),
        stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: control.writerBuild, stockGeneration: control.generation } };
    });
    return snapshot.rows;
  };
}
module.exports = { quoteUnusedBorrowReturn, createPurchaseBorrowReturnOptions };

},
// current-packing-service.cjs sha256:10f35293b9dbed7b89699dfdaff6cece365234b9f6af11e4b05a20f4f4c7ff64
"current-packing-service.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { createPackingStockPreparation } = load("packing-stock-preparation.cjs");
const { hash } = load("commit-proof.cjs");
const { WRITERS } = load("stock-admission.cjs");
// Private existing packing gateways only. PHOTOS requires its paired immutable
// file protocol; neither this service nor evidence posts invoice/physical dispatch.
function createCurrentPackingService({ company, items, store, protocol, coverage, authorityDependencies: deps }) {
  if (protocol?.planFormat !== 'SEGMENTED_V2' || !['NCT', 'GHR'].includes(company)
    || typeof deps?.projectPackingWorkroom !== 'function') throw Error('Current packing v2 scope/original public projector required');
  const guardedProtocol={...protocol,readSnapshot:read=>protocol.readSnapshot(control=>{
    if(!control.writerBuild||WRITERS.some(writer=>coverage?.[writer]?.verified!==true||coverage[writer].build!==control.writerBuild))throw Error('Inventory writer coverage incomplete; packing activation blocked');
    return read(control);
  })};
  const prepare = createPackingStockPreparation({ ...deps, company, items, store, protocol:guardedProtocol });
  function department(value) { if (!['SUPPORT', 'WAREHOUSE'].includes(value)) throw Error('Original packing department required'); return value; }
  return {
    read: async request => {
      const result = await prepare.read({ company, department: department(request?.department) });
      const view = deps.projectPackingWorkroom(result.context, request.department);
      if (result.context.stockDamageVersion === 1) view.lists = view.lists.map(list => ({ ...list, lines: list.lines.map(line => {
        const task = result.context.tasks.find(task => task.taskId === line.taskId);
        if (!task) return line; // Unrelated original archived history stays read-only.
        const otherHeld = result.context.lists.filter(other => other.id !== list.id).reduce((n, other) => n + deps.packingHeld(other, line.taskId), 0);
        return { ...line, stockDamageIsolation: task.stockDamageIsolation || 0,
          stockUsableForList: Math.max(0, Math.min(task.remaining, task.ready) - otherHeld) };
      }) }));
      return { ...view, staff:result.staff, department:request.department, stockCurrent: result.stockCurrent };
    },
    save: async request => {
      const originalDepartment = department(request?.department);
      let actor;
      const authenticate=async()=>{
          const member = await deps.readMember();
          if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') deps.requirePackingStaff(member, [], originalDepartment);
          const employee={...deps.requirePackingStaff(member,await deps.readStaffRecords(),originalDepartment),memberId:member._id};
          if(actor&&(employee.staffId!==actor.staffId||employee.memberId!==actor.memberId))throw Error('Original packing photo employee changed');
          actor=employee;
          return actor;
      };
      let saveProtocol=guardedProtocol;
      if(request.input?.action==='PHOTOS'){
        if(originalDepartment!=='WAREHOUSE'||typeof deps.createPhotoProtocol!=='function'||typeof deps.allocatePhotoSlots!=='function')throw Error('Current non-photo packing required until paired file protocol supplied');
        await authenticate();saveProtocol=deps.createPhotoProtocol({request,staff:actor});
        if(saveProtocol?.planFormat!=='SEGMENTED_V2'||typeof saveProtocol.commit!=='function'||typeof saveProtocol.readSnapshot!=='function')throw Error('Bounded original packing photo protocol required');
      }
      const result = await createCurrentStockSave({ company, writer: 'PACKING', protocol:saveProtocol, coverage,
        authenticate, prepare: async command => {
          const prepared=await prepare.prepare({ company, department: originalDepartment, requestId: command.requestId,
            staffId: command.staffId, memberId: command.memberId, input: command.input.details });
          if(prepared.staff.staffId!==actor.staffId||prepared.staff.memberId!==actor.memberId||prepared.staff.packingDepartment!==originalDepartment)throw Error('Original packing employee changed during preparation');
          return prepared;
        } })({
        requestId: request.requestId, stockProtocol: request.stockProtocol, stockBuild: request.stockBuild, stockGeneration: request.stockGeneration,
        ...(request.stockIdentity!==undefined?{stockIdentity:request.stockIdentity}:{}),input: { department: originalDepartment, details: request.input } });
      if (result.ok !== true) return result;
      const id = request.input.action === 'CREATE' ? hash(company, request.requestId, actor.memberId, 'PACKING') : request.input.id;
      await protocol.readSnapshot(async () => {
        const row = await store.read(company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', hash(company, id, 'PACKING_CURRENT'));
        if (!row || row.company !== company || row.action !== 'SUPPORT_PACKING_LIST_CURRENT' || !row._version
          || row.description !== id || row.details?.list?.id !== id) throw Error('Committed packing identity unconfirmed');
        deps.readPackingLists([row], company);
      });
      // Stable list ID needed by the original UI's refresh. Do not label a later
      // mutable list revision/status as the result of this earlier committed save.
      return { ...result, company, id };
    }
  };
}
module.exports = { createCurrentPackingService };

},
// packing-stock-preparation.cjs sha256:4128280d97eabbb706e4dad6e6c34d1c07219b52e795d38203e8099f81ab93e4
"packing-stock-preparation.cjs": (load, module) => {
'use strict';

const { stockKey } = load("current-model.cjs");
const { originalProductState } = load("original-product-state.cjs");
const { readCurrentProduct } = load("current-product-reader.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { currentPackingContext } = load("current-packing-context.cjs");
const { validateOriginalPacking } = load("original-packing-validation.cjs");
const { preparePackingStock } = load("packing-stock-plan.cjs");
const {captureOriginalPackingPhotoPlan}=load("packing-photo-plan.cjs");
const {prependPackingPhotoReceipts}=load("packing-photo-fenced-store.cjs");
const {hash}=load("commit-proof.cjs");
const {readArrangements,projectArrangementLinks,linkArrangement,identity:arrangementIdentity}=load("purchase-arrangement.cjs");
// Private candidate for the existing authenticated read/save gateways. Every read
// shares the company control barrier. No legacy apply or file upload in prepare.
function createPackingStockPreparation(deps) {
  const { company, readMember, readStaffRecords, requirePackingStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, projectPackingContext, createPackingListOperations, readAllocations, readCustomerShipments,
    readPackingLists, packingHeld, readPreparation, projectPreparation, items, store, protocol, now } = deps;
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requirePackingStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, projectPackingContext, createPackingListOperations, readAllocations, readCustomerShipments,
    readPackingLists, packingHeld, now].some(f => typeof f !== 'function') || typeof items?.query !== 'function'
    || typeof store?.read !== 'function' || typeof protocol?.readSnapshot !== 'function') throw Error('Server packing stock dependencies required');
  const current = protocol.planFormat === 'SEGMENTED_V2';
  if (current && typeof deps.readCurrentTaskRows !== 'function') throw Error('Private packing current task reader required');
  async function load(request, save) {
    const photos=save&&request?.input?.action==='PHOTOS';
    if (request?.company !== company || !['SUPPORT', 'WAREHOUSE'].includes(request.department)
      || photos&&(!current||request.department!=='WAREHOUSE'||typeof deps.allocatePhotoSlots!=='function')) throw Error('Supported company/non-photo packing request required until paired file protocol supplied');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePackingStaff(member, [], request.department);
    const staff = requirePackingStaff(member, await readStaffRecords(), request.department), metrics = { queries: 0, exactReads: 0 };
    // Private admission fields from current save, never browser input. Refuse
    // before context reads and photo ID allocation; retain the later check too.
    if (save && (request.staffId !== undefined && request.staffId !== staff.staffId
      || request.memberId !== undefined && request.memberId !== member._id)) throw Error('Original packing employee changed during preparation');
    const snapshot = await protocol.readSnapshot(async control => {
      if (current && (control?.company !== company || control.mode !== 'ACTIVE' || control.pending
        || control.transferIndexVersion !== 2 || !control.writerBuild)) throw Error('Current packing checkpoint/index unavailable');
      const original = await readContext(company, staff);
      if (original?.company !== company || !Array.isArray(original.tasks) || !Array.isArray(original.activity)) throw Error('Original packing company context required');
      const packing = projectPackingContext(original), identities = new Map();
      for (const task of packing.tasks) {
        const source = original.tasks.filter(t => t.id === task.taskId);
        if (source.length !== 1) throw Error('Exact original packing task required');
        const identity = { company, barcode: source[0].barcode, packing: source[0].packing, ea: source[0].ea };
        identities.set(stockKey(identity), identity);
      }
      const orders = projectPurchaseOrders({ company, workspace: original, records: await readPurchaseRecords(company, staff) }), products = [];
      for (const identity of identities.values()) {
        const builder = originalProductState({ company, context: original, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
        const demandTaskIds = packing.tasks.filter(task => {
          const originalTask = original.tasks.find(t => t.id === task.taskId);
          return stockKey({ ...originalTask, company }) === stockKey(identity);
        }).map(task => task.taskId);
        const rows = current ? await readScopedCurrentProduct({ company, identity, items, store, metrics,
          transferIndexVersion: control.transferIndexVersion, demandTaskIds }) : await readCurrentProduct({ company, identity, items, store, metrics });
        if (current) {
          if (!rows.product) throw Error('Current packing product checkpoint missing');
          rows.taskRows = await deps.readCurrentTaskRows(company, builder.scopeTaskIds(rows), staff); rows.generation = control.generation;
        }
        products.push({ state: builder.buildState(rows), rows });
      }
      const context = currentPackingContext({ context: packing, states: products.map(p => p.state) });
      if(current){const instructions=projectArrangementLinks(company,readArrangements(company,original.activity),original.activity);
        context.tasks=context.tasks.map(task=>({...task,purchaseArrangements:instructions.filter(i=>i.taskId===task.taskId)}));}
      if (context.stockDamageVersion === 1 && deps.currentDamageVersion !== 1) throw Error('Paired original isolated packing model required');
      if (!save) return { context, ...(current ? { stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1,
        stockBuild: control.writerBuild, stockGeneration: control.generation } } : {}) };
      let validated;
      if(photos){
        const at=now(),args={company,staff,requestId:request.requestId,input:request.input,context,createPackingListOperations,now:()=>new Date(at)};
        // Original file/state/history validators BEFORE generated IDs. ALLOCATE
        // creates no file; after manifest publication this capture never reruns.
        await captureOriginalPackingPhotoPlan({...args,slots:(request.input.photos||[]).map((_,index)=>'pending-packing-'+hash(company,request.requestId,staff.memberId,index))});
        validated=await captureOriginalPackingPhotoPlan({...args,slots:await deps.allocatePhotoSlots(request.input.photos.length)});
      }else validated = await validateOriginalPacking({ createPackingListOperations, company, staff, requestId: request.requestId, input: request.input, context, now });
      const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
      metrics.exactReads++;
      const currentRecord = await store.read(journal, validated.record._id), prior = context.lists.find(l => l.id === validated.record.description);
      if (JSON.stringify(currentRecord?.details?.list || null) !== JSON.stringify(prior || null)) throw Error('Packing current record changed');
      // Reuse original stored-list validation, including evidence/bounds, before mapping.
      readPackingLists([{ ...validated.record, company }], company);
      let arrangementPlan;
      if(request.input.purchaseArrangement!==undefined){
        if(!current||request.department!=='SUPPORT'||request.input.action!=='CREATE')throw Error('Purchase instruction requires original Support create');
        const reference=request.input.purchaseArrangement;
        if(!reference||typeof reference.taskId!=='string'||typeof reference.batchId!=='string')throw Error('Exact Purchase instruction reference required');
        const before=await store.read(journal,arrangementIdentity(company,reference.taskId,reference.batchId));
        arrangementPlan=linkArrangement({company,before,reference,list:validated.record.details.list,
          staff:{...staff,memberId:member._id},requestId:request.requestId,at:validated.record.activityTime});
      }
      const lines = new Set([...(prior?.lines || []), ...(prior?.change?.lines || []), ...validated.record.details.list.lines,
        ...(validated.record.details.list.change?.lines || [])].map(l => l.taskId));
      return { validated, currentRecord, arrangementPlan, products: products.filter(p => p.state.tasks.some(t => lines.has(t.id))) };
    });
    const originalStaff={memberId:staff.memberId,staffId:staff.staffId,staffName:staff.staffName,packingDepartment:staff.packingDepartment};
    if (!save) return { ...snapshot.rows, staff:originalStaff, memberId: staff.memberId, generation: snapshot.generation, metrics };
    const mapped=preparePackingStock({ company, ...snapshot.rows, validated:photos?{...snapshot.rows.validated,uploads:[]}:snapshot.rows.validated,generation: snapshot.generation, packingHeld,
      planFormat: current ? 'SEGMENTED_V2' : 'PROOF_V1' });
    if(snapshot.rows.arrangementPlan)mapped.plan.writes.push(...snapshot.rows.arrangementPlan.writes);
    if(photos)mapped.plan=prependPackingPhotoReceipts({company,staff,requestId:request.requestId,input:request.input,prepared:snapshot.rows.validated,plan:mapped.plan});
    return { ...mapped,
      staff:originalStaff, memberId: staff.memberId, generation: snapshot.generation, metrics };
  }
  return { read: request => load(request, false), prepare: request => load(request, true) };
}
module.exports = { createPackingStockPreparation };

},
// current-packing-context.cjs sha256:f4beea8dc1fdd53c4b85b36ee253cb79772ed1a74eb4a57ee1acc37fe07f6673
"current-packing-context.cjs": (load, module) => {
'use strict';

const { validate } = load("borrowing-model.cjs");
const { hash } = load("commit-proof.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
// Original packing context keeps its identity, legacy guards, chats and language.
// Only quantity authority switches to complete server current-state snapshots.
function currentPackingContext({ context, states }) {
  if (!['NCT', 'GHR'].includes(context?.company) || !context.sourceVersion || !Array.isArray(context.tasks)
    || !Array.isArray(context.lists) || !Array.isArray(states)) throw Error('Original server packing context required');
  const tasks = new Map();
  for (const state of states) {
    validate(state);
    if (state.company !== context.company) throw Error('Packing current company conflict');
    for (const task of state.tasks) {
      if (tasks.has(task.id)) throw Error('Packing current task is ambiguous');
      tasks.set(task.id, { task, ready: state.sources.reduce((n, s) => n + (s.claims[task.id] || 0), 0),
        isolated: state.sources.reduce((n, s) => n + (s.isolatedClaims?.[task.id] || 0), 0) });
    }
  }
  if (new Set(context.tasks.map(t => t.taskId)).size !== context.tasks.length) throw Error('Original packing task is ambiguous');
  const result = copy(context);
  if ([...tasks.values()].some(row => row.isolated > 0) || context.lists.some(list => list.stockDamageReviewRequired === true)) result.stockDamageVersion = 1;
  result.tasks = context.tasks.map(row => {
    const current = tasks.get(row.taskId);
    if (!current || row.company !== context.company || current.task.customerId !== row.customerId
      || row.remaining !== current.task.requested - current.task.dispatched) throw Error('Exact packing demand provenance required');
    return { ...copy(row), ready: current.ready, remaining: current.task.requested - current.task.dispatched,
      ...(current.isolated > 0 ? { stockDamageIsolation: current.isolated } : {}) };
  });
  result.sourceVersion = hash(context.sourceVersion, states.map(s => [s.barcode, s.packing, s.ea, s.revision, s.packingHolds.version])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  return result;
}
module.exports = { currentPackingContext };

},
// original-packing-validation.cjs sha256:fae30516f52a8ca4c4f8fff5a0050a3289a2cd3ccf4ee236f836008b1a6330f3
"original-packing-validation.cjs": (load, module) => {
'use strict';

const copy = value => JSON.parse(JSON.stringify(value));
// Private original prepare capture only. PHOTOS deliberately excluded: its
// existing external allocation/upload identity protocol must not be replaced.
async function validateOriginalPacking({ createPackingListOperations, company, staff, requestId, input, context, now }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.lists)
    || typeof createPackingListOperations !== 'function' || typeof now !== 'function' || !input || input.action === 'PHOTOS') throw Error('Original non-photo packing snapshot required');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', scratch = new Map(), boundary = new Error('Private packing preparation boundary');
  let captured, reads = 0;
  const scope = c => { if (c !== journal) throw Error('Packing snapshot scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.record?.action !== 'SUPPORT_PACKING_LIST_CURRENT'
          || row.details.plan.uploads?.length) throw Error('Unexpected packing preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Packing apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private packing lock removal allowed'); scratch.delete(id);
    }
  };
  const save = createPackingListOperations({ store, now, names: { [company]: { activity: journal } }, readContext: async (c, employee) => {
    if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected packing apply/read'); return copy(context);
  } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original packing boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original packing preparation incomplete');
  return captured;
}
module.exports = { validateOriginalPacking };

},
// packing-stock-plan.cjs sha256:3d3ff92abc87da4ea0303903f47bcddcf7bf703a7b8f41ecdb2d53204fc5e6f4
"packing-stock-plan.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const { stockKey } = load("current-model.cjs");
const { preparePackingHoldTransition } = load("borrowing-stock-plan.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const { utf8Bytes } = load("segmented-plan.cjs");
// Original prepare and original list parser must run FIRST on current Packing context.
// No photo/file operations here; PHOTOS needs its own preserved external retry protocol.
function preparePackingStock({ company, validated, currentRecord, products, generation, packingHeld, planFormat = 'PROOF_V1' }) {
  if (!['PROOF_V1', 'SEGMENTED_V2'].includes(planFormat) || planFormat === 'SEGMENTED_V2'
    && products?.some(p => p.rows?.planFormat !== planFormat || p.rows?.scope !== 'CURRENT_ACTIVE_PRODUCT')) throw Error('Server scoped packing format required');
  const record = validated?.record, prior = currentRecord?.details?.list, next = record?.details?.list;
  if (!['NCT', 'GHR'].includes(company) || typeof packingHeld !== 'function' || validated?.uploads?.length || !next?.id || next.company !== company
    || record.action !== 'SUPPORT_PACKING_LIST_CURRENT' || record.result !== 'SAVED'
    || record._id !== hash(company, next.id, 'PACKING_CURRENT') || record.description !== next.id
    || !record.initiatedByStaffId || !Array.isArray(next.lines) || !next.lines.length || !Array.isArray(products) || !products.length
    || (prior?.revision || '') !== validated.beforeRevision
    || currentRecord && (currentRecord.company !== company || !currentRecord._version || currentRecord._id !== record._id)
    || next.invoiceId || next.dispatchedAt) throw Error('Original exact non-invoice packing transition required');
  const lines = new Set([...(prior?.lines || []), ...(prior?.change?.lines || []), ...next.lines, ...(next.change?.lines || [])].map(l => l.taskId));
  const coverage = new Map([...lines].map(id => [id, 0])), keys = new Set(), states = [], writes = [];
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', event = { ...copy(record), company };
  writes.push({ collection: journal, before: copy(currentRecord || null), after: event });
  for (const product of products) {
    const key = stockKey(product.state), covered = [...lines].filter(id => product.state.tasks.some(t => t.id === id));
    if (product.state.company !== company || keys.has(key) || !covered.length) throw Error('Distinct complete packing product coverage required');
    keys.add(key); for (const id of covered) coverage.set(id, coverage.get(id) + 1);
    const packingHolds = copy(product.state.packingHolds);
    packingHolds.version = hash(packingHolds.version, record._id, prior?.revision || '', next.revision);
    for (const task of product.state.tasks) {
      const oldListHeld = prior ? packingHeld(prior, task.id) : 0, newListHeld = packingHeld(next, task.id);
      if (![oldListHeld, newListHeld].every(n => Number.isSafeInteger(n) && n >= 0)
        || packingHolds.heldByTask[task.id] < oldListHeld) throw Error('Original packing hold provenance conflict');
      packingHolds.heldByTask[task.id] += newListHeld - oldListHeld;
    }
    const mapped = preparePackingHoldTransition({ ...product, event, generation, packingHolds });
    const duplicate = mapped.plan.writes.find(w => w.collection === journal && w.after._id === record._id);
    if (!duplicate || !same(duplicate.after, event)) throw Error('Original packing record mismatch');
    writes.push(...mapped.plan.writes.filter(w => w !== duplicate)); states.push(mapped.state);
  }
  if ([...coverage.values()].some(n => n !== 1) || new Set(writes.map(w => w.collection + ':' + w.after._id)).size !== writes.length
    || writes.length > (planFormat === 'SEGMENTED_V2' ? 10000 : 30) || utf8Bytes(JSON.stringify({ writes })) > (planFormat === 'SEGMENTED_V2' ? 8 * 1024 * 1024 : 180000)) throw Error('Atomic packing coverage limit');
  return { plan: { writes }, states };
}
module.exports = { preparePackingStock };

},
// current-sales-save.cjs sha256:b56de22ce7a02d59ad2e6bd60ad37c4372c10b97629bc434b41496c7a783055b
"current-sales-save.cjs": (load, module) => {
'use strict';

const { createCurrentStockSave } = load("current-stock-save.cjs");
const { readCurrentSalesWorkspace } = load("sales-current-workspace.cjs");
const { stockKey } = load("current-model.cjs");
const { validateOriginalSales } = load("original-sales-validation.cjs");
const { prepareSalesDemand } = load("borrowing-stock-plan.cjs");
const { requireOriginalSalesDelegation } = load("sales-delegation.cjs");
const {hash}=load("commit-proof.cjs");
// PRIVATE composition after original customerFulfilmentGateway authentication.
// Never expose this as a SiteMember method taking browser staff/customer claims.
function createCurrentSalesDemandSave({ company, items, store, protocol, coverage, authenticateOriginalDelegation,
  readContext, readCurrentTaskRows, readPurchaseRecords, projectPurchaseOrders,
  createSalesOrderAdjustmentOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld,
  readPreparation, projectPreparation, readPlans, planVersion, now = () => new Date() }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2'
    || typeof items?.query !== 'function' || typeof store?.read !== 'function') throw Error('Private current Sales dependencies required');
  for (const fn of [authenticateOriginalDelegation, readContext, readCurrentTaskRows, readPurchaseRecords, projectPurchaseOrders,
    createSalesOrderAdjustmentOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPlans, planVersion, now]) {
    if (typeof fn !== 'function') throw Error('Original Sales authority dependency required');
  }
  return async request => {
    // Per-call capture: parallel delegated requests must never share an actor.
    let staff;
    const save = createCurrentStockSave({ company, writer: 'SALES_DEMAND', protocol, coverage,
      authenticate: async () => {
        staff = await authenticateOriginalDelegation(company, request);
        requireOriginalSalesDelegation(staff, request?.input?.customerId);
        if (request.input.action !== 'ADJUST') throw Error('Original authenticated Sales customer delegation required');
        return { memberId: staff.memberId,staffId:staff.staffId };
      }, prepare: async command => {
        if (command.memberId !== staff.memberId) throw Error('Sales delegated actor changed');
        const metrics = { exactReads: 0, queries: 0 };
        const snapshot = await protocol.readSnapshot(async control => {
          const context = await readContext(company, staff);
          if (context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
            || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Original Sales company context required');
          const task = context.tasks.find(t => t.id === command.input.taskId && t.customerId === staff.customerId
            && t.orderId === command.input.orderId && !t.procurementSource && !t.specialPurchase && !t.archived);
          if (!task) throw Error('Select an active customer order line.');
          const current = await readCurrentSalesWorkspace({ company, context, staff, control, items, store, metrics,
            readCurrentTaskRows, readPurchaseRecords, projectPurchaseOrders, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
          const product = current.products.get(stockKey({ ...task, company }));
          if (!product) throw Error('Current Sales task product missing');
          const { state, rows } = product;
          const validated = await validateOriginalSales({ company, staff, requestId: command.requestId, input: command.input,
            context: current.context, createSalesOrderAdjustmentOperations, readPlans, planVersion, now });
          return { state, rows, validated };
        });
        const { state, rows, validated } = snapshot.rows;
        return { ...prepareSalesDemand({ state, rows, event: validated.event, generation: snapshot.generation }),
          memberId: staff.memberId, generation: snapshot.generation, metrics };
      } });
    const result=await save(request);if(result.ok!==true)return result;
    const id=hash(company,request.requestId,staff.memberId,'SALES_ORDER_ADJUSTMENT');
    const snapshot=await protocol.readSnapshot(()=>store.read(company==='NCT'?'R2NCTActivity':'R2NCTActivity1',id)),event=snapshot.rows;
    if(!event?._version||event.company!==company||event._id!==id||event.title!==id||event.action!=='SALES_ORDER_ADJUSTMENT_SAVED'||event.result!=='SAVED'
      ||event.initiatedByStaffId!==staff.staffId||event.image!==staff.customerId||event.imageAltText!==request.input.taskId||event.details?.customerId!==staff.customerId
      ||event.details.orderId!==request.input.orderId||event.details.mode!==request.input.mode||!Number.isSafeInteger(event.details.requested)||event.details.requested<1)throw Error('Committed original Sales adjustment receipt unconfirmed');
    return{...result,company,taskId:event.imageAltText,requested:event.details.requested};
  };
}
module.exports = { createCurrentSalesDemandSave };

},
// sales-current-workspace.cjs sha256:e72b7dd3211f552edd2835aeb325dfc25fcca9a27e30247cfb227d9fb4b5182c
"sales-current-workspace.cjs": (load, module) => {
'use strict';

const { stockKey } = load("current-model.cjs");
const { originalProductState } = load("original-product-state.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { currentAllocationContext } = load("current-allocation-context.cjs");
const { copy } = load("segmented-plan.cjs");
// Same complete customer-product view for READ and ADJUST. Keeping the ORIGINAL
// global adjustmentVersion contract avoids inconsistent per-line save versions.
async function readCurrentSalesWorkspace({ company, context, staff, control, items, store, metrics = { queries: 0, exactReads: 0 },
  readCurrentTaskRows, readPurchaseRecords, projectPurchaseOrders, readAllocations, readCustomerShipments,
  readPackingLists, packingHeld, readPreparation, projectPreparation }) {
  if (context?.company !== company || control?.company !== company || control.pending || control.mode !== 'ACTIVE' || control.schemaVersion !== 1
    || !Number.isSafeInteger(control.generation) || control.generation < 0 || !control.writerBuild || control.transferIndexVersion !== 2
    || !staff?.customerId || !Array.isArray(context.tasks) || !Array.isArray(context.activity)) throw Error('Complete private Sales current context required');
  const groups = new Map();
  for (const task of context.tasks.filter(t => t.customerId === staff.customerId && !t.procurementSource && !t.specialPurchase && !t.archived)) {
    const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea }, key = stockKey(identity);
    if (!groups.has(key)) groups.set(key, { identity, taskIds: [] }); groups.get(key).taskIds.push(task.id);
  }
  const records = groups.size ? await readPurchaseRecords(company, staff) : [];
  const orders = groups.size ? projectPurchaseOrders({ company, workspace: context, records }) : [];
  const prior = readAllocations(context.activity), currentTasks = new Map(), currentSources = new Set(), allocations = [], products = new Map();
  for (const [key, group] of groups) {
    const product = originalProductState({ company, context, orders, identity: group.identity, readAllocations: () => prior,
      readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
    const own = product.sources.filter(s => group.taskIds.includes(s.ownerTaskId));
    const rows = await readScopedCurrentProduct({ company, identity: group.identity, items, store, metrics, transferIndexVersion: control.transferIndexVersion,
      sourceTaskIds: own.map(s => s.id), demandTaskIds: group.taskIds, claimPairs: own.map(s => ({ sourceTaskId: s.id, taskId: s.ownerTaskId })) });
    rows.taskRows = await readCurrentTaskRows(company, product.scopeTaskIds(rows), staff); rows.generation = control.generation;
    const state = product.buildState(rows), converted = currentAllocationContext({ state, context, readAllocations: () => prior });
    for (const task of state.tasks) {
      if (currentTasks.has(task.id)) throw Error('Ambiguous current Sales task product');
      currentTasks.set(task.id, converted.tasks.find(t => t.id === task.id));
    }
    for (const source of state.sources) {
      if (currentSources.has(source.id)) throw Error('Ambiguous current Sales source product');
      currentSources.add(source.id); allocations.push(converted.allocations.find(a => a.sourceTaskId === source.id));
    }
    products.set(key, { state, rows });
  }
  return { context: { ...copy(context), stockAllocationView: 'CURRENT_V2',
    tasks: context.tasks.map(task => copy(currentTasks.get(task.id) || task)),
    allocations: [...prior.filter(a => !currentSources.has(a.sourceTaskId)), ...allocations] }, products, metrics };
}
module.exports = { readCurrentSalesWorkspace };

},
// original-sales-validation.cjs sha256:8911582bfacea2781f4044da7db41282fd1ccecf29d314911af63dc16c9d1afa
"original-sales-validation.cjs": (load, module) => {
'use strict';

const copy = value => JSON.parse(JSON.stringify(value));
// Validation seam only: original customer-scoped staff must be supplied by the real
// Sales authority, never browser claims. No real journal store or mutation accepted.
async function validateOriginalSales({ createSalesOrderAdjustmentOperations, company, staff, requestId, input, context, readPlans, planVersion, now }) {
  if (typeof createSalesOrderAdjustmentOperations !== 'function' || !['NCT', 'GHR'].includes(company)
    || context?.company !== company || !Array.isArray(context.activity) || typeof readPlans !== 'function'
    || typeof planVersion !== 'function' || typeof now !== 'function') throw Error('Original Sales validation dependencies required');
  const collection = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const scratch = new Map(), boundary = new Error('Private Sales preparation boundary'); let captured, reads = 0;
  const scope = c => { if (c !== collection) throw Error('Unexpected Sales journal collection'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'SALES_ORDER_ADJUSTMENT_SAVED') throw Error('Unexpected Sales preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Legacy Sales apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => { scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private Sales lock may be removed'); scratch.delete(id); }
  };
  const save = createSalesOrderAdjustmentOperations({ store, names: { [company]: { activity: collection } }, readPlans, planVersion, now,
    readContext: async (c, employee) => { if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected Sales apply/read'); return copy(context); } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original Sales boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original Sales preparation incomplete');
  return captured;
}
module.exports = { validateOriginalSales };

},
// sales-delegation.cjs sha256:5b896c40c89ec8d5cef5b16fd681c01093018b98d112a84a807ae59bf8a925d2
"sales-delegation.cjs": (load, module) => {
'use strict';
// Shape/scope assertion only, NOT authentication. Original shared-secret gateway
// must create this staff object AFTER authorizing the source request.
function requireOriginalSalesDelegation(staff, customerId) {
  if (typeof staff?.staffId !== 'string' || !staff.staffId || staff.staffId.length > 100
    || staff.memberId !== 'SOURCE_SALES/' + staff.staffId || typeof staff.staffName !== 'string' || !staff.staffName || staff.staffName.length > 200
    || staff.canSelectShipment !== true || typeof staff.customerId !== 'string' || !staff.customerId || staff.customerId.length > 100
    || customerId !== staff.customerId) throw Error('Original authenticated Sales customer delegation required');
  return staff;
}
module.exports = { requireOriginalSalesDelegation };

},
// current-sales-read.cjs sha256:552b774be88911132c6b7da13a4f446325b2f7ec751a09e411404c7c27f64346
"current-sales-read.cjs": (load, module) => {
'use strict';

const { requireOriginalSalesDelegation } = load("sales-delegation.cjs");
const { readCurrentSalesWorkspace } = load("sales-current-workspace.cjs");
// PRIVATE original source gateway only. Original response filtering, account/
// document/currency calculations stay in the original service, not reimplemented.
function createCurrentSalesRead({ company, protocol, authenticateOriginalDelegation, readContext,
  readOriginalCustomerFulfilment, currentFulfilmentVersion, ...dependencies }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || currentFulfilmentVersion !== 2
    || typeof authenticateOriginalDelegation !== 'function' || typeof readContext !== 'function'
    || typeof readOriginalCustomerFulfilment !== 'function') throw Error('Verified private original Sales read dependencies required');
  return async requestCompany => {
    if (requestCompany !== company) throw Error('Sales current read company conflict');
    const staff = await authenticateOriginalDelegation(company, { action: 'READ' });
    requireOriginalSalesDelegation(staff, staff?.customerId);
    const snapshot = await protocol.readSnapshot(async control => {
      const context = await readContext(company, staff);
      const current = await readCurrentSalesWorkspace({ ...dependencies, company, context, staff, control });
      const result = await readOriginalCustomerFulfilment(company, staff, staff.customerId, current.context);
      if (result?.company !== company) throw Error('Original customer response company changed');
      return { ...result, stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1,
        stockBuild: control.writerBuild, stockGeneration: control.generation,stockIdentity:{staffId:staff.staffId,memberId:staff.memberId} } };
    });
    return snapshot.rows;
  };
}
module.exports = { createCurrentSalesRead };

},
// current-sales-shipment-save.cjs sha256:40dae7f13bedffcdf7f183f9b0fb838c9682668b197a974eb64a7df54d12e112
"current-sales-shipment-save.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { requireOriginalSalesDelegation } = load("sales-delegation.cjs");
const { readCurrentSalesWorkspace } = load("sales-current-workspace.cjs");
const { validateOriginalShipment } = load("original-shipment-validation.cjs");
const { prepareSalesShipmentHolds } = load("sales-shipment-hold-plan.cjs");
const { hash } = load("commit-proof.cjs");
// PRIVATE existing source bearer gateway only, not SiteMember identity input.
function createCurrentSalesShipmentSave({ company, items, store, protocol, coverage, authenticateOriginalDelegation,
  readContext, createCustomerFulfilmentOperations, currentAllocationVersion, now = () => new Date(), ...dependencies }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || currentAllocationVersion !== 2
    || typeof authenticateOriginalDelegation !== 'function' || typeof readContext !== 'function'
    || typeof createCustomerFulfilmentOperations !== 'function') throw Error('Private original current Sales shipment dependencies required');
  return async request => {
    let staff;
    const result = await createCurrentStockSave({ company, writer: 'SHIPMENT', protocol, coverage,
      authenticate: async () => {
        staff = await authenticateOriginalDelegation(company, request); requireOriginalSalesDelegation(staff, request?.input?.customerId);
        if (!['SELECT', 'CANCEL'].includes(request.input.action)) throw Error('Original non-invoice Sales shipment action required');
        return { memberId: staff.memberId,staffId:staff.staffId };
      }, prepare: async command => {
        const metrics = { queries: 0, exactReads: 0 };
        const snapshot = await protocol.readSnapshot(async control => {
          const original = await readContext(company, staff);
          const current = await readCurrentSalesWorkspace({ ...dependencies, company, items, store, staff, control, context: original, metrics });
          const validated = await validateOriginalShipment({ company, staff, requestId: command.requestId, input: command.input,
            context: current.context, createCustomerFulfilmentOperations, currentAllocationVersion, now });
          const shipment = validated.event.details.shipment;
          const ids = new Set(shipment.lines.map(line => line.taskId));
          const products = [...current.products.values()].filter(p => p.state.tasks.some(t => ids.has(t.id)));
          const priorShipment = command.input.action === 'CANCEL' ? dependencies.readCustomerShipments(current.context.activity).find(s => s.id === shipment.id) : null;
          return prepareSalesShipmentHolds({ company, event: validated.event, priorShipment, products, generation: control.generation });
        });
        return { ...snapshot.rows, memberId: staff.memberId, generation: snapshot.generation, metrics };
      } })(request);
    if (result.ok !== true) return result;
    const record = await protocol.readSnapshot(() => store.read(company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', hash(company, request.requestId, staff.memberId, 'SHIPMENT_EVENT')));
    const event = record.rows, shipment = event?.details?.shipment;
    if (!event?._version || event.company !== company || event.action !== 'CUSTOMER_SHIPMENT_CHANGED' || event.result !== 'SAVED'
      || event.initiatedByStaffId !== staff.staffId || shipment?.company !== company || shipment.customerId !== staff.customerId
      || shipment.status !== (request.input.action === 'SELECT' ? 'REQUESTED' : 'CANCELLED')) throw Error('Committed shipment receipt identity unconfirmed');
    return { ...result, company, shipmentId: shipment.id, status: shipment.status };
  };
}
module.exports = { createCurrentSalesShipmentSave };

},
// original-shipment-validation.cjs sha256:60b9d049a5346af921a9ac9612769c7b8ded103900635d986a1dddb3597f7f48
"original-shipment-validation.cjs": (load, module) => {
'use strict';
const copy = value => JSON.parse(JSON.stringify(value));
// Capture ORIGINAL preparation only. Does not invoice, dispatch, allocate files,
// call FX or perform a business write. Real invoice entry remains disabled.
async function validateOriginalShipment({ company, staff, requestId, input, context, createCustomerFulfilmentOperations,
  currentAllocationVersion, now }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.activity)
    || !['SELECT', 'CANCEL', 'DISPATCH'].includes(input?.action) || typeof createCustomerFulfilmentOperations !== 'function'
    || typeof now !== 'function' || context.stockAllocationView === 'CURRENT_V2' && currentAllocationVersion !== 2) throw Error('Original non-invoice shipment validation dependencies required');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const scratch = new Map(), boundary = new Error('Private original shipment prepare boundary'); let captured, reads = 0;
  const scope = c => { if (c !== journal) throw Error('Original shipment journal scope violation'); };
  const store = { read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'CUSTOMER_SHIPMENT_CHANGED') throw Error('Unexpected original shipment preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Legacy shipment apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => { scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private shipment lock release allowed'); scratch.delete(id); } };
  const save = createCustomerFulfilmentOperations({ store, names: { [company]: { activity: journal } }, now,
    readRates: async () => { throw Error('Real invoice/FX not authorized by current shipment validator'); },
    readContext: async (c, actor) => { if (c !== company || actor.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected shipment context/apply'); return copy(context); } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original shipment prepare boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  const event = captured?.event, shipment = event?.details?.shipment;
  const status = { SELECT: 'REQUESTED', CANCEL: 'CANCELLED', DISPATCH: 'DISPATCHED' }[input.action];
  if (!event || reads !== 1 || scratch.size || event._id !== event.title || event.result !== 'SAVED'
    || event.initiatedByStaffId !== staff.staffId || shipment?.company !== company || shipment.status !== status
    || event.description !== shipment.id || event.image !== shipment.customerId || staff.customerId && staff.customerId !== shipment.customerId) throw Error('Original shipment event identity conflict');
  return captured;
}
module.exports = { validateOriginalShipment };

},
// sales-shipment-hold-plan.cjs sha256:369609efdb72a7b404b72d94a77898cb5939e0d56fe387687d844f443c54d189
"sales-shipment-hold-plan.cjs": (load, module) => {
'use strict';
const { preparePackingHoldTransition } = load("borrowing-stock-plan.cjs");
const { copy, utf8Bytes } = load("segmented-plan.cjs");
// Original SELECT/CANCEL reservation only. Neither Loaded nor invoice nor actual
// physical dispatch is inferred from this change in legacy shipment intent.
function prepareSalesShipmentHolds({ company, event, priorShipment, products, generation }) {
  const shipment = event?.details?.shipment;
  if (!['NCT', 'GHR'].includes(company) || event?.action !== 'CUSTOMER_SHIPMENT_CHANGED' || event.result !== 'SAVED'
    || !event._id || event._id !== event.title || !event.initiatedByStaffId || !event.activityTime
    || shipment?.company !== company || !['REQUESTED', 'CANCELLED'].includes(shipment.status)
    || !Array.isArray(shipment.lines) || !shipment.lines.length || !Array.isArray(products) || !products.length
    || shipment.status === 'REQUESTED' && (priorShipment || event.details.beforeRevision)
    || shipment.status === 'CANCELLED' && (priorShipment?.status !== 'REQUESTED' || priorShipment.revision !== event.details.beforeRevision
      || priorShipment.id !== shipment.id || JSON.stringify(priorShipment.lines) !== JSON.stringify(shipment.lines))) throw Error('Original exact shipment reservation transition required');
  const coverage = new Map(shipment.lines.map(line => [line.taskId, 0])), writes = [], states = [];
  if (coverage.size !== shipment.lines.length) throw Error('Distinct shipment hold task coverage required');
  for (const product of products) {
    const covered = shipment.lines.filter(line => product.state.tasks.some(t => t.id === line.taskId));
    if (!covered.length || product.rows.planFormat !== 'SEGMENTED_V2') throw Error('Exact current shipment hold product required');
    const holds = copy(product.state.packingHolds);
    for (const line of covered) {
      const task = product.state.tasks.find(t => t.id === line.taskId);
      if (task.customerId !== shipment.customerId || task.orderId !== line.orderId || task.sourceLineId !== line.sourceLineId
        || !Number.isSafeInteger(line.quantity) || line.quantity < 1) throw Error('Original shipment hold demand conflict');
      coverage.set(task.id, coverage.get(task.id) + 1);
      const delta = shipment.status === 'REQUESTED' ? line.quantity : -line.quantity;
      holds.heldByTask[task.id] += delta;
    }
    const mapped = preparePackingHoldTransition({ ...product, event, generation, packingHolds: holds });
    states.push(mapped.state);
    writes.push(...mapped.plan.writes.filter(w => w.after.action !== 'CUSTOMER_SHIPMENT_CHANGED'));
  }
  if ([...coverage.values()].some(n => n !== 1)) throw Error('Complete shipment hold product coverage required');
  writes.unshift({ collection: company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', before: null, after: { ...copy(event), company } });
  if (new Set(writes.map(w => w.collection + ':' + w.after._id)).size !== writes.length || writes.length > 10000
    || utf8Bytes(JSON.stringify({ writes })) > 8 * 1024 * 1024) throw Error('Shipment hold segmented policy');
  return { plan: { writes }, states };
}
module.exports = { prepareSalesShipmentHolds };

},
// current-sales-arrangement-save.cjs sha256:ebbfc9dff9fae8498494eebe93c889cc05ab2a2fc701f14d644f77c63771cfa9
"current-sales-arrangement-save.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { requireOriginalSalesDelegation } = load("sales-delegation.cjs");
const { prepareShipmentArrangement } = load("shipment-arrangement-plan.cjs");
const { hash } = load("commit-proof.cjs");
// PRIVATE original source gateway composition. Dates and shipment batches remain
// intent metadata: one original event, no stock/demand/PO/packing mutation.
function createCurrentSalesArrangementSave({ company, store, protocol, coverage, authenticateOriginalDelegation,
  readContext, createSalesShipmentDateOperations, createShipmentPlanOperations, now = () => new Date() }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || typeof store?.read !== 'function'
    || [authenticateOriginalDelegation, readContext, createSalesShipmentDateOperations, createShipmentPlanOperations, now].some(fn => typeof fn !== 'function')) {
    throw Error('Private original Sales arrangement dependencies required');
  }
  return async request => {
    let staff;
    const result = await createCurrentStockSave({ company, writer: 'SHIPMENT_PLAN', protocol, coverage,
      authenticate: async () => {
        staff = await authenticateOriginalDelegation(company, request);
        requireOriginalSalesDelegation(staff, request?.input?.customerId);
        if (!['PLAN', 'ORDER_DATE'].includes(request.input.action)) throw Error('Original Sales arrangement action required');
        return { memberId: staff.memberId,staffId:staff.staffId };
      }, prepare: async command => {
        if (command.memberId !== staff.memberId) throw Error('Sales delegated actor changed');
        const snapshot = await protocol.readSnapshot(async () => prepareShipmentArrangement({ company, staff,
          requestId: command.requestId, input: command.input, context: await readContext(company, staff),
          createSalesShipmentDateOperations, createShipmentPlanOperations, now }));
        return { plan: snapshot.rows.plan, memberId: staff.memberId, generation: snapshot.generation };
      } })(request);
    if (result.ok !== true) return result;
    const date = request.input.action === 'ORDER_DATE', journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
    const receipt = await protocol.readSnapshot(() => store.read(journal,
      hash(company, request.requestId, staff.memberId, date ? 'SALES_SHIPMENT_DATE' : 'SHIPMENT_PLAN_EVENT')));
    const event = receipt.rows;
    if (!event?._version || event.company !== company || event.title !== event._id || event.result !== 'SAVED'
      || event.initiatedByStaffId !== staff.staffId || event.image !== staff.customerId
      || event.action !== (date ? 'SALES_SHIPMENT_DATE_SAVED' : 'CUSTOMER_SHIPMENT_PLAN_SAVED')
      || date && (event.description !== request.input.orderId || event.details?.customerId !== staff.customerId
        || event.details?.submissionId !== request.input.submissionId || event.details?.date !== request.input.date)
      || !date && (event.details?.plan?.company !== company || event.details?.plan?.customerId !== staff.customerId
        || event.details?.plan?.orderId !== request.input.orderId || event.details?.plan?.id !== event.description)) {
      throw Error('Committed Sales arrangement receipt identity unconfirmed');
    }
    return date ? { ...result, company, orderId: event.description, customerId: staff.customerId,
      date: event.details.date, revision: event.title, savedAt: event.activityTime, by: event.initiatedByStaffName }
      : { ...result, company, planId: event.description };
  };
}
module.exports = { createCurrentSalesArrangementSave };

},
// shipment-arrangement-plan.cjs sha256:c63409a7c46abee0146e241d27d0209e96f39510273e21e07c944b842cc1b0c4
"shipment-arrangement-plan.cjs": (load, module) => {
'use strict';

const copy = value => JSON.parse(JSON.stringify(value));
// Original authenticated Sales gateway must supply staff/context under the common
// fence. This seam grants no authority and never calls legacy apply. Batches/date
// remain intent metadata; no stock movement, demand cancellation or allocation.
async function prepareShipmentArrangement({ company, staff, requestId, input, context,
  createSalesShipmentDateOperations, createShipmentPlanOperations, now }) {
  const date = input?.action === 'ORDER_DATE', batch = input?.action === 'PLAN';
  const factory = date ? createSalesShipmentDateOperations : createShipmentPlanOperations;
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks)
    || !Array.isArray(context.activity) || !date && !batch || typeof factory !== 'function' || typeof now !== 'function') throw Error('Original Sales arrangement context required');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', expectedAction = date ? 'SALES_SHIPMENT_DATE_SAVED' : 'CUSTOMER_SHIPMENT_PLAN_SAVED';
  const scratch = new Map(), boundary = new Error('Private Sales arrangement boundary'); let captured, reads = 0;
  const scope = c => { if (c !== journal) throw Error('Sales arrangement scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== expectedAction) throw Error('Unexpected Sales arrangement preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Sales arrangement apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private Sales arrangement lock removal allowed'); scratch.delete(id);
    }
  };
  const save = factory({ store, names: { [company]: { activity: journal } }, now, readContext: async (c, employee) => {
    if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected Sales arrangement apply/read'); return copy(context);
  } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original Sales arrangement boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  const event = captured?.event;
  if (!event || reads !== 1 || scratch.size || event._id !== event.title || event.result !== 'SAVED'
    || event.initiatedByStaffId !== staff.staffId || event.image !== input.customerId
    || date && (event.description !== input.orderId || event.details.submissionId !== input.submissionId)
    || batch && (event.details.plan?.company !== company || event.details.plan.orderId !== input.orderId)) throw Error('Original Sales arrangement identity conflict');
  return { plan: { writes: [{ collection: journal, before: null, after: { ...event, company } }] }, event, expectedVersion: input.version };
}
module.exports = { prepareShipmentArrangement };

},
// current-sales-document-save.cjs sha256:2e6bc0eb0860c53ba66a2757e6b756af2be5bd50c1250fe0322b37f79198453f
"current-sales-document-save.cjs": (load, module) => {
'use strict';
const {createCurrentStockSave}=load("current-stock-save.cjs"),{requireOriginalSalesDelegation}=load("sales-delegation.cjs");
const {captureOriginalCustomerDocumentPlan,assertCustomerDocumentPlan}=load("customer-document-plan.cjs"),{hash}=load("commit-proof.cjs");
// PRIVATE ORIGINAL Source bearer composition only. Existing document posting rules
// unchanged; this appends its existing immutable event under the common fence.
function createCurrentSalesDocumentSave({company,store,coverage,authenticateOriginalDelegation,readContext,createCustomerAccountOperations,
 createDocumentProtocol,allocateDocumentSlot,now=()=>new Date()}){
 if(!['NCT','GHR'].includes(company)||typeof store?.read!=='function'||[authenticateOriginalDelegation,readContext,createCustomerAccountOperations,createDocumentProtocol,allocateDocumentSlot,now].some(fn=>typeof fn!=='function'))throw Error('Private original document save dependencies required');
 return async request=>{
  let staff;
  const authenticate=async()=>{const current=await authenticateOriginalDelegation(company,request);requireOriginalSalesDelegation(current,request?.input?.customerId);
   if(current.canUploadCustomerDocument!==true||request?.input?.action!=='DOCUMENT'||request.stockIdentity?.staffId!==current.staffId||request.stockIdentity?.memberId!==current.memberId
    ||staff&&(staff.staffId!==current.staffId||staff.memberId!==current.memberId))throw Error('Original source document identity/permission required');staff=current;return{memberId:staff.memberId,staffId:staff.staffId};};
  await authenticate();const protocol=createDocumentProtocol({request,staff});
  if(protocol?.planFormat!=='SEGMENTED_V2'||typeof protocol.commit!=='function'||typeof protocol.readSnapshot!=='function')throw Error('Paired original document protocol required');
  const result=await createCurrentStockSave({company,writer:'SHIPMENT',protocol,coverage,authenticate,prepare:async command=>{
   if(command.memberId!==staff.memberId)throw Error('Original document employee changed');
   const snapshot=await protocol.readSnapshot(async()=>{
    const context=await readContext(company,staff),at=now().toISOString(),args={company,staff,requestId:command.requestId,input:command.input,context,createCustomerAccountOperations,now:()=>new Date(at)};
    // Validate with an unused placeholder before any real ID allocation; capture
    // again against the same frozen original context/time using server-only slot.
    await captureOriginalCustomerDocumentPlan({...args,slot:'DOCUMENT_VALIDATION_SLOT'});
    const slot=await allocateDocumentSlot(company),prepared=await captureOriginalCustomerDocumentPlan({...args,slot});
    return{writes:[{collection:company==='NCT'?'R2NCTActivity':'R2NCTActivity1',before:null,after:{...prepared.event,company}}]};
   });return{memberId:staff.memberId,generation:snapshot.generation,plan:snapshot.rows};
  }})(request);
  if(result.ok!==true)return result;
  const documentId=hash(company,request.requestId,staff.memberId,'CUSTOMER_DOCUMENT'),snapshot=await protocol.readSnapshot(()=>store.read(company==='NCT'?'R2NCTActivity':'R2NCTActivity1',documentId)),row=snapshot.rows;
  if(!row?._version||row.company!==company)throw Error('Original committed document unconfirmed');
  const event={...row};delete event._version;delete event.company;const doc=event.details?.document;
  assertCustomerDocumentPlan({company,staff:{...staff,staffName:event.initiatedByStaffName},requestId:request.requestId,input:request.input,plan:{expectedVersion:request.input.version,event,
   upload:{action:'UPLOAD',company,department:'SALES',type:doc?.type,poId:documentId,fileId:doc?.fileId,name:doc?.name,sha256:doc?.sha256}}});
  return{...result,company,documentId};
 };
}
module.exports={createCurrentSalesDocumentSave};

},
// customer-document-plan.cjs sha256:f231c865a16498b6d185415836a2d06739aeb27078eeb742c9b7d873c63adcfd
"customer-document-plan.cjs": (load, module) => {
'use strict';
const {hash}=load("commit-proof.cjs"),{copy,same}=load("segmented-plan.cjs"),{requireOriginalSalesDelegation}=load("sales-delegation.cjs");
function pdfFacts(base64){const Buffer=StockRuntimeBuffer;const bytes=Buffer.from(base64,'base64');return{bytes,sha256:createHash('sha256').update(bytes).digest('hex')};}
const fileId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(value),clean=value=>String(value??'').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,90);
// PRIVATE candidate prepare capture. The original factory owns all document, invoice,
// duplicate, PDF, customer and account-version rules. Never its legacy apply.
async function captureOriginalCustomerDocumentPlan({company,staff,requestId,input,context,createCustomerAccountOperations,now,slot}){
 requireOriginalSalesDelegation(staff,input?.customerId);
 if(!['NCT','GHR'].includes(company)||context?.company!==company||!Array.isArray(context.activity)||!Array.isArray(context.customers)
  ||staff.canUploadCustomerDocument!==true||input?.action!=='DOCUMENT'||typeof createCustomerAccountOperations!=='function'||typeof now!=='function'||!fileId(slot))throw Error('Original private customer document scope required');
 const journal=company==='NCT'?'R2NCTActivity':'R2NCTActivity1',scratch=new Map(),boundary=Error('Original private customer document boundary');let captured,reads=0,allocated=0;
 const scope=collection=>{if(collection!==journal)throw Error('Original customer document collection scope');};
 const store={read:async(collection,id)=>{scope(collection);return copy(scratch.get(id)||null);},
  insert:async(collection,row)=>{scope(collection);
   if(row.action==='PURCHASE_OPERATION_PREPARED'&&row.details?.kind==='PREPARED'){
    if(captured||scratch.size!==1||row.details.plan?.event?.action!=='CUSTOMER_ACCOUNT_DOCUMENT_SAVED')throw Error('Original customer document prepare conflict');captured=copy(row.details.plan);throw boundary;
   }
   if(row.action!=='PURCHASE_OPERATION_LOCK'||row.details?.kind!=='LOCK'||scratch.size)throw Error('Original customer document legacy apply forbidden');scratch.set(row._id,copy(row));return copy(row);
  },remove:async(collection,id)=>{scope(collection);if(scratch.get(id)?.action!=='PURCHASE_OPERATION_LOCK')throw Error('Only original scratch document lock removal allowed');scratch.delete(id);}};
 const save=createCustomerAccountOperations({store,names:{[company]:{activity:journal}},now,
  readContext:async(selected,employee)=>{if(selected!==company||employee.memberId!==staff.memberId||employee.staffId!==staff.staffId||++reads!==1)throw Error('Original customer document context/actor conflict');return copy(context);},
  documentService:async command=>{if(!same(command,{action:'ALLOCATE',company})||allocated++)throw Error('Original document external apply forbidden during capture');return{ok:true,fileId:slot};}});
 try{await save({company,staff:copy(staff),requestId,input:copy(input)});throw Error('Original document prepare boundary missing');}catch(error){if(error!==boundary)throw error;}
 if(!captured||reads!==1||scratch.size||allocated!==1)throw Error('Original customer document capture incomplete');
 assertCustomerDocumentPlan({company,staff,requestId,input,plan:captured});return captured;
}
function assertCustomerDocumentPlan({company,staff,requestId,input,plan}){
 requireOriginalSalesDelegation(staff,input?.customerId);
 const event=plan?.event,doc=event?.details?.document,id=hash(company,requestId,staff.memberId,'CUSTOMER_DOCUMENT');
 if(!['NCT','GHR'].includes(company)||staff.canUploadCustomerDocument!==true||!/^[a-f0-9-]{36}$/i.test(requestId||'')||input?.action!=='DOCUMENT'
  ||typeof input.base64!=='string'||input.base64.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw Error('Immutable original customer PDF required');
 const {bytes,sha256}=pdfFacts(input.base64);
 if(bytes.length<5||bytes.length>3*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.toString('base64')!==input.base64
  ||event?._id!==id||event.title!==id||event.description!==id||event.image!==input.customerId||event.action!=='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'||event.result!=='SAVED'
  ||event.initiatedByStaffId!==staff.staffId||event.initiatedByStaffName!==staff.staffName||event.actorType!=='STAFF'||event.message!==String(input.reason).trim()||!Number.isFinite(Date.parse(event.activityTime))
  ||doc?.id!==id||doc.company!==company||doc.customerId!==input.customerId||doc.byStaffId!==staff.staffId||doc.by!==staff.staffName||doc.at!==event.activityTime
  ||!['SALES_INV','SALES_CN','DEBIT_NOTE','CUSTOMER_RECEIPT'].includes(doc.type)||doc.type!==input.type||doc.number!==String(input.number).trim()||doc.date!==input.date
  ||doc.currency!==String(input.currency).trim().toUpperCase()||doc.amountCents!==input.amountCents||doc.reason!==String(input.reason).trim()
  ||doc.shipmentId!==(input.type==='SALES_INV'?input.shipmentId:'')||!fileId(doc.fileId)||doc.sha256!==sha256||doc.size!==bytes.length
  ||doc.url!=='https://drive.google.com/file/d/'+doc.fileId+'/view'||doc.name!==input.date+' '+clean(doc.customerName||doc.customerId)+' '+input.type+' '+clean(doc.number)+'.pdf'
  ||plan.expectedVersion!==input.version||!same(plan.upload,{action:'UPLOAD',company,department:'SALES',type:input.type,poId:id,fileId:doc.fileId,name:doc.name,sha256}))throw Error('Immutable original customer document plan conflict');
 return true;
}
async function uploadCustomerDocumentSlot({company,staff,requestId,input,plan,documentService}){
 assertCustomerDocumentPlan({company,staff,requestId,input,plan});if(typeof documentService!=='function')throw Error('Original document service required');
 const upload=copy(plan.upload),receipt=await documentService({...upload,base64:input.base64});
 if(receipt?.ok!==true||['fileId','company','poId','sha256','name'].some(key=>receipt[key]!==upload[key]))throw Error('Original customer document upload unconfirmed; retain same file ID');
 return{fileId:upload.fileId,company,poId:upload.poId,sha256:upload.sha256,name:upload.name};
}
module.exports={captureOriginalCustomerDocumentPlan,assertCustomerDocumentPlan,uploadCustomerDocumentSlot};

},
// customer-document-fenced-store.cjs sha256:0f856dfa0e7089483c53c62c67e462e3a53279c2958e9f722e96f5c993ed80b1
"customer-document-fenced-store.cjs": (load, module) => {
'use strict';
const {hash}=load("commit-proof.cjs"),{createSegmentedPlanCodec,copy,same}=load("segmented-plan.cjs");
const {assertCustomerDocumentPlan,uploadCustomerDocumentSlot}=load("customer-document-plan.cjs"),{requireOriginalSalesDelegation}=load("sales-delegation.cjs");
const unversion=row=>{const result=copy(row);delete result._version;delete result.company;return result;};
// The ORIGINAL document event is already immutable and contains its file receipt.
// Upload then conditional INSERT that event: no extra CMS file-confirmation row,
// no mutable ledger rewrite, no separate stock authority or legacy apply.
function createCustomerDocumentFencedStore({company,staff,request,store,documentService,codecPolicy={},coordination='EXCLUSIVE_LOCK'}){
 if(!['EXCLUSIVE_LOCK','CONTROL_CAS_CANDIDATE'].includes(coordination))throw Error('Explicit server document coordination required');
 const exclusive=coordination==='EXCLUSIVE_LOCK';
 requireOriginalSalesDelegation(staff,request?.input?.customerId);
 if(!['NCT','GHR'].includes(company)||staff.canUploadCustomerDocument!==true||request.input?.action!=='DOCUMENT'
  ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||request.stockProtocol!==1||typeof request.stockBuild!=='string'||!request.stockBuild
  ||!Number.isSafeInteger(request.stockGeneration)||request.stockGeneration<0||request.stockIdentity?.staffId!==staff.staffId||request.stockIdentity?.memberId!==staff.memberId
  ||['read','insert','compareAndSet','compareAndRemove'].some(method=>typeof store?.[method]!=='function')||typeof documentService!=='function')throw Error('Private original customer file fence required');
 const codec=createSegmentedPlanCodec({...codecPolicy,company,domainWrites:true}),{journal,lockId,controlId}=codec.ids;
 // Existing source fulfilment co-writer category, not a new financial capability.
 const key=hash(company+'/PURCHASE',request.requestId,staff.memberId),digest=hash({company,writer:'SHIPMENT',input:request.input,stockProtocol:request.stockProtocol,
  stockBuild:request.stockBuild,stockGeneration:request.stockGeneration,stockIdentity:request.stockIdentity});
 const documentId=hash(company,request.requestId,staff.memberId,'CUSTOMER_DOCUMENT');
 async function beforeDocumentInsert(collection,row){
  const control=await store.read(journal,controlId),lock=exclusive?await store.read(journal,lockId):null,manifest=await store.read(journal,key);
  if(collection!==journal||row?._id!==documentId||row.action!=='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'||row.company!==company
   ||!control?._version||control.company!==company||control.mode!=='ACTIVE'||control.writerBuild!==request.stockBuild||control.generation!==request.stockGeneration
   ||control.pending?.key!==key||control.pending.digest!==digest||control.pending.phase!=='APPLY'||control.pending.cursor!==0||control.pending.count!==1||manifest?.digest!==digest||manifest.planHash!==control.pending.planHash
   ||manifest.baseGeneration!==request.stockGeneration||exclusive&&(lock?.company!==company||lock.owner!==key||!lock.attempt))throw Error('Durable original customer document APPLY fence required');
  if(!Array.isArray(manifest.fragments)||manifest.fragments.length>32)throw Error('Bounded original document manifest required');const fragments=[];
  for(const ref of manifest.fragments)fragments.push(await store.read(journal,ref.id));const plan=codec.decode({manifest,fragments,key,digest,memberId:staff.memberId,requestId:request.requestId});
  if(plan.writes.length!==1||plan.writes[0].collection!==journal||plan.writes[0].before!==null||!same(plan.writes[0].after,row))throw Error('Exact immutable original document insertion required');
  const event=unversion(row),doc=event.details?.document,recordedStaff={...staff,staffName:event.initiatedByStaffName};
  const prepared={expectedVersion:request.input.version,event,upload:{action:'UPLOAD',company,department:'SALES',type:doc?.type,poId:documentId,fileId:doc?.fileId,name:doc?.name,sha256:doc?.sha256}};
  assertCustomerDocumentPlan({company,staff:recordedStaff,requestId:request.requestId,input:request.input,plan:prepared});
  await uploadCustomerDocumentSlot({company,staff:recordedStaff,requestId:request.requestId,input:request.input,plan:prepared,documentService});
  // A late file callback does not authorize a late CMS write. Never take/renew/
  // steal any lease or accept a changed owner, checkpoint, mode or generation.
  if(!same(await store.read(journal,controlId),control)||exclusive&&!same(await store.read(journal,lockId),lock))throw Error('Original document callback fence changed; retain request');
 }
 const metadata=(collection,row)=>collection===journal&&row?._id!==documentId&&row?.action!=='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'&&(row?._id===lockId||row?._id===controlId||row?.stockOperationProtocol===2);
 return{read:(...args)=>store.read(...args),
  insert:async(collection,row)=>{if(!metadata(collection,row))await beforeDocumentInsert(collection,row);return store.insert(collection,row);},
  compareAndSet:(collection,id,version,row)=>{if(!metadata(collection,row)||id!==row._id)throw Error('Original customer document is insert-only');return store.compareAndSet(collection,id,version,row);},
  compareAndRemove:(collection,id,attempt)=>{if(collection!==journal||id!==lockId)throw Error('Only exact owned document protocol lock release allowed');return store.compareAndRemove(collection,id,attempt);}};
}
module.exports={createCustomerDocumentFencedStore};

},
// current-warehouse-dispatch-save.cjs sha256:f73bb7bdf82c474ea26bb471034cc0da14d51314185bac4b229938aabe2dc688
"current-warehouse-dispatch-save.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { readCurrentWarehouseShipmentWorkspace } = load("warehouse-shipment-workspace.cjs");
const { validateOriginalShipment } = load("original-shipment-validation.cjs");
const { prepareWarehouseDispatch } = load("warehouse-dispatch-plan.cjs");
const { hash } = load("commit-proof.cjs");
// PRIVATE original fulfilment staffContext callback, not browser permissions.
function createCurrentWarehouseDispatchSave({ company, items, store, protocol, coverage, authenticateOriginalWarehouse,
  readContext, createCustomerFulfilmentOperations, currentAllocationVersion, now = () => new Date(), ...dependencies }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || currentAllocationVersion !== 2
    || typeof authenticateOriginalWarehouse !== 'function' || typeof readContext !== 'function'
    || typeof createCustomerFulfilmentOperations !== 'function') throw Error('Private original Warehouse dispatch dependencies required');
  return async request => {
    let staff;
    const result = await createCurrentStockSave({ company, writer: 'SHIPMENT', protocol, coverage,
      authenticate: async () => {
        staff = await authenticateOriginalWarehouse(company);
        if (!staff?.memberId || !staff.staffId || staff.canDispatchShipment !== true || staff.customerId
          || request?.input?.action !== 'DISPATCH') throw Error('Original Warehouse dispatch grant required');
        return { memberId: staff.memberId,staffId:staff.staffId };
      }, prepare: async command => {
        const metrics = { exactReads: 0, queries: 0 };
        const snapshot = await protocol.readSnapshot(async control => {
          const current = await readCurrentWarehouseShipmentWorkspace({ ...dependencies, company, items, store, staff, control,
            context: await readContext(company, staff), metrics });
          const validated = await validateOriginalShipment({ company, staff, requestId: command.requestId, input: command.input,
            context: current.context, createCustomerFulfilmentOperations, currentAllocationVersion, now });
          const shipment = validated.event.details.shipment, ids = new Set(shipment.lines.map(l => l.taskId));
          const products = [...current.products.values()].filter(p => p.state.tasks.some(t => ids.has(t.id)));
          const taskRows = products.flatMap(p => p.rows.taskRows.filter(t => ids.has(t._id)));
          return prepareWarehouseDispatch({ event: validated.event,
            priorShipment: dependencies.readCustomerShipments(current.context.activity).find(s => s.id === shipment.id),
            products, taskRows, generation: control.generation, planFormat: 'SEGMENTED_V2' });
        });
        return { ...snapshot.rows, memberId: staff.memberId, generation: snapshot.generation, metrics };
      } })(request);
    if (result.ok !== true) return result;
    const snapshot = await protocol.readSnapshot(() => store.read(company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', hash(company, request.requestId, staff.memberId, 'SHIPMENT_EVENT')));
    const event = snapshot.rows;
    if (!event?._version || event.company !== company || event.action !== 'CUSTOMER_SHIPMENT_CHANGED' || event.result !== 'SAVED'
      || event.initiatedByStaffId !== staff.staffId || event.details?.shipment?.status !== 'DISPATCHED'
      || event.details.shipment.id !== request.input.id) throw Error('Committed physical dispatch receipt unconfirmed');
    return { ...result, company, shipmentId: event.details.shipment.id, status: 'DISPATCHED' };
  };
}
function createCurrentWarehouseShipmentRead({ company, protocol, authenticateOriginalWarehouse, readContext,
  readOriginalCustomerFulfilment, currentFulfilmentVersion, ...dependencies }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || currentFulfilmentVersion !== 2
    || [authenticateOriginalWarehouse, readContext, readOriginalCustomerFulfilment].some(fn => typeof fn !== 'function')) throw Error('Private original Warehouse shipment read dependencies required');
  return async requestCompany => {
    if (requestCompany !== company) throw Error('Warehouse shipment read company conflict');
    const staff = await authenticateOriginalWarehouse(company);
    const snapshot = await protocol.readSnapshot(async control => {
      const current = await readCurrentWarehouseShipmentWorkspace({ ...dependencies, company, protocol, control, staff, context: await readContext(company, staff) });
      // Original public gateway still applies its original financial redaction.
      const result = await readOriginalCustomerFulfilment(company, staff, '', current.context);
      if (result?.company !== company) throw Error('Original Warehouse shipment response company changed');
      return { ...result, staff:{...result.staff,staffId:staff.staffId,memberId:staff.memberId}, stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: control.writerBuild, stockGeneration: control.generation } };
    });
    return snapshot.rows;
  };
}
module.exports = { createCurrentWarehouseDispatchSave, createCurrentWarehouseShipmentRead };

},
// warehouse-shipment-workspace.cjs sha256:8671cb8c5bf4479ea6653dbf7e1d676d26c90db6165871d03c7bdaf4b972c407
"warehouse-shipment-workspace.cjs": (load, module) => {
'use strict';
const { stockKey } = load("current-model.cjs");
const { originalProductState } = load("original-product-state.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { currentAllocationContext } = load("current-allocation-context.cjs");
const { copy } = load("segmented-plan.cjs");
// PRIVATE original company fulfilment context, not a source Sales customer scope.
// Same selected set must feed its original READ/version and DISPATCH validation.
async function readCurrentWarehouseShipmentWorkspace({ company, staff, context, control, items, store,
  readCurrentTaskRows, readPurchaseRecords, projectPurchaseOrders, readAllocations, readCustomerShipments,
  readPackingLists, packingHeld, readPreparation, projectPreparation, metrics = { exactReads: 0, queries: 0 } }) {
  if (!['NCT', 'GHR'].includes(company) || !staff?.memberId || !staff.staffId
    || staff.canDispatchShipment !== true && staff.readFinancial !== true || staff.customerId
    || context?.company !== company || control?.company !== company || control.mode !== 'ACTIVE' || control.pending
    || control.schemaVersion !== 1 || !Number.isSafeInteger(control.generation) || control.generation < 0
    || control.transferIndexVersion !== 2 || typeof control.writerBuild !== 'string' || !control.writerBuild
    || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
    || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Private original Warehouse shipment context required');
  const shipments = readCustomerShipments(context.activity);
  if (shipments.some(s => s.company !== company)) throw Error('Shipment company context conflict');
  const retained = new Set(shipments.filter(s => ['REQUESTED', 'INVOICED'].includes(s.status)).flatMap(s => s.lines.map(l => l.taskId)));
  const selected = context.tasks.filter(t => !t.procurementSource && !t.specialPurchase && (!t.archived || retained.has(t.id)));
  if ([...retained].some(id => !selected.some(t => t.id === id))) throw Error('Original outstanding shipment task missing');
  const groups = new Map();
  for (const task of selected) {
    const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea }, key = stockKey(identity);
    if (!groups.has(key)) groups.set(key, { identity, taskIds: [] }); groups.get(key).taskIds.push(task.id);
  }
  const records = groups.size ? await readPurchaseRecords(company, staff) : [];
  const orders = groups.size ? projectPurchaseOrders({ company, workspace: context, records }) : [];
  const prior = readAllocations(context.activity), products = new Map(), tasks = new Map(), sources = new Set(), allocations = [];
  for (const [key, group] of groups) {
    const builder = originalProductState({ company, context, orders, identity: group.identity, readAllocations: () => prior,
      readCustomerShipments: () => shipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
    const explicitSources = [...new Set(shipments.filter(s => ['REQUESTED', 'INVOICED'].includes(s.status))
      .flatMap(s => s.lines.filter(l => group.taskIds.includes(l.taskId)).flatMap(l => l.sources.map(p => p.sourceTaskId))))];
    const rows = await readScopedCurrentProduct({ company, identity: group.identity, items, store, metrics,
      transferIndexVersion: control.transferIndexVersion, sourceTaskIds: explicitSources, demandTaskIds: group.taskIds });
    if (!rows.product) throw Error('Warehouse shipment product checkpoint missing');
    rows.taskRows = await readCurrentTaskRows(company, builder.scopeTaskIds(rows), staff); rows.generation = control.generation;
    const state = builder.buildState(rows), view = currentAllocationContext({ state, context, readAllocations: () => prior });
    for (const task of state.tasks) {
      if (tasks.has(task.id)) throw Error('Warehouse shipment task product ambiguous'); tasks.set(task.id, view.tasks.find(t => t.id === task.id));
    }
    for (const source of state.sources) {
      if (sources.has(source.id)) throw Error('Warehouse shipment source product ambiguous'); sources.add(source.id);
      allocations.push(view.allocations.find(a => a.sourceTaskId === source.id));
    }
    products.set(key, { state, rows });
  }
  return { context: { ...copy(context), stockAllocationView: 'CURRENT_V2', tasks: context.tasks.map(t => copy(tasks.get(t.id) || t)),
    allocations: [...prior.filter(a => !sources.has(a.sourceTaskId)), ...allocations] }, products, metrics };
}
module.exports = { readCurrentWarehouseShipmentWorkspace };

},
// warehouse-dispatch-plan.cjs sha256:24f90ee9a182facbb54b1778967ace45da49280a894428f457806a92733e9dfc
"warehouse-dispatch-plan.cjs": (load, module) => {
'use strict';

const { stockKey } = load("current-model.cjs");
const { prepareShipmentDispatch } = load("borrowing-stock-plan.cjs");
const { appendTaskDispatchCheckpoints } = load("task-dispatch-checkpoint.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
function prepareWarehouseDispatch({ event, priorShipment, products, generation, taskRows, planFormat = 'PROOF_V1' }) {
  if (!['PROOF_V1', 'SEGMENTED_V2'].includes(planFormat)) throw Error('Server dispatch plan format required');
  const shipment = event?.details?.shipment;
  if (!Array.isArray(shipment?.lines) || !shipment.lines.length || !Array.isArray(priorShipment?.lines)
    || !Array.isArray(products) || !products.length) throw Error('Complete original dispatch and products required');
  const keys = new Set(), consumed = new Set(), states = [], writes = [];
  for (const { state, rows } of products) {
    const key = stockKey(state);
    if (keys.has(key)) throw Error('Duplicate dispatch product'); keys.add(key);
    const lines = shipment.lines.filter(l => state.tasks.some(t => t.id === l.taskId));
    if (!lines.length) throw Error('Unrelated dispatch product');
    for (const line of lines) { if (consumed.has(line.taskId)) throw Error('Ambiguous dispatch task'); consumed.add(line.taskId); }
    const scoped = { ...copy(event), details: { ...copy(event.details), shipment: { ...copy(shipment), lines: copy(lines) } } };
    const prior = { ...copy(priorShipment), lines: priorShipment.lines.filter(l => consumed.has(l.taskId) && lines.some(n => n.taskId === l.taskId)) };
    const result = prepareShipmentDispatch({ state, rows, event: scoped, priorShipment: prior, generation });
    states.push(result.state);
    writes.push(...result.plan.writes.filter(w => w.after.action !== 'CUSTOMER_SHIPMENT_CHANGED'));
  }
  if (new Set(shipment.lines.map(l => l.taskId)).size !== shipment.lines.length || consumed.size !== shipment.lines.length
    || new Set(priorShipment.lines.map(l => l.taskId)).size !== shipment.lines.length
    || priorShipment.lines.some(l => !consumed.has(l.taskId))) throw Error('Incomplete dispatch product coverage');
  writes.unshift({ collection: shipment.company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', before: null, after: { ...copy(event), company: shipment.company } });
  const plan = planFormat === 'SEGMENTED_V2' ? appendTaskDispatchCheckpoints({ company: shipment.company, plan: { writes }, products, states, taskRows, generation }) : { writes };
  if (planFormat !== 'SEGMENTED_V2' && products.some(p => p.state.lifecycleVersion === 2)) throw Error('Current dispatch must retain task checkpoints');
  if (new Set(plan.writes.map(w => w.collection + ':' + w.after._id)).size !== plan.writes.length
    || plan.writes.length > (planFormat === 'SEGMENTED_V2' ? 10000 : 30)
    || Buffer.byteLength(JSON.stringify(plan)) > (planFormat === 'SEGMENTED_V2' ? 8 * 1024 * 1024 : 180000)) throw Error('Combined dispatch exceeds atomic proof bound');
  return { states, plan };
}
module.exports = { prepareWarehouseDispatch };

},
// task-dispatch-checkpoint.cjs sha256:75c8094f9dc48fb26d2d69a12aff273b3ecc83861e47838c5177d6e6472fe45d
"task-dispatch-checkpoint.cjs": (load, module) => {
'use strict';

const { same, copy } = load("segmented-plan.cjs");
const count = n => Number.isSafeInteger(n) && n >= 0;
// Exact normalized domain rows from private store, never projected/browser tasks.
// Caller includes this plan in the SAME stock fence; does not write separately.
function appendTaskDispatchCheckpoints({ company, plan, products, states, taskRows, generation }) {
  if (!['NCT', 'GHR'].includes(company) || !Array.isArray(plan?.writes) || !Array.isArray(products)
    || !Array.isArray(states) || states.length !== products.length || !Array.isArray(taskRows)
    || !count(generation) || !count(generation + 1)) throw Error('Private dispatch checkpoint context required');
  const collection = company === 'NCT' ? 'R2NCTTasks' : 'R2NCTTasks1', result = copy(plan);
  const exact = new Map(taskRows.map(row => [row._id, row]));
  if (exact.size !== taskRows.length) throw Error('Duplicate exact dispatch task');
  const consumed = new Set();
  for (let index = 0; index < products.length; index++) {
    const before = products[index].state, after = states[index];
    if (before?.lifecycleVersion !== 2 || after?.lifecycleVersion !== 2 || before.company !== company || after.company !== company
      || before.tasks.length !== after.tasks.length) throw Error('Dispatch lifecycle checkpoint required');
    for (const task of before.tasks) {
      const next = after.tasks.find(t => t.id === task.id);
      if (!next || !count(task.dispatched) || !count(next.dispatched) || next.dispatched < task.dispatched) throw Error('Dispatch task identity/cumulative conflict');
      if (next.dispatched === task.dispatched) continue;
      const row = exact.get(task.id);
      if (!row || consumed.has(task.id) || row.company !== company || !row._version || row.stockCounterSchema !== 2
        || row.stockDispatchedCumulative !== task.dispatched || !count(row.stockCounterGeneration) || row.stockCounterGeneration > generation) throw Error('Exact task dispatch checkpoint stale');
      consumed.add(task.id);
      const existing = result.writes.find(w => w.collection === collection && w.after._id === task.id);
      if (existing && !same(existing.before, row)) throw Error('Dispatch task writer conflict');
      const checkpoint = { stockCounterSchema: 2, stockDispatchedCumulative: next.dispatched, stockCounterGeneration: generation + 1 };
      if (existing) Object.assign(existing.after, checkpoint);
      else result.writes.push({ collection, before: copy(row), after: { ...copy(row), ...checkpoint } });
    }
  }
  if (consumed.size !== exact.size) throw Error('Unrelated exact dispatch task rows');
  return result;
}
module.exports = { appendTaskDispatchCheckpoints };

},
// sales-gateway-current.cjs sha256:67b31ee12c3715f15eb95391f51cf22db623cf5565cbd9b7685926edfbd3cf87
"sales-gateway-current.cjs": (load, module) => {
'use strict';
const { requireOriginalSalesDelegation } = load("sales-delegation.cjs");
// PRIVATE: invoked only after the existing source bearer authentication. This is
// a transport adapter, never a replacement for source/member authentication.
async function dispatchCurrentSalesGateway({ body, staff, resolveCurrentSales, legacy }) {
  requireOriginalSalesDelegation(staff, body.customerId);
  if (typeof resolveCurrentSales !== 'function' || typeof legacy !== 'function') throw Error('Private Sales route dependencies required');
  const current = await resolveCurrentSales(body.company, staff);
  if (current?.mode === 'LEGACY') {
    if(body.input?.stockCurrent!==undefined)throw Error('Sales inventory mode changed; retain the original current request');
    return legacy();
  }
  if (current?.mode !== 'ACTIVE') throw Error('Inventory maintenance; Sales changes are paused');
  if (body.action === 'READ' && typeof current.read === 'function') return current.read(body.company);
  const save = body.action === 'ADJUST' ? current.save : ['SELECT', 'CANCEL'].includes(body.action) ? current.shipmentSave
    : ['PLAN', 'ORDER_DATE'].includes(body.action) ? current.arrangementSave : body.action==='DOCUMENT'?current.documentSave:null;
  if (typeof save !== 'function') {
    throw Error('Current Sales action is not connected; no legacy write fallback');
  }
  const { stockCurrent, ...input } = body.input || {};
  if (stockCurrent?.schema !== 'CURRENT_STOCK_V2' || stockCurrent.stockProtocol !== 1
    || typeof stockCurrent.stockBuild !== 'string' || !stockCurrent.stockBuild
    || !Number.isSafeInteger(stockCurrent.stockGeneration) || stockCurrent.stockGeneration < 0) {
    throw Error('Current Sales form changed; refresh and review retained input');
  }
  return save({ requestId: body.requestId, stockProtocol: stockCurrent.stockProtocol,
    stockBuild: stockCurrent.stockBuild, stockGeneration: stockCurrent.stockGeneration,stockIdentity:stockCurrent.stockIdentity,
    input: { ...input, action: body.action, customerId: staff.customerId } });
}
module.exports = { dispatchCurrentSalesGateway };

},
// current-order-intake.cjs sha256:8824b6020af432cc49b193d308521bc28d560bdaf7feacf23c9001d1588389c2
"current-order-intake.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const { stockKey } = load("current-model.cjs");
const { domainCollections } = load("domain-scope.cjs");
const { prepareOrderIntake, intakeProtocolIdentity } = load("order-intake-plan.cjs");
const { evaluateStockAdmission } = load("stock-admission.cjs");
const copy = value => JSON.parse(JSON.stringify(value));

// PRIVATE, reachable only after the unchanged nctReceiver bearer check. The source
// keeps its original immutable destination/order lock across every pending response.
// No browser generation, routing override, staff grant or new submission identity.
function createCurrentOrderIntakeOperations({ company, store, protocol, coverage = {},
  createNctIntake, createNctReceiptReader, readOppositePreparation, captureCosts, now = () => new Date() }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2') throw Error('Private current intake scope required');
  for (const fn of [store?.read, protocol?.commit, protocol?.readSnapshot, protocol?.readControl,
    createNctIntake, createNctReceiptReader, readOppositePreparation, captureCosts, now]) {
    if (typeof fn !== 'function') throw Error('Original current intake dependency required');
  }
  const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const otherJournal = company === 'NCT' ? 'R2NCTActivity1' : 'R2NCTActivity';
  const originalReceipt = createNctReceiptReader({ store });
  async function validate(body) {
    if (body?.destination !== company) throw Error('Original intake company conflict');
    // Run the ORIGINAL full input validator without touching a real collection.
    await createNctReceiptReader({ store: { read: async () => null } })(body);
    intakeProtocolIdentity(body);
  }
  function admit(control, operation) {
    const result = evaluateStockAdmission({ company, writer: 'ORDER_INTAKE', control, coverage, operation,
      request: { stockProtocol: 1, stockBuild: control.writerBuild,
        stockGeneration: operation?.replay ? operation.baseGeneration : control.generation } });
    if (result.route !== 'FENCED_CURRENT') throw Error('Current intake requires ACTIVE; no legacy fallback');
    return result;
  }
  async function readReceipt(body) {
    await validate(body);
    const snapshot = await protocol.readSnapshot(async control => {
      admit(control);
      return originalReceipt(copy(body));
    });
    return copy(snapshot.rows);
  }
  async function receive(body) {
    await validate(body);
    const input = copy(body), identity = intakeProtocolIdentity(input);
    // An already accepted original delivery is a read-only replay, not an empty
    // stock commit. Pending saves must resume below; even ORDER_RECEIVED alone is
    // not a final receipt until all current images/generation have been verified.
    const initial = await protocol.readControl();
    if (!initial.pending) {
      const prior = await readReceipt(input);
      if (prior.ok === true) return prior;
    }
    let admittedGeneration;
    const result = await protocol.commit({ ...identity, input,
      authorize: operation => { admittedGeneration = admit(operation.control, operation).generation; },
      prepare: async () => {
        const snapshot = await protocol.readSnapshot(async control => {
          if (control.generation !== admittedGeneration) throw Error('Intake checkpoint changed');
          admit(control);
          const base = [input.sourceSiteId, input.orderId];
          const tables = { [orders]: [], [tasks]: [], [journal]: [], [otherJournal]: [] };
          const exact = async (collection, id) => {
            const row = collection === otherJournal ? await readOppositePreparation(collection, id) : await store.read(collection, id);
            if (row !== null) {
              if (!row || row._id !== id || row.company && row.company !== (collection === otherJournal ? (company === 'NCT' ? 'GHR' : 'NCT') : company)) throw Error('Exact intake record identity conflict');
              tables[collection].push(copy(row));
            }
          };
          await Promise.all([exact(journal, hash(...base, 'PREPARED')),
            exact(journal, hash(...base, 'ACCEPTED')),exact(otherJournal, hash(...base, 'PREPARED'))]);
          // Native SDK readMany uses complete strong exact-ID batches of fifty.
          // Keep the same snapshot barrier and fail on incomplete/foreign data;
          // a batch failure must never turn an existing row into an absent row.
          const exactMany = async (collection, ids) => {
            const rows = typeof store.readMany === 'function'
              ? await store.readMany(collection, ids)
              : await (async () => { const values = []; for (const id of ids) values.push(await store.read(collection, id)); return values; })();
            if (!Array.isArray(rows) || rows.length !== ids.length || rows.some((row, index) => row !== null
              && (!row || row._id !== ids[index] || row.company !== company))) throw Error('Complete exact intake batch required');
            return rows;
          };
          // Independent exact-ID table reads share the same surrounding snapshot.
          // Await every complete result before preparation; failed reads still fail
          // the whole operation, with no partial plan or absent-row fallback.
          await Promise.all([[orders, 'ORDER'], [tasks, 'TASK'], [journal, 'INITIAL_COST']].map(async ([collection, suffix]) => {
            tables[collection].push(...(await exactMany(collection, input.lines.map(line => hash(...base, line.sourceLineId, suffix)))).filter(row => row !== null));
          }));
          const products = new Map();
          for (const line of input.lines) {
            const product = { company, barcode: line.unitBarcode, packing: line.packingSize, ea: line.eaPerCtn };
            const key = stockKey(product);
            if (!products.has(key)) products.set(key, { identity: product, row: null });
          }
          const productRows = await exactMany('R2StockProducts', [...products.keys()].map(key => hash(company, key)));
          [...products.values()].forEach((entry, index) => { entry.row = productRows[index]; });
          return prepareOrderIntake({ company, body: input, tables, createNctIntake, createNctReceiptReader,
            captureCosts, now, planFormat: 'SEGMENTED_V2', generation: control.generation, productRows: [...products.values()] });
        });
        if (snapshot.rows.replay || !snapshot.rows.plan.writes.length || snapshot.generation !== admittedGeneration) throw Error('Intake changed before preparation; review original receipt');
        return snapshot.rows.plan;
      } });
    if (result?.ok === false && result.pending === true && result.requestId === identity.requestId
      && ['BEFORE', 'APPLY', 'VERIFY'].includes(result.phase) && Number.isSafeInteger(result.completedCount)
      && Number.isSafeInteger(result.totalRecords) && result.totalRecords > 0 && result.completedCount >= 0 && result.completedCount <= result.totalRecords) {
      return { ok: false, pending: true, orderId: input.orderId, destination: company, submissionId: input.submissionId,
        phase: result.phase, completedCount: result.completedCount, totalRecords: result.totalRecords };
    }
    if (result?.ok !== true || !Number.isSafeInteger(result.generation) || result.generation < 1) throw Error('Current intake commit unconfirmed');
    const receipt = await readReceipt(input);
    if (receipt.ok !== true) throw Error('Original accepted receipt unconfirmed');
    return receipt;
  }
  return { receive, readReceipt };
}
module.exports = { createCurrentOrderIntakeOperations };

},
// order-intake-plan.cjs sha256:2df022e0f0b25b00e5d7bbe0ac49e734290045cf9f72b428227e4d7780de09a4
"order-intake-plan.cjs": (load, module) => {
'use strict';

const { domainCollections } = load("domain-scope.cjs");
const { hash } = load("commit-proof.cjs");
const { appendIntakeProductCheckpoints } = load("intake-product-checkpoint.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
// Candidate ONLY after original nctReceiver authentication. This is not an HTTP
// gateway and possession of a payload is NOT proof of the intake shared secret.
async function prepareOrderIntake({ createNctIntake, createNctReceiptReader, company, body, tables, captureCosts, now,
  planFormat = 'PROOF_V1', generation, productRows }) {
  const Buffer=StockRuntimeBuffer;
  if (!['PROOF_V1', 'SEGMENTED_V2'].includes(planFormat) || planFormat === 'SEGMENTED_V2' && (!Number.isSafeInteger(generation) || generation < 0 || !Number.isSafeInteger(generation + 1))) throw Error('Server intake protocol/generation required');
  const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const opposite = company === 'NCT' ? 'GHR' : 'NCT', otherJournal = opposite === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const allowed = new Set([orders, tasks, journal, otherJournal]);
  if (body?.destination !== company || typeof createNctIntake !== 'function' || typeof createNctReceiptReader !== 'function'
    || typeof captureCosts !== 'function' || typeof now !== 'function' || !tables
    || Object.keys(tables).some(c => !allowed.has(c)) || [...allowed].some(c => !Array.isArray(tables[c]))) throw Error('Complete private intake snapshot required');
  const overlay = new Map(), writes = [];
  for (const c of allowed) for (const row of tables[c]) {
    const key = c + ':' + row._id, expectedCompany = c === otherJournal ? opposite : company;
    if (!row._id || overlay.has(key) || row.company && row.company !== expectedCompany) throw Error('Intake snapshot scope/identity conflict');
    overlay.set(key, copy(row));
  }
  const permittedEvents = new Set(['INTAKE_PREPARED', 'COST_CAPTURE', 'ORDER_RECEIVED']);
  const store = {
    read: async (c, id) => { if (!allowed.has(c)) throw Error('Intake read scope violation'); return copy(overlay.get(c + ':' + id) || null); },
    insert: async (c, row) => {
      const key = c + ':' + row._id;
      if (![orders, tasks, journal].includes(c) || !row._id || overlay.has(key)
        || c === journal && !permittedEvents.has(row.action)
        || c === orders && (row.title !== body.orderId || row.customerId !== body.customerId || row.submissionId !== body.submissionId)
        || c === tasks && row.description !== body.orderId
        || c === journal && row.description !== body.orderId) throw Error('Unexpected original intake insert');
      const proposed = { ...copy(row), company };
      // The original validator has already checked the date-only source value.
      // Preserve the existing CMS Date field, not a midnight DateTime conversion.
      if (c === orders) proposed.estimatedShipmentDate = body.estimatedShipmentDate || null;
      if (c === tasks && planFormat === 'SEGMENTED_V2') Object.assign(proposed, {
        stockCounterSchema: 2, stockDispatchedCumulative: 0, stockCounterGeneration: generation + 1 });
      overlay.set(key, proposed); writes.push({ collection: c, before: null, after: proposed }); return copy(proposed);
    }
  };
  // ORIGINAL core validates identity/quote/FX/date, reuses durable captured costs,
  // preserves existing task manual edits, and inserts ORDER_RECEIVED last.
  const outcome = await createNctIntake({ store, captureCosts, now })(copy(body));
  const receipt = await createNctReceiptReader({ store })(copy(body));
  if (JSON.stringify(outcome) !== JSON.stringify(receipt) || outcome.ok !== true
    || writes.length && writes.at(-1).after.action !== 'ORDER_RECEIVED'
    || writes.length > (planFormat === 'SEGMENTED_V2' ? 10000 : 30)
    || Buffer.byteLength(JSON.stringify({ writes })) > (planFormat === 'SEGMENTED_V2' ? 8 * 1024 * 1024 : 180000)) throw Error('Complete bounded original intake receipt required');
  const taskRows = outcome.taskIds.map(id => overlay.get(tasks + ':' + id));
  if (taskRows.some(row => !row || row.description !== body.orderId)
    || writes.some(w => w.collection === tasks && (!outcome.taskIds.includes(w.after._id) || w.after.receivedQtyInCtn !== null
      || w.after.ourPoNumber !== '' || w.after.supplierId !== ''))) throw Error('Original initial task identity required');
  const plan = planFormat === 'SEGMENTED_V2' ? appendIntakeProductCheckpoints({ company, body, plan: { writes }, productRows, generation }) : { writes };
  return { plan, outcome: copy(outcome), replay: writes.length === 0,
    // Company fence cannot serialize a concurrent opposite-company intake. Real
    // immutable routing/cross-company arbitration still requires proof before live.
    activationReady: false, blockers: ['ORIGINAL_AUTH_GATEWAY_REQUIRED', 'CROSS_COMPANY_ROUTING_PROOF_REQUIRED', 'PRODUCTION_INTAKE_CAPACITY_REQUIRED'] };
}
function intakeProtocolIdentity({ sourceSiteId, orderId, destination }) {
  if (sourceSiteId !== '5292b63a-30e5-4c0e-8762-a1b127bbc651' || typeof orderId !== 'string' || !orderId.trim()
    || !['NCT', 'GHR'].includes(destination)) throw Error('Original intake identity required');
  const digest = hash('ORDER_INTAKE', sourceSiteId, orderId, destination);
  return { requestId: digest.slice(0, 8) + '-' + digest.slice(8, 12) + '-4' + digest.slice(13, 16) + '-8' + digest.slice(17, 20) + '-' + digest.slice(20),
    memberId: 'INTERNAL_ORDER_INTAKE:' + sourceSiteId };
}
module.exports = { prepareOrderIntake, intakeProtocolIdentity };

},
// intake-product-checkpoint.cjs sha256:2eb7ef3e1791aefa19363b889e6cf843e56b6f33ad4561b91f531a36cf3f86d7
"intake-product-checkpoint.cjs": (load, module) => {
'use strict';

const { stockKey } = load("current-model.cjs");
const { hash } = load("commit-proof.cjs");
const { copy } = load("segmented-plan.cjs");
// Exact company-scoped product reads from the private shared barrier are required.
// Creates zero product metadata only; no receipt, reservation, PO or free cartons.
function appendIntakeProductCheckpoints({ company, body, plan, productRows, generation }) {
  if (!['NCT', 'GHR'].includes(company) || body?.destination !== company || !Array.isArray(body.lines)
    || !Array.isArray(plan?.writes) || !Number.isSafeInteger(generation) || generation < 0 || !Number.isSafeInteger(generation + 1)) throw Error('Private intake product context required');
  if (!plan.writes.length) return copy(plan); // Original accepted replay stays read-only.
  const identities = new Map();
  for (const line of body.lines) {
    const identity = { company, barcode: line.unitBarcode, packing: line.packingSize, ea: line.eaPerCtn, name: line.itemName };
    const key = stockKey(identity); if (!identities.has(key)) identities.set(key, identity);
  }
  if (!Array.isArray(productRows) || productRows.length !== identities.size) throw Error('Complete exact intake product reads required');
  const provided = new Map();
  for (const entry of productRows) {
    const key = stockKey(entry.identity);
    if (entry.identity.company !== company || !identities.has(key) || provided.has(key) || entry.row !== null && (!entry.row
      || entry.row._id !== hash(company, key) || entry.row.company !== company || entry.row.stockKey !== key || !entry.row._version
      || entry.row.lifecycleVersion !== 2 || !Number.isSafeInteger(entry.row.nextBorrowSequence) || entry.row.nextBorrowSequence < 1)) throw Error('Intake product checkpoint conflict');
    provided.set(key, entry.row);
  }
  const result = copy(plan), marker = result.writes.pop();
  if (marker?.after.action !== 'ORDER_RECEIVED') throw Error('Original accepted marker must remain last');
  for (const [key, identity] of identities) if (provided.get(key) === null) {
    result.writes.push({ collection: 'R2StockProducts', before: null, after: { _id: hash(company, key), schemaVersion: 1,
      company, stockKey: key, barcode: identity.barcode, name: identity.name, packing: identity.packing, ea: identity.ea,
      lifecycleVersion: 2, nextBorrowSequence: 1, onHand: 0, isolated: 0, available: 0, reservedUsable: 0,
      reviewRequired: false, reviewCodes: [], revision: 0, checkpointGeneration: generation + 1, status: 'CLOSED' } });
  }
  result.writes.push(marker); return result;
}
module.exports = { appendIntakeProductCheckpoints };

},
// current-cost-tables.cjs sha256:10c053bce4e9670fd615995a0b9d5a1580238ca1b33d306c0206f0bfe40e8978
"current-cost-tables.cjs": (load, module) => {
'use strict';
const { domainCollections } = load("domain-scope.cjs");
const { hash } = load("commit-proof.cjs");
// Only rows consumed by the ORIGINAL one-task reference retry; never all activity.
function createCurrentCostTables({ company, items, store }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function'
    || typeof store?.read !== 'function' || typeof store?.normalizeListedRow !== 'function') throw Error('Private exact cost reader required');
  const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  return async (selectedCompany, taskId, staff, requestId) => {
    if (selectedCompany !== company || !/^[a-f0-9]{32}$/.test(taskId || '') || !/^[a-f0-9-]{36}$/i.test(requestId || '')
      || typeof staff?.memberId !== 'string' || !staff.memberId || typeof staff.staffId !== 'string' || !staff.staffId) throw Error('Original exact cost scope required');
    const tables = { [orders]: [], [tasks]: [], [journal]: [] }, seen = new Set();
    function retain(collection, row, immutableHistory = false) {
      if (row !== null) {
        if (!row || typeof row._id !== 'string' || !row._id || row.company !== company
          && !(immutableHistory && collection === journal && row.company === undefined)) throw Error('Cost row company/identity conflict');
        const key = collection + ':' + row._id;
        if (!seen.has(key)) { seen.add(key); tables[collection].push(row); }
      }
      return row;
    }
    const exact = async (collection, id) => retain(collection, await store.read(collection, id));
    async function one(collection, criteria) {
      let query = items.query(collection);
      for (const [key, value] of Object.entries(criteria)) query = query.eq(key, value);
      const page = await query.limit(2).find({ consistentRead: true });
      if (!Array.isArray(page?.items) || page.items.length > 1) throw Error('Ambiguous original cost record');
      if (!page.items.length) return null;
      const raw = page.items[0];
      // Original pre-ACTIVE immutable receipt/special-task evidence does not need
      // a rewritten company/version field. It is NEVER a conditional before-image.
      const history = collection === journal && raw && !Object.hasOwn(raw, 'stockCommitVersion')
        && ['ORDER_RECEIVED', 'SPECIAL_PURCHASE_ADDED'].includes(criteria.action);
      const row = history ? JSON.parse(JSON.stringify(raw)) : store.normalizeListedRow(collection, raw);
      if (Object.entries(criteria).some(([key, value]) => row[key] !== value)) throw Error('Cost query identity conflict');
      return retain(collection, row, history);
    }
    const task = await exact(tasks, taskId);
    if (!task || !task._version || task.title !== taskId || !task.description || !task.imageAltText) throw Error('Original migrated cost task required');
    await one(orders, { title: task.description, sourceLineId: task.imageAltText });
    const receipt = await one(journal, { description: task.description, action: 'ORDER_RECEIVED', result: 'ACCEPTED' });
    if (task.specialPurchase === true && receipt?.details?.taskIds && !receipt.details.taskIds.includes(taskId)) {
      const event = await one(journal, { action: 'SPECIAL_PURCHASE_ADDED', imageAltText: taskId, result: 'SAVED' });
      if (event?.details?.parentTaskId) await exact(tasks, event.details.parentTaskId);
    }
    await exact(journal, hash(company, taskId, 'COST_LOCK'));
    for (const kind of ['RESULT', 'ATTEMPT', 'CAPTURE']) await exact(journal, hash(company, taskId, requestId, staff.memberId, kind));
    return tables;
  };
}
module.exports = { createCurrentCostTables };

},
// maintenance-snapshot-reader.cjs sha256:56c3025b038c2f194e444da05941059e361d22fb102d6caa0788019aa51c4690
"maintenance-snapshot-reader.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const { copy, same } = load("segmented-plan.cjs");
const { domainCollections } = load("domain-scope.cjs");
const { stockBootstrapPreflight } = load("bootstrap-preflight.cjs");
const { lifecycleBootstrapPreflight } = load("lifecycle-bootstrap-preflight.cjs");
const { encodeMaintenanceNativeImage, decodeMaintenanceNativeImage } = load("maintenance-native-images.cjs");
const { isMaintenanceBackupRecord } = load("maintenance-backup-store.cjs");
const Buffer=StockRuntimeBuffer;

// Private maintenance reader only, not a public method or a mode/drain authority.
// Uses original business projectors; all pages (including archived/unprojected
// rows) are retained for review/backup. A browser cannot supply rows or budgets.
function createMaintenanceSnapshotReader({ company, items, store, protocol, authenticateAdmin, verifyLegacyDrain,
  projectPurchaseWorkspace, projectStockCard, projectPurchaseOrders, limits, maxBackupBytes, pageSize = 100 }) {
  const [orders, tasks, purchaseOrders] = domainCollections(company), journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const legacy = [orders, tasks, journal, 'SharedSuppliers', purchaseOrders];
  const current = { positions: 'R2StockPositions', claims: 'R2StockClaims', products: 'R2StockProducts' };
  const names = [...legacy, ...Object.values(current)];
  if (typeof items?.query !== 'function' || typeof store?.normalizeListedRow !== 'function'
    || ['readControl', 'readSnapshot'].some(method => typeof protocol?.[method] !== 'function')
    || [authenticateAdmin, verifyLegacyDrain, projectPurchaseWorkspace, projectStockCard, projectPurchaseOrders].some(fn => typeof fn !== 'function')
    || !limits || names.some(name => !Number.isSafeInteger(limits[name]) || limits[name] < 1)
    || !Number.isSafeInteger(maxBackupBytes) || maxBackupBytes < 1
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw Error('Explicit private maintenance snapshot dependencies/budgets required');

  async function readState(ownedMigration = null) {
    const admin = await authenticateAdmin();
    if (admin?.isAdmin !== true || typeof admin.memberId !== 'string' || !admin.memberId) throw Error('Administrator maintenance capture required');
    const requireDrain = async () => {
      if (await verifyLegacyDrain({ company, purpose: 'MAINTENANCE_CAPTURE' }) !== true) throw Error('Legacy request drain is not verified');
    };
    await requireDrain();
    let queries = 0;
    const snapshot = await protocol.readSnapshot(async control => {
      if (control?._id !== hash(company, 'STOCK_CONTROL') || control.company !== company || control.mode !== 'MAINTENANCE'
        || control.schemaVersion !== 1 || control.transferIndexVersion !== 2 || !control._version || control.pending !== null
        || !Number.isSafeInteger(control.generation) || control.generation < 0) throw Error('Verified maintenance capture control required');
      const tables = {}, capturedTables = {}; let retainedBytes = 0;
      for (const collection of names) {
        const rows = [], seen = new Set(); let expected = null, previous = null;
        do {
          let query = items.query(collection);
          // Historical company-specific tables include original rows with no
          // company metadata. Shared POs are scanned completely before filtering;
          // missing ownership is a review error, never silently omitted.
          if (Object.values(current).includes(collection)) query = query.eq('company', company);
          const page = await query.ascending('_id').skip(rows.length).limit(pageSize)
            .find({ consistentRead: true, returnTotalCount: true });
          queries++;
          if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount < rows.length
            || page.totalCount > limits[collection] || expected !== null && expected !== page.totalCount
            || page.items.length !== Math.min(pageSize, page.totalCount - rows.length)) throw Error('Incomplete or over-budget maintenance table: ' + collection);
          expected = page.totalCount;
          for (const row of page.items) {
            if (typeof row?._id !== 'string' || !row._id || seen.has(row._id) || previous !== null && previous >= row._id
              || Object.hasOwn(row, '_version')) throw Error('Distinct ordered native maintenance rows required');
            if (collection === purchaseOrders ? !['NCT', 'GHR'].includes(row.company)
              : collection !== 'SharedSuppliers' && (Object.values(current).includes(collection) ? row.company !== company
                : Object.hasOwn(row, 'company') && row.company !== company)) throw Error('Maintenance collection company conflict');
            seen.add(row._id); previous = row._id;
            const image = encodeMaintenanceNativeImage(row);
            if (collection !== journal || !isMaintenanceBackupRecord(row, company)) retainedBytes += Buffer.byteLength(JSON.stringify(image), 'utf8');
            if (retainedBytes > maxBackupBytes) throw Error('Maintenance backup exceeds explicit byte budget');
            rows.push(decodeMaintenanceNativeImage(image));
          }
        } while (rows.length < expected);
        capturedTables[collection] = rows;
        const ownedLock = row => {
          if (!ownedMigration || row._id !== hash(company + '/PURCHASE', 'LOCK')) return false;
          const fields = Object.keys(row).filter(key => !['_createdDate', '_updatedDate', '_owner', '_ownerId'].includes(key)).sort().join(',');
          if (fields !== '_id,attempt,company,owner' || row.company !== company
            || row.owner !== hash(company + '/PURCHASE', ownedMigration.requestId, admin.memberId)
            || typeof row.attempt !== 'string' || !row.attempt) throw Error('Exact owned migration capture lock required');
          return true;
        };
        if (ownedMigration && collection === journal && !rows.some(ownedLock)) throw Error('Owned migration capture lock missing');
        tables[collection] = collection === purchaseOrders ? rows.filter(row => row.company === company)
          : collection === journal ? rows.filter(row => !isMaintenanceBackupRecord(row, company) && !ownedLock(row)) : rows;
      }
      const metadataRows = [];
      for (const collection of [orders, tasks, purchaseOrders]) for (const row of tables[collection]) {
        if (!Object.hasOwn(row, 'stockCommitVersion')) {
          if (Object.prototype.toString.call(row._updatedDate) !== '[object Date]' || !Number.isFinite(row._updatedDate.getTime())
            || row.stockOperationProtocol != null) throw Error('Typed original metadata checkpoint required');
          metadataRows.push({ collection, row });
        }
      }
      const normalized = (collection, row) => Object.hasOwn(row, 'stockCommitVersion') ? store.normalizeListedRow(collection, row) : copy(row);
      const projectedTables = Object.fromEntries(legacy.map(collection => [collection, tables[collection].map(row =>
        collection === 'SharedSuppliers' || collection === journal ? copy(row) : normalized(collection, row))]));
      const workspace = projectPurchaseWorkspace({ company, orders: projectedTables[orders], tasks: projectedTables[tasks],
        activity: projectedTables[journal], suppliers: projectedTables.SharedSuppliers, staff: {} });
      if (workspace?.company !== company || !Array.isArray(workspace.tasks)) throw Error('Original complete maintenance workspace required');
      const context = { ...workspace, activity: projectedTables[journal] };
      // These are display/session metadata, not source business evidence. The
      // original projector's fetchedAt must not change a checkpoint on each read.
      delete context.staff; delete context.fetchedAt; delete context.readAt;
      const existing = { company, complete: true, transfers: tables[journal].filter(row => row.action === 'STOCK_TRANSFER_CURRENT').map(row => normalized(journal, row)) };
      for (const [kind, collection] of Object.entries(current)) existing[kind] = tables[collection].map(row => store.normalizeListedRow(collection, row));
      const taskRows = projectedTables[tasks], base = stockBootstrapPreflight({ company, context,
        purchaseRecords: projectedTables[purchaseOrders], existing, control, projectStockCard, projectPurchaseOrders, includeProjection: true });
      const expected = base.canBootstrap ? lifecycleBootstrapPreflight({ company, context, base, taskRows, generation: control.generation }) : base;
      if (metadataRows.length) expected.blockers = [...new Set([...expected.blockers, 'LEGACY_VERSION_INITIALIZATION_NOT_VERIFIED'])];
      const payload = encodeMaintenanceNativeImage({ company, control, tables });
      if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > maxBackupBytes) throw Error('Maintenance backup exceeds explicit byte budget');
      const backup = { schema: 'STOCK_MAINTENANCE_TYPED_BACKUP_V1', company, backupId: hash('MAINTENANCE_NATIVE_BACKUP_V1', payload), payload };
      // Strong pages are not a cross-table transaction. Re-read the complete
      // cohort and compare native images, not only counts, so an edit or same-size
      // replacement during capture cannot be mistaken for the original backup.
      // This is an additional freshness check, NOT proof of old-request drain.
      for (const collection of names) {
        const captured = capturedTables[collection]; let offset = 0;
        do {
          let query = items.query(collection);
          if (Object.values(current).includes(collection)) query = query.eq('company', company);
          const page = await query.ascending('_id').skip(offset).limit(pageSize)
            .find({ consistentRead: true, returnTotalCount: true });
          queries++;
          if (!Array.isArray(page?.items) || page.totalCount !== captured.length
            || page.items.length !== Math.min(pageSize, captured.length - offset)
            || page.items.some((row, index) => JSON.stringify(encodeMaintenanceNativeImage(row))
              !== JSON.stringify(encodeMaintenanceNativeImage(captured[offset + index])))) throw Error('Maintenance native cohort changed during capture');
          offset += page.items.length;
        } while (offset < captured.length);
      }
      const currentAdmin = await authenticateAdmin();
      if (currentAdmin?.isAdmin !== true || currentAdmin.memberId !== admin.memberId) throw Error('Maintenance capture administrator changed');
      await requireDrain();
      if (!same(control, await protocol.readControl())) throw Error('Maintenance capture control changed');
      return { company, control, context, taskRows, expected, existing, backup, metadataRows,
        complete: true, emptyCurrentConfirmed: ['positions', 'claims', 'products', 'transfers'].every(kind => !existing[kind].length),
        activationReady: false, durableBackupConfirmed: false };
    });
    return { ...snapshot.rows, metrics: { queries } };
  }
  async function read() {
    if (arguments.length) throw Error('Maintenance capture accepts no browser images or authority');
    return readState();
  }
  async function readOwnedMigration(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'checkpointId,requestId'
      || !/^[a-f0-9-]{36}$/i.test(input.requestId || '') || !/^[a-f0-9]{32}$/.test(input.checkpointId || '')) throw Error('Original owned migration capture identity required');
    const result = await readState(input);
    if (result.expected.checkpointId !== input.checkpointId) throw Error('Owned migration checkpoint changed');
    return result;
  }
  // Direct composition seam for createMaintenanceMigration.capture. A different
  // current cohort never adopts a previously displayed checkpoint. Durability
  // and the actual Admin/drain binding remain installation prerequisites.
  async function capture(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'checkpointId,company' || input.company !== company
      || !/^[a-f0-9]{32}$/.test(input.checkpointId || '')) throw Error('Original maintenance checkpoint identity required');
    const result = await read();
    if (result.expected.checkpointId !== input.checkpointId) throw Error('Maintenance checkpoint changed');
    return result;
  }
  return { read, capture, readOwnedMigration };
}
module.exports = { createMaintenanceSnapshotReader };

},
// bootstrap-preflight.cjs sha256:9083326a4282f92713e1587e671923ea425c4432615ebf045b8d9be2b80fb50e
"bootstrap-preflight.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const { convertProjectedStock } = load("current-model.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const fingerprint = value => hash(canonical(value));
// Pure maintenance-window preflight ONLY. Produces private candidate images but
// performs no CMS/schema/index changes, tags, writes, chunking or mode transition.
function stockBootstrapPreflight({ company, context, purchaseRecords, existing, control, projectStockCard, projectPurchaseOrders, includeProjection = false }) {
  if (typeof includeProjection !== 'boolean') throw Error('Private projection option required');
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
    || !Array.isArray(purchaseRecords) || typeof projectStockCard !== 'function' || typeof projectPurchaseOrders !== 'function'
    || existing?.complete !== true || !['positions', 'claims', 'products', 'transfers'].every(k => Array.isArray(existing[k]))) throw Error('Complete private bootstrap snapshots required');
  const blockers = [], expectedControlId = hash(company, 'STOCK_CONTROL'), expectedLockId = hash(company + '/PURCHASE', 'LOCK');
  if (control?._id !== expectedControlId || control.company !== company || control.mode !== 'MAINTENANCE' || control.schemaVersion !== 1
    || !control._version || !Number.isSafeInteger(control.generation) || control.generation < 0 || control.pending) blockers.push('VERIFIED_MAINTENANCE_CONTROL_REQUIRED');
  if (['positions', 'claims', 'products', 'transfers'].some(k => existing[k].length)) blockers.push('CURRENT_ROWS_ALREADY_EXIST_NO_OVERWRITE');
  const activity = new Map();
  for (const row of context.activity) {
    if (!row._id || activity.has(row._id) || row.company && row.company !== company) throw Error('Complete unique company journal snapshot required');
    activity.set(row._id, row);
    if (row._id === expectedLockId || ['PURCHASE_OPERATION_LOCK','PURCHASE_TASK_COST_LOCK','COST_RETRY_LOCK'].includes(row.action)) blockers.push('BUSINESS_LOCK_PRESENT');
    if (row.action === 'STOCK_TRANSFER_CURRENT') blockers.push('BORROWING_FACTS_REQUIRE_CURRENT_CHECKPOINT');
    if (row.stockOperationProtocol === 2 && row.action === 'STOCK_PLAN_MANIFEST') blockers.push('SEGMENTED_FACTS_REQUIRE_CURRENT_CHECKPOINT');
  }
  for (const task of context.tasks) {
    if (activity.has(hash(company, task.id, 'COST_LOCK'))) blockers.push('BUSINESS_COST_LOCK_PRESENT');
    if (activity.has(hash(company, task.id, 'GP_LOCK'))) blockers.push('BUSINESS_GP_LOCK_PRESENT');
  }
  for (const row of context.activity) {
    if (row.action === 'PURCHASE_OPERATION_PREPARED') {
      const result = activity.get(hash(row._id, 'RESULT'));
      if (row.details?.kind !== 'PREPARED' || !row.details.digest || !result || result.action !== 'PURCHASE_OPERATION_RESULT'
        || result.result !== 'SAVED' || result.details?.kind !== 'RESULT' || result.details.digest !== row.details.digest
        || result.details.outcome?.ok !== true) blockers.push('LEGACY_SAVE_NOT_CONFIRMED');
    } else if (row.plan && Number.isSafeInteger(row.baseGeneration)) {
      const result = activity.get(hash(row._id, 'RESULT'));
      if (!row.digest || !result || result.digest !== row.digest || result.baseGeneration !== row.baseGeneration || result.outcome?.ok !== true
        || result.outcome.operationId !== row._id || result.outcome.generation !== row.baseGeneration + 1
        || control.generation < result.outcome.generation) blockers.push('CURRENT_SAVE_NOT_CONFIRMED');
    }
  }
  const businessContext = { ...context }; delete businessContext.readAt;
  const sourceHash = fingerprint({ company, context: businessContext, purchaseRecords }), currentHash = fingerprint(existing), controlHash = fingerprint(control);
  const checkpointId = hash('STOCK_BOOTSTRAP', company, sourceHash, currentHash, controlHash);
  if (blockers.length) return { checkpointId, sourceHash, currentHash, controlHash, canBootstrap: false, activationReady: false,
    blockers: [...new Set(blockers)], rows: null };
  const orders = projectPurchaseOrders({ company, workspace: context, records: purchaseRecords });
  const tasks = context.tasks.map(task => {
    if (task.warehouse?.hasPhysicalReceipt !== true) return copy(task);
    const matches = orders.filter(po => po.company === company && po.taskIds.includes(task.id) && po.number === task.po);
    if (matches.length !== 1) throw Error('One resolved authoritative source PO required');
    return { ...copy(task), poId: matches[0].id };
  });
  const projection = projectStockCard({ ...context, tasks }), candidate = convertProjectedStock({ snapshot: projection, tasks, generation: control.generation });
  const rows = Object.fromEntries(['positions', 'claims', 'products'].map(k => [k, candidate[k].map(row => ({ ...row,
    _version: hash(checkpointId, k, row._id) }))]));
  return { company, generation: control.generation, checkpointId, sourceHash, currentHash, controlHash, canBootstrap: true, activationReady: false, blockers: [], rows,
    ...(includeProjection ? { privateProjection: copy(projection) } : {}),
    reviewRequired: !candidate.activationReady, counts: Object.fromEntries(Object.entries(rows).map(([k, values]) => [k, values.length])),
    // This is a PRIVATE dry-run parity aid, not evidence that production has been migrated.
    parity: { sources: rows.positions.length, products: rows.products.length, legacyProjectionHash: fingerprint(projection) } };
}
module.exports = { stockBootstrapPreflight };

},
// lifecycle-bootstrap-preflight.cjs sha256:f5a5606014f498c0ea9c6cce5aa535f1ddc250e083243cb9f607b0b67deeba99
"lifecycle-bootstrap-preflight.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const { stockKey } = load("current-model.cjs");
const { copy } = load("segmented-plan.cjs");
const count = n => Number.isSafeInteger(n) && n >= 0;
// Private maintenance DRY RUN. Reuses the original bootstrap projection, never
// fabricates counters from an incomplete current page. NO database capability.
function lifecycleBootstrapPreflight({ company, context, base, taskRows, generation }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks)
    || base?.canBootstrap !== true || base.company !== company || base.generation !== generation || !base.checkpointId || base.privateProjection?.company !== company
    || !Array.isArray(base.privateProjection.items) || !Array.isArray(base.rows?.positions) || !Array.isArray(base.rows.claims)
    || !Array.isArray(base.rows.products) || !Array.isArray(taskRows) || !count(generation)) throw Error('Complete original maintenance bootstrap evidence required');
  const raw = new Map(taskRows.map(row => [row._id, row])), tasks = new Map(context.tasks.map(t => [t.id, t]));
  if (raw.size !== taskRows.length || tasks.size !== context.tasks.length || raw.size !== tasks.size) throw Error('Complete exact legacy task snapshot required');
  const dispatched = new Map(), sourceDispatch = new Map(), products = new Map(base.rows.products.map(p => [p.stockKey, copy(p)]));
  for (const item of base.privateProjection.items) for (const source of item.sources) {
    if (!tasks.has(source.sourceTaskId) || sourceDispatch.has(source.sourceTaskId) || !Array.isArray(source.reservations)) throw Error('Bootstrap source provenance conflict');
    let total = 0;
    for (const reservation of source.reservations) {
      if (!tasks.has(reservation.taskId) || !count(reservation.dispatched) || !count(total + reservation.dispatched)) throw Error('Known historical dispatch provenance required');
      total += reservation.dispatched;
      const key = source.sourceTaskId + '/' + reservation.taskId;
      if (dispatched.has(key)) throw Error('Duplicate bootstrap dispatch claim');
      dispatched.set(key, reservation.dispatched);
    }
    if (total !== source.dispatched) throw Error('Bootstrap source dispatch total differs');
    sourceDispatch.set(source.sourceTaskId, total);
  }
  const taskTotals = new Map([...tasks.keys()].map(id => [id, 0]));
  const positionMap = new Map(base.rows.positions.map(p => [p._id, p]));
  const claims = base.rows.claims.map(claim => {
    const position = positionMap.get(claim.positionId), source = position?.sourceTaskId;
    if (!source || !dispatched.has(source + '/' + claim.taskId)) throw Error('Bootstrap claim dispatch evidence missing');
    const amount = dispatched.get(source + '/' + claim.taskId), prior = taskTotals.get(claim.taskId);
    if (!count(prior) || !count(prior + amount)) throw Error('Bootstrap task dispatch overflow');
    taskTotals.set(claim.taskId, prior + amount);
    return { ...copy(claim), dispatchedCumulative: amount };
  });
  const positions = base.rows.positions.map(position => {
    if (sourceDispatch.get(position.sourceTaskId) !== position.dispatched) throw Error('Bootstrap exact source dispatch conflict');
    return { ...copy(position), borrowRepaidCumulative: 0 };
  });
  const blockers = base.reviewRequired ? ['STOCK_ATTRIBUTION_REQUIRES_REVIEW'] : [], taskInitializations = [];
  for (const task of context.tasks) {
    const row = raw.get(task.id), amount = taskTotals.get(task.id), version = row?._version || row?.stockCommitVersion;
    if (!row || row.company && row.company !== company || row.description !== task.orderId || row.imageAltText !== task.sourceLineId
      || !count(amount) || typeof (task.requested ?? task.ord) !== 'number' || amount > (task.requested ?? task.ord)) throw Error('Legacy task identity/dispatch conflict');
    if (row.stockCounterSchema != null && (row.stockCounterSchema !== 2 || row.stockDispatchedCumulative !== amount
      || !count(row.stockCounterGeneration) || row.stockCounterGeneration > generation)) blockers.push('EXISTING_TASK_COUNTER_REQUIRES_REVIEW');
    if (!version) blockers.push('TASK_VERSION_INITIALIZATION_NOT_VERIFIED');
    else if (typeof version !== 'string' || row._version && row.stockCommitVersion && row._version !== row.stockCommitVersion) throw Error('Legacy task version conflict');
    taskInitializations.push({ id: task.id, observedHash: hash(row), observedVersion: version || null,
      fields: { company, stockCounterSchema: 2, stockDispatchedCumulative: amount, stockCounterGeneration: generation } });
    // Existing real order products with no physical receipt still need one zero
    // identity/high-water checkpoint. Never create rows for the whole catalogue.
    const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea }, key = stockKey(identity);
    if (!products.has(key)) products.set(key, { _id: hash(company, key), schemaVersion: 1, ...identity, stockKey: key, name: task.name || '',
      onHand: 0, isolated: 0, reservedUsable: 0, available: 0, reviewRequired: false, reviewCodes: [], revision: 0,
      checkpointGeneration: generation, status: 'CLOSED' });
  }
  const productRows = [...products.values()].map(p => ({ ...p, lifecycleVersion: 2, nextBorrowSequence: 1 }));
  const checkpointId = hash(base.checkpointId, 'LIFECYCLE_V2', taskInitializations);
  const rows = Object.fromEntries(Object.entries({ positions, claims, products: productRows }).map(([kind, values]) => [kind,
    values.map(row => ({ ...row, _version: hash(checkpointId, kind, row._id) }))]));
  return { company, generation, checkpointId, baseCheckpointId: base.checkpointId, canPlan: true,
    canApply: false, activationReady: false, blockers: [...new Set([...blockers, 'ADMIN_MIGRATION_APPLY_NOT_IMPLEMENTED'])],
    rows, taskInitializations, proposedTransferIndexVersion: 2,
    // No immutable prepared plan/endpoint may treat these fields as executable CAS
    // evidence until missing legacy version initialization and freshness are proven.
    counts: { positions: positions.length, claims: claims.length, products: productRows.length, tasks: taskInitializations.length } };
}
module.exports = { lifecycleBootstrapPreflight };

},
// maintenance-native-images.cjs sha256:f903b7a23b83de37d378f34d342b056b9dbc20587b0b9bd460870abf6b060ff4
"maintenance-native-images.cjs": (load, module) => {
'use strict';

// Explicit private backup encoding. Dates are tagged by their actual native type,
// never by field-name or ISO-looking text. JSON persistence cannot erase the
// _updatedDate Date needed by the existing metadata initialization condition.
function encodeMaintenanceNativeImage(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (!Number.isFinite(value.getTime())) throw Error('Valid native backup Date required');
    return ['DATE', value.toISOString()];
  }
  if (value === null) return ['NULL'];
  if (typeof value === 'string') return ['TEXT', value];
  if (typeof value === 'boolean') return ['BOOLEAN', value];
  if (typeof value === 'number' && Number.isFinite(value)) return ['NUMBER', Object.is(value, -0) ? '-0' : value];
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw Error('Dense native backup array required');
    return ['ARRAY', value.map(encodeMaintenanceNativeImage)];
  }
  const proto = value && typeof value === 'object' && Object.getPrototypeOf(value);
  if (value && typeof value === 'object' && (proto === null || Object.getPrototypeOf(proto) === null
    && Object.getOwnPropertyDescriptor(proto, 'constructor')?.value?.name === 'Object') && !Object.getOwnPropertySymbols(value).length) {
    // Existing nested business snapshots may be hashed as original JSON. Keep
    // their key order; canonical protocol-metadata comparison is separate.
    return ['OBJECT', Object.keys(value).map(key => [key, encodeMaintenanceNativeImage(value[key])])];
  }
  throw Error('Supported native backup value required');
}

function decodeMaintenanceNativeImage(value) {
  if (!Array.isArray(value)) throw Error('Tagged native backup image required');
  const [type, data] = value;
  if (type === 'NULL' && value.length === 1) return null;
  if (value.length !== 2) throw Error('Exact tagged native backup image required');
  if (type === 'TEXT' && typeof data === 'string' || type === 'BOOLEAN' && typeof data === 'boolean') return data;
  if (type === 'NUMBER' && (typeof data === 'number' && Number.isFinite(data) && !Object.is(data, -0) || data === '-0')) return data === '-0' ? -0 : data;
  if (type === 'DATE' && typeof data === 'string') {
    const date = new Date(data);
    if (Number.isFinite(date.getTime()) && date.toISOString() === data) return date;
  }
  if (type === 'ARRAY' && Array.isArray(data)) return data.map(decodeMaintenanceNativeImage);
  if (type === 'OBJECT' && Array.isArray(data) && data.every(entry => Array.isArray(entry) && entry.length === 2
    && typeof entry[0] === 'string') && new Set(data.map(entry => entry[0])).size === data.length) {
    return Object.fromEntries(data.map(([key, image]) => [key, decodeMaintenanceNativeImage(image)]));
  }
  throw Error('Valid exact native backup image required');
}
module.exports = { encodeMaintenanceNativeImage, decodeMaintenanceNativeImage };

},
// maintenance-backup-store.cjs sha256:ccec4096f1518fa17f4a5701c117d7e6c5a4ef65de287888c2c40c3da76c733c
"maintenance-backup-store.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const { same, copy, utf8Bytes } = load("segmented-plan.cjs");
const { domainCollections } = load("domain-scope.cjs");
const { encodeMaintenanceNativeImage, decodeMaintenanceNativeImage } = load("maintenance-native-images.cjs");
const FORMAT = 'STOCK_NATIVE_BACKUP_PARTS_V1';
const actions = ['STOCK_MAINTENANCE_BACKUP_HEADER', 'STOCK_MAINTENANCE_BACKUP_PART', 'STOCK_MAINTENANCE_BACKUP_CONFIRMED'];
const hex = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const keys = (value, expected) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === expected.split(' ').sort().join(',');
const partId = (root, backup, index) => hash(root, backup, 'BACKUP_PART', index);
const metadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId']);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => hash(canonical(value));

// Reserved nonbusiness records only. This is classification, NOT proof of
// retention/privacy or a grant to execute any contained image. Native system
// metadata may be present on lists; every application field must match exactly.
function isMaintenanceBackupRecord(raw, company) {
  if (!actions.includes(raw?.action)) return false;
  const row = Object.fromEntries(Object.entries(raw).filter(([key]) => !metadata.has(key))), d = row.details;
  let valid = ['NCT', 'GHR'].includes(company) && keys(row, '_id company action details') && row.company === company
    && d?.format === FORMAT && hex(d.rootId) && hex(d.backupId);
  if (row.action === actions[0]) valid = valid && keys(d, 'format rootId requestId memberId checkpointId backupId payloadHash payloadBytes controlHash parts')
    && uuid(d.requestId) && typeof d.memberId === 'string' && !!d.memberId && hex(d.checkpointId) && hex(d.controlHash)
    && row._id === d.rootId && d.rootId === hash(company, 'STOCK_BACKUP', d.requestId, d.memberId)
    && hex(d.payloadHash) && count(d.payloadBytes) && d.payloadBytes > 0 && Array.isArray(d.parts) && d.parts.length > 0
    && d.parts.every((ref, index) => keys(ref, 'id hash bytes') && ref.id === partId(d.rootId, d.backupId, index)
      && hex(ref.hash) && count(ref.bytes) && ref.bytes > 0);
  else if (row.action === actions[1]) valid = valid && keys(d, 'format rootId backupId index payload hash')
    && count(d.index) && row._id === partId(d.rootId, d.backupId, d.index) && typeof d.payload === 'string'
    && d.payload.length > 0 && d.hash === hash(d.payload);
  else valid = valid && keys(d, 'format rootId backupId headerHash') && row._id === hash(d.rootId, 'BACKUP_CONFIRMED') && hex(d.headerHash);
  if (!valid) throw Error('Malformed reserved maintenance backup record');
  return true;
}

function decodeBackup(backup, company) {
  if (!keys(backup, 'schema company backupId payload') || backup.schema !== 'STOCK_MAINTENANCE_TYPED_BACKUP_V1'
    || backup.company !== company || backup.backupId !== hash('MAINTENANCE_NATIVE_BACKUP_V1', backup.payload)) throw Error('Exact typed maintenance backup required');
  const raw = decodeMaintenanceNativeImage(backup.payload), [orders, tasks, po] = domainCollections(company);
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const names = [orders, tasks, journal, po, 'SharedSuppliers', 'R2StockPositions', 'R2StockClaims', 'R2StockProducts'];
  if (!keys(raw, 'company control tables') || raw.company !== company || !keys(raw.tables, names.join(' '))
    || !same(encodeMaintenanceNativeImage(raw), backup.payload)) throw Error('Complete canonical native backup required');
  for (const name of names) {
    const rows = raw.tables[name];
    if (!Array.isArray(rows) || new Set(rows.map(row => row?._id)).size !== rows.length
      || rows.some(row => typeof row?._id !== 'string' || !row._id || Object.hasOwn(row, '_version')
        || (name === po || name.startsWith('Stock') ? row.company !== company
          : name !== 'SharedSuppliers' && Object.hasOwn(row, 'company') && row.company !== company)
        || name === journal && isMaintenanceBackupRecord(row, company))) throw Error('Native backup row scope conflict');
  }
  return raw;
}

// Existing company journal read/insert capability ONLY. No updates, deletes,
// locks, mode/generation transition, new collection, or inventory authority.
// A real private-retention verifier is mandatory before the first storage read;
// this module never assumes the existing journal has a suitable native ACL.
function createMaintenanceBackupStore({ company, store, authenticateAdmin, verifyPrivateRetention, verifyLegacyDrain,
  readControl, readSnapshot, policy }) {
  if (!['NCT', 'GHR'].includes(company) || ['read', 'insert'].some(method => typeof store?.[method] !== 'function')
    || [authenticateAdmin, verifyPrivateRetention, verifyLegacyDrain, readControl, readSnapshot].some(fn => typeof fn !== 'function')
    || !policy || ['recordBudgetBytes', 'maxBackupBytes', 'maxFragments', 'partsPerInvocation'].some(key => !count(policy[key]) || !policy[key])
    || policy.recordBudgetBytes < 2048 || policy.recordBudgetBytes > 256000) throw Error('Explicit private backup storage dependencies/policies required');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', bytes = row => utf8Bytes(JSON.stringify(row));
  function input(request) {
    if (!keys(request, 'requestId') || !uuid(request.requestId)) throw Error('Original backup request required');
  }
  async function authorize(memberId) {
    const admin = await authenticateAdmin();
    if (admin?.isAdmin !== true || typeof admin.memberId !== 'string' || !admin.memberId || memberId && memberId !== admin.memberId) throw Error('Administrator backup retention required');
    if (await verifyPrivateRetention({ company, collection: journal }) !== true) throw Error('Private native backup retention is not verified');
    return admin.memberId;
  }
  async function maintenance(control) {
    const actual = await readControl();
    if (actual?._id !== hash(company, 'STOCK_CONTROL') || actual.company !== company || actual.mode !== 'MAINTENANCE'
      || actual.schemaVersion !== 1 || actual.transferIndexVersion !== 2 || !actual._version || actual.pending !== null
      || !count(actual.generation) || control && !same(actual, control)) throw Error('Unchanged maintenance backup control required');
    if (await verifyLegacyDrain({ company, purpose: 'MAINTENANCE_BACKUP' }) !== true) throw Error('Legacy request drain is not verified');
    return actual;
  }
  function build(snapshot, requestId, memberId) {
    if (snapshot?.company !== company || snapshot.complete !== true || !hex(snapshot.expected?.checkpointId)) throw Error('Complete server-owned backup capture required');
    const raw = decodeBackup(snapshot.backup, company);
    if (!same(raw.control, snapshot.control)) throw Error('Original backup control image required');
    const rootId = hash(company, 'STOCK_BACKUP', requestId, memberId), backupId = snapshot.backup.backupId;
    const payload = JSON.stringify(snapshot.backup), parts = [];
    if (utf8Bytes(payload) > policy.maxBackupBytes) throw Error('Backup payload byte policy exceeded');
    let offset = 0;
    while (offset < payload.length) {
      if (parts.length >= policy.maxFragments) throw Error('Backup fragment policy exceeded');
      const index = parts.length, wrap = text => ({ _id: partId(rootId, backupId, index), company, action: actions[1],
        details: { format: FORMAT, rootId, backupId, index, payload: text, hash: hash(text) } });
      let low = 1, high = Math.min(payload.length - offset, policy.recordBudgetBytes), size = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (bytes(wrap(payload.slice(offset, offset + mid))) <= policy.recordBudgetBytes) { size = mid; low = mid + 1; } else high = mid - 1;
      }
      if (size && /[\uD800-\uDBFF]/.test(payload[offset + size - 1]) && /[\uDC00-\uDFFF]/.test(payload[offset + size] || '')) size--;
      if (!size) throw Error('Backup fragment metadata exceeds policy');
      parts.push(wrap(payload.slice(offset, offset + size))); offset += size;
    }
    const header = { _id: rootId, company, action: actions[0], details: { format: FORMAT, rootId, requestId, memberId,
      checkpointId: snapshot.expected.checkpointId, backupId, payloadHash: hash(payload), payloadBytes: utf8Bytes(payload), controlHash: fingerprint(snapshot.control),
      parts: parts.map(row => ({ id: row._id, hash: row.details.hash, bytes: utf8Bytes(row.details.payload) })) } };
    if (bytes(header) > policy.recordBudgetBytes) throw Error('Backup header exceeds record policy');
    return { header, parts };
  }
  async function exact(id) {
    const row = await store.read(journal, id);
    if (row !== null && (!isMaintenanceBackupRecord(row, company) || row._id !== id || bytes(row) > policy.recordBudgetBytes)) throw Error('Backup exact storage identity conflict');
    return row;
  }
  async function retainRecord(row, current) {
    if (current !== null && !same(current, row)) throw Error('Backup occupied identity conflict');
    if (current === null) await store.insert(journal, row);
    // Unknown replies propagate: do NOT catch/retry or publish a confirmation.
    if (!same(await exact(row._id), row)) throw Error('Backup storage readback differs');
  }
  async function inspectOwned(requestId, memberId, header) {
    const rootId = hash(company, 'STOCK_BACKUP', requestId, memberId);
    header = header || await exact(rootId);
    if (!header || header.action !== actions[0] || header.details.memberId !== memberId || header.details.requestId !== requestId
      || header.details.parts.length > policy.maxFragments || header.details.payloadBytes > policy.maxBackupBytes) throw Error('Original bounded backup header required');
    const confirmation = { _id: hash(rootId, 'BACKUP_CONFIRMED'), company, action: actions[2],
      details: { format: FORMAT, rootId, backupId: header.details.backupId, headerHash: fingerprint(header) } };
    if (!same(await exact(confirmation._id), confirmation)) throw Error('Backup confirmation is not complete');
    const pieces = []; let total = 0;
    for (const [index, ref] of header.details.parts.entries()) {
      const row = await exact(ref.id);
      if (row?.action !== actions[1] || row.details.rootId !== rootId || row.details.backupId !== header.details.backupId
        || row.details.index !== index || row.details.hash !== ref.hash || utf8Bytes(row.details.payload) !== ref.bytes) throw Error('Backup fragment readback is incomplete');
      total += ref.bytes; if (total > policy.maxBackupBytes) throw Error('Backup payload byte policy exceeded');
      pieces.push(row.details.payload);
    }
    const payload = pieces.join('');
    if (total !== header.details.payloadBytes || hash(payload) !== header.details.payloadHash) throw Error('Backup payload integrity conflict');
    const backup = JSON.parse(payload), raw = decodeBackup(backup, company);
    if (backup.backupId !== header.details.backupId || fingerprint(raw.control) !== header.details.controlHash || JSON.stringify(backup) !== payload) throw Error('Backup identity changed');
    await authorize(memberId);
    return { company, requestId, retainedBy: memberId, checkpointId: header.details.checkpointId, backupId: backup.backupId, backup, raw,
      durableBackupConfirmed: true, activationReady: false };
  }
  async function inspect(request) {
    input(request); const memberId = await authorize();
    return inspectOwned(request.requestId, memberId);
  }
  async function retain(request) {
    input(request); const memberId = await authorize(), rootId = hash(company, 'STOCK_BACKUP', request.requestId, memberId);
    const prior = await exact(rootId), complete = await exact(hash(rootId, 'BACKUP_CONFIRMED'));
    if (complete) return inspectOwned(request.requestId, memberId, prior);
    const control = await maintenance(), snapshot = await readSnapshot();
    if (!same(snapshot?.control, control)) throw Error('Backup capture changed maintenance control');
    const { header, parts } = build(snapshot, request.requestId, memberId);
    await authorize(memberId); await maintenance(control);
    await retainRecord(header, prior);
    let inserted = 0;
    for (const row of parts) {
      const current = await exact(row._id);
      if (current === null && inserted >= policy.partsPerInvocation) return { company, requestId: request.requestId,
        checkpointId: header.details.checkpointId, backupId: header.details.backupId, pending: true, durableBackupConfirmed: false };
      await authorize(memberId); await maintenance(control);
      await retainRecord(row, current); if (current === null) inserted++;
    }
    await authorize(memberId); await maintenance(control);
    const confirmation = { _id: hash(rootId, 'BACKUP_CONFIRMED'), company, action: actions[2],
      details: { format: FORMAT, rootId, backupId: header.details.backupId, headerHash: fingerprint(header) } };
    await retainRecord(confirmation, null);
    return inspectOwned(request.requestId, memberId, header);
  }
  function metadataReader(request) {
    input(request); const originalRequest = copy(request);
    return async entry => {
      if (!keys(entry, 'company checkpointId ordinal') || entry.company !== company || !hex(entry.checkpointId) || !count(entry.ordinal)) throw Error('Original retained metadata ordinal required');
      const retained = await inspect(originalRequest);
      if (retained.checkpointId !== entry.checkpointId) throw Error('Retained metadata checkpoint differs');
      const rows = domainCollections(company).flatMap(collection => retained.raw.tables[collection]
        .filter(row => !Object.hasOwn(row, 'stockCommitVersion')).map(row => ({ collection, row })));
      const selected = rows[entry.ordinal];
      if (!selected || Object.prototype.toString.call(selected.row._updatedDate) !== '[object Date]'
        || !Number.isFinite(selected.row._updatedDate.getTime()) || selected.row.stockOperationProtocol != null) throw Error('Typed retained metadata row required');
      return { ...selected, checkpointId: entry.checkpointId, ordinal: entry.ordinal };
    };
  }
  return { retain, inspect, metadataReader };
}

// Server-only composition with the existing migration.capture seam. The only
// permitted change since the retained pre-initialization snapshot is the exact
// existing metadata initializer token/company/native update timestamp. A durable
// flag from the browser or an unrelated old backup cannot authorize migration.
function createRetainedMaintenanceCapture({ company, backupStore, readSnapshot, backupRequest }) {
  if (!['NCT', 'GHR'].includes(company) || typeof backupStore?.inspect !== 'function' || typeof readSnapshot !== 'function'
    || !keys(backupRequest, 'requestId') || !uuid(backupRequest.requestId)) throw Error('Original retained migration capture dependencies required');
  const originalRequest = copy(backupRequest), domain = new Set(domainCollections(company));
  const withoutMetadata = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['company', 'stockCommitVersion', '_updatedDate'].includes(key)));
  return async request => {
    if ((!keys(request, 'company checkpointId') && !keys(request, 'company checkpointId requestId')) || request.company !== company
      || !hex(request.checkpointId) || Object.hasOwn(request, 'requestId') && !uuid(request.requestId)) throw Error('Original migration capture identity required');
    const retained = await backupStore.inspect(originalRequest), fresh = Object.hasOwn(request, 'requestId')
      ? await readSnapshot({ requestId: request.requestId, checkpointId: request.checkpointId }) : await readSnapshot();
    if (retained?.company !== company || retained.durableBackupConfirmed !== true || !retained.retainedBy
      || fresh?.company !== company || fresh.complete !== true || fresh.expected?.checkpointId !== request.checkpointId
      || fresh.emptyCurrentConfirmed !== true || !same(fresh.control, retained.raw?.control)) throw Error('Fresh migration capture and original durable backup required');
    const actual = decodeBackup(fresh.backup, company), original = decodeBackup(retained.backup, company);
    for (const collection of Object.keys(original.tables)) {
      const before = original.tables[collection], after = actual.tables[collection], map = new Map(after.map(row => [row._id, row]));
      if (before.length !== after.length) throw Error('Retained migration cohort changed');
      for (const row of before) {
        const current = map.get(row._id);
        if (!current) throw Error('Retained migration cohort changed');
        if (!domain.has(collection) || Object.hasOwn(row, 'stockCommitVersion')) {
          if (!same(encodeMaintenanceNativeImage(row), encodeMaintenanceNativeImage(current))) throw Error('Retained migration business image changed');
        } else if (current.company !== company || current.stockCommitVersion !== hash('STOCK_METADATA_V2', company, retained.checkpointId, collection, row._id)
          || Object.prototype.toString.call(current._updatedDate) !== '[object Date]' || !Number.isFinite(current._updatedDate.getTime())
          || !same(encodeMaintenanceNativeImage(withoutMetadata(row)), encodeMaintenanceNativeImage(withoutMetadata(current)))) {
          throw Error('Exact retained metadata initialization required; business fields unchanged');
        }
      }
    }
    // Reauthorize the same retained owner after the new complete snapshot. A
    // second administrator's unrelated receipt cannot be substituted in between.
    const after = await backupStore.inspect(originalRequest);
    if (after.retainedBy !== retained.retainedBy || after.backupId !== retained.backupId || after.checkpointId !== retained.checkpointId) throw Error('Retained backup authority changed');
    return { ...fresh, durableBackupConfirmed: true, backupIdentity: { requestId: originalRequest.requestId,
      backupId: retained.backupId, checkpointId: retained.checkpointId, retainedBy: retained.retainedBy } };
  };
}
module.exports = { createMaintenanceBackupStore, isMaintenanceBackupRecord, createRetainedMaintenanceCapture };

},
// maintenance-installed-reader.cjs sha256:fe96f23fdbd7faadf295bcce826700c25c82e979381374255704c00f12d7f4db
"maintenance-installed-reader.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const { same, copy, utf8Bytes } = load("segmented-plan.cjs");
const { readCompanyCurrentSnapshot } = load("company-current-snapshot.cjs");
const { encodeMaintenanceNativeImage } = load("maintenance-native-images.cjs");

// PRIVATE original migration validate/inspect adapter, not a normal stock read.
// Unlike readSnapshot(), it may inspect an owned FINALIZE checkpoint, but never
// a different pending operation or an APPLY/VERIFY partial cohort. It has NO
// write, release, retry, mode-switch or activation capability.
function createMaintenanceInstalledReader({ company, items, store, authenticateAdmin, verifyLegacyDrain,
  readControl, limits, maxSnapshotBytes, pageSize = 100 }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function'
    || ['read', 'normalizeListedRow'].some(method => typeof store?.[method] !== 'function')
    || [authenticateAdmin, verifyLegacyDrain, readControl].some(fn => typeof fn !== 'function')
    || !limits || ['positions', 'claims', 'products', 'transfers', 'taskRows'].some(kind => !Number.isSafeInteger(limits[kind]) || limits[kind] < 1)
    || !Number.isSafeInteger(maxSnapshotBytes) || maxSnapshotBytes < 1
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw Error('Explicit private installed-reader dependencies/budgets required');
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', tasks = company === 'NCT' ? 'R2NCTTasks' : 'R2NCTTasks1';
  const lockId = hash(company + '/PURCHASE', 'LOCK');
  return async request => {
    if (!request || Object.keys(request).sort().join(',') !== 'checkpointId,company,requestId' || request.company !== company
      || !/^[a-f0-9-]{36}$/i.test(request.requestId || '') || !/^[a-f0-9]{32}$/.test(request.checkpointId || '')) throw Error('Original installed migration identity required');
    const admin = await authenticateAdmin();
    if (admin?.isAdmin !== true || typeof admin.memberId !== 'string' || !admin.memberId) throw Error('Administrator installed migration read required');
    const key = hash(company + '/PURCHASE', request.requestId, admin.memberId);
    const digest = hash({ kind: 'INITIAL_STOCK_MIGRATION_V2', checkpointId: request.checkpointId });
    async function boundary() {
      const currentAdmin = await authenticateAdmin();
      if (currentAdmin?.isAdmin !== true || currentAdmin.memberId !== admin.memberId) throw Error('Installed migration administrator changed');
      if (await verifyLegacyDrain({ company, checkpointId: request.checkpointId }) !== true) throw Error('Legacy request drain is not verified');
      const control = await readControl();
      if (control?._id !== hash(company, 'STOCK_CONTROL') || control.company !== company || control.mode !== 'MAINTENANCE'
        || control.schemaVersion !== 1 || control.transferIndexVersion !== 2 || !control._version
        || !Number.isSafeInteger(control.generation) || control.generation < 0) throw Error('Installed migration maintenance control required');
      const manifest = await store.read(journal, key), result = await store.read(journal, hash(key, 'RESULT'));
      const lock = await store.read(journal, lockId);
      if (manifest?._id !== key || manifest.company !== company || manifest.stockOperationProtocol !== 2 || manifest.action !== 'STOCK_PLAN_MANIFEST'
        || manifest.memberId !== admin.memberId || manifest.requestId !== request.requestId || manifest.digest !== digest
        || !/^[a-f0-9]{32}$/.test(manifest.planHash || '') || !Number.isSafeInteger(manifest.baseGeneration) || manifest.baseGeneration < 0
        || !Number.isSafeInteger(manifest.writeCount) || manifest.writeCount < 1) throw Error('Original installed migration manifest required');
      if (control.pending !== null) {
        const p = control.pending;
        if (!p || p.key !== key || p.digest !== digest || p.planHash !== manifest.planHash || p.phase !== 'FINALIZE'
          || p.cursor !== manifest.writeCount || p.count !== manifest.writeCount || control.generation !== manifest.baseGeneration
          || lock?.company !== company || lock._id !== lockId || lock.owner !== key || typeof lock.attempt !== 'string' || !lock.attempt
          || result !== null) throw Error('Owned FINALIZE migration read required');
      } else if (lock !== null || result?._id !== hash(key, 'RESULT') || result.company !== company || result.stockOperationProtocol !== 2
        || result.digest !== digest || result.baseGeneration !== manifest.baseGeneration || result.outcome?.ok !== true
        || result.outcome.operationId !== key || result.outcome.generation !== manifest.baseGeneration + 1
        || control.generation !== result.outcome.generation) throw Error('Confirmed original migration read required');
      return { control, manifest, result, lock };
    }
    const before = await boundary(), metrics = { queries: 0, exactReads: 0 };
    async function cohort() {
      // Reuse the existing complete all-status stock reader. Its ordinary barrier
      // is NOT weakened; this explicit private wrapper is bounded by boundary().
      const current = await readCompanyCurrentSnapshot({ company, items, store, limits, pageSize,
        protocol: { readSnapshot: async readRows => ({ rows: await readRows(), generation: before.control.generation }) } });
      metrics.queries += current.metrics.queries; metrics.exactReads += current.metrics.exactReads;
      const taskRows = [], seen = new Set(); let total = null;
      do {
        // Scan the exact company-owned task table WITHOUT filtering out missing
        // company/version metadata. Such a row is an error, never silently absent.
        const page = await items.query(tasks).ascending('_id').skip(taskRows.length).limit(pageSize)
          .find({ consistentRead: true, returnTotalCount: true });
        metrics.queries++;
        if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount < taskRows.length
          || page.totalCount > limits.taskRows || total !== null && total !== page.totalCount
          || page.items.length !== Math.min(pageSize, page.totalCount - taskRows.length)) throw Error('Incomplete or over-budget installed task cohort');
        total = page.totalCount;
        for (const raw of page.items) {
          if (typeof raw?._id !== 'string' || !raw._id || seen.has(raw._id) || raw.company !== company) throw Error('Installed task scope conflict');
          seen.add(raw._id);
          const listed = store.normalizeListedRow(tasks, raw), row = await store.read(tasks, raw._id); metrics.exactReads++;
          if (!row || row._id !== raw._id || row.company !== company || !same(listed, row)) throw Error('Installed exact task image changed');
          taskRows.push(copy(row));
        }
      } while (taskRows.length < total);
      const rows = { company, positions: current.positions, claims: current.claims, products: current.products,
        transfers: current.transfers, taskRows, complete: true, taskRowsComplete: true };
      if (utf8Bytes(JSON.stringify(encodeMaintenanceNativeImage(rows))) > maxSnapshotBytes) throw Error('Installed migration snapshot byte policy exceeded');
      return rows;
    }
    const first = await cohort(), second = await cohort(), after = await boundary();
    if (!same(before, after)) throw Error('Installed migration boundary changed during read');
    if (JSON.stringify(encodeMaintenanceNativeImage(first)) !== JSON.stringify(encodeMaintenanceNativeImage(second))) throw Error('Installed migration cohort changed during read');
    return { ...second, generation: after.control.generation, operationId: key, checkpointId: request.checkpointId,
      inspectionStage: after.control.pending === null ? 'CONFIRMED' : 'OWNED_FINALIZE', metrics, activationReady: false };
  };
}
module.exports = { createMaintenanceInstalledReader };

},
// company-current-snapshot.cjs sha256:61cbc68a6917ce730674641d5c50753c7c63704e8ea840ed37583172ed5881fb
"company-current-snapshot.cjs": (load, module) => {
'use strict';

// Private explicit shadow/maintenance snapshot, NOT a normal page read. Operator
// supplies measured read budgets; exceeding them refuses rather than truncates.
async function readCompanyCurrentSnapshot({ company, items, store, protocol, limits, pageSize = 100 }) {
  const names = ['positions', 'claims', 'products', 'transfers'];
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function' || typeof store?.read !== 'function'
    || typeof protocol?.readSnapshot !== 'function' || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
    || !limits || names.some(k => !Number.isSafeInteger(limits[k]) || limits[k] < 1)) throw Error('Explicit private snapshot read budgets required');
  const metrics = { queries: 0, exactReads: 0 };
  const snapshot = await protocol.readSnapshot(async () => {
    const result = { company, complete: true };
    for (const [name, collection, action] of [['positions', 'R2StockPositions'], ['claims', 'R2StockClaims'], ['products', 'R2StockProducts'],
      ['transfers', company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1', 'STOCK_TRANSFER_CURRENT']]) {
      const rows = [], seen = new Set(); let expected = null;
      do {
        let query = items.query(collection).eq('company', company);
        if (action) query = query.eq('action', action);
        const page = await query.ascending('_id').skip(rows.length).limit(pageSize).find({ consistentRead: true, returnTotalCount: true });
        metrics.queries++;
        if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0 || page.totalCount > limits[name]
          || expected !== null && expected !== page.totalCount || page.items.length !== Math.min(pageSize, page.totalCount - rows.length)) throw Error('Incomplete or over-budget current company snapshot');
        expected = page.totalCount;
        for (const listed of page.items) {
          if (typeof listed._id !== 'string' || !listed._id || seen.has(listed._id) || listed.company !== company || action && listed.action !== action) throw Error('Company snapshot list scope conflict');
          seen.add(listed._id); metrics.exactReads++;
          const row = await store.read(collection, listed._id);
          if (!row || row._id !== listed._id || row.company !== company || action && row.action !== action) throw Error('Company snapshot exact read changed');
          rows.push(JSON.parse(JSON.stringify(row)));
        }
      } while (rows.length < expected);
      result[name] = rows;
    }
    return result;
  });
  return { ...snapshot.rows, generation: snapshot.generation, metrics };
}
module.exports = { readCompanyCurrentSnapshot };

},
// maintenance-metadata-initializer.cjs sha256:c9316ada88b7b2a39f2f7eddf06d9a2bc0e77119631c841fac8fcf25d69f9013
"maintenance-metadata-initializer.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const own = (row, field) => Object.prototype.hasOwnProperty.call(row, field);
const nativeDate = value => Object.prototype.toString.call(value) === '[object Date]' && Number.isFinite(value.getTime());
const typed = value => {
  if (nativeDate(value)) return ['date', value.toISOString()];
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return [typeof value, value];
  if (Array.isArray(value)) return ['array', value.map(typed)];
  if (value && Object.prototype.toString.call(value) === '[object Object]') return ['object', Object.keys(value).sort().map(key => [key, typed(value[key])])];
  throw Error('Unsupported native migration value');
};
const image = value => JSON.stringify(typed(value));
const business = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['_updatedDate', 'company', 'stockCommitVersion'].includes(key)));

// Private one-record step. It never scans, deletes, changes business fields, or
// treats timestamps as a substitute for proof that old writers have stopped.
// The server checkpoint owns collection/ID/images; browser input is only ordinal.
function createMaintenanceMetadataInitializer({ company, items, authenticateAdmin, verifyLegacyDrain, readControl, readCapturedRow }) {
  if (!['NCT', 'GHR'].includes(company) || ['query', 'patch'].some(method => typeof items?.[method] !== 'function')
    || [authenticateAdmin, verifyLegacyDrain, readControl, readCapturedRow].some(fn => typeof fn !== 'function')) throw Error('Private metadata initialization dependencies required');
  // Existing journal history is immutable and already supported by the current
  // readers. It is deliberately excluded from blanket metadata initialization.
  const allowed = new Set(company === 'NCT' ? ['R2NCTTasks', 'R2NCTOrders', 'R2PurchaseOrders'] : ['R2NCTTasks1', 'R2NCTOrders1', 'R2PurchaseOrders']);
  async function step(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'checkpointId,ordinal' || !/^[a-f0-9]{32}$/.test(input.checkpointId || '')
      || !Number.isSafeInteger(input.ordinal) || input.ordinal < 0) throw Error('Captured migration row ordinal required');
    const admin = await authenticateAdmin();
    if (admin?.isAdmin !== true || !admin.memberId) throw Error('Administrator metadata initialization required');
    const requireMaintenance = async () => {
      const control = await readControl();
      if (control?._id !== hash(company, 'STOCK_CONTROL') || control.company !== company || control.mode !== 'MAINTENANCE'
        || control.schemaVersion !== 1 || !control._version || control.pending !== null) throw Error('Unchanged maintenance metadata control required');
      if (await verifyLegacyDrain({ company, checkpointId: input.checkpointId }) !== true) throw Error('Legacy request drain is not verified');
      return image(control);
    };
    const controlImage = await requireMaintenance(), captured = await readCapturedRow({ company, ...input });
    const collection = captured?.collection, before = captured?.row;
    if (!allowed.has(collection) || captured.checkpointId !== input.checkpointId || captured.ordinal !== input.ordinal
      || typeof before?._id !== 'string' || !before._id || !nativeDate(before._updatedDate)
      || own(before, 'stockCommitVersion') || own(before, '_version') || own(before, 'company') && before.company !== company
      || before.stockOperationProtocol != null) throw Error('Exact unversioned captured business row required');
    image(before);
    const read = async () => {
      const page = await items.query(collection).eq('_id', before._id).limit(2).find({ consistentRead: true, returnTotalCount: true });
      if (!Array.isArray(page?.items) || page.totalCount !== 1 || page.items.length !== 1 || page.items[0]?._id !== before._id) throw Error('Complete exact metadata read required');
      image(page.items[0]); return page.items[0];
    };
    const version = hash('STOCK_METADATA_V2', company, input.checkpointId, collection, before._id);
    const afterMatches = row => row.company === company && row.stockCommitVersion === version && nativeDate(row._updatedDate)
      && image(business(row)) === image(business(before));
    const current = await read();
    if (afterMatches(current)) return { ok: true, initialized: false, alreadyConfirmed: true, ordinal: input.ordinal };
    if (image(current) !== image(before)) throw Error('Captured legacy row changed; no metadata written');
    if (await requireMaintenance() !== controlImage) throw Error('Maintenance control changed before initialization');
    // Date conjunction is the exact installed-SDK primitive already checked in
    // isolation. It is only used after independent old-writer quiescence proof.
    let patch = items.patch(collection, before._id).setField('company', company).setField('stockCommitVersion', version);
    await patch.run({ condition: { company: own(before, 'company') ? { $eq: company } : { $exists: false },
      stockCommitVersion: { $exists: false }, _updatedDate: { $eq: { $date: before._updatedDate.toISOString() } } } });
    // No catch/retry on an unknown result. A later explicit step first inspects
    // the durable exact metadata token; it never overwrites a different version.
    if (!afterMatches(await read())) throw Error('Metadata initialization image unconfirmed');
    if (await requireMaintenance() !== controlImage) throw Error('Maintenance changed; retain initialized row for review');
    return { ok: true, initialized: true, alreadyConfirmed: false, ordinal: input.ordinal };
  }
  return { step };
}
module.exports = { createMaintenanceMetadataInitializer };

},
// maintenance-migration.cjs sha256:68f579c288f8c486f695a9c3888e5e33c6aa56b067ab1f4978c04277145b07d9
"maintenance-migration.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const { same, copy } = load("segmented-plan.cjs");
const { createSegmentedFencedProof } = load("segmented-fenced-proof.cjs");
const { compareStockLifecycleShadow } = load("lifecycle-shadow-parity.cjs");
const tables = { positions: 'R2StockPositions', claims: 'R2StockClaims', products: 'R2StockProducts' };
const taskTable = company => company === 'NCT' ? 'R2NCTTasks' : 'R2NCTTasks1';
const count = n => Number.isSafeInteger(n) && n >= 0;

// Server-only migration of an already versioned, complete captured cohort. Missing
// legacy versions require the separate conditional metadata initializer first.
// This does not create schema, assert old requests stopped, or enable ACTIVE.
function prepareMaintenanceMigration({ company, expected, taskRows, control, backupIdentity }) {
  if (!['NCT', 'GHR'].includes(company) || expected?.company !== company || expected.canPlan !== true
    || !expected.checkpointId || !expected.baseCheckpointId || expected.proposedTransferIndexVersion !== 2
    || !Array.isArray(expected.blockers) || expected.blockers.some(code => code !== 'ADMIN_MIGRATION_APPLY_NOT_IMPLEMENTED')
    || !count(expected.generation) || !count(expected.generation + 1) || !Array.isArray(expected.taskInitializations)
    || !Array.isArray(taskRows) || control?._id !== hash(company, 'STOCK_CONTROL') || control.company !== company
    || control.mode !== 'MAINTENANCE' || control.schemaVersion !== 1 || control.transferIndexVersion !== 2
    || !control._version || control.pending !== null || control.generation !== expected.generation
    || Object.keys(tables).some(kind => !Array.isArray(expected.rows?.[kind]))) throw Error('Verified maintenance migration capture required');
  const raw = new Map(taskRows.map(row => [row._id, row]));
  if (raw.size !== taskRows.length || raw.size !== expected.taskInitializations.length) throw Error('Complete migration task cohort required');
  const generation = expected.generation + 1, writes = [], seen = new Set();
  const target = copy(expected); target.generation = generation;
  target.blockers = []; target.canApply = false; target.activationReady = false;
  for (const kind of Object.keys(tables)) target.rows[kind] = expected.rows[kind].map(row => {
    if (row.company !== company || !row._id || row.checkpointGeneration !== expected.generation) throw Error('Captured migration stock scope conflict');
    const after = { ...copy(row), checkpointGeneration: generation };
    writes.push({ collection: tables[kind], before: null, after });
    return after;
  });
  target.taskInitializations = expected.taskInitializations.map(entry => {
    const before = raw.get(entry.id);
    if (!before || seen.has(entry.id) || before.company !== company || typeof before._version !== 'string' || !before._version
      || before.stockCommitVersion !== undefined || hash(before) !== entry.observedHash || before._version !== entry.observedVersion
      || entry.fields?.company !== company || entry.fields.stockCounterSchema !== 2
      || !count(entry.fields.stockDispatchedCumulative) || entry.fields.stockCounterGeneration !== expected.generation) {
      throw Error('Exact versioned migration task image required');
    }
    seen.add(entry.id);
    const fields = { ...copy(entry.fields), stockCounterGeneration: generation };
    writes.push({ collection: taskTable(company), before: copy(before), after: { ...copy(before), ...fields } });
    return { ...copy(entry), fields };
  });
  // Even an empty company uses a durable metadata checkpoint, not a fake product.
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  writes.push({ collection: journal, before: null, after: { _id: hash(company, 'MIGRATION', expected.checkpointId), company,
    action: 'STOCK_INITIALIZATION_CHECKPOINT', checkpointId: expected.checkpointId, generation,
    counts: copy(expected.counts), lifecycleVersion: 2 } });
  return { writes, migration: { company, checkpointId: expected.checkpointId, baseGeneration: expected.generation,
    expected: target, legacyTaskRows: copy(taskRows), ...(backupIdentity ? { backupIdentity: copy(backupIdentity) } : {}) } };
}

function createMaintenanceMigration({ company, store, authenticateAdmin, verifyLegacyDrain, capture,
  readInstalled, protocolOptions = {} }) {
  if (!['NCT', 'GHR'].includes(company) || [authenticateAdmin, verifyLegacyDrain, capture, readInstalled].some(fn => typeof fn !== 'function')) {
    throw Error('Private migration authority, drain verification and snapshot readers required');
  }
  const protocol = createSegmentedFencedProof({ ...protocolOptions, company, store, domainWrites: true });
  async function requireDrain(checkpointId) {
    if (await verifyLegacyDrain({ company, checkpointId }) !== true) throw Error('Legacy request drain is not verified');
  }
  async function apply(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'checkpointId,requestId'
      || !/^[a-f0-9-]{36}$/i.test(input.requestId || '') || !/^[a-f0-9]{32}$/.test(input.checkpointId || '')) throw Error('Original migration request and checkpoint required');
    const admin = await authenticateAdmin();
    if (!admin?.memberId || admin.isAdmin !== true) throw Error('Administrator migration authority required');
    // Verify before any lock/staging write as well as under the owned protocol.
    // A missing provider/installed admission verifier is an error, never a flag
    // accepted from the browser or an inference from elapsed time/empty locks.
    await requireDrain(input.checkpointId);
    return protocol.commit({ requestId: input.requestId, memberId: admin.memberId,
      input: { kind: 'INITIAL_STOCK_MIGRATION_V2', checkpointId: input.checkpointId },
      authorize: async operation => {
        const currentAdmin = await authenticateAdmin(), control = operation.control;
        if (currentAdmin?.isAdmin !== true || currentAdmin.memberId !== admin.memberId
          || control.mode !== 'MAINTENANCE' || control.schemaVersion !== 1 || control.transferIndexVersion !== 2) throw Error('Migration maintenance authority changed');
        await requireDrain(input.checkpointId);
      },
      prepare: async () => {
        const observed = await capture({ company, requestId: input.requestId, checkpointId: input.checkpointId });
        if (observed?.expected?.checkpointId !== input.checkpointId || observed.emptyCurrentConfirmed !== true) throw Error('Original complete empty-current checkpoint required');
        if (observed.durableBackupConfirmed !== true) throw Error('Durable private original migration backup required');
        const proof = observed.backupIdentity;
        if (!proof || Object.keys(proof).sort().join(',') !== 'backupId,checkpointId,requestId,retainedBy'
          || !/^[a-f0-9-]{36}$/i.test(proof.requestId || '') || !/^[a-f0-9]{32}$/.test(proof.backupId || '')
          || !/^[a-f0-9]{32}$/.test(proof.checkpointId || '') || proof.retainedBy !== admin.memberId) throw Error('Original retained backup identity required');
        const control = await protocol.readControl();
        if (!same(control, observed.control)) throw Error('Migration capture changed');
        return prepareMaintenanceMigration({ company, ...observed, control });
      },
      validate: async plan => {
        // Before RESULT/generation publication require the entire installed cohort,
        // not sums from one display page. The protocol has already checked each
        // after-image; this also detects extra rows not present in the plan.
        const installed = await readInstalled({ company, requestId: input.requestId, checkpointId: input.checkpointId });
        if (installed?.company !== company || installed.complete !== true || installed.taskRowsComplete !== true
          || !Array.isArray(installed.transfers) || installed.transfers.length) throw Error('Complete initial migration readback required');
        for (const [kind, collection] of Object.entries({ ...tables, taskRows: taskTable(company) })) {
          const actual = installed[kind], expectedRows = plan.writes.filter(w => w.collection === collection).map(w => w.after);
          if (!Array.isArray(actual) || actual.length !== expectedRows.length || new Set(actual.map(row => row._id)).size !== actual.length
            || expectedRows.some(row => !same(row, actual.find(value => value._id === row._id)))) throw Error('Initial migration cohort differs');
        }
      } });
  }
  async function inspect(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'checkpointId,requestId'
      || !/^[a-f0-9-]{36}$/i.test(input.requestId || '') || !/^[a-f0-9]{32}$/.test(input.checkpointId || '')) throw Error('Original migration inspection required');
    const admin = await authenticateAdmin();
    if (admin?.isAdmin !== true || !admin.memberId) throw Error('Administrator migration authority required');
    const before = await protocol.readControl();
    if (before.mode !== 'MAINTENANCE' || before.pending) throw Error('Completed maintenance migration required');
    const key = hash(company + '/PURCHASE', input.requestId, admin.memberId), result = await store.read(protocol.ids.journal, hash(key, 'RESULT'));
    const manifest = await store.read(protocol.ids.journal, key);
    if (result?.company !== company || result._id !== hash(key, 'RESULT') || result.stockOperationProtocol !== 2
      || result.outcome?.ok !== true || result.outcome.operationId !== key
      || result.digest !== hash({ kind: 'INITIAL_STOCK_MIGRATION_V2', checkpointId: input.checkpointId })
      || manifest?.digest !== result.digest || result.baseGeneration !== manifest.baseGeneration
      || result.outcome.generation !== result.baseGeneration + 1 || before.generation !== result.outcome.generation) throw Error('Confirmed original migration result required');
    // Decode the exact retained operation; never recapture a different baseline.
    const { createSegmentedPlanCodec } = load("segmented-plan.cjs");
    const codec = createSegmentedPlanCodec({ ...protocolOptions.codecPolicy, company, domainWrites: true });
    const fragments = [];
    for (const ref of manifest.fragments || []) fragments.push(await store.read(protocol.ids.journal, ref.id));
    const plan = codec.decode({ manifest, fragments, key, digest: result.digest, memberId: admin.memberId, requestId: input.requestId });
    if (plan.migration?.checkpointId !== input.checkpointId) throw Error('Migration checkpoint identity differs');
    const current = await readInstalled({ company, requestId: input.requestId, checkpointId: input.checkpointId }), after = await protocol.readControl();
    return compareStockLifecycleShadow({ company, expected: plan.migration.expected, legacyTaskRows: plan.migration.legacyTaskRows,
      current: { ...current, generation: result.outcome.generation }, controlBefore: before, controlAfter: after });
  }
  return { apply, inspect };
}
module.exports = { prepareMaintenanceMigration, createMaintenanceMigration };

},
// lifecycle-shadow-parity.cjs sha256:b3732560fa61f88cb7253f10261192fc93c4f13a3133df505a63f76459bfbbe5
"lifecycle-shadow-parity.cjs": (load, module) => {
'use strict';

// Private initial-cutover READ ONLY proof. The original shadow comparison covers
// physical/customer fields, not v2 lifetime counters. This adds those requirements
// without changing that legacy diagnostic, selecting an authority or enabling mode.
const { hash } = load("commit-proof.cjs");
const { compareStockShadow } = load("shadow-parity.cjs");
const { same, copy } = load("segmented-plan.cjs");
const count = n => Number.isSafeInteger(n) && n >= 0;
const taskMetadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId', '_version', 'stockCommitVersion',
  'company', 'stockCounterSchema', 'stockDispatchedCumulative', 'stockCounterGeneration']);
const businessImage = row => Object.fromEntries(Object.entries(copy(row)).filter(([field]) => !taskMetadata.has(field)));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
function compareStockLifecycleShadow({ company, expected, legacyTaskRows, current, controlBefore, controlAfter }) {
  if (!['NCT', 'GHR'].includes(company) || expected?.company !== company || expected.canPlan !== true
    || !expected.checkpointId || !expected.baseCheckpointId || !count(expected.generation)
    || expected.proposedTransferIndexVersion !== 2 || !Array.isArray(expected.taskInitializations)
    || !Array.isArray(legacyTaskRows) || current?.taskRowsComplete !== true || !Array.isArray(current.taskRows)
    || ['positions', 'claims', 'products'].some(table => !Array.isArray(expected.rows?.[table]))) throw Error('Complete lifecycle maintenance snapshots required');
  const base = compareStockShadow({ company, expected: { company, generation: expected.generation, ...expected.rows },
    current, controlBefore, controlAfter });
  const result = { ...base, schema: 'STOCK_INITIAL_LIFECYCLE_SHADOW_V2', lifecycleVerified: false, activationReady: false };
  if (!base.parity) return result;
  if (controlBefore.transferIndexVersion !== 2) return { ...result, parity: false, status: 'TRANSFER_INDEX_NOT_VERIFIED', fingerprint: hash(result.fingerprint, 'TRANSFER_INDEX_NOT_VERIFIED') };
  const differences = [...base.differences]; let differenceCount = base.differenceCount;
  const difference = (table, id, field, reason) => {
    differenceCount++;
    if (differences.length < 100) differences.push({ table, id, field, reason });
  };
  const fields = { positions: ['borrowRepaidCumulative'], claims: ['dispatchedCumulative'], products: ['lifecycleVersion', 'nextBorrowSequence'] };
  const fingerprints = {};
  for (const [table, critical] of Object.entries(fields)) {
    const observed = new Map(current[table].map(row => [row._id, row]));
    for (const row of expected.rows[table]) {
      if (table === 'positions' && row.borrowRepaidCumulative !== 0
        || table === 'claims' && !count(row.dispatchedCumulative)
        || table === 'products' && (row.lifecycleVersion !== 2 || row.nextBorrowSequence !== 1)) throw Error('Initial lifecycle baseline counters required');
      const after = observed.get(row._id);
      if (typeof after?._version !== 'string' || !after._version) difference(table, row._id, '_version', 'CURRENT_LIFECYCLE_METADATA_INVALID');
      for (const field of critical) if (!same(row[field], after?.[field])) difference(table, row._id, field, 'LIFECYCLE_COUNTER_MISMATCH');
      if (after?.checkpointGeneration !== expected.generation) difference(table, row._id, 'checkpointGeneration', 'INITIAL_CHECKPOINT_GENERATION_MISMATCH');
    }
    fingerprints[table] = current[table].map(row => [row._id, ...critical.map(field => row[field]), row.checkpointGeneration]).sort((a,b) => a[0].localeCompare(b[0]));
  }
  const initializations = new Map(), legacy = new Map(), actual = new Map();
  for (const entry of expected.taskInitializations) {
    if (typeof entry?.id !== 'string' || !entry.id || initializations.has(entry.id)
      || entry.fields?.company !== company || entry.fields.stockCounterSchema !== 2 || !count(entry.fields.stockDispatchedCumulative)
      || entry.fields.stockCounterGeneration !== expected.generation || !entry.observedHash) throw Error('Exact lifecycle task baseline required');
    initializations.set(entry.id, entry);
  }
  for (const row of legacyTaskRows) {
    if (!row?._id || legacy.has(row._id) || !initializations.has(row._id) || row.company && row.company !== company
      || hash(row) !== initializations.get(row._id).observedHash) throw Error('Captured legacy task evidence differs');
    legacy.set(row._id, row);
  }
  if (legacy.size !== initializations.size) throw Error('Complete captured legacy tasks required');
  for (const row of current.taskRows) {
    if (!row?._id || actual.has(row._id)) throw Error('Unique current task identities required');
    actual.set(row._id, row);
    if (!initializations.has(row._id)) difference('tasks', row._id, '_id', 'UNEXPECTED_CURRENT_TASK');
  }
  for (const [id, entry] of initializations) {
    const row = actual.get(id);
    if (!row) { difference('tasks', id, '_id', 'CURRENT_TASK_MISSING'); continue; }
    const version = row._version || row.stockCommitVersion;
    if (row.company !== company || typeof version !== 'string' || !version
      || row._version && row.stockCommitVersion && row._version !== row.stockCommitVersion) difference('tasks', id, '_version', 'CURRENT_TASK_METADATA_INVALID');
    for (const field of ['stockCounterSchema', 'stockDispatchedCumulative', 'stockCounterGeneration']) {
      if (!same(row[field], entry.fields[field])) difference('tasks', id, field, 'TASK_COUNTER_MISMATCH');
    }
    if (!same(businessImage(legacy.get(id)), businessImage(row))) difference('tasks', id, 'businessImage', 'ORIGINAL_TASK_CHANGED');
  }
  // Equality of two caches is insufficient: independently prove cumulative source
  // and task totals against exact claims, including CLOSED fully dispatched ones.
  const checkDispatch = (rows, tasks, label) => {
    const bySource = new Map(), byTask = new Map();
    for (const row of rows.claims) {
      if (!count(row.dispatchedCumulative)) { difference('claims', row._id, 'dispatchedCumulative', label + '_DISPATCH_INVALID'); continue; }
      for (const [map, id] of [[bySource, row.positionId], [byTask, row.taskId]]) {
        const total = (map.get(id) || 0) + row.dispatchedCumulative;
        if (!count(total)) throw Error('Lifecycle dispatch aggregate overflow');
        map.set(id, total);
      }
      if (!initializations.has(row.taskId)) difference('claims', row._id, 'taskId', label + '_TASK_MISSING');
    }
    for (const row of rows.positions) if ((bySource.get(row._id) || 0) !== row.dispatched) difference('positions', row._id, 'dispatched', label + '_CLAIM_DISPATCH_TOTAL_MISMATCH');
    for (const [id, task] of tasks) if ((byTask.get(id) || 0) !== task.stockDispatchedCumulative) difference('tasks', id, 'stockDispatchedCumulative', label + '_CLAIM_DISPATCH_TOTAL_MISMATCH');
  };
  checkDispatch(expected.rows, new Map([...initializations].map(([id, entry]) => [id, entry.fields])), 'EXPECTED');
  checkDispatch(current, actual, 'CURRENT');
  fingerprints.tasks = [...actual].map(([id, row]) => [id, row.company, row.stockCounterSchema, row.stockDispatchedCumulative,
    row.stockCounterGeneration, hash(canonical(businessImage(row)))]).sort((a,b) => a[0].localeCompare(b[0]));
  const parity = differenceCount === 0, status = parity ? base.status === 'PARITY_WITH_REVIEW_REQUIRED'
    ? 'LIFECYCLE_PARITY_WITH_REVIEW_REQUIRED' : 'LIFECYCLE_PARITY_CONFIRMED_KNOWN' : 'LIFECYCLE_DIFFERENCE_REVIEW_REQUIRED';
  const dataFingerprint = hash(base.dataFingerprint, expected.checkpointId, fingerprints);
  return { ...result, status, parity, lifecycleVerified: parity, differences, differenceCount, dataFingerprint,
    fingerprint: hash(base.fingerprint, status, dataFingerprint, differences, differenceCount) };
}
module.exports = { compareStockLifecycleShadow };

},
// shadow-parity.cjs sha256:a8ceb7a99b67057ee4ba2a79ed135bc7f81867b2c0d1f2cce46810566c027362
"shadow-parity.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const fields = {
  positions: ['schemaVersion', 'company', 'stockKey', 'sourceKind', 'sourceId', 'sourceTaskId', 'poId', 'receiptAccepted', 'replacementReceived', 'supplierReturned', 'dispatched', 'onHand', 'isolated', 'reservedUsable', 'available', 'reviewCodes', 'status'],
  claims: ['schemaVersion', 'company', 'stockKey', 'positionId', 'taskId', 'customerId', 'orderId', 'sourceLineId', 'reservedUsable', 'isolatedAttributed', 'reviewCodes', 'status'],
  products: ['schemaVersion', 'company', 'stockKey', 'barcode', 'packing', 'ea', 'onHand', 'isolated', 'reservedUsable', 'available', 'reviewRequired', 'status']
};
const quantities = ['onHand', 'isolated', 'reservedUsable', 'available'];
const count = n => Number.isSafeInteger(n) && n >= 0;
const sum = (rows, field) => {
  let n = 0;
  for (const row of rows) { if (row[field] === null) return null; if (!count(row[field]) || !count(n + row[field])) throw Error('Shadow quantity invalid'); n += row[field]; }
  return n;
};
// Explicit private maintenance/shadow diagnostic. Never called on normal stock
// reads, never writes, never elects a winner or grants activation permission.
function compareStockShadow({ company, expected, current, controlBefore, controlAfter }) {
  const report = { company, activationReady: false, parity: false, status: null, differenceCount: 0, differences: [] };
  const finish = status => ({ ...report, status, fingerprint: hash(canonical({ ...report, status })) });
  if (!['NCT', 'GHR'].includes(company) || expected?.company !== company || current?.company !== company || current.complete !== true
    || !count(expected.generation) || !count(current.generation) || !Array.isArray(current.transfers)
    || Object.keys(fields).some(k => !Array.isArray(expected[k]) || !Array.isArray(current[k]))) throw Error('Complete company shadow snapshots required');
  if (!same(controlBefore, controlAfter)) return finish('SNAPSHOT_CHANGED_RECHECK');
  if (controlBefore?._id !== hash(company, 'STOCK_CONTROL') || controlBefore.company !== company || !controlBefore._version
    || controlBefore.schemaVersion !== 1 || !count(controlBefore.generation)) return finish('CONTROL_NOT_VERIFIED');
  if (controlBefore.pending) return finish('SAVE_PENDING_STAY_BLOCKED');
  if (!['MAINTENANCE', 'SHADOW'].includes(controlBefore.mode)) return finish('MODE_NOT_ELIGIBLE');
  if (expected.generation !== current.generation || current.generation !== controlBefore.generation) return finish('GENERATION_MISMATCH');
  if (current.transfers.length) return finish('RELATION_AWARE_BASELINE_REQUIRED');
  const differences = (table, id, field, reason = 'FIELD_MISMATCH') => {
    report.differenceCount++;
    if (report.differences.length < 100) report.differences.push({ table, id, field, reason });
  };
  const maps = {}, fingerprintRows = {};
  let reviewRequired = false;
  for (const table of Object.keys(fields)) {
    const left = new Map(), right = new Map();
    for (const [rows, map] of [[expected[table], left], [current[table], right]]) for (const row of rows) {
      const id = table === 'positions' ? hash(company, row.stockKey, 'PURCHASE_SOURCE', row.sourceTaskId)
        : table === 'claims' ? hash(company, row.positionId, row.taskId) : hash(company, row.stockKey);
      let key; try { key = JSON.parse(row.stockKey); } catch (_) { throw Error('Shadow stock identity conflict'); }
      if (!row._id || row._id !== id || map.has(row._id) || row.company !== company || row.schemaVersion !== 1
        || !Array.isArray(key) || key.length !== 4 || key[0] !== company || typeof key[1] !== 'string' || !key[1]
        || typeof key[2] !== 'string' || !key[2] || !Number.isSafeInteger(key[3]) || key[3] <= 0
        || !['ACTIVE', 'CLOSED'].includes(row.status)) throw Error('Shadow row identity conflict');
      map.set(row._id, row);
    }
    maps[table] = right;
    const ids = [...new Set([...left.keys(), ...right.keys()])].sort();
    for (const id of ids) {
      const before = left.get(id), after = right.get(id);
      if (!before || !after) { differences(table, id, '_id', before ? 'CURRENT_ROW_MISSING' : 'UNEXPECTED_CURRENT_ROW'); continue; }
      if (!after._version || !count(after.revision) || !count(after.checkpointGeneration) || after.checkpointGeneration > current.generation) differences(table, id, '_version', 'CURRENT_METADATA_INVALID');
      for (const field of fields[table]) {
        const normalize = value => field === 'reviewCodes' && Array.isArray(value) ? [...value].sort() : value;
        if (!same(normalize(before[field]), normalize(after[field]))) differences(table, id, field);
      }
      if (after.reviewRequired === true || after.reviewCodes?.length || quantities.some(k => after[k] === null) || after.isolatedAttributed === null) reviewRequired = true;
    }
    const select = row => ({ _id: row._id, ...Object.fromEntries(fields[table].map(k => [k, row[k]])) });
    fingerprintRows[table] = { expected: expected[table].map(select).sort((a, b) => a._id.localeCompare(b._id)),
      current: current[table].map(select).sort((a, b) => a._id.localeCompare(b._id)) };
  }
  const claimsByPosition = new Map(), sourcesByProduct = new Map(), productKeys = new Set([...maps.products.values()].map(p => p.stockKey));
  for (const claim of maps.claims.values()) { if (!claimsByPosition.has(claim.positionId)) claimsByPosition.set(claim.positionId, []); claimsByPosition.get(claim.positionId).push(claim); }
  for (const position of maps.positions.values()) { if (!sourcesByProduct.has(position.stockKey)) sourcesByProduct.set(position.stockKey, []); sourcesByProduct.get(position.stockKey).push(position); }
  for (const position of maps.positions.values()) {
    const claims = claimsByPosition.get(position._id) || [];
    if (!productKeys.has(position.stockKey)) differences('positions', position._id, 'stockKey', 'PRODUCT_CHECKPOINT_MISSING');
    const usable = sum(claims, 'reservedUsable');
    if (usable !== null && position.reservedUsable !== null && usable !== position.reservedUsable) differences('positions', position._id, 'reservedUsable', 'CLAIM_TOTAL_MISMATCH');
    if (quantities.every(k => count(position[k])) && position.onHand !== position.available + position.isolated + position.reservedUsable) differences('positions', position._id, 'onHand', 'PHYSICAL_BALANCE_MISMATCH');
    if ([position.onHand, position.supplierReturned, position.dispatched, position.receiptAccepted, position.replacementReceived].every(count)
      && position.onHand + position.supplierReturned + position.dispatched !== position.receiptAccepted + position.replacementReceived) differences('positions', position._id, 'onHand', 'MOVEMENT_TOTAL_MISMATCH');
  }
  for (const claim of maps.claims.values()) {
    const position = maps.positions.get(claim.positionId);
    if (!position || claim.stockKey !== position.stockKey) differences('claims', claim._id, 'positionId', 'ORPHANED_CLAIM');
  }
  for (const product of maps.products.values()) {
    const sources = sourcesByProduct.get(product.stockKey) || [];
    for (const field of quantities) if (sum(sources, field) !== product[field]) differences('products', product._id, field, 'SOURCE_TOTAL_MISMATCH');
  }
  report.dataFingerprint = hash(canonical(fingerprintRows));
  report.parity = report.differenceCount === 0;
  return finish(report.parity ? reviewRequired ? 'PARITY_WITH_REVIEW_REQUIRED' : 'PARITY_CONFIRMED_KNOWN' : 'DIFFERENCE_REVIEW_REQUIRED');
}
module.exports = { compareStockShadow };

},
// maintenance-control-initializer.cjs sha256:fe7cb5941228bb17103473e6239ee6f3324378c829f0d38d7b17a1cb9529e164
"maintenance-control-initializer.cjs": (load, module) => {
'use strict';
const { hash } = load("commit-proof.cjs");
const { same } = load("segmented-plan.cjs");

// Add ONE absent maintenance control. Never changes an existing LEGACY/ACTIVE
// control, acquires/releases a lock, retries an unknown insert, or enables writes.
function createMaintenanceControlInitializer({ company, store, authenticateAdmin, verifyLegacyDrain,
  verifyPrivateRetention, verifyControlSchema }) {
  if (!['NCT', 'GHR'].includes(company) || ['read', 'insert'].some(key => typeof store?.[key] !== 'function')
    || [authenticateAdmin, verifyLegacyDrain, verifyPrivateRetention, verifyControlSchema].some(fn => typeof fn !== 'function')) {
    throw Error('Actual private maintenance initialization dependencies required');
  }
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const id = hash(company, 'STOCK_CONTROL'), lockId = hash(company + '/PURCHASE', 'LOCK');
  function request(input) {
    if (!input || Object.keys(input).join(',') !== 'requestId' || !/^[a-f0-9-]{36}$/i.test(input.requestId || '')) throw Error('Original maintenance initialization request required');
  }
  async function authorize(owner) {
    const admin = await authenticateAdmin();
    if (admin?.isAdmin !== true || typeof admin.memberId !== 'string' || !admin.memberId || owner && owner !== admin.memberId) throw Error('Actual maintenance administrator required');
    if (await verifyLegacyDrain({ company, purpose: 'INITIALIZE_MAINTENANCE_CONTROL' }) !== true) throw Error('Legacy request drain is not verified');
    if (await verifyPrivateRetention({ company, collection: journal }) !== true) throw Error('Private native control retention is not verified');
    if (await verifyControlSchema({ company, collection: journal }) !== true) throw Error('Native maintenance control fields are not verified');
    return admin.memberId;
  }
  const original = (input, memberId) => ({ _id: id, company, mode: 'MAINTENANCE', schemaVersion: 1,
    transferIndexVersion: 2, generation: 0, pending: null,
    _version: hash(company, 'MAINTENANCE_CONTROL_V1', input.requestId, memberId) });
  async function read(expected) {
    // Absence of a lock is only an additional conflict check, NEVER drain proof.
    if (await store.read(journal, lockId) !== null) throw Error('Existing business lock requires review; never release');
    const actual = await store.read(journal, id);
    if (actual !== null && !same(actual, expected)) throw Error('Existing control differs; never overwrite or change mode');
    return actual;
  }
  async function inspect(input) {
    request(input); const memberId = await authorize(), expected = original(input, memberId), actual = await read(expected);
    await authorize(memberId);
    return { company, controlId: id, requestId: input.requestId, initialized: actual !== null,
      mode: actual ? 'MAINTENANCE' : null, activationReady: false };
  }
  async function initialize(input) {
    request(input); const memberId = await authorize(), expected = original(input, memberId), before = await read(expected);
    await authorize(memberId);
    const fresh = await read(expected);
    if (!same(before, fresh)) throw Error('Maintenance initialization boundary changed');
    if (fresh === null) await store.insert(journal, expected);
    // Unknown outcomes propagate immediately. Only a later explicit inspection
    // of the SAME request can confirm ownership; no automatic resubmission.
    if (!same(await read(expected), expected)) throw Error('Maintenance control insert unconfirmed');
    await authorize(memberId);
    return { company, controlId: id, requestId: input.requestId, initialized: true,
      created: fresh === null, mode: 'MAINTENANCE', activationReady: false };
  }
  return { initialize, inspect };
}
module.exports = { createMaintenanceControlInitializer };

}
};
const modules = new Map();
function load(name) {
  if (!Object.hasOwn(factories, name)) throw Error('Runtime module scope violation');
  if (!modules.has(name)) { const module = { exports: {} }; modules.set(name, module); factories[name](load, module); }
  return modules.get(name).exports;
}
export const createCurrentStockSave = load("current-stock-save.cjs").createCurrentStockSave;
export const createCurrentWarehouseReceiptSave = load("current-department-saves.cjs").createCurrentWarehouseReceiptSave;
export const createCurrentBorrowingSave = load("current-department-saves.cjs").createCurrentBorrowingSave;
export const createCurrentAllocationSave = load("current-department-saves.cjs").createCurrentAllocationSave;
export const createSdkConditionalStore = load("sdk-conditional-store.cjs").createSdkConditionalStore;
export const createCurrentPurchaseSave = load("current-department-saves.cjs").createCurrentPurchaseSave;
export const createCurrentPurchaseReorderSave = load("current-purchase-reorder-save.cjs").createCurrentPurchaseReorderSave;
export const createCurrentPurchaseTables = load("current-purchase-tables.cjs").createCurrentPurchaseTables;
export const createCurrentPurchaseTaskGateway = load("current-purchase-task-gateway.cjs").createCurrentPurchaseTaskGateway;
export const createCurrentPurchaseSaveRouter = load("current-purchase-save-router.cjs").createCurrentPurchaseSaveRouter;
export const createCurrentPurchaseReadRouter = load("current-purchase-read-router.cjs").createCurrentPurchaseReadRouter;
export const createCurrentWarehouseReceiptRouter = load("current-warehouse-receipt-router.cjs").createCurrentWarehouseReceiptRouter;
export const createCurrentWarehouseOrdersRead = load("current-warehouse-orders-read.cjs").createCurrentWarehouseOrdersRead;
export const createCurrentWarehouseOrdersRouter = load("current-warehouse-receipt-router.cjs").createCurrentWarehouseOrdersRouter;
export const createCurrentWarehousePreparationSave = load("current-warehouse-preparation-save.cjs").createCurrentWarehousePreparationSave;
export const createCurrentWarehouseCbmSave = load("current-warehouse-cbm-save.cjs").createCurrentWarehouseCbmSave;
export const createWarehousePhotoFencedStore = load("warehouse-photo-fenced-store.cjs").createWarehousePhotoFencedStore;
export const createPackingPhotoFencedStore = load("packing-photo-fenced-store.cjs").createPackingPhotoFencedStore;
export const createCurrentQuantityCaseSave = load("current-department-saves.cjs").createCurrentQuantityCaseSave;
export const createCurrentShortageSave = load("current-department-saves.cjs").createCurrentShortageSave;
export const createCurrentStockExceptionSave = load("current-stock-exception-save.cjs").createCurrentStockExceptionSave;
export const createCurrentStockResolutionSave = load("current-stock-resolution-save.cjs").createCurrentStockResolutionSave;
export const createCurrentCostReferenceSave = load("current-cost-reference-save.cjs").createCurrentCostReferenceSave;
export const createCurrentMarginReferenceSave = load("current-margin-reference-save.cjs").createCurrentMarginReferenceSave;
export const createCurrentPurchaseOrderRecordSave = load("current-order-record-save.cjs").createCurrentPurchaseOrderRecordSave;
export const createCurrentAccountOrderRecordSave = load("current-order-record-save.cjs").createCurrentAccountOrderRecordSave;
export const createCurrentAccountAuxiliarySave = load("current-account-auxiliary-save.cjs").createCurrentAccountAuxiliarySave;
export const createCurrentOrderFileSave = load("current-order-file-save.cjs").createCurrentOrderFileSave;
export const createOrderFileFencedStore = load("order-file-fenced-store.cjs").createOrderFileFencedStore;
export const createPurchaseDeleteProtocol = load("purchase-delete-protocol.cjs").createPurchaseDeleteProtocol;
export const createFencedProof = load("fenced-proof.cjs").createFencedProof;
export const createSegmentedFencedProof = load("segmented-fenced-proof.cjs").createSegmentedFencedProof;
export const planCollections = load("domain-scope.cjs").planCollections;
export const createPurchaseTransferWorkspace = load("purchase-transfer-workspace.cjs").createPurchaseTransferWorkspace;
export const createBorrowCurrentQuery = load("borrow-current-query.cjs").createBorrowCurrentQuery;
export const readCurrentPurchaseProjection = load("purchase-current-projection.cjs").readCurrentPurchaseProjection;
export const createCurrentPurchaseWorkspaceRead = load("current-purchase-workspace-read.cjs").createCurrentPurchaseWorkspaceRead;
export const createPurchaseBorrowOptions = load("purchase-borrow-options.cjs").createPurchaseBorrowOptions;
export const createCurrentPurchaseBorrowGateway = load("current-purchase-borrow-gateway.cjs").createCurrentPurchaseBorrowGateway;
export const createCurrentPackingService = load("current-packing-service.cjs").createCurrentPackingService;
export const projectCurrentWarehouseReady = load("current-warehouse-ready-context.cjs").projectCurrentWarehouseReady;
export const createCurrentSalesDemandSave = load("current-sales-save.cjs").createCurrentSalesDemandSave;
export const createCurrentSalesRead = load("current-sales-read.cjs").createCurrentSalesRead;
export const createCurrentSalesShipmentSave = load("current-sales-shipment-save.cjs").createCurrentSalesShipmentSave;
export const createCurrentSalesArrangementSave = load("current-sales-arrangement-save.cjs").createCurrentSalesArrangementSave;
export const createCurrentSalesDocumentSave = load("current-sales-document-save.cjs").createCurrentSalesDocumentSave;
export const createCustomerDocumentFencedStore = load("customer-document-fenced-store.cjs").createCustomerDocumentFencedStore;
export const createCurrentWarehouseDispatchSave = load("current-warehouse-dispatch-save.cjs").createCurrentWarehouseDispatchSave;
export const createCurrentWarehouseShipmentRead = load("current-warehouse-dispatch-save.cjs").createCurrentWarehouseShipmentRead;
export const dispatchCurrentSalesGateway = load("sales-gateway-current.cjs").dispatchCurrentSalesGateway;
export const requireOriginalSalesDelegation = load("sales-delegation.cjs").requireOriginalSalesDelegation;
export const createCurrentOrderIntakeOperations = load("current-order-intake.cjs").createCurrentOrderIntakeOperations;
export const createCurrentCostTables = load("current-cost-tables.cjs").createCurrentCostTables;
export const createMaintenanceSnapshotReader = load("maintenance-snapshot-reader.cjs").createMaintenanceSnapshotReader;
export const createMaintenanceBackupStore = load("maintenance-backup-store.cjs").createMaintenanceBackupStore;
export const createRetainedMaintenanceCapture = load("maintenance-backup-store.cjs").createRetainedMaintenanceCapture;
export const createMaintenanceInstalledReader = load("maintenance-installed-reader.cjs").createMaintenanceInstalledReader;
export const createMaintenanceMetadataInitializer = load("maintenance-metadata-initializer.cjs").createMaintenanceMetadataInitializer;
export const createMaintenanceMigration = load("maintenance-migration.cjs").createMaintenanceMigration;
export const createMaintenanceControlInitializer = load("maintenance-control-initializer.cjs").createMaintenanceControlInitializer;
