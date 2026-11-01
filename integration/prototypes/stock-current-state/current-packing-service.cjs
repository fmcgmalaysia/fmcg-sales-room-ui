'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { createPackingStockPreparation } = require('./packing-stock-preparation.cjs');
const { hash } = require('./commit-proof.cjs');
const { WRITERS } = require('./stock-admission.cjs');
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
