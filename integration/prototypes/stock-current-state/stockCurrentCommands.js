import { createHash, randomBytes } from 'crypto';
// Candidate-only backend runtime. Original gateway authentication and verified
// all-writer coverage are mandatory. No webMethods, SDK elevation or mode switch.
const factories = {
// current-stock-save.cjs sha256:83fea3fb1d8885a95c8189849c330df1cdb59fc883fbca621d5d7f18fb36180e
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
    const envelope = copy({ company, writer, input: request.input, stockProtocol: request.stockProtocol,
      stockBuild: request.stockBuild, stockGeneration: request.stockGeneration });
    let admittedGeneration;
    const result = await protocol.commit({ requestId: request.requestId, memberId: actor.memberId, input: envelope,
      authorize: operation => {
        const admission = evaluateStockAdmission({ company, writer, control: operation.control, coverage, request: envelope, operation });
        if (admission.route !== 'FENCED_CURRENT') throw Error('Current save requires ACTIVE mode; no legacy or shadow fallback');
        admittedGeneration = admission.generation;
      },
      prepare: async () => {
        const prepared = await prepare({ company, requestId: request.requestId, memberId: actor.memberId, input: copy(envelope.input) });
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
// current-department-saves.cjs sha256:2ee2acf2a86c0f1865443ff246b97f0a6646fe007c83dbd36bec447473b5a1bd
"current-department-saves.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { createWarehouseAuthority } = load("warehouse-authority.cjs");
const { createWarehouseStockReader } = load("warehouse-stock-reader.cjs");
const { createBorrowingAuthority } = load("borrowing-authority.cjs");
const { createBorrowingStockReader } = load("borrowing-stock-reader.cjs");
const { createAllocationAuthority } = load("allocation-authority.cjs");
const { createPurchaseStockPreparation } = load("purchase-stock-preparation.cjs");
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
  return createCurrentStockSave({ company, writer: 'RECEIPT', protocol, coverage,
    authenticate: authorize,
    prepare: command => createWarehouseStockReader({ company, items, store, protocol, readAuthority: () => authority(command) })() });
}
function createCurrentBorrowingSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  const authorize = authenticate(authorityDependencies, authorityDependencies?.requirePurchaseStaff);
  const authority = createBorrowingAuthority(authorityContext(authorityDependencies, protocol));
  const save = createCurrentStockSave({ company, writer: 'BORROWING', protocol, coverage,
    authenticate: authorize,
    prepare: command => createBorrowingStockReader({ company, items, store, protocol,
      readAuthority: () => authority({ company, requestId: command.requestId, kind: command.input.kind, input: command.input.details }) })() });
  return request => {
    if (!request || !['APPROVE', 'RETURN'].includes(request.kind)) throw Error('Purchase borrowing action required');
    return save({ requestId: request.requestId, stockProtocol: request.stockProtocol, stockBuild: request.stockBuild,
      stockGeneration: request.stockGeneration, input: { kind: request.kind, details: request.input } });
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
      : ['EDIT', 'PO', 'AVERAGE_COST'].includes(request?.operation) ? 'PURCHASE_TASK' : null;
    if (!writer) throw Error('Supported current Purchase operation required');
    let actor;
    const result = await createCurrentStockSave({ company, writer, protocol, coverage, authenticate: async () => { actor = await authorize(); return actor; },
      prepare: command => prepare({ company, requestId: command.requestId, operation: command.input.operation, input: command.input.details }) })({
      requestId: request.requestId, stockProtocol: request.stockProtocol, stockBuild: request.stockBuild,
      stockGeneration: request.stockGeneration, input: { operation: request.operation, details: request.input } });
    if (result.ok !== true || request.operation !== 'ADD_SOURCE') return result;
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
module.exports = { createCurrentWarehouseReceiptSave, createCurrentBorrowingSave, createCurrentAllocationSave, createCurrentPurchaseSave };

},
// warehouse-authority.cjs sha256:6ac1a4cbccd0d64e074b6d0afa4a7c7aeffccb43367aaf4738d8a7c4a9e29ce5
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
  return async ({ company, requestId, input }) => {
    if (!['NCT', 'GHR'].includes(company) || !/^[a-f0-9-]{36}$/i.test(requestId || '')
      || !input || !['RECEIVE', 'CORRECT'].includes(input.action)) throw Error('Valid Warehouse receipt request required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requireWarehouseStaff(member, []);
    const staff = { ...requireWarehouseStaff(member, await readStaffRecords()), memberId: member._id };
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
      products: [...products.values()].map(p => {
        const lines = validated.event.details.lines.filter(line => p.sources.some(s => s.id === line.taskId));
        return { identity: p.identity, buildState: p.buildState,
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

// Repository must filter/sort/page StockProducts BEFORE returning rows; no Activity API.
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
// original-product-state.cjs sha256:b6900df9feef392a2b4311b85214d08daf5616d0239586be21489f3ec4f6b567
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
    const po = orders.filter(p => p.company === company && p.taskIds.includes(source.id));
    const candidateOwner = source.customerDemandTaskId || source.id;
    const ownerTaskId = demands.some(t => t.id === candidateOwner) ? candidateOwner : null;
    if (po.length !== 1 || po[0].number !== source.po || source.procurement.draftPlan
      || ownerTaskId === null && source.procurement.customerCtn !== 0 || !count(source.procurement.customerCtn)
      || source.procurement.customerCtn > source.procurement.totalCtn
      || source.warehouse && source.warehouse.hasPhysicalReceipt !== true && source.warehouse.accepted > 0) throw Error('Confirmed source PO and customer share required');
    const dispatchedByTask = {};
    for (const shipment of shipments.filter(s => s.status === 'DISPATCHED')) for (const line of shipment.lines) {
      const n = line.sources.find(s => s.sourceTaskId === source.id)?.quantity || 0;
      if (n) dispatchedByTask[line.taskId] = (dispatchedByTask[line.taskId] || 0) + n;
    }
    return { ...identity, id: source.id, ownerTaskId, poId: po[0].id, orderId: source.orderId, sourceLineId: source.sourceLineId,
      poValid: true, reviewRequired: false, receiptPolicy: ownerTaskId === null || allocations.some(a => a.sourceTaskId === source.id) ? 'EXPLICIT_ONLY' : 'OWNER_DEMAND',
      ownerShare: source.procurement.customerCtn, planned: source.procurement.totalCtn,
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
        const p = positions.get(s.id), claims = {};
        for (const c of rows.claims.filter(c => c.positionId === hash(company, key, 'PURCHASE_SOURCE', s.id))) {
          if (Object.hasOwn(claims, c.taskId) || !count(c.reservedUsable)) throw Error('Known unique current claims required');
          claims[c.taskId] = c.reservedUsable;
        }
        return { ...s, replacementReceived: p?.replacementReceived ?? 0, supplierReturned: p?.supplierReturned ?? 0,
          ...(currentLifecycle ? { borrowRepaidCumulative: p ? p.borrowRepaidCumulative : 0 } : {}),
          onHand: p?.onHand ?? 0, isolated: p?.isolated ?? 0, available: p?.available ?? 0, claims };
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
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
  if (company === 'NCT') return ['NCTOrders', 'NCTTasks', 'PurchaseOrders'];
  if (company === 'GHR') return ['NCTOrders1', 'NCTTasks1', 'PurchaseOrders'];
  throw Error('Known company domain scope required');
}
function planCollections(company, domainWrites = false) {
  if (!['NCT', 'GHR'].includes(company) || typeof domainWrites !== 'boolean') throw Error('Explicit server plan scope required');
  return [company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', 'StockPositions', 'StockClaims', 'StockProducts',
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
  const collection = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
// warehouse-stock-reader.cjs sha256:9e33c59871013fa9a2a97289ea434b4fc9bbf153c6f5a6cc527830eda08a9a0e
"warehouse-stock-reader.cjs": (load, module) => {
'use strict';

const { readCurrentProduct } = load("current-product-reader.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { prepareWarehouseReceipt } = load("warehouse-receipt-plan.cjs");
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
      for (const product of authority.products) {
        if (product.identity?.company !== company || typeof product.buildState !== 'function') throw Error('Server product authority required');
        if (protocol.planFormat === 'SEGMENTED_V2' && !product.stockScope) throw Error('Server receipt current scope required');
        const rows = protocol.planFormat === 'SEGMENTED_V2'
          ? await readScopedCurrentProduct({ ...product.stockScope, company, identity: product.identity, items, store, metrics, transferIndexVersion: control?.transferIndexVersion })
          : await readCurrentProduct({ company, identity: product.identity, items, store, metrics });
        if (protocol.planFormat === 'SEGMENTED_V2') {
          if (typeof product.readTaskRows !== 'function') throw Error('Private current task checkpoint reader required');
          rows.taskRows = await product.readTaskRows(rows); rows.generation = control.generation;
        }
        products.push({ state: product.buildState(rows), rows });
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
  const key = stockKey(identity), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
  const positions = await completeRows('StockPositions', 14);
  const claims = await completeRows('StockClaims', 60);
  const transfers = await completeRows(journal, 30, 'STOCK_TRANSFER_CURRENT');
  const product = await exact('StockProducts', hash(company, key));
  const knownRows = [...positions, ...claims, ...transfers, ...(product ? [product] : [])];
  if (knownRows.some(row => row.company !== company || row.stockKey !== key || !row._version || row.reviewRequired === true || row.reviewCodes?.length
      || ['onHand', 'isolated', 'available', 'reservedUsable', 'isolatedAttributed'].some(k => row[k] === null))
    || !product && (positions.length || claims.length || transfers.length)) throw Error('Current product requires review; no legacy quantity fallback');
  return { complete: true, positions, claims, transfers, product };
}
module.exports = { readCurrentProduct };

},
// scoped-current-reader.cjs sha256:500dd4284e595f9b27c5f3fb424f7547d44a3738a71e8e02f856694558c1d9f4
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
  metrics = { queries: 0, exactReads: 0 } }) {
  const key = stockKey(identity), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
    if (collection === 'StockPositions' && (!['receiptAccepted', 'borrowRepaidCumulative', 'onHand', 'isolated', 'available', 'reservedUsable', 'dispatched'].every(f => count(row[f]))
      || row.borrowRepaidCumulative > row.receiptAccepted || row.onHand !== row.isolated + row.available + row.reservedUsable)) throw Error('Source current checkpoint requires review');
    if (collection === 'StockClaims' && (!count(row.dispatchedCumulative) || !count(row.reservedUsable) || row.isolatedAttributed !== 0
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
  const product = await exact('StockProducts', hash(company, key));
  if (product && (product.lifecycleVersion !== 2 || !Number.isSafeInteger(product.nextBorrowSequence) || product.nextBorrowSequence < 1
    || !['onHand', 'reservedUsable', 'available', 'isolated'].every(f => count(product[f]))
    || product.onHand !== product.reservedUsable + product.available + product.isolated)) throw Error('Product lifecycle checkpoint requires review');
  const positions = new Map((await querySet('StockPositions', [['eq', 'status', 'ACTIVE']])).map(row => [row._id, row]));
  const claims = new Map((await querySet('StockClaims', [['eq', 'status', 'ACTIVE']])).map(row => [row._id, row]));
  const transfers = new Map((await querySet(journal, [['eq', 'action', 'STOCK_TRANSFER_CURRENT'], ['eq', 'status', 'ACTIVE']])).map(row => [row._id, row]));
  for (const sourceId of new Set(correctionSourceIds)) {
    const rows = await querySet(journal, [['eq', 'action', 'STOCK_TRANSFER_CURRENT'], ['eq', 'replacementSourceId', sourceId], ['gt', 'repaidQuantity', 0]]);
    for (const row of rows) transfers.set(row._id, row);
  }
  const requiredSources = new Set([...sourceTaskIds, ...correctionSourceIds, ...claimPairs.map(p => p.sourceTaskId)]), pairs = [...claimPairs];
  for (const claim of claims.values()) {
    const position = await exact('StockPositions', claim.positionId);
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
    const row = await exact('StockPositions', hash(company, key, 'PURCHASE_SOURCE', id));
    if (row) { if (row.sourceTaskId !== id) throw Error('Source stable identity conflict'); positions.set(row._id, row); }
  }
  for (const position of positions.values()) {
    if (position._id !== hash(company, key, 'PURCHASE_SOURCE', position.sourceTaskId)) throw Error('Source stable identity conflict');
    requiredSources.add(position.sourceTaskId);
    // Only this source's nonzero dispatch provenance, not all CLOSED product claims.
    for (const row of await querySet('StockClaims', [['eq', 'positionId', position._id], ['gt', 'dispatchedCumulative', 0]])) claims.set(row._id, row);
  }
  for (const { sourceTaskId, taskId } of pairs) {
    const positionId = hash(company, key, 'PURCHASE_SOURCE', sourceTaskId);
    const row = await exact('StockClaims', hash(company, positionId, taskId));
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
  writes.unshift({ collection: event.details.company === 'NCT' ? 'NCTActivity' : 'NCTActivity1',
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
// borrowing-stock-plan.cjs sha256:d481f8d97933a88f6d7b1802f7a9b9da49156660bdeacfb67c9f4ad1c68cddff
"borrowing-stock-plan.cjs": (load, module) => {
'use strict';

// Pure bounded mapping into the EXISTING fenced-plan contract. Not an endpoint,
// production schema installation or replacement for trusted business validators.
const { hash } = load("commit-proof.cjs");
const { stockKey } = load("current-model.cjs");
const { validate, approveBorrow, receive, correctAccepted, returnUnusedBorrow, allocateCumulative, adjustDemand, dispatchReserved, quarantineFree, freeCaseMovement, releaseFreeCase, relationRemaining } = load("borrowing-model.cjs");
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
  const company = before.company, key = stockKey(before), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
      writes.push({ collection: 'StockPositions', before: copy(old), after: { ...copy(base), poId: next.poId, receiptAccepted: next.accepted,
        replacementReceived: next.replacementReceived || 0, supplierReturned: next.supplierReturned || 0,
        ...(after.lifecycleVersion === 2 ? { borrowRepaidCumulative: next.borrowRepaidCumulative } : {}),
        dispatched: total(Object.values(next.dispatchedByTask || {})), onHand: next.onHand, isolated: next.isolated,
        available: next.available, reservedUsable: sumClaims(next), revision: (old?.revision || 0) + 1,
        checkpointGeneration: generation + 1, status: next.onHand === 0 ? 'CLOSED' : 'ACTIVE' } });
    }
    const ids = new Set([...Object.keys(source.claims), ...Object.keys(next.claims)]);
    for (const row of rows.claims.filter(c => c.positionId === id)) ids.add(row.taskId);
    for (const taskId of ids) {
      const claimId = hash(company, id, taskId), oldClaim = claims.get(claimId) || null, task = tasks.get(taskId);
      const prior = source.claims[taskId] || 0, quantity = next.claims[taskId] || 0;
      if (!task) throw Error('Claim task missing');
      if (oldClaim) {
        consumedClaims.add(claimId); checkRow(oldClaim, company, claimId, key);
        if (oldClaim.positionId !== id || oldClaim.taskId !== taskId || oldClaim.customerId !== task.customerId
          || oldClaim.reservedUsable !== prior || oldClaim.isolatedAttributed !== 0) throw Error('Claim snapshot conflict');
        if (before.lifecycleVersion === 2 && oldClaim.dispatchedCumulative !== (source.dispatchedByTask?.[taskId] || 0)) throw Error('Claim dispatch snapshot conflict');
      } else if (prior !== 0) throw Error('Claim snapshot missing');
      if (quantity === prior && (source.dispatchedByTask?.[taskId] || 0) === (next.dispatchedByTask?.[taskId] || 0)) continue;
      const base = oldClaim || { _id: claimId, schemaVersion: 1, company, stockKey: key, positionId: id,
        taskId, customerId: task.customerId, orderId: task.orderId || '', sourceLineId: task.sourceLineId || '',
        isolatedAttributed: 0, reviewCodes: [] };
      writes.push({ collection: 'StockClaims', before: copy(oldClaim), after: { ...copy(base), reservedUsable: quantity,
        ...(after.lifecycleVersion === 2 ? { dispatchedCumulative: next.dispatchedByTask?.[taskId] || 0 } : {}),
        revision: (oldClaim?.revision || 0) + 1, checkpointGeneration: generation + 1, status: quantity === 0 ? 'CLOSED' : 'ACTIVE' } });
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
  writes.push({ collection: 'StockProducts', before: copy(product || null), after: productAfter });
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
  const { after } = quarantineFree(state, { expectedRevision: state.revision, sourceId: source.id,
    quantity: event.details.quantity, kind: event.details.kind, reason: event.details.reason });
  const plan = mapTransition({ before: state, after, rows, event, generation });
  plan.writes[0].after.stockAttribution = 'FREE';
  plan.writes[0].after.stockKey = stockKey(state);
  return { state: after, plan };
}
function prepareFreeCaseMovement({ state, rows, event, caseEvent, priorResolution, generation }) {
  const d = event?.details, previous = priorResolution || {}, next = d?.state, action = d?.action;
  if (!event || event.action !== 'STOCK_EXCEPTION_RESOLUTION_SAVED' || event.result !== 'SAVED' || !event._id || event._id !== event.title
    || !event.initiatedByStaffId || !event.activityTime || !['RETURN', 'REPLACEMENT'].includes(action)
    || caseEvent?.action !== 'STOCK_EXCEPTION_REPORTED' || caseEvent.result !== 'SAVED' || caseEvent._id !== caseEvent.title
    || caseEvent.stockAttribution !== 'FREE' || caseEvent.stockKey !== stockKey(state) || caseEvent.company !== state.company
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
    action, quantity: newEntries.at(-1).quantity });
  return { state: after, plan: mapTransition({ before: state, after, rows, event, generation }) };
}
function prepareFreeCaseRelease({ state, rows, event, caseEvent, priorResolution, generation }) {
  const next = event?.details?.state, previous = priorResolution, approval = next?.financeApproval;
  if (!event || event.action !== 'STOCK_EXCEPTION_RESOLUTION_SAVED' || event.result !== 'SAVED' || event._id !== event.title || !event._id
    || !event.activityTime || !event.initiatedByStaffId || event.details.action !== 'CLOSE'
    || caseEvent?.stockAttribution !== 'FREE' || caseEvent.action !== 'STOCK_EXCEPTION_REPORTED' || caseEvent.result !== 'SAVED'
    || caseEvent.company !== state.company || caseEvent.stockKey !== stockKey(state) || caseEvent._id !== caseEvent.title
    || event.description !== caseEvent.title || event.imageAltText !== caseEvent.imageAltText || next?.caseId !== caseEvent.title
    || !previous || previous.financeApproval || event.details.beforeRevision !== previous.revision
    || previous.adminApproval?.outcome !== 'RELEASED' || previous.adminApproval.quantity !== caseEvent.details.quantity
    || approval?.outcome !== 'RELEASED' || approval.byStaffId !== event.initiatedByStaffId
    || approval.byStaffId === previous.adminApproval.byStaffId || !previous.adminApproval.byStaffId
    || (previous.returns || []).length || (previous.replacements || []).length) throw Error('Original separate Admin and Finance release approval required');
  const oldFixed = copy(previous), newFixed = copy(next); delete oldFixed.revision; delete newFixed.financeApproval;
  if (!same(oldFixed, newFixed)) throw Error('Release must preserve original case approval facts');
  const { after } = releaseFreeCase(state, { expectedRevision: state.revision, sourceId: caseEvent.imageAltText, quantity: caseEvent.details.quantity });
  return { state: after, plan: mapTransition({ before: state, after, rows, event, generation }) };
}
function prepareProcurementTransition({ state, after, rows, event, generation }) {
  guardProcurementStock({ before: state, after });
  const next = { ...copy(after), revision: state.revision + 1 };
  return { state: next, plan: mapTransition({ before: state, after: next, rows, event, generation }) };
}
function preparePackingHoldTransition({ state, rows, event, generation, packingHolds }) {
  const after = { ...copy(state), revision: state.revision + 1, packingHolds: copy(packingHolds) };
  // validate(after) in mapper enforces per-task held <= actual usable ownership.
  return { state: after, plan: mapTransition({ before: state, after, rows, event, generation }) };
}
module.exports = { prepareBorrowApproval, prepareBorrowReturn, prepareBorrowingReceipt, prepareCurrentAllocation, prepareSalesDemand, prepareShipmentDispatch, prepareFreeQuarantine, prepareFreeCaseMovement, prepareFreeCaseRelease, prepareProcurementTransition, preparePackingHoldTransition, transferId };

},
// borrowing-model.cjs sha256:c441b846c58578b09c791d849223bbc2102cdcdcedd1cca0b4ec161b886593e2
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
      || state.packingHolds.heldByTask[task.id] > reserved(state, task.id)) throw Error('Packing task coverage requires review');
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
      || state.packingHolds.heldByTask[borrower.id] !== 0 || legacyHeld(state, borrower.id)) throw Error('Eligible unheld borrower required');
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
function freeCaseMovement(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    if (!source || !positive(input.quantity) || !['RETURN', 'REPLACEMENT'].includes(input.action)) throw Error('Validated free-case physical movement required');
    if (input.action === 'RETURN') {
      if (input.quantity > source.isolated) throw Error('Supplier return exceeds isolated stock');
      source.isolated -= input.quantity; source.onHand -= input.quantity;
      source.supplierReturned = (source.supplierReturned || 0) + input.quantity;
    } else {
      source.onHand += input.quantity; source.available += input.quantity;
      source.replacementReceived = (source.replacementReceived || 0) + input.quantity;
    }
  });
}
function releaseFreeCase(before, input) {
  return transition(before, input.expectedRevision, state => {
    const source = state.sources.find(s => s.id === input.sourceId);
    if (!source || !positive(input.quantity) || input.quantity > source.isolated) throw Error('Approved isolated release quantity required');
    source.isolated -= input.quantity; source.available += input.quantity;
  });
}
module.exports = { validate, approveBorrow, receive, correctAccepted, returnUnusedBorrow, dispatch, dispatchReserved, adjustDemand, quarantineFree, freeCaseMovement, releaseFreeCase,
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
// allocation-authority.cjs sha256:84a32525a9374412cf092aad3cf0142a69de343377c2ee50d76052739dce78db
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
  return async ({ company, requestId, input }) => {
    if (!['NCT', 'GHR'].includes(company) || !/^[a-f0-9-]{36}$/i.test(requestId || '')
      || input?.action !== 'ALLOCATE' || typeof input.sourceTaskId !== 'string' || !input.sourceTaskId) throw Error('Valid allocation request required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePurchaseStaff(member, []);
    const staff = { ...requirePurchaseStaff(member, await readStaffRecords()), memberId: member._id };
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
  const collection = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
// purchase-stock-preparation.cjs sha256:1c617f85f7ae57ffa457b9f2921bc8e5861bdfaef56efae5406def33c88c6301
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
    const trusted = { company, staff: request.operation === 'ADD_SOURCE' ? { ...staff, canAddPurchaseSource: true } : staff,
      requestId: request.requestId, operation: request.operation, input: request.input };
    const metrics = { queries: 0, exactReads: 0 };
    const snapshot = await protocol.readSnapshot(async control => {
      let tables = await readTables(company, staff);
      const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
        : preparePurchaseDomain({ validated, request: trusted, tables, taskEditVersion, operationId, planFormat });
      if (current) for (const write of domainPlan.writes.filter(w => w.collection === tasks && w.before === null)) {
        Object.assign(write.after, { stockCounterSchema: 2, stockDispatchedCumulative: 0, stockCounterGeneration: control.generation + 1 });
      }
      const afterContext = projectDomainAfter({ company, staff, tables, plan: domainPlan, projectPurchaseWorkspace });
      const identities = new Map();
      for (const update of source ? [{ id: validated.task._id }] : validated.updates) {
        const found = [beforeContext, afterContext].flatMap(context => context.tasks.filter(t => t.id === update.id));
        if (!found.length) throw Error('Purchase changed task missing from original projection');
        const identity = { company, barcode: found[0].barcode, packing: found[0].packing, ea: found[0].ea }, key = stockKey(identity);
        if (found.some(t => stockKey({ company, barcode: t.barcode, packing: t.packing, ea: t.ea }) !== key)) throw Error('Purchase cannot replace product identity');
        identities.set(key, identity);
      }
      const products = [];
      for (const identity of identities.values()) {
        const builder = context => originalProductState({ company, context, identity,
          orders: projectPurchaseOrders({ company, workspace: context, records: tables.PurchaseOrders }),
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
    return { ...preparePurchaseStock({ company, ...snapshot.rows, generation: snapshot.generation, planFormat }),
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
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const allowed = new Set([orders, tasks, journal, 'SharedSuppliers', 'PurchaseOrders']);
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
// purchase-domain-plan.cjs sha256:db8541ecfee808a39216a23127fb61ed8f72387e6aede0116a49a64ac53a1ce7
"purchase-domain-plan.cjs": (load, module) => {
'use strict';

const { domainCollections } = load("domain-scope.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const { utf8Bytes } = load("segmented-plan.cjs");
// Maps unchanged original domain intent. Requires migration-tagged exact row versions.
// Does NOT replace stock/share guards, cost locks or all-writer authorization.
function preparePurchaseDomain({ validated, request, tables, taskEditVersion, operationId, planFormat = 'PROOF_V1' }) {
  if (!['PROOF_V1', 'SEGMENTED_V2'].includes(planFormat)) throw Error('Server Purchase plan format required');
  const company = request.company, [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  if (!validated || validated.operation !== request.operation || !Array.isArray(validated.updates) || !Array.isArray(validated.events)
    || !validated.time || validated.displayOrder || typeof taskEditVersion !== 'function' || typeof operationId !== 'function') throw Error('Supported original Purchase plan required; display order needs its own adapter');
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
  const journal = company === 'NCT' ? 'NCTActivity' : company === 'GHR' ? 'NCTActivity1' : null;
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
  const next = domainAfterSnapshot({ company, tables, plan }), [orders, tasks] = domainCollections(company), activity = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
  const [, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
  const { company, staff } = request, [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const allowed = new Set([orders, tasks, journal, 'SharedSuppliers', 'PurchaseOrders']);
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
  const { company } = request, [, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
// sdk-conditional-store.cjs sha256:d087abf224b05a079b2b74e67e038584a5f3bba0a7285de4adafa129a909e4d5
"sdk-conditional-store.cjs": (load, module) => {
'use strict';

// Candidate adapter only. Caller supplies authorized company and explicit collection scope.
// Not imported by production. Verified SDK1.0.528 uses plain WQL conditions, not Filter().
const metadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId']);
const own = (row, key) => Object.prototype.hasOwnProperty.call(row, key);
const { createSdkFieldCodec } = load("sdk-field-codec.cjs");

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
  return { read, insert, compareAndSet, compareAndRemove };
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
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
// segmented-fenced-proof.cjs sha256:43aa65f851d72c5f6e6cd5e907c90b4a218e93f51c9bea7c6aa4ff3c5508bc45
"segmented-fenced-proof.cjs": (load, module) => {
'use strict';

// OFFLINE v2 candidate. Same company fence/CAS contract as v1, no live endpoint.
// Runtime/staging budgets still require actual platform acceptance before activation.
const randomUUID = () => randomBytes(16).toString('hex');
const { hash } = load("commit-proof.cjs");
const { createSegmentedPlanCodec, same, copy } = load("segmented-plan.cjs");
function createSegmentedFencedProof({ store, company = 'NCT', newAttempt = randomUUID,
  domainWrites = false, codecPolicy = {}, stepsPerInvocation = 20, maxStagedFragments = 32 }) {
  for (const method of ['read', 'insert', 'compareAndSet', 'compareAndRemove']) {
    if (typeof store?.[method] !== 'function') throw Error('Conditional storage required');
  }
  if (!Number.isSafeInteger(stepsPerInvocation) || stepsPerInvocation < 1
    || !Number.isSafeInteger(maxStagedFragments) || maxStagedFragments < 1) throw Error('Bounded execution policy required');
  const codec = createSegmentedPlanCodec({ ...codecPolicy, company, domainWrites });
  const { journal, lockId, controlId } = codec.ids, scope = company + '/PURCHASE';
  async function readControl() {
    const row = await store.read(journal, controlId);
    if (!row || row.company !== company || !row._version || !Number.isSafeInteger(row.generation) || row.generation < 0) throw Error('Control missing or invalid');
    return row;
  }
  async function initialize() { await store.insert(journal, { _id: controlId, company, generation: 0, pending: null, _version: 'GENESIS' }); }
  async function transition(collection, before, after) {
    try {
      if (before) await store.compareAndSet(collection, after._id, before._version, copy(after));
      else await store.insert(collection, copy(after));
    } catch (error) {
      if (!same(await store.read(collection, after._id), after)) throw error;
    }
    if (!same(await store.read(collection, after._id), after)) throw Error('Conditional write unconfirmed');
  }
  const nextControl = (before, fields) => ({ ...before, ...fields, _version: hash(before._version, fields) });
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
    // Unknown acquisition is never stolen or auto-removed, including a lost reply.
    await store.insert(journal, { _id: lockId, company, owner: key, attempt });
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
      const fragments = [];
      if (!Array.isArray(manifest.fragments) || manifest.fragments.length > maxStagedFragments) throw Error('Manifest capacity conflict');
      for (const ref of manifest.fragments) fragments.push(await store.read(journal, ref.id));
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
      await store.compareAndRemove(journal, lockId, attempt);
    }
  }
  return { initialize, readControl, readSnapshot, commit, ids: codec.ids, planFormat: 'SEGMENTED_V2' };
}
module.exports = { createSegmentedFencedProof };

},
// purchase-transfer-workspace.cjs sha256:1d9ef617c0459322ae604f04cc14e992544456aeaafbf953c50f01b73870c8ed
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
          if (!r.id || seen.has(r.id) || !r.borrowerTaskId || !r.lenderTaskId || !r.lenderSourceId || !r.replacementSourceId
            || !count(r.quantity) || !r.quantity || !count(r.repaid) || !count(r.returned) || r.repaid + r.returned >= r.quantity) throw Error('Known outstanding relation required');
          seen.add(r.id); relations.push(r);
        }
        cursor = page.nextCursor;
        if (relations.length < expectedTotal && (!cursor || cursor.offset !== relations.length || cursor.version !== expectedVersion)
          || relations.length === expectedTotal && cursor) throw Error('Transfer workspace cursor incomplete');
      } while (cursor);
      const sourceIds = new Set(relations.flatMap(r => [r.lenderSourceId, r.replacementSourceId]));
      return { ...copy(workspace), stockCurrent: { schema: 'PURCHASE_TRANSFERS_V2', generation: control.generation,
        stockProtocol: 1, stockBuild: control.writerBuild, stockGeneration: control.generation },
        tasks: workspace.tasks.map(task => ({ ...copy(task), stockTransferOutstanding: sourceIds.has(task.id),
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
    const offset = cursor?.offset || 0, journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
// current-packing-service.cjs sha256:7a44248693f4bd637b8a35c29a1f5611652535271d991fd81a6d4f2d34ab99b6
"current-packing-service.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { createPackingStockPreparation } = load("packing-stock-preparation.cjs");
const { hash } = load("commit-proof.cjs");
// Private existing packing gateways only. PHOTOS/file protocol and real invoice/
// dispatch remain separate protected flows, not enabled by this non-file service.
function createCurrentPackingService({ company, items, store, protocol, coverage, authorityDependencies: deps }) {
  if (protocol?.planFormat !== 'SEGMENTED_V2' || !['NCT', 'GHR'].includes(company)
    || typeof deps?.projectPackingWorkroom !== 'function') throw Error('Current packing v2 scope/original public projector required');
  const prepare = createPackingStockPreparation({ ...deps, company, items, store, protocol });
  function department(value) { if (!['SUPPORT', 'WAREHOUSE'].includes(value)) throw Error('Original packing department required'); return value; }
  return {
    read: async request => {
      const result = await prepare.read({ company, department: department(request?.department) });
      return { ...deps.projectPackingWorkroom(result.context, request.department), stockCurrent: result.stockCurrent };
    },
    save: async request => {
      const originalDepartment = department(request?.department);
      let actor;
      const result = await createCurrentStockSave({ company, writer: 'PACKING', protocol, coverage,
        authenticate: async () => {
          const member = await deps.readMember();
          if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') deps.requirePackingStaff(member, [], originalDepartment);
          actor = { ...deps.requirePackingStaff(member, await deps.readStaffRecords(), originalDepartment), memberId: member._id };
          return actor;
        }, prepare: command => prepare.prepare({ company, department: originalDepartment, requestId: command.requestId, input: command.input.details }) })({
        requestId: request.requestId, stockProtocol: request.stockProtocol, stockBuild: request.stockBuild, stockGeneration: request.stockGeneration,
        input: { department: originalDepartment, details: request.input } });
      if (result.ok !== true) return result;
      const id = request.input.action === 'CREATE' ? hash(company, request.requestId, actor.memberId, 'PACKING') : request.input.id;
      await protocol.readSnapshot(async () => {
        const row = await store.read(company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', hash(company, id, 'PACKING_CURRENT'));
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
// packing-stock-preparation.cjs sha256:cccee03e09adc88ac42102ece8e276a214cdc573bb86dff51201c1f228118cc5
"packing-stock-preparation.cjs": (load, module) => {
'use strict';

const { stockKey } = load("current-model.cjs");
const { originalProductState } = load("original-product-state.cjs");
const { readCurrentProduct } = load("current-product-reader.cjs");
const { readScopedCurrentProduct } = load("scoped-current-reader.cjs");
const { currentPackingContext } = load("current-packing-context.cjs");
const { validateOriginalPacking } = load("original-packing-validation.cjs");
const { preparePackingStock } = load("packing-stock-plan.cjs");
// Private candidate for the existing authenticated read/save gateways. Every read
// shares the company control barrier. No legacy apply/photo/file side effects.
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
    if (request?.company !== company || !['SUPPORT', 'WAREHOUSE'].includes(request.department)
      || save && request.input?.action === 'PHOTOS') throw Error('Supported company/non-photo packing request required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePackingStaff(member, [], request.department);
    const staff = requirePackingStaff(member, await readStaffRecords(), request.department), metrics = { queries: 0, exactReads: 0 };
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
      if (!save) return { context, ...(current ? { stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1,
        stockBuild: control.writerBuild, stockGeneration: control.generation } } : {}) };
      const validated = await validateOriginalPacking({ createPackingListOperations, company, staff, requestId: request.requestId, input: request.input, context, now });
      const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
      metrics.exactReads++;
      const currentRecord = await store.read(journal, validated.record._id), prior = context.lists.find(l => l.id === validated.record.description);
      if (JSON.stringify(currentRecord?.details?.list || null) !== JSON.stringify(prior || null)) throw Error('Packing current record changed');
      // Reuse original stored-list validation, including evidence/bounds, before mapping.
      readPackingLists([{ ...validated.record, company }], company);
      const lines = new Set([...(prior?.lines || []), ...(prior?.change?.lines || []), ...validated.record.details.list.lines,
        ...(validated.record.details.list.change?.lines || [])].map(l => l.taskId));
      return { validated, currentRecord, products: products.filter(p => p.state.tasks.some(t => lines.has(t.id))) };
    });
    if (!save) return { ...snapshot.rows, memberId: staff.memberId, generation: snapshot.generation, metrics };
    return { ...preparePackingStock({ company, ...snapshot.rows, generation: snapshot.generation, packingHeld,
      planFormat: current ? 'SEGMENTED_V2' : 'PROOF_V1' }),
      memberId: staff.memberId, generation: snapshot.generation, metrics };
  }
  return { read: request => load(request, false), prepare: request => load(request, true) };
}
module.exports = { createPackingStockPreparation };

},
// current-packing-context.cjs sha256:b05160716be1f6b23150210faab374255a3b0110f38df5e5519bec3fa85636d1
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
      tasks.set(task.id, { task, ready: state.sources.reduce((n, s) => n + (s.claims[task.id] || 0), 0) });
    }
  }
  if (new Set(context.tasks.map(t => t.taskId)).size !== context.tasks.length) throw Error('Original packing task is ambiguous');
  const result = copy(context);
  result.tasks = context.tasks.map(row => {
    const current = tasks.get(row.taskId);
    if (!current || row.company !== context.company || current.task.customerId !== row.customerId
      || row.remaining !== current.task.requested - current.task.dispatched) throw Error('Exact packing demand provenance required');
    return { ...copy(row), ready: current.ready, remaining: current.task.requested - current.task.dispatched };
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
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', scratch = new Map(), boundary = new Error('Private packing preparation boundary');
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
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', event = { ...copy(record), company };
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
// current-sales-save.cjs sha256:2fa20a1468fc7a609cd53755d41684fc49bbdc97a4e0158ab01ea4009bc55ca7
"current-sales-save.cjs": (load, module) => {
'use strict';

const { createCurrentStockSave } = load("current-stock-save.cjs");
const { readCurrentSalesWorkspace } = load("sales-current-workspace.cjs");
const { stockKey } = load("current-model.cjs");
const { validateOriginalSales } = load("original-sales-validation.cjs");
const { prepareSalesDemand } = load("borrowing-stock-plan.cjs");
const { requireOriginalSalesDelegation } = load("sales-delegation.cjs");
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
        return { memberId: staff.memberId };
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
    return save(request);
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
  const collection = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
// current-sales-read.cjs sha256:883addb30bc632c1677fb142612e2e75e70d78f61f43d2ca1ffb04a6f067c62f
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
        stockBuild: control.writerBuild, stockGeneration: control.generation } };
    });
    return snapshot.rows;
  };
}
module.exports = { createCurrentSalesRead };

},
// current-sales-shipment-save.cjs sha256:c36789c04b02f4384ce241ffdecd91cf5b78e26a3c818c5533666b2d8deb1a32
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
        return { memberId: staff.memberId };
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
    const record = await protocol.readSnapshot(() => store.read(company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', hash(company, request.requestId, staff.memberId, 'SHIPMENT_EVENT')));
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
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
  writes.unshift({ collection: company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', before: null, after: { ...copy(event), company } });
  if (new Set(writes.map(w => w.collection + ':' + w.after._id)).size !== writes.length || writes.length > 10000
    || utf8Bytes(JSON.stringify({ writes })) > 8 * 1024 * 1024) throw Error('Shipment hold segmented policy');
  return { plan: { writes }, states };
}
module.exports = { prepareSalesShipmentHolds };

},
// current-sales-arrangement-save.cjs sha256:f80fbcb3aefdf6e5f3fc1b9d06e52cf80e93db10c75c921c9eeeb3e18b03c723
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
        return { memberId: staff.memberId };
      }, prepare: async command => {
        if (command.memberId !== staff.memberId) throw Error('Sales delegated actor changed');
        const snapshot = await protocol.readSnapshot(async () => prepareShipmentArrangement({ company, staff,
          requestId: command.requestId, input: command.input, context: await readContext(company, staff),
          createSalesShipmentDateOperations, createShipmentPlanOperations, now }));
        return { plan: snapshot.rows.plan, memberId: staff.memberId, generation: snapshot.generation };
      } })(request);
    if (result.ok !== true) return result;
    const date = request.input.action === 'ORDER_DATE', journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', expectedAction = date ? 'SALES_SHIPMENT_DATE_SAVED' : 'CUSTOMER_SHIPMENT_PLAN_SAVED';
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
// current-warehouse-dispatch-save.cjs sha256:c42613e519b6f75c80117fd78655e7302a0eea38cfec4f245fe80de31386a52f
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
        return { memberId: staff.memberId };
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
    const snapshot = await protocol.readSnapshot(() => store.read(company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', hash(company, request.requestId, staff.memberId, 'SHIPMENT_EVENT')));
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
      return { ...result, stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: control.writerBuild, stockGeneration: control.generation } };
    });
    return snapshot.rows;
  };
}
module.exports = { createCurrentWarehouseDispatchSave, createCurrentWarehouseShipmentRead };

},
// warehouse-shipment-workspace.cjs sha256:a65427c28ad34f4c7907be273c2c74618fde31684659e24b598dcdbd0ec0ed1f
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
  if (!['NCT', 'GHR'].includes(company) || !staff?.memberId || !staff.staffId || staff.canDispatchShipment !== true || staff.customerId
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
  writes.unshift({ collection: shipment.company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', before: null, after: { ...copy(event), company: shipment.company } });
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
  const collection = company === 'NCT' ? 'NCTTasks' : 'NCTTasks1', result = copy(plan);
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
// sales-gateway-current.cjs sha256:c18616c8887d6b1781a6f448ca09ee03a26659187916f4094f2064f6d80c4229
"sales-gateway-current.cjs": (load, module) => {
'use strict';
const { requireOriginalSalesDelegation } = load("sales-delegation.cjs");
// PRIVATE: invoked only after the existing source bearer authentication. This is
// a transport adapter, never a replacement for source/member authentication.
async function dispatchCurrentSalesGateway({ body, staff, resolveCurrentSales, legacy }) {
  requireOriginalSalesDelegation(staff, body.customerId);
  if (typeof resolveCurrentSales !== 'function' || typeof legacy !== 'function') throw Error('Private Sales route dependencies required');
  const current = await resolveCurrentSales(body.company, staff);
  if (current?.mode === 'LEGACY') return legacy();
  if (current?.mode !== 'ACTIVE') throw Error('Inventory maintenance; Sales changes are paused');
  if (body.action === 'READ' && typeof current.read === 'function') return current.read(body.company);
  const save = body.action === 'ADJUST' ? current.save : ['SELECT', 'CANCEL'].includes(body.action) ? current.shipmentSave
    : ['PLAN', 'ORDER_DATE'].includes(body.action) ? current.arrangementSave : null;
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
    stockBuild: stockCurrent.stockBuild, stockGeneration: stockCurrent.stockGeneration,
    input: { ...input, action: body.action, customerId: staff.customerId } });
}
module.exports = { dispatchCurrentSalesGateway };

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
export const createFencedProof = load("fenced-proof.cjs").createFencedProof;
export const createSegmentedFencedProof = load("segmented-fenced-proof.cjs").createSegmentedFencedProof;
export const planCollections = load("domain-scope.cjs").planCollections;
export const createPurchaseTransferWorkspace = load("purchase-transfer-workspace.cjs").createPurchaseTransferWorkspace;
export const createBorrowCurrentQuery = load("borrow-current-query.cjs").createBorrowCurrentQuery;
export const createPurchaseBorrowOptions = load("purchase-borrow-options.cjs").createPurchaseBorrowOptions;
export const createCurrentPackingService = load("current-packing-service.cjs").createCurrentPackingService;
export const projectCurrentWarehouseReady = load("current-warehouse-ready-context.cjs").projectCurrentWarehouseReady;
export const createCurrentSalesDemandSave = load("current-sales-save.cjs").createCurrentSalesDemandSave;
export const createCurrentSalesRead = load("current-sales-read.cjs").createCurrentSalesRead;
export const createCurrentSalesShipmentSave = load("current-sales-shipment-save.cjs").createCurrentSalesShipmentSave;
export const createCurrentSalesArrangementSave = load("current-sales-arrangement-save.cjs").createCurrentSalesArrangementSave;
export const createCurrentWarehouseDispatchSave = load("current-warehouse-dispatch-save.cjs").createCurrentWarehouseDispatchSave;
export const createCurrentWarehouseShipmentRead = load("current-warehouse-dispatch-save.cjs").createCurrentWarehouseShipmentRead;
export const dispatchCurrentSalesGateway = load("sales-gateway-current.cjs").dispatchCurrentSalesGateway;
