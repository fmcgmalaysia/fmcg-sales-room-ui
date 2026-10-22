'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { createWarehouseAuthority } = require('./warehouse-authority.cjs');
const { createWarehouseStockReader } = require('./warehouse-stock-reader.cjs');
const { createBorrowingAuthority } = require('./borrowing-authority.cjs');
const { createBorrowingStockReader } = require('./borrowing-stock-reader.cjs');
const { createAllocationAuthority } = require('./allocation-authority.cjs');
const { createPurchaseStockPreparation } = require('./purchase-stock-preparation.cjs');

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
  return createCurrentStockSave({ company, writer: 'RECEIPT', protocol, coverage,
    authenticate: authorize,
    prepare: command => createWarehouseStockReader({ company, items, store, protocol, readAuthority: () => authority(command) })() });
}
function createCurrentBorrowingSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  const authorize = authenticate(authorityDependencies, authorityDependencies?.requirePurchaseStaff);
  const authority = createBorrowingAuthority(authorityContext(authorityDependencies, protocol));
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
  return request => {
    const writer = request?.operation === 'ADD_SOURCE' ? 'PURCHASE_SOURCE' : request?.operation === 'PLAN' ? 'PURCHASE_PLAN'
      : ['EDIT', 'PO', 'AVERAGE_COST'].includes(request?.operation) ? 'PURCHASE_TASK' : null;
    if (!writer) throw Error('Supported current Purchase operation required');
    return createCurrentStockSave({ company, writer, protocol, coverage, authenticate: authorize,
      prepare: command => prepare({ company, requestId: command.requestId, operation: command.input.operation, input: command.input.details }) })({
      requestId: request.requestId, stockProtocol: request.stockProtocol, stockBuild: request.stockBuild,
      stockGeneration: request.stockGeneration, input: { operation: request.operation, details: request.input } });
  };
}
module.exports = { createCurrentWarehouseReceiptSave, createCurrentBorrowingSave, createCurrentAllocationSave, createCurrentPurchaseSave };
