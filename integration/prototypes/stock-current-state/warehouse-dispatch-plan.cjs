'use strict';

const { stockKey } = require('./current-model.cjs');
const { prepareShipmentDispatch } = require('./borrowing-stock-plan.cjs');
const { appendTaskDispatchCheckpoints } = require('./task-dispatch-checkpoint.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function prepareWarehouseDispatch({ event, priorShipment, products, generation, taskRows, planFormat = 'PROOF_V1' }) {
  if (!['PROOF_V1', 'SEGMENTED_V2'].includes(planFormat)) throw Error('Server dispatch plan format required');
  const shipment = event?.details?.shipment;
  if (!Array.isArray(shipment?.lines) || !shipment.lines.length || !Array.isArray(priorShipment?.lines)
    || !Array.isArray(products) || !products.length) throw Error('Complete original dispatch and products required');
  const keys = new Set(), consumed = new Set(), states = [], writes = [];
  for (const { state, rows } of products) {
    const key = stockKey(state);
    if (keys.has(key)) throw Error('Duplicate dispatch product'); keys.add(key);
    const lines = shipment.lines.filter(l => state.tasks.some(t => t.id === l.taskId));
    if (!lines.length) throw Error('Unrelated dispatch product');
    for (const line of lines) { if (consumed.has(line.taskId)) throw Error('Ambiguous dispatch task'); consumed.add(line.taskId); }
    const scoped = { ...copy(event), details: { ...copy(event.details), shipment: { ...copy(shipment), lines: copy(lines) } } };
    const prior = { ...copy(priorShipment), lines: priorShipment.lines.filter(l => consumed.has(l.taskId) && lines.some(n => n.taskId === l.taskId)) };
    const result = prepareShipmentDispatch({ state, rows, event: scoped, priorShipment: prior, generation });
    states.push(result.state);
    writes.push(...result.plan.writes.filter(w => w.after.action !== 'CUSTOMER_SHIPMENT_CHANGED'));
  }
  if (new Set(shipment.lines.map(l => l.taskId)).size !== shipment.lines.length || consumed.size !== shipment.lines.length
    || new Set(priorShipment.lines.map(l => l.taskId)).size !== shipment.lines.length
    || priorShipment.lines.some(l => !consumed.has(l.taskId))) throw Error('Incomplete dispatch product coverage');
  writes.unshift({ collection: shipment.company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', before: null, after: { ...copy(event), company: shipment.company } });
  const plan = planFormat === 'SEGMENTED_V2' ? appendTaskDispatchCheckpoints({ company: shipment.company, plan: { writes }, products, states, taskRows, generation }) : { writes };
  if (planFormat !== 'SEGMENTED_V2' && products.some(p => p.state.lifecycleVersion === 2)) throw Error('Current dispatch must retain task checkpoints');
  if (new Set(plan.writes.map(w => w.collection + ':' + w.after._id)).size !== plan.writes.length
    || plan.writes.length > (planFormat === 'SEGMENTED_V2' ? 10000 : 30)
    || Buffer.byteLength(JSON.stringify(plan)) > (planFormat === 'SEGMENTED_V2' ? 8 * 1024 * 1024 : 180000)) throw Error('Combined dispatch exceeds atomic proof bound');
  return { states, plan };
}
module.exports = { prepareWarehouseDispatch };
