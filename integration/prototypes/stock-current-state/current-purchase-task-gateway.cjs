'use strict';
const { createCurrentPurchaseSave, createCurrentAllocationSave, createCurrentShortageSave, createCurrentQuantityCaseSave } = require('./current-department-saves.cjs');
const { createCurrentPurchaseReorderSave } = require('./current-purchase-reorder-save.cjs');
const { createCurrentMarginReferenceSave } = require('./current-margin-reference-save.cjs');
// Current-only authenticated root binding. Unsupported/missing metadata cannot
// reach an old unfenced writer through this gateway. No browser coverage/actor.
function createCurrentPurchaseTaskGateway(dependencies) {
  const { company } = dependencies;
  if (!['NCT','GHR'].includes(company)) throw Error('Private current Purchase company required');
  return async (requestCompany, request) => {
    if (requestCompany !== company || !request || request.company !== undefined && request.company !== company
      || typeof request.operation !== 'string' || !['EDIT','PLAN','PO','ADD_SOURCE','AVERAGE_COST','QTY','REORDER','ALLOCATE','SHORTAGE','QUANTITY_CASE','MARGIN_REFRESH'].includes(request.operation)
      || JSON.stringify(request).length > 200000) throw Error('Supported bounded current Purchase task request required');
    if ((request.operation === 'REORDER' || request.operation === 'EDIT' && request.input?.displayRows !== undefined)
      && (dependencies.currentDisplayOrderVersion !== 2 || dependencies.authorityDependencies?.currentDisplayOrderVersion !== 2)) {
      throw Error('Paired original current display calculator required');
    }
    // Construct only the selected ORIGINAL authority. A shortage read must not
    // require a separate price/sort workspace or run another department command.
    const execute = request.operation === 'REORDER' ? createCurrentPurchaseReorderSave(dependencies)
      : request.operation === 'ALLOCATE' ? createCurrentAllocationSave(dependencies)
      : request.operation === 'SHORTAGE' ? createCurrentShortageSave(dependencies)
      : request.operation === 'MARGIN_REFRESH' ? createCurrentMarginReferenceSave(dependencies)
      : request.operation === 'QUANTITY_CASE' ? createCurrentQuantityCaseSave(dependencies) : createCurrentPurchaseSave(dependencies);
    return execute({ requestId:request.requestId,operation:request.operation,input:request.operation === 'ADD_SOURCE' ? { ...request.input,action:'ADD_SOURCE' } : request.input,
      stockProtocol:request.stockProtocol,stockBuild:request.stockBuild,stockGeneration:request.stockGeneration,stockIdentity:request.stockIdentity });
  };
}
module.exports = { createCurrentPurchaseTaskGateway };
