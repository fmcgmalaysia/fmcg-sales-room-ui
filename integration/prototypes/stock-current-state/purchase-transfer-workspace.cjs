'use strict';

const { copy } = require('./segmented-plan.cjs');
const count = n => Number.isSafeInteger(n) && n >= 0;
// Read-only composition. Original Purchase auth/workspace supplied by real gateway.
// A failed/incomplete relation index must fail the refresh, not clear existing halos.
function createPurchaseTransferWorkspace({ company, protocol, authenticate, readWorkspace, readOutstanding, maxRelations = 2000 }) {
  if (!['NCT', 'GHR'].includes(company) || typeof protocol?.readSnapshot !== 'function' || typeof authenticate !== 'function'
    || typeof readWorkspace !== 'function' || typeof readOutstanding !== 'function' || !Number.isSafeInteger(maxRelations) || maxRelations < 1) throw Error('Private Purchase workspace dependencies required');
  return async requestCompany => {
    if (requestCompany !== company) throw Error('Purchase workspace company conflict');
    const actor = await authenticate(company);
    if (!actor?.memberId || !actor.staffId) throw Error('Original Purchase authorization required');
    const snapshot = await protocol.readSnapshot(async control => {
      if (control?.company !== company || control.pending || !count(control.generation) || !['LEGACY', 'ACTIVE'].includes(control.mode)) throw Error('Purchase stock workspace unavailable');
      if (control.mode === 'ACTIVE' && (control.transferIndexVersion !== 2 || !control.writerBuild)) throw Error('Purchase source transfer index/build not verified');
      const workspace = await readWorkspace(company, actor);
      if (workspace?.company !== company || !Array.isArray(workspace.tasks) || new Set(workspace.tasks.map(t => t.id)).size !== workspace.tasks.length) throw Error('Original Purchase workspace required');
      if (control.mode === 'LEGACY') return copy(workspace);
      const relations = [], seen = new Set(); let cursor, expectedTotal, expectedVersion;
      do {
        const page = await readOutstanding(company, { view: 'OUTSTANDING', pageSize: 50, ...(cursor ? { cursor } : {}) });
        if (page?.schema !== 'CURRENT_BORROW_RELATIONS_V1' || page.company !== company || page.view !== 'OUTSTANDING'
          || page.generation !== control.generation || !/^[a-f0-9]{32}$/.test(page.version || '') || page.offset !== relations.length || !Array.isArray(page.items)
          || !count(page.total) || page.total > maxRelations || page.items.length !== Math.min(50, page.total - relations.length)
          || expectedTotal !== undefined && (page.total !== expectedTotal || page.version !== expectedVersion)) throw Error('Complete current transfer workspace required');
        expectedTotal = page.total; expectedVersion = page.version;
        for (const r of page.items) {
          if (!r.id || seen.has(r.id) || !r.borrowerTaskId || !r.lenderTaskId || !r.lenderSourceId || !r.replacementSourceId
            || !count(r.quantity) || !r.quantity || !count(r.repaid) || !count(r.returned) || r.repaid + r.returned >= r.quantity) throw Error('Known outstanding relation required');
          seen.add(r.id); relations.push(r);
        }
        cursor = page.nextCursor;
        if (relations.length < expectedTotal && (!cursor || cursor.offset !== relations.length || cursor.version !== expectedVersion)
          || relations.length === expectedTotal && cursor) throw Error('Transfer workspace cursor incomplete');
      } while (cursor);
      const sourceIds = new Set(relations.flatMap(r => [r.lenderSourceId, r.replacementSourceId]));
      return { ...copy(workspace), stockCurrent: { schema: 'PURCHASE_TRANSFERS_V2', generation: control.generation,
        stockProtocol: 1, stockBuild: control.writerBuild, stockGeneration: control.generation },
        tasks: workspace.tasks.map(task => ({ ...copy(task), stockTransferOutstanding: sourceIds.has(task.id),
          stockTransferTaskId: task.customerDemandTaskId || task.id })) };
    });
    return snapshot.rows;
  };
}
module.exports = { createPurchaseTransferWorkspace };
