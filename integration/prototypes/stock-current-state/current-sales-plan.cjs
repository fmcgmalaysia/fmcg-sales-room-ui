'use strict';

const { currentAllocationContext } = require('./current-allocation-context.cjs');
const { validateOriginalSales } = require('./original-sales-validation.cjs');
const { prepareSalesDemand } = require('./borrowing-stock-plan.cjs');
// Execute under the common fence/read barrier. request.staff must be resolved by
// the EXISTING authenticated Sales gateway; this module is not a public endpoint.
async function prepareCurrentSales({ state, rows, generation, context, request,
  createSalesOrderAdjustmentOperations, readAllocations, readPlans, planVersion, now }) {
  if (request.company !== state.company) throw Error('Sales current-state company conflict');
  const current = currentAllocationContext({ state, context, readAllocations });
  const validated = await validateOriginalSales({ ...request, context: current,
    createSalesOrderAdjustmentOperations, readPlans, planVersion, now });
  return { ...prepareSalesDemand({ state, rows, generation, event: validated.event }),
    event: validated.event, expectedVersion: validated.version };
}
module.exports = { prepareCurrentSales };
