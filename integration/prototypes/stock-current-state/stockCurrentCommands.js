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
// current-department-saves.cjs sha256:edddfad2dfaeb696d754887e27e6c35555052d5ee87c153a6c5bc305785260a0
"current-department-saves.cjs": (load, module) => {
'use strict';
const { createCurrentStockSave } = load("current-stock-save.cjs");
const { createWarehouseAuthority } = load("warehouse-authority.cjs");
const { createWarehouseStockReader } = load("warehouse-stock-reader.cjs");
const { createBorrowingAuthority } = load("borrowing-authority.cjs");
const { createBorrowingStockReader } = load("borrowing-stock-reader.cjs");

function authenticate(deps, requireStaff) {
  if (typeof deps?.readMember !== 'function' || typeof deps?.readStaffRecords !== 'function' || typeof requireStaff !== 'function') throw Error('Original department authentication required');
  return async () => {
    const member = await deps.readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requireStaff(member, []);
    return { ...requireStaff(member, await deps.readStaffRecords()), memberId: member._id };
  };
}
// Concrete original authority -> current reader -> shared commit composition. No
// legacy writer or new privilege may be supplied through a browser request.
function createCurrentWarehouseReceiptSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  const authorize = authenticate(authorityDependencies, authorityDependencies?.requireWarehouseStaff);
  const authority = createWarehouseAuthority(authorityDependencies);
  return createCurrentStockSave({ company, writer: 'RECEIPT', protocol, coverage,
    authenticate: authorize,
    prepare: command => createWarehouseStockReader({ company, items, store, protocol, readAuthority: () => authority(command) })() });
}
function createCurrentBorrowingSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  const authorize = authenticate(authorityDependencies, authorityDependencies?.requirePurchaseStaff);
  const authority = createBorrowingAuthority(authorityDependencies);
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
module.exports = { createCurrentWarehouseReceiptSave, createCurrentBorrowingSave };

},
// warehouse-authority.cjs sha256:93c0452a7f3c509b7246510e0e2f90e6a8f877345bef8c1113b7a870e016803f
"warehouse-authority.cjs": (load, module) => {
'use strict';

const { stockKey } = load("current-model.cjs");
const { originalProductState } = load("original-product-state.cjs");
const { validateOriginalReceipt } = load("original-receipt-validation.cjs");
// Server-only authority preparation. Caller must execute this INSIDE readSnapshot
// and recheck expectedVersion under the fenced lock before committing its plan.
function createWarehouseAuthority({ readMember, readStaffRecords, requireWarehouseStaff, readContext, readPurchaseRecords,
  projectPurchaseOrders, projectWarehouseOrders, createWarehouseOperations,
  readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation, now = () => new Date() }) {
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
      products: [...products.values()].map(p => ({ identity: p.identity, buildState: p.buildState })) };
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
// original-product-state.cjs sha256:6dcb7fac9c5d88c6b5f01de0c45a723062ecc25f0da9fecaab7df2b1279834da
"original-product-state.cjs": (load, module) => {
'use strict';

const { hash } = load("commit-proof.cjs");
const { stockKey } = load("current-model.cjs");
const { createPackingHoldSnapshot } = load("packing-hold-snapshot.cjs");
const { legacyPreparationGuard } = load("legacy-preparation-guard.cjs");
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
  return { identity, demands, sources, buildState: rows => {
    const positions = new Map(rows.positions.map(p => [p.sourceTaskId, p]));
    const tasks = demands.map(t => ({ ...identity, id: t.id, customerId: t.customerId, orderId: t.orderId, sourceLineId: t.sourceLineId,
      requested: t.requested ?? t.ord, dispatched: sources.reduce((n, s) => n + (s.dispatchedByTask[t.id] || 0), 0) }));
    return { ...identity, name: rows.product?.name || name, complete: true, revision: rows.product?.revision || 0, tasks, packingHolds: holds,
      sources: sources.map(s => {
        const p = positions.get(s.id), claims = {};
        for (const c of rows.claims.filter(c => c.positionId === hash(company, key, 'PURCHASE_SOURCE', s.id))) {
          if (Object.hasOwn(claims, c.taskId) || !count(c.reservedUsable)) throw Error('Known unique current claims required');
          claims[c.taskId] = c.reservedUsable;
        }
        return { ...s, replacementReceived: p?.replacementReceived ?? 0, supplierReturned: p?.supplierReturned ?? 0,
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
// warehouse-stock-reader.cjs sha256:872b2dd16adaf3702a9b6e37137755141a27b5629d4fc3c9b3490711887381aa
"warehouse-stock-reader.cjs": (load, module) => {
'use strict';

const { readCurrentProduct } = load("current-product-reader.cjs");
const { prepareWarehouseReceipt } = load("warehouse-receipt-plan.cjs");
function createWarehouseStockReader({ company, items, store, protocol, readAuthority }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function' || typeof store?.read !== 'function'
    || typeof protocol?.readSnapshot !== 'function' || typeof readAuthority !== 'function') throw Error('Server Warehouse stock dependencies required');
  // Intended as fenced commit.prepare; not a standalone unauthenticated save route.
  return async () => {
    const metrics = { queries: 0, exactReads: 0 };
    const snapshot = await protocol.readSnapshot(async () => {
      const authority = await readAuthority();
      if (authority?.kind !== 'RECEIVE' || !authority.memberId || !authority.validated
        || !Array.isArray(authority.products) || !authority.products.length) throw Error('Verified Warehouse authority required');
      const products = [];
      for (const product of authority.products) {
        if (product.identity?.company !== company || typeof product.buildState !== 'function') throw Error('Server product authority required');
        const rows = await readCurrentProduct({ company, identity: product.identity, items, store, metrics });
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
// borrowing-stock-plan.cjs sha256:977a60e7241a54056e821496ffc706e569b8096a36af0ef702d1cf35777b8f2e
"borrowing-stock-plan.cjs": (load, module) => {
'use strict';

// Pure bounded mapping into the EXISTING fenced-plan contract. Not an endpoint,
// production schema installation or replacement for trusted business validators.
const { hash } = load("commit-proof.cjs");
const { stockKey } = load("current-model.cjs");
const { validate, approveBorrow, receive, correctAccepted, returnUnusedBorrow, allocateCumulative, adjustDemand, dispatchReserved, quarantineFree, freeCaseMovement, releaseFreeCase, relationRemaining } = load("borrowing-model.cjs");
const { guardProcurementStock } = load("procurement-stock-guard.cjs");
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
  if (!count(generation) || !rows || rows.complete !== true || !Array.isArray(rows.positions)
    || !Array.isArray(rows.claims) || !Array.isArray(rows.transfers) || before.sources.length > 14
    || before.tasks.length > 30 || before.relations.length > 30 || after.relations.length > 30 || rows.claims.length > 60
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
    if (product.revision !== before.revision || !Object.keys(beforeTotals).every(k => product[k] === beforeTotals[k])) throw Error('Product snapshot conflict');
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
      revision: (old?.revision || 0) + 1, activityTime: event.activityTime, checkpointGeneration: generation + 1,
      status: relationRemaining(relation) === 0 ? 'CLOSED' : 'ACTIVE', details: { relation: copy(relation) } } });
  }
  if (consumedPositions.size !== positions.size || consumedClaims.size !== claims.size || consumedTransfers.size !== transfers.size) throw Error('Snapshot contains unrelated stock rows');
  const totals = summary(after);
  writes.push({ collection: 'StockProducts', before: copy(product || null), after: { ...(product || { _id: productId,
    schemaVersion: 1, company, stockKey: key, barcode: before.barcode, packing: before.packing, ea: before.ea, name: before.name || '' }),
    ...totals, revision: before.revision + 1, checkpointGeneration: generation + 1, reviewRequired: false,
    ...(after.lifecycleVersion === 2 ? { lifecycleVersion: 2, nextBorrowSequence: after.nextBorrowSequence } : {}),
    status: totals.onHand === 0 ? 'CLOSED' : 'ACTIVE' } });
  const identities = writes.map(w => w.collection + ':' + w.after._id);
  if (new Set(identities).size !== writes.length || writes.length > 30 || Buffer.byteLength(JSON.stringify({ writes })) > 180000) throw Error('Borrowing plan exceeds atomic proof bound');
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
// borrowing-model.cjs sha256:7923a4d5c9ddaab5ffa108a991821dca30179b71340354dbdbcf2c145076fbd8
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
    if (sum(state.sources.map(s => s.dispatchedByTask?.[task.id] || 0)) !== task.dispatched) throw Error('Task dispatch provenance conflict');
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
// segmented-plan.cjs sha256:0039b49767dc5d7105fa42aed123468ce123839e5e815c9856f2324822adf1b4
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
      || !Number.isSafeInteger(baseGeneration) || baseGeneration < 0 || typeof attempt !== 'string' || !attempt) throw Error('Segmented operation identity');
  }
  function encode(context) {
    identity(context);
    const { key, digest, memberId, requestId, baseGeneration, attempt } = context;
    const plan = normalize(context.plan, key), payload = stringify(plan), fragments = [];
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
    if (!same(parsed, normalized) || stringify(parsed) !== payload || manifest.writeCount !== normalized.writes.length) throw Error('Prepared plan changed');
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
// borrowing-authority.cjs sha256:91a596aac377f03a1eb79c246a19f9c4a84642be9f6c31df56d4498cb880d744
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
  projectPurchaseOrders, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation, readTransfer, now = () => new Date() }) {
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
    return { kind, identity, input: safeInput, event, memberId: member._id, buildState: product.buildState };
  };
}
module.exports = { createBorrowingAuthority };

},
// borrowing-stock-reader.cjs sha256:397d3a682736eeba0d2bf35883b798049f28116a1bbe942016ae0a9141a15370
"borrowing-stock-reader.cjs": (load, module) => {
'use strict';

// Bounded current-row preparation candidate. Authority callback is SERVER-owned and
// must retain existing permission/PO/packing/finance checks. No production imports.
const { readCurrentProduct } = load("current-product-reader.cjs");
const { prepareBorrowApproval, prepareBorrowReturn, prepareBorrowingReceipt, prepareCurrentAllocation } = load("borrowing-stock-plan.cjs");
function createBorrowingStockReader({ company, items, store, protocol, readAuthority }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function' || typeof store?.read !== 'function'
    || typeof protocol?.readSnapshot !== 'function' || typeof readAuthority !== 'function') throw Error('Server borrowing dependencies required');
  return async () => {
    const metrics = { exactReads: 0, queries: 0 };
    const snapshot = await protocol.readSnapshot(async () => {
      const authority = await readAuthority();
      const identity = authority?.identity || authority?.state;
      if (!identity || identity.company !== company || !['APPROVE', 'RETURN', 'RECEIVE', 'ALLOCATE'].includes(authority.kind)
        || !authority.state && typeof authority.buildState !== 'function') throw Error('Verified borrowing authority required');
      const rows = await readCurrentProduct({ company, identity, items, store, metrics });
      if (typeof authority.buildState === 'function') authority.state = authority.buildState(rows);
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
// sdk-conditional-store.cjs sha256:3ba8df47b612e124ee65cbf91fda3c3e33056ce37b2b438d53191424f51d8974
"sdk-conditional-store.cjs": (load, module) => {
'use strict';

// Candidate adapter only. Caller supplies authorized company and explicit collection scope.
// Not imported by production. Verified SDK1.0.528 uses plain WQL conditions, not Filter().
const metadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId']);
const own = (row, key) => Object.prototype.hasOwnProperty.call(row, key);
const copy = value => JSON.parse(JSON.stringify(value));

function createSdkConditionalStore({ items, company, collections }) {
  if (!['NCT', 'GHR'].includes(company) || !Array.isArray(collections) || !collections.length
    || collections.some(name => typeof name !== 'string' || !name)
    || !items || ['query', 'insert', 'patch', 'remove'].some(method => typeof items[method] !== 'function')) {
    throw Error('Explicit conditional store scope required');
  }
  const allowed = new Set(collections);
  function scope(collection, id) {
    if (!allowed.has(collection) || typeof id !== 'string' || !id) throw Error('Storage scope violation');
  }
  function normalize(row) {
    if (!row) return null;
    if (row.company !== company) throw Error('Storage company conflict');
    const result = {};
    for (const [key, value] of Object.entries(row)) {
      if (!metadata.has(key) && key !== 'stockCommitVersion') result[key] = copy(value);
    }
    if (own(row, 'stockCommitVersion')) result._version = row.stockCommitVersion;
    return result;
  }
  function encode(row) {
    if (!row || row.company !== company || own(row, 'stockCommitVersion')
      || Object.keys(row).some(key => metadata.has(key))) throw Error('Invalid owned storage image');
    const result = {};
    for (const [key, value] of Object.entries(row)) {
      if (key !== '_version') result[key] = copy(value);
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
    return normalize(page.items[0] || null);
  }
  async function insert(collection, row) {
    scope(collection, row?._id);
    return normalize(await items.insert(collection, encode(row)));
  }
  async function compareAndSet(collection, id, expectedVersion, after) {
    scope(collection, id);
    if (typeof expectedVersion !== 'string' || !expectedVersion || after?._id !== id
      || !after._version || after._version === expectedVersion) throw Error('Fresh conditional version required');
    const current = await read(collection, id);
    if (!current || current._version !== expectedVersion) throw Error('Storage version conflict');
    const beforePayload = encode(current), afterPayload = encode(after);
    let patch = items.patch(collection, id);
    for (const key of Object.keys(beforePayload)) {
      if (key !== '_id' && !own(afterPayload, key)) patch = patch.removeField(key);
    }
    for (const [key, value] of Object.entries(afterPayload)) {
      if (key !== '_id') patch = patch.setField(key, value);
    }
    return normalize(await patch.run({ condition: { company: { $eq: company }, stockCommitVersion: { $eq: expectedVersion } } }));
  }
  async function compareAndRemove(collection, id, expectedAttempt) {
    scope(collection, id);
    if (typeof expectedAttempt !== 'string' || !expectedAttempt) throw Error('Execution identity required');
    return normalize(await items.remove(collection, id, {
      condition: { company: { $eq: company }, attempt: { $eq: expectedAttempt } }
    }));
  }
  return { read, insert, compareAndSet, compareAndRemove };
}

module.exports = { createSdkConditionalStore };

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
// segmented-fenced-proof.cjs sha256:dbfbb2e74438de5bfda8616ab177adced523ac32543c175a2206c5185c61ca78
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
    const rows = await readRows(), after = await readControl();
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
      if (manifest && (manifest.company !== company || manifest._id !== key || manifest.digest !== digest
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
export const createSdkConditionalStore = load("sdk-conditional-store.cjs").createSdkConditionalStore;
export const createFencedProof = load("fenced-proof.cjs").createFencedProof;
export const createSegmentedFencedProof = load("segmented-fenced-proof.cjs").createSegmentedFencedProof;
export const planCollections = load("domain-scope.cjs").planCollections;
