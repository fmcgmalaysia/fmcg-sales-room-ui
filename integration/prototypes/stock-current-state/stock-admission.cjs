'use strict';

const WRITERS = Object.freeze(['RECEIPT', 'ALLOCATION', 'SALES_DEMAND', 'PURCHASE_SOURCE', 'PURCHASE_PLAN', 'PURCHASE_TASK',
  'STOCK_EXCEPTION', 'STOCK_RESOLUTION', 'PACKING', 'WAREHOUSE_PREPARATION', 'SHIPMENT', 'ORDER_INTAKE', 'ORDER_UPDATE', 'COST_REFERENCE',
  'MARGIN_REFERENCE', 'SHIPMENT_PLAN', 'QUANTITY_CASE', 'PURCHASE_ORDER_RECORD', 'ACCOUNT_PURCHASE_RECORD']);
// Server construction only. Never accept coverage/mode/company/build from browser.
// Permission checks remain in original authenticated gateways; this grants none.
function createStockAdmission({ company, readControl, coverage = {} }) {
  if (!['NCT', 'GHR'].includes(company) || typeof readControl !== 'function') throw Error('Server stock admission scope required');
  return async ({ writer, request }) => {
    if (!WRITERS.includes(writer)) throw Error('Unknown inventory writer; activation requires review');
    const control = await readControl();
    if (!control || control.company !== company || !control._version || !Number.isSafeInteger(control.generation) || control.generation < 0
      || !['LEGACY', 'SHADOW', 'ACTIVE', 'MAINTENANCE'].includes(control.mode) || control.schemaVersion !== 1) throw Error('Stock mode unavailable; no automatic fallback');
    if (control.pending) throw Error('Inventory save pending; preserve the same request');
    if (control.mode === 'MAINTENANCE') throw Error('Inventory maintenance; business writes are paused');
    if (control.mode === 'LEGACY') return { route: 'LEGACY', generation: control.generation };
    if (!control.writerBuild || WRITERS.some(name => coverage[name]?.verified !== true || coverage[name].build !== control.writerBuild)) throw Error('Inventory writer coverage incomplete; activation blocked');
    if (request?.stockProtocol !== 1 || request.stockBuild !== control.writerBuild || request.stockGeneration !== control.generation) throw Error('Stock form changed; refresh and review retained input');
    return { route: control.mode === 'ACTIVE' ? 'FENCED_CURRENT' : 'FENCED_SHADOW', generation: control.generation, build: control.writerBuild };
  };
}
module.exports = { WRITERS, createStockAdmission };
