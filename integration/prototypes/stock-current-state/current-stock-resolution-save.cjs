'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { originalProductState } = require('./original-product-state.cjs');
const { readScopedCurrentProduct } = require('./scoped-current-reader.cjs');
const { prepareFreeCaseMovement, prepareFreeCaseRelease, prepareProcurementTransition } = require('./borrowing-stock-plan.cjs');
const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const permissions = { DECIDE: 'canPlanStockResolution', APPROVE_LOSS: 'canApproveStockLoss', APPROVE_VARIANCE: 'canApproveStockLoss',
  APPROVE_RELEASE: 'canApproveStockLoss', RETURN: 'canReportStockException', REPLACEMENT: 'canReportStockException', CLOSE: 'canCloseStockException' };

async function validateOriginalStockResolution({ company, staff, context, orders, requestId, input, createStockResolutionOperations, now }) {
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', scratch = new Map(), boundary = new Error('Private stock resolution boundary');
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
          const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
    const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
    const receipt = await protocol.readSnapshot(() => store.read(journal, hash(company, request.requestId, staff.memberId, 'STOCK_RESOLUTION')));
    const event = receipt.rows;
    if (!event?._version || event.company !== company || event._id !== event.title || event.result !== 'SAVED'
      || event.action !== 'STOCK_EXCEPTION_RESOLUTION_SAVED' || event.initiatedByStaffId !== staff.staffId
      || event.description !== request.input.id || event.details?.action !== request.input.action) throw Error('Committed stock resolution receipt requires review');
    return { ...result, company, caseId: event.description };
  };
}
module.exports = { validateOriginalStockResolution, createCurrentStockResolutionSave };
