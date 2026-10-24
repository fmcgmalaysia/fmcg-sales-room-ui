'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { validateOriginalPurchase } = require('./original-purchase-validation.cjs');
const { domainCollections } = require('./domain-scope.cjs');
const { copy } = require('./segmented-plan.cjs');
// Original REORDER is display only, but writes whole task rows. It must share the
// company fence so a stock counter cannot be overwritten by a late ordering save.
function createCurrentPurchaseReorderSave({ company, store, protocol, coverage, currentDisplayOrderVersion, authorityDependencies: d }) {
  if (!['NCT','GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || currentDisplayOrderVersion !== 2
    || typeof store?.read !== 'function'
    || [d?.readMember,d?.readStaffRecords,d?.requirePurchaseStaff,d?.readTables,d?.createPurchaseOperations,d?.taskEditVersion,d?.operationId,d?.now]
      .some(fn => typeof fn !== 'function')) throw Error('Private original current Purchase ordering dependencies required');
  const [orders,tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
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
