'use strict';

const { hash } = require('./commit-proof.cjs');
// Old preparation and old invoices may refer to the SAME cartons, but have no
// stable cross-reference. Never sum them into a second invented quantity hold.
// Keep a conservative task guard for ownership changes, independent of invoice
// quantities; actual invoice dispatch and ordinary receipts remain permitted.
function legacyPreparationGuard({ company, context, taskIds, readPreparation, projectPreparation }) {
  const blockedByTask = Object.fromEntries(taskIds.map(id => [id, false]));
  if (!context.activity.some(e => e.action === 'WAREHOUSE_PREPARATION_SAVED' && e.result === 'SAVED')) return { blockedByTask, version: hash([]) };
  if (typeof readPreparation !== 'function') throw Error('Original legacy preparation parser required; ownership changes stay blocked');
  const states = readPreparation(context.activity);
  if (!states || typeof states.values !== 'function' || typeof states.get !== 'function') throw Error('Original legacy preparation states required');
  const versions = [], projected = typeof projectPreparation === 'function' ? projectPreparation(context) : [];
  for (const state of states.values()) {
    if (state.company !== company || typeof state.prepared !== 'boolean' || !Number.isSafeInteger(state.loaded) || state.loaded < 0) throw Error('Legacy preparation facts require review');
    if (!Object.hasOwn(blockedByTask, state.taskId)) continue;
    const matches = projected.filter(row => row.id === state.id);
    const row = matches.length === 1 ? matches[0] : null;
    // Retire only through ORIGINAL batch identity/signature and dispatched range,
    // never age or task-wide shipped totals that might belong to another batch.
    const retired = !!row && !row.stale && !row.orphaned && row.signature === state.signature
      && row.quantity === state.quantity && Number.isSafeInteger(row.dispatched) && row.dispatched >= state.quantity;
    blockedByTask[state.taskId] ||= !retired && (state.prepared || state.loaded > 0);
    versions.push([state.id, state.revision, state.prepared, state.loaded, retired, row?.dispatched ?? null]);
  }
  return { blockedByTask, version: hash(versions.sort((a, b) => a[0].localeCompare(b[0]))) };
}
module.exports = { legacyPreparationGuard };
