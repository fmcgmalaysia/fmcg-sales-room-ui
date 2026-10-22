'use strict';
const { createCurrentPurchaseSave } = require('./current-department-saves.cjs');
const { createCurrentPurchaseReorderSave } = require('./current-purchase-reorder-save.cjs');
// Current-only authenticated root binding. Unsupported/missing metadata cannot
// reach an old unfenced writer through this gateway. No browser coverage/actor.
function createCurrentPurchaseTaskGateway(dependencies) {
  const { company } = dependencies;
  if (!['NCT','GHR'].includes(company)) throw Error('Private current Purchase company required');
  const save = createCurrentPurchaseSave(dependencies), reorder = createCurrentPurchaseReorderSave(dependencies);
  return async (requestCompany, request) => {
    if (requestCompany !== company || !request || request.company !== undefined && request.company !== company
      || typeof request.operation !== 'string' || !['EDIT','PLAN','PO','ADD_SOURCE','AVERAGE_COST','QTY','REORDER'].includes(request.operation)
      || JSON.stringify(request).length > 200000) throw Error('Supported bounded current Purchase task request required');
    return (request.operation === 'REORDER' ? reorder : save)({ requestId:request.requestId,operation:request.operation,input:request.input,
      stockProtocol:request.stockProtocol,stockBuild:request.stockBuild,stockGeneration:request.stockGeneration });
  };
}
module.exports = { createCurrentPurchaseTaskGateway };
