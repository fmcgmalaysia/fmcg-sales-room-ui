'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { createWarehouseAuthority } = require('./warehouse-authority.cjs');
const { createWarehouseStockReader } = require('./warehouse-stock-reader.cjs');
const { createBorrowingAuthority } = require('./borrowing-authority.cjs');
const { createBorrowingStockReader } = require('./borrowing-stock-reader.cjs');
const { createAllocationAuthority } = require('./allocation-authority.cjs');
const { createPurchaseStockPreparation } = require('./purchase-stock-preparation.cjs');
const { createQuantityCasePreparation } = require('./quantity-case-preparation.cjs');
const { createShortageStockPreparation } = require('./shortage-stock-preparation.cjs');
const { hash } = require('./commit-proof.cjs');
const { domainCollections } = require('./domain-scope.cjs');

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
  return async request=>{
    let actor;
    const save = createCurrentStockSave({ company, writer: 'RECEIPT', protocol, coverage,
      authenticate: async()=>{actor=await authorize();return actor;},
      prepare: command => createWarehouseStockReader({ company, items, store, protocol, readAuthority: () => authority(command) })() });
    const result=await save(request);
    if(result.ok!==true)return result;
    const id=hash(company,request.requestId,actor.memberId,'WAREHOUSE_RECEIPT');
    const snapshot=await protocol.readSnapshot(()=>store.read(company==='NCT'?'NCTActivity':'NCTActivity1',id)),event=snapshot.rows;
    if(!event?._version||event._id!==id||event.title!==id||event.company!==company||event.result!=='SAVED'
      ||event.action!=='WAREHOUSE_RECEIPT_SAVED'||event.initiatedByStaffId!==actor.staffId
      ||event.description!==request.input.id||event.details?.company!==company
      ||typeof event.activityTime!=='string'||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Committed Warehouse receipt requires review');
    return {...result,company,poId:event.description,receiptId:id,savedAt:event.activityTime};
  };
}
function createCurrentBorrowingSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  const authorize = authenticate(authorityDependencies, authorityDependencies?.requirePurchaseStaff);
  const authority = createBorrowingAuthority(authorityContext(authorityDependencies, protocol));
  const save = createCurrentStockSave({ company, writer: 'BORROWING', protocol, coverage,
    authenticate: authorize,
    prepare: command => createBorrowingStockReader({ company, items, store, protocol,
      readAuthority: async () => {
        const verified = await authority({ company, requestId: command.requestId, kind: command.input.kind, input: command.input.details });
        // Both identities are server-read. A same-member staff reissue between
        // admission and PO authority must not stage approval under another staff.
        if (verified.event?.initiatedByStaffId !== command.staffId) throw Error('Borrowing approval identity changed');
        return verified;
      } })() });
  return request => {
    if (!request || !['APPROVE', 'RETURN'].includes(request.kind)) throw Error('Purchase borrowing action required');
    return save({ requestId: request.requestId, stockProtocol: request.stockProtocol, stockBuild: request.stockBuild,
      stockGeneration: request.stockGeneration, stockIdentity: request.stockIdentity, input: { kind: request.kind, details: request.input } });
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
      : ['EDIT', 'PO', 'AVERAGE_COST', 'QTY'].includes(request?.operation) ? 'PURCHASE_TASK' : null;
    if (!writer) throw Error('Supported current Purchase operation required');
    let actor;
    const result = await createCurrentStockSave({ company, writer, protocol, coverage, authenticate: async () => {
      actor = await authorize();
      // Replays also retain the ORIGINAL operation-specific grant, not merely
      // general Purchase access after a role downgrade.
      if (request.operation === 'QTY' && actor.role !== 'SUPER ADMIN') throw Error('Only Super Admin may change customer demand.');
      return actor;
    },
      prepare: command => prepare({ company, requestId: command.requestId, staffId: command.staffId, operation: command.input.operation, input: command.input.details }) })({
      requestId: request.requestId, stockProtocol: request.stockProtocol, stockBuild: request.stockBuild,
      stockGeneration: request.stockGeneration, stockIdentity: request.stockIdentity, input: { operation: request.operation, details: request.input } });
    if (result.ok !== true) return result;
    if (request.operation === 'EDIT' && request.input.displayRows !== undefined) {
      const id = authorityDependencies.operationId(company,request.requestId,actor.memberId,'PURCHASE_DISPLAY_ORDER');
      const receipt = await protocol.readSnapshot(() => store.read(company === 'NCT' ? 'NCTActivity' : 'NCTActivity1',id)), event = receipt.rows;
      const taskIds = [...new Set([...request.input.taskIds,...request.input.edits.map(row => row.taskId)])];
      if (!event?._version || event._id !== id || event.title !== id || event.company !== company || event.result !== 'SAVED'
        || event.action !== 'PURCHASE_DISPLAY_ORDER_SAVED' || event.initiatedByStaffId !== actor.staffId || event.details?.schema !== 2
        || event.details.displayOrder?.customerId !== request.input.customerId
        || JSON.stringify(event.details.displayOrder.rows) !== JSON.stringify(request.input.displayRows)
        || !Array.isArray(event.details.taskIds) || new Set(event.details.taskIds).size !== taskIds.length
        || event.details.taskIds.some(id => !taskIds.includes(id))) throw Error('Committed combined Purchase display receipt requires review');
      return { ...result, company, operation: 'EDIT', savedAt: event.activityTime, taskIds: [...event.details.taskIds] };
    }
    if (request.operation === 'QTY') {
      // Original QTY reduces the procurement commitment, NOT the Sales requested
      // demand. Keep its original Super Admin validator and immutable stock guards.
      const id = authorityDependencies.operationId(company, request.requestId, actor.memberId, request.input.taskId, 'PURCHASE_QTY_REDUCED');
      const receipt = await protocol.readSnapshot(() => store.read(company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', id));
      const event = receipt.rows;
      if (!event?._version || event._id !== id || event.title !== id || event.company !== company || event.result !== 'SAVED'
        || event.action !== 'PURCHASE_QTY_REDUCED' || event.imageAltText !== request.input.taskId
        || event.initiatedByStaffId !== actor.staffId || event.details?.authorizedRole !== 'SUPER ADMIN'
        || event.details.after !== request.input.quantity) throw Error('Committed original Purchase quantity receipt requires review');
      return { ...result, company, operation: 'QTY', savedAt: event.activityTime, taskIds: [request.input.taskId] };
    }
    if (request.operation !== 'ADD_SOURCE') return result;
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
function createCurrentQuantityCaseSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  if (protocol?.planFormat !== 'SEGMENTED_V2') throw Error('Current quantity v2 protocol required');
  const authorize = authenticate(authorityDependencies, authorityDependencies?.requirePurchaseStaff);
  const prepare = createQuantityCasePreparation({ ...authorityContext(authorityDependencies, protocol), company, items, store, protocol });
  return async request => {
    let actor;
    const result = await createCurrentStockSave({ company, writer: 'QUANTITY_CASE', protocol, coverage,
      authenticate: async () => { actor = await authorize(); return actor; },
      prepare: command => prepare({ company, requestId: command.requestId, staffId: command.staffId, input: command.input }) })(request);
    if (result.ok !== true) return result;
    const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
    const receipt = await protocol.readSnapshot(() => store.read(journal, hash(company, request.requestId, actor.memberId, 'QUANTITY_CASE_DECISION')));
    const event = receipt.rows;
    if (!event?._version || event.company !== company || event._id !== event.title || event.result !== 'SAVED'
      || event.action !== 'PURCHASE_QUANTITY_CASE_DECIDED' || event.initiatedByStaffId !== actor.staffId
      || event.details?.caseId !== request.input.id) throw Error('Committed quantity decision receipt requires review');
    return { ...result, company, caseId: event.details.caseId };
  };
}
function createCurrentShortageSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  if (protocol?.planFormat !== 'SEGMENTED_V2') throw Error('Current shortage v2 protocol required');
  const authorize = authenticate(authorityDependencies, authorityDependencies?.requirePurchaseStaff);
  const prepare = createShortageStockPreparation({ ...authorityContext(authorityDependencies, protocol), company, items, store, protocol });
  return async request => {
    let actor;
    const result = await createCurrentStockSave({ company, writer: 'QUANTITY_CASE', protocol, coverage,
      authenticate: async () => { actor = await authorize(); return actor; },
      prepare: command => prepare({ company, requestId: command.requestId, staffId: command.staffId, input: command.input }) })(request);
    if (result.ok !== true) return result;
    const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
    const receipt = await protocol.readSnapshot(() => store.read(journal, hash(company, request.requestId, actor.memberId, 'SHORTAGE')));
    const event = receipt.rows;
    if (!event?._version || event.company !== company || event._id !== event.title || event.result !== 'SAVED'
      || event.action !== 'PURCHASE_SHORTAGE_DECIDED' || event.initiatedByStaffId !== actor.staffId
      || event.imageAltText !== request.input.taskId) throw Error('Committed shortage decision receipt requires review');
    return { ...result, company, taskId: event.imageAltText, savedAt: event.activityTime };
  };
}
module.exports = { createCurrentWarehouseReceiptSave, createCurrentBorrowingSave, createCurrentAllocationSave, createCurrentPurchaseSave, createCurrentQuantityCaseSave, createCurrentShortageSave };
