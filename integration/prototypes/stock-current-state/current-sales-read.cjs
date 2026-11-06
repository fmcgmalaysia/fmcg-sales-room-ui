'use strict';

const { requireOriginalSalesDelegation } = require('./sales-delegation.cjs');
const { readCurrentSalesWorkspace } = require('./sales-current-workspace.cjs');
// PRIVATE original source gateway only. Original response filtering, account/
// document/currency calculations stay in the original service, not reimplemented.
function createCurrentSalesRead({ company, protocol, authenticateOriginalDelegation, readContext,
  readOriginalCustomerFulfilment, currentFulfilmentVersion, ...dependencies }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || currentFulfilmentVersion !== 2
    || typeof authenticateOriginalDelegation !== 'function' || typeof readContext !== 'function'
    || typeof readOriginalCustomerFulfilment !== 'function') throw Error('Verified private original Sales read dependencies required');
  return async requestCompany => {
    if (requestCompany !== company) throw Error('Sales current read company conflict');
    const staff = await authenticateOriginalDelegation(company, { action: 'READ' });
    requireOriginalSalesDelegation(staff, staff?.customerId);
    const snapshot = await protocol.readSnapshot(async control => {
      const context = await readContext(company, staff);
      const current = await readCurrentSalesWorkspace({ ...dependencies, company, context, staff, control });
      const result = await readOriginalCustomerFulfilment(company, staff, staff.customerId, current.context);
      if (result?.company !== company) throw Error('Original customer response company changed');
      return { ...result, stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1,
        stockBuild: control.writerBuild, stockGeneration: control.generation,stockIdentity:{staffId:staff.staffId,memberId:staff.memberId} } };
    });
    return snapshot.rows;
  };
}
module.exports = { createCurrentSalesRead };
