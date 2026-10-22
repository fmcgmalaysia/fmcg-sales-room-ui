'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { prepareCostReference } = require('./cost-reference-plan.cjs');
const { hash } = require('./commit-proof.cjs');
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
            tables: await d.readCostTables(company, command.input.taskId, staff, command.requestId), captureCosts: d.captureCosts, now: d.now });
          if (prepared.outcome?.ok !== true || prepared.outcome.requestId !== command.requestId || prepared.outcome.company !== company
            || prepared.outcome.taskId !== command.input.taskId) throw Error('Original cost retry receipt identity conflict');
          if (!prepared.plan.writes.length) throw Error('Prior legacy cost receipt requires reconciliation before current save');
          return prepared.plan;
        });
        return { plan: snapshot.rows, memberId: staff.memberId, generation: snapshot.generation };
      } })(request);
    if (result.ok !== true) return result;
    const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
    const receipt = await protocol.readSnapshot(() => store.read(journal,
      hash(company, request.input.taskId, request.requestId, staff.memberId, 'RESULT')));
    const event = receipt.rows, outcome = event?.details?.outcome;
    if (!event?._version || event.company !== company || event._id !== event.title || event.action !== 'COST_RETRY_RESULT'
      || event.result !== 'RECORDED' || event.initiatedByStaffId !== staff.staffId || event.imageAltText !== request.input.taskId
      || event.details?.actorMemberId !== staff.memberId || event.details.requestId !== request.requestId
      || outcome?.ok !== true || outcome.company !== company || outcome.taskId !== request.input.taskId || outcome.requestId !== request.requestId) {
      throw Error('Committed cost reference receipt requires review');
    }
    return { ...outcome, ...result };
  };
}
module.exports = { createCurrentCostReferenceSave };
