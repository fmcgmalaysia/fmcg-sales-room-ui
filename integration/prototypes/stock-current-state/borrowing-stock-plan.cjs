'use strict';

// Pure bounded mapping into the EXISTING fenced-plan contract. Not an endpoint,
// production schema installation or replacement for trusted business validators.
const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const { validate, approveBorrow, receive, correctAccepted, returnUnusedBorrow, allocateCumulative, adjustDemand, dispatchReserved, quarantineFree, freeCaseMovement, releaseFreeCase, relationRemaining } = require('./borrowing-model.cjs');
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
  if (product) {
    checkRow(product, company, productId, key);
    if (product.revision !== before.revision || !Object.keys(beforeTotals).every(k => product[k] === beforeTotals[k])) throw Error('Product snapshot conflict');
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
    } else if (source.accepted !== 0 || source.onHand !== 0 || sumClaims(source) !== 0) throw Error('Source snapshot missing');
    const positionChanged = !same(source, next);
    if (positionChanged) {
      const base = old || { _id: id, schemaVersion: 1, company, stockKey: key, barcode: before.barcode, packing: before.packing,
        ea: before.ea, name: before.name || '', sourceKind: 'PURCHASE_SOURCE', sourceId: source.id, sourceTaskId: source.id,
        poId: source.poId, replacementReceived: 0, supplierReturned: 0, reviewCodes: [] };
      writes.push({ collection: 'StockPositions', before: copy(old), after: { ...copy(base), receiptAccepted: next.accepted,
        replacementReceived: next.replacementReceived || 0, supplierReturned: next.supplierReturned || 0,
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
      } else if (prior !== 0) throw Error('Claim snapshot missing');
      if (quantity === prior) continue;
      const base = oldClaim || { _id: claimId, schemaVersion: 1, company, stockKey: key, positionId: id,
        taskId, customerId: task.customerId, orderId: task.orderId || '', sourceLineId: task.sourceLineId || '',
        isolatedAttributed: 0, reviewCodes: [] };
      writes.push({ collection: 'StockClaims', before: copy(oldClaim), after: { ...copy(base), reservedUsable: quantity,
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
      revision: (old?.revision || 0) + 1, activityTime: event.activityTime, checkpointGeneration: generation + 1,
      status: relationRemaining(relation) === 0 ? 'CLOSED' : 'ACTIVE', details: { relation: copy(relation) } } });
  }
  if (consumedPositions.size !== positions.size || consumedClaims.size !== claims.size || consumedTransfers.size !== transfers.size) throw Error('Snapshot contains unrelated stock rows');
  const totals = summary(after);
  writes.push({ collection: 'StockProducts', before: copy(product || null), after: { ...(product || { _id: productId,
    schemaVersion: 1, company, stockKey: key, barcode: before.barcode, packing: before.packing, ea: before.ea, name: before.name || '' }),
    ...totals, revision: before.revision + 1, checkpointGeneration: generation + 1, reviewRequired: false,
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
module.exports = { prepareBorrowApproval, prepareBorrowReturn, prepareBorrowingReceipt, prepareCurrentAllocation, prepareSalesDemand, prepareShipmentDispatch, prepareFreeQuarantine, prepareFreeCaseMovement, prepareFreeCaseRelease, transferId };
