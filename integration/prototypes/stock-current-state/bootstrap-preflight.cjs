'use strict';

const { hash } = require('./commit-proof.cjs');
const { convertProjectedStock } = require('./current-model.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const fingerprint = value => hash(canonical(value));
// Pure maintenance-window preflight ONLY. Produces private candidate images but
// performs no CMS/schema/index changes, tags, writes, chunking or mode transition.
function stockBootstrapPreflight({ company, context, purchaseRecords, existing, control, projectStockCard, projectPurchaseOrders, includeProjection = false }) {
  if (typeof includeProjection !== 'boolean') throw Error('Private projection option required');
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
    || !Array.isArray(purchaseRecords) || typeof projectStockCard !== 'function' || typeof projectPurchaseOrders !== 'function'
    || existing?.complete !== true || !['positions', 'claims', 'products', 'transfers'].every(k => Array.isArray(existing[k]))) throw Error('Complete private bootstrap snapshots required');
  const blockers = [], expectedControlId = hash(company, 'STOCK_CONTROL'), expectedLockId = hash(company + '/PURCHASE', 'LOCK');
  if (control?._id !== expectedControlId || control.company !== company || control.mode !== 'MAINTENANCE' || control.schemaVersion !== 1
    || !control._version || !Number.isSafeInteger(control.generation) || control.generation < 0 || control.pending) blockers.push('VERIFIED_MAINTENANCE_CONTROL_REQUIRED');
  if (['positions', 'claims', 'products', 'transfers'].some(k => existing[k].length)) blockers.push('CURRENT_ROWS_ALREADY_EXIST_NO_OVERWRITE');
  const activity = new Map();
  for (const row of context.activity) {
    if (!row._id || activity.has(row._id) || row.company && row.company !== company) throw Error('Complete unique company journal snapshot required');
    activity.set(row._id, row);
    if (row._id === expectedLockId || ['PURCHASE_OPERATION_LOCK','PURCHASE_TASK_COST_LOCK','COST_RETRY_LOCK'].includes(row.action)) blockers.push('BUSINESS_LOCK_PRESENT');
    if (row.action === 'STOCK_TRANSFER_CURRENT') blockers.push('BORROWING_FACTS_REQUIRE_CURRENT_CHECKPOINT');
    if (row.stockOperationProtocol === 2 && row.action === 'STOCK_PLAN_MANIFEST') blockers.push('SEGMENTED_FACTS_REQUIRE_CURRENT_CHECKPOINT');
  }
  for (const task of context.tasks) {
    if (activity.has(hash(company, task.id, 'COST_LOCK'))) blockers.push('BUSINESS_COST_LOCK_PRESENT');
    if (activity.has(hash(company, task.id, 'GP_LOCK'))) blockers.push('BUSINESS_GP_LOCK_PRESENT');
  }
  for (const row of context.activity) {
    if (row.action === 'PURCHASE_OPERATION_PREPARED') {
      const result = activity.get(hash(row._id, 'RESULT'));
      if (row.details?.kind !== 'PREPARED' || !row.details.digest || !result || result.action !== 'PURCHASE_OPERATION_RESULT'
        || result.result !== 'SAVED' || result.details?.kind !== 'RESULT' || result.details.digest !== row.details.digest
        || result.details.outcome?.ok !== true) blockers.push('LEGACY_SAVE_NOT_CONFIRMED');
    } else if (row.plan && Number.isSafeInteger(row.baseGeneration)) {
      const result = activity.get(hash(row._id, 'RESULT'));
      if (!row.digest || !result || result.digest !== row.digest || result.baseGeneration !== row.baseGeneration || result.outcome?.ok !== true
        || result.outcome.operationId !== row._id || result.outcome.generation !== row.baseGeneration + 1
        || control.generation < result.outcome.generation) blockers.push('CURRENT_SAVE_NOT_CONFIRMED');
    }
  }
  const businessContext = { ...context }; delete businessContext.readAt;
  const sourceHash = fingerprint({ company, context: businessContext, purchaseRecords }), currentHash = fingerprint(existing), controlHash = fingerprint(control);
  const checkpointId = hash('STOCK_BOOTSTRAP', company, sourceHash, currentHash, controlHash);
  if (blockers.length) return { checkpointId, sourceHash, currentHash, controlHash, canBootstrap: false, activationReady: false,
    blockers: [...new Set(blockers)], rows: null };
  const orders = projectPurchaseOrders({ company, workspace: context, records: purchaseRecords });
  const tasks = context.tasks.map(task => {
    if (task.warehouse?.hasPhysicalReceipt !== true) return copy(task);
    const matches = orders.filter(po => po.company === company && po.taskIds.includes(task.id) && po.number === task.po);
    if (matches.length !== 1) throw Error('One resolved authoritative source PO required');
    return { ...copy(task), poId: matches[0].id };
  });
  const projection = projectStockCard({ ...context, tasks }), candidate = convertProjectedStock({ snapshot: projection, tasks, generation: control.generation });
  const rows = Object.fromEntries(['positions', 'claims', 'products'].map(k => [k, candidate[k].map(row => ({ ...row,
    _version: hash(checkpointId, k, row._id) }))]));
  return { company, generation: control.generation, checkpointId, sourceHash, currentHash, controlHash, canBootstrap: true, activationReady: false, blockers: [], rows,
    ...(includeProjection ? { privateProjection: copy(projection) } : {}),
    reviewRequired: !candidate.activationReady, counts: Object.fromEntries(Object.entries(rows).map(([k, values]) => [k, values.length])),
    // This is a PRIVATE dry-run parity aid, not evidence that production has been migrated.
    parity: { sources: rows.positions.length, products: rows.products.length, legacyProjectionHash: fingerprint(projection) } };
}
module.exports = { stockBootstrapPreflight };
