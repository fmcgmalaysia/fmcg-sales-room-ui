'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { createPackingStockPreparation } = require('./packing-stock-preparation.cjs');
const { hash } = require('./commit-proof.cjs');
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
