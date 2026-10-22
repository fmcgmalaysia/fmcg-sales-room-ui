'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { createWarehouseAuthority } = require('./warehouse-authority.cjs');
const { createWarehouseStockReader } = require('./warehouse-stock-reader.cjs');
const { createBorrowingAuthority } = require('./borrowing-authority.cjs');
const { createBorrowingStockReader } = require('./borrowing-stock-reader.cjs');

function authenticate(deps, requireStaff) {
  if (typeof deps.readMember !== 'function' || typeof deps.readStaffRecords !== 'function' || typeof requireStaff !== 'function') throw Error('Original department authentication required');
  return async () => {
    const member = await deps.readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requireStaff(member, []);
    return { ...requireStaff(member, await deps.readStaffRecords()), memberId: member._id };
  };
}
// Concrete original authority -> current reader -> shared commit composition. No
// legacy writer or new privilege may be supplied through a browser request.
function createCurrentWarehouseReceiptSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  const authority = createWarehouseAuthority(authorityDependencies);
  return createCurrentStockSave({ company, writer: 'RECEIPT', protocol, coverage,
    authenticate: authenticate(authorityDependencies, authorityDependencies.requireWarehouseStaff),
    prepare: command => createWarehouseStockReader({ company, items, store, protocol, readAuthority: () => authority(command) })() });
}
function createCurrentBorrowingSave({ company, items, store, protocol, coverage, authorityDependencies }) {
  const authority = createBorrowingAuthority(authorityDependencies);
  const save = createCurrentStockSave({ company, writer: 'BORROWING', protocol, coverage,
    authenticate: authenticate(authorityDependencies, authorityDependencies.requirePurchaseStaff),
    prepare: command => createBorrowingStockReader({ company, items, store, protocol,
      readAuthority: () => authority({ company, requestId: command.requestId, kind: command.input.kind, input: command.input.details }) })() });
  return request => {
    if (!request || !['APPROVE', 'RETURN'].includes(request.kind)) throw Error('Purchase borrowing action required');
    return save({ requestId: request.requestId, stockProtocol: request.stockProtocol, stockBuild: request.stockBuild,
      stockGeneration: request.stockGeneration, input: { kind: request.kind, details: request.input } });
  };
}
module.exports = { createCurrentWarehouseReceiptSave, createCurrentBorrowingSave };
