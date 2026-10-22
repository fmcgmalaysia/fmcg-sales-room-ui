'use strict';
const { createPurchaseBorrowOptions } = require('./purchase-borrow-options.cjs');
const { createCurrentBorrowingSave } = require('./current-department-saves.cjs');
// Private original Purchase gateway binding. Its server-owned dependencies retain
// actual Purchase permissions; this adapter is not a public permission grant.
function createCurrentPurchaseBorrowGateway(dependencies) {
  const { company } = dependencies;
  const options = createPurchaseBorrowOptions(dependencies), save = createCurrentBorrowingSave(dependencies);
  function bounded(requestCompany, value) {
    if (requestCompany !== company || !value || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(value).length > 6000) throw Error('Bounded original Purchase borrowing request required');
  }
  return {
    readOptions: async (requestCompany, input) => {
      bounded(requestCompany, input);
      return { ok: true, ...await options(company, { borrowerTaskId: input.borrowerTaskId }) };
    },
    save: async (requestCompany, request) => {
      bounded(requestCompany, request);
      if (request.company !== undefined && request.company !== company) throw Error('Purchase borrowing company conflict');
      const kind = request.operation === 'BORROW_APPROVE' ? 'APPROVE' : request.operation === 'BORROW_RETURN' ? 'RETURN' : null;
      if (!kind) throw Error('Supported original Purchase borrowing action required');
      return save({ requestId: request.requestId, kind, input: request.input, stockProtocol: request.stockProtocol,
        stockBuild: request.stockBuild, stockGeneration: request.stockGeneration });
    }
  };
}
module.exports = { createCurrentPurchaseBorrowGateway };
