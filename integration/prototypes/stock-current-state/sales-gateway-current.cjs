'use strict';
const { requireOriginalSalesDelegation } = require('./sales-delegation.cjs');
// PRIVATE: invoked only after the existing source bearer authentication. This is
// a transport adapter, never a replacement for source/member authentication.
async function dispatchCurrentSalesGateway({ body, staff, resolveCurrentSales, legacy }) {
  requireOriginalSalesDelegation(staff, body.customerId);
  if (typeof resolveCurrentSales !== 'function' || typeof legacy !== 'function') throw Error('Private Sales route dependencies required');
  const current = await resolveCurrentSales(body.company, staff);
  if (current?.mode === 'LEGACY') return legacy();
  if (current?.mode !== 'ACTIVE') throw Error('Inventory maintenance; Sales changes are paused');
  if (body.action === 'READ' && typeof current.read === 'function') return current.read(body.company);
  const save = body.action === 'ADJUST' ? current.save : ['SELECT', 'CANCEL'].includes(body.action) ? current.shipmentSave : null;
  if (typeof save !== 'function') {
    throw Error('Current Sales action is not connected; no legacy write fallback');
  }
  const { stockCurrent, ...input } = body.input || {};
  if (stockCurrent?.schema !== 'CURRENT_STOCK_V2' || stockCurrent.stockProtocol !== 1
    || typeof stockCurrent.stockBuild !== 'string' || !stockCurrent.stockBuild
    || !Number.isSafeInteger(stockCurrent.stockGeneration) || stockCurrent.stockGeneration < 0) {
    throw Error('Current Sales form changed; refresh and review retained input');
  }
  return save({ requestId: body.requestId, stockProtocol: stockCurrent.stockProtocol,
    stockBuild: stockCurrent.stockBuild, stockGeneration: stockCurrent.stockGeneration,
    input: { ...input, action: body.action, customerId: staff.customerId } });
}
module.exports = { dispatchCurrentSalesGateway };
