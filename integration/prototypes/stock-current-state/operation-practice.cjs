'use strict';
// Local interactive acceptance only. No SDK, endpoints, activation or production
// writer coverage. Exact existing quantity/borrowing/batch rules supply results.
const borrowing = require('./borrowing-model.cjs');
const { quoteBorrowOptions } = require('./purchase-borrow-options.cjs');
const { quoteUnusedBorrowReturn } = require('./purchase-borrow-return-options.cjs');
const { prepareShipmentArrangement } = require('./shipment-arrangement-plan.cjs');
const { prepareArrangement, readArrangements, identity } = require('./purchase-arrangement.cjs');
const { batchAllocation } = require('./purchase-batch-allocation.cjs');
const { attachBatchAvailability } = require('./purchase-batch-availability.cjs');
const copy = v => JSON.parse(JSON.stringify(v));
const BUILD = 'LOCAL-OPERATION-PRACTICE-20261025';
const IDS = { A: 'a'.repeat(32), B: 'b'.repeat(32), C: 'c'.repeat(32) };
function createOperationPractice({ shipment, batches, sessionId = 'TEST' }) {
  if (!shipment?.createShipmentPlanOperations || !batches?.resolveBatchEntitlements) throw Error('Original plan and batch modules required');
  if (!/^[a-zA-Z0-9-]{1,40}$/.test(sessionId)) throw Error('Isolated practice session required');
  const company = 'NCT', staff = { staffId: 'PRACTICE-PURCHASE-' + sessionId, memberId: 'PRACTICE-PURCHASE-' + sessionId, staffName: 'Operation test 操作测试', canEditCustomerDemand: false };
  const sales = { staffId: 'PRACTICE-SALES-' + sessionId, memberId: 'SOURCE_SALES/PRACTICE-SALES-' + sessionId, staffName: 'Sales test', customerId: 'EXAMPLE-A', canSelectShipment: true };
  const base = { company, packing: '320ML x 24', ea: 24, requested: 100, dispatched: 0 };
  const tasks = [
    { ...base, id: IDS.A, customerId: 'EXAMPLE-A', orderId: 'ORDER-A', sourceLineId: 'LINE-A', barcode: '9556404007035' },
    { ...base, id: IDS.B, customerId: 'EXAMPLE-B', orderId: 'ORDER-B', sourceLineId: 'LINE-B', barcode: '9556404007035' },
    { ...base, id: IDS.C, customerId: 'EXAMPLE-A', orderId: 'ORDER-C', sourceLineId: 'LINE-C', barcode: '9556404007999' }
  ];
  let states = [tasks.slice(0, 2), tasks.slice(2)].map(group => ({ ...group[0], complete: true, revision: 0,
    tasks: copy(group), packingHolds: { company, complete: true, scope: 'TASK_TOTAL', version: 'TEST-H0', heldByTask: Object.fromEntries(group.map(t => [t.id, 0])) },
    sources: group.map(t => { const accepted = t.id === IDS.B ? 100 : 80, planned = t.id === IDS.A ? 90 : accepted;
      return { ...base, barcode: t.barcode, id: t.id, ownerTaskId: t.id, poId: 'TEST-PO-' + t.id[0].toUpperCase(), poValid: true,
        reviewRequired: false, receiptPolicy: 'OWNER_DEMAND', ownerShare: planned, planned, accepted, onHand: accepted,
        isolated: 0, available: 0, claims: { [t.id]: accepted } }; }), relations: [] }));
  states.forEach(borrowing.validate);
  let generation = 0, order = [IDS.A, IDS.C, IDS.B], activity = [], receipts = new Map(), busy = Promise.resolve();
  const archived = new Set();
  const findState = id => { const state = states.find(s => s.tasks.some(t => t.id === id)); if (!state) throw Error('Unknown test row'); return state; };
  const meta = () => ({ schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: BUILD, stockGeneration: generation, stockIdentity: { staffId: sales.staffId, memberId: sales.memberId } });
  const plans = () => shipment.readShipmentPlans(activity);
  function workspace() {
    const rows = order.map(id => {
      const state = findState(id), task = state.tasks.find(t => t.id === id), source = state.sources.find(s => s.id === id);
      const coverage = borrowing.taskCoverage(state, id), related = state.relations.filter(r => r.quantity > r.repaid + (r.returned || 0));
      const row = { ...copy(task), archived: archived.has(id), name: id === IDS.C ? 'FULLY RECEIVED PRODUCT 收齐示例' : '7 UP (CAN)', ord: 100,
        inc: coverage.reservedUsable, lpPc: 1.5, lpCtn: 36, disc1: 0, disc2: 0, disc3: 0, netCostCtn: 36, costStatus: 'CAPTURED', gp: .2,
        history: [], masterReceivedAt: '2026-10-25T01:00:00Z', stage: 'NEW_INCOMING', transactionCurrency: 'USD', estimatedShipmentDate: '2026-10-30',
        editVersion: 'TEST-EDIT-' + generation, supplierId: 'EXAMPLE-SUP', po: source.poId,
        procurement: { totalCtn: source.planned, customerCtn: source.ownerShare, expectedExtra: 0, revision: 'TEST-P1', draftPlan: false, transportMode: 'SUPPLIER_DELIVER' },
        warehouse: { hasPhysicalReceipt: true, accepted: source.accepted }, stockActualReceived: source.accepted, stockHasReceipt: true,
        stockAllocatedCumulative: coverage.reservedUsable, stockTransferOutstanding: related.some(r => [r.borrowerTaskId, r.lenderTaskId].includes(id)),
        stockBorrowedOutstanding: related.filter(r => r.borrowerTaskId === id).reduce((n, r) => n + r.quantity - r.repaid - (r.returned || 0), 0),
        stockAllocationFacts: { usable: coverage.reservedUsable, held: 0, dispatched: 0, availableToArrange: coverage.reservedUsable, review: false },
        stockArrangements: readArrangements(company, activity).filter(i => i.taskId === id) };
      const plan = plans().find(p => p.orderId === task.orderId);
      if (plan) {
        row.batchEntitlements = batches.resolveBatchEntitlements(plan, id, { committed: source.ownerShare, received: coverage.reservedUsable }, [{ id, quantity: source.ownerShare }]);
        row.stockAllocatedBatches = batchAllocation(row);
        const physical = batches.resolveBatchStock(plan, id, [{ id, quantity: source.accepted }]);
        row.stockReceiptBatches = row.batchEntitlements.map((b, i) => ({ id: b.id, received: physical[i] }));
      }
      return row;
    });
    const result = { company, staff: copy(staff), fetchedAt: new Date().toISOString(), tasks: rows,
      customers: [{ id: 'EXAMPLE-A', name: 'Example Customer A', shortName: 'EXAMPLE A 示例客户A' }, { id: 'EXAMPLE-B', name: 'Example Customer B', shortName: 'EXAMPLE B 示例客户B' }],
      suppliers: [{ id: 'EXAMPLE-SUP', name: 'Example Supplier', shortName: 'EXAMPLE SUPPLIER' }], sourcesVersion: 'TEST-S1', allocations: [], shipmentPlans: copy(plans()),
      purchaseDisplayOrder: {}, stockAllocationView: 'CURRENT_V2', stockCurrent: { schema: 'PURCHASE_TRANSFERS_V2', stockProtocol: 1, stockBuild: BUILD, stockGeneration: generation, generation } };
    attachBatchAvailability({ company, workspace: result, activity, readPackingLists: () => [], packingHeld: () => 0 });
    return result;
  }
  function options(taskId) {
    if (archived.has(taskId)) throw Error('Archived test row is read only');
    const state = findState(taskId), result = quoteBorrowOptions({ state, borrowerTaskId: taskId });
    return { ok: true, schema: 'CURRENT_BORROW_OPTIONS_V2', company, borrowerTaskId: taskId, ...result,
      options: result.options.map(o => ({ ...o, lenderCustomerId: tasks.find(t => t.id === o.lenderTaskId).customerId,
        lenderPoNumber: o.lenderPoId, replacementPoNumber: o.replacementPoId })), stockCurrent: meta() };
  }
  function relations(input) {
    const items = states.flatMap(s => s.relations.map(r => ({ ...r, revision: s.revision }))).map(r => ({ ...copy(r), remaining: r.quantity - r.repaid - (r.returned || 0) }))
      .filter(r => r.remaining > 0 && (input.view === 'OUTSTANDING' || [r.borrowerTaskId, r.lenderTaskId].includes(input.taskId)));
    const offset = input.cursor?.offset || 0, size = input.pageSize || 5, version = ('0'.repeat(32) + generation.toString(16)).slice(-32);
    if (input.cursor && input.cursor.version !== version) throw Error('Test rows changed. Refresh before continuing.');
    return { ok: true, schema: 'CURRENT_BORROW_RELATIONS_V1', company, view: input.view, taskId: input.view === 'TASK' ? input.taskId : null,
      generation, version, offset, total: items.length, halo: items.length > 0, items: items.slice(offset, offset + size), nextCursor: offset + size < items.length ? { version, offset: offset + size } : null };
  }
  function salesRead() {
    const ws = workspace(), context = { company, tasks: ws.tasks, activity };
    return { version: 'TEST-SHIPMENT', planVersion: shipment.shipmentPlanVersion(context), plans: copy(plans()), shipments: [], stockCurrent: meta(),
      lines: ws.tasks.filter(t => t.customerId === sales.customerId && !t.archived).map(t => ({ taskId: t.id, orderId: t.orderId, barcode: t.barcode, name: t.name,
        packing: t.packing, requested: t.requested, available: t.stockAllocatedCumulative })) };
  }
  async function apply(request) {
    if (request.company !== company || !request.requestId || typeof request.requestId !== 'string') throw Error('Exact test request required');
    const digest = JSON.stringify(request), prior = receipts.get(request.requestId);
    if (prior) { if (prior.digest !== digest) throw Error('Test save identity conflict'); return copy(prior.result); }
    const supplied = request.type === 'SALES_ROOM_SHIPMENT_REQUEST' ? request.input?.stockCurrent : request;
    if (supplied?.stockBuild !== BUILD || supplied.stockGeneration !== generation || supplied.stockProtocol !== 1) throw Error('Test data changed. Refresh before saving.');
    let next, replace, event;
    if (request.type === 'SALES_ROOM_SHIPMENT_REQUEST' && request.action === 'PLAN') {
      const input = { ...request.input, action: 'PLAN' }; delete input.stockCurrent;
      const prepared = await prepareShipmentArrangement({ company, staff: sales, requestId: request.requestId, input,
        context: { company, tasks: workspace().tasks, activity: copy(activity) }, ...shipment, now: () => new Date() });
      event = prepared.event;
    } else if (request.type === 'PURCHASE_SAVE_REQUEST' && ['BORROW_APPROVE', 'BORROW_RETURN'].includes(request.operation)) {
      const input = request.input, state = request.operation === 'BORROW_APPROVE' ? findState(input.borrowerTaskId)
        : states.find(s => s.relations.some(r => r.id === input.relationId));
      if (!state) throw Error('Unknown test relationship');
      if (request.operation === 'BORROW_APPROVE' && archived.has(input.borrowerTaskId)) throw Error('Archived test row is read only');
      next = request.operation === 'BORROW_APPROVE' ? borrowing.approveBorrow(state, { ...input, id: request.requestId, approvedBy: staff.staffId }).after
        : borrowing.returnUnusedBorrow(state, { ...input, approvedBy: staff.staffId }).after;
      replace = state;
    } else if (request.type === 'PURCHASE_SAVE_REQUEST' && request.operation === 'ARRANGE_AVAILABLE') {
      const ws = workspace(), input = request.input, id = identity(company, input.taskId, input.batchId);
      const prepared = prepareArrangement({ company, staff, requestId: request.requestId, input, workspace: ws,
        before: activity.find(e => e._id === id) || null, at: new Date().toISOString() });
      for (const w of prepared.writes) { const index = activity.findIndex(e => e._id === w.after._id); if (index >= 0) activity[index] = copy({ ...w.after, _version: 'TEST-' + (generation + 1) });
        else activity.push(copy({ ...w.after, _version: 'TEST-' + (generation + 1) })); }
    } else throw Error('This practice supports split plans, borrowing, unused returns and Support requests only. 本测试仅接通拆单、借货、未使用退回及交给Support安排。');
    if (replace) states = states.map(s => s === replace ? next : s);
    if (event) activity.push(copy(event));
    generation++;
    const result = { ok: true, company, requestId: request.requestId, stockGeneration: generation, practiceOnly: true,
      ...(event?.action === 'CUSTOMER_SHIPMENT_PLAN_SAVED' ? { planId: event.description } : {}) };
    receipts.set(request.requestId, { digest, result });
    return copy(result);
  }
  const execute = request => { const operation = busy.then(() => apply(copy(request))); busy = operation.catch(() => {}); return operation; };
  function receive(taskId, cumulativeAccepted) {
    const state = findState(taskId), next = borrowing.receive(state, { expectedRevision: state.revision, sourceId: taskId, cumulativeAccepted }).after;
    states = states.map(s => s === state ? next : s); generation++; return workspace();
  }
  return { BUILD, IDS: copy(IDS), workspace, options, relations, salesRead, execute, receive,
    returnOptions: relationId => { const state = states.find(s => s.relations.some(r => r.id === relationId)); if (!state) throw Error('Unknown test relationship');
      return { ok: true, schema: 'CURRENT_BORROW_RETURN_OPTIONS_V2', company, ...quoteUnusedBorrowReturn({ state, relationId }), stockCurrent: meta() }; },
    move: () => { order = [IDS.C, IDS.A, IDS.B]; return workspace(); },
    archive: taskId => { findState(taskId); archived.add(taskId); return workspace(); },
    inspect: () => copy({ generation, states, activity, cmsWrites: false, nativeAcceptance: false, activationReady: false }) };
}
module.exports = { createOperationPractice, BUILD, IDS };
