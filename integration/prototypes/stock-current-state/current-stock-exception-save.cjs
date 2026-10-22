'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { originalProductState } = require('./original-product-state.cjs');
const { readScopedCurrentProduct } = require('./scoped-current-reader.cjs');
const { prepareFreeQuarantine } = require('./borrowing-stock-plan.cjs');
const { hash } = require('./commit-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));

// Execute only the original validator's PREPARE in a private in-memory journal.
// Actual stock/event writes belong exclusively to the common current coordinator.
async function validateOriginalStockException({ company, staff, context, requestId, input, createStockExceptionOperations, now }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks)
    || !Array.isArray(context.activity) || typeof createStockExceptionOperations !== 'function' || typeof now !== 'function') {
    throw Error('Original stock exception context required');
  }
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', scratch = new Map(), boundary = new Error('Private exception preparation boundary');
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
// handles approved FREE stock isolation, never invents reserved-loss attribution.
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
        return { memberId: staff.memberId };
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
          return prepareFreeQuarantine({ state: builder.buildState(rows), rows, event: validated.event, generation: control.generation });
        });
        return { ...snapshot.rows, memberId: staff.memberId, generation: snapshot.generation, metrics };
      } })(request);
    if (result.ok !== true) return result;
    const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
    const receipt = await protocol.readSnapshot(() => store.read(journal, hash(company, request.requestId, staff.memberId, 'STOCK_EXCEPTION')));
    const event = receipt.rows;
    if (!event?._version || event.company !== company || event._id !== event.title || event.result !== 'SAVED'
      || event.action !== 'STOCK_EXCEPTION_REPORTED' || event.stockAttribution !== 'FREE' || event.initiatedByStaffId !== staff.staffId
      || event.imageAltText !== request.input.sourceTaskId || event.details?.company !== company) throw Error('Committed free stock exception receipt requires review');
    return { ...result, company, caseId: event.title };
  };
}
module.exports = { validateOriginalStockException, createCurrentStockExceptionSave };
