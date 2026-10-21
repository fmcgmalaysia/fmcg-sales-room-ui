'use strict';

// Isolated server preparation candidate; not a public endpoint or replacement authorization.
const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const { composeReceiptStockPlan } = require('./receipt-stock-plan.cjs');
const count = n => Number.isSafeInteger(n) && n >= 0;
const copy = row => JSON.parse(JSON.stringify(row));

function createReceiptStockReader({ company, items, store, protocol, readReceiptAuthority }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function'
    || typeof store?.read !== 'function' || typeof protocol?.readSnapshot !== 'function'
    || typeof readReceiptAuthority !== 'function') throw Error('Server receipt reader dependencies required');
  return async () => {
    const metrics = { exactReads: 0, claimQueries: 0 };
    const snapshot = await protocol.readSnapshot(async () => {
      // Existing permission/PO version/receipt/finance/allocation validators belong here.
      // This callback is server-supplied; never accept its result directly from a browser.
      const authority = await readReceiptAuthority();
      if (!authority || authority.event?.details?.company !== company || !Array.isArray(authority.sources)
        || !authority.sources.length || authority.sources.length > 14
        || new Set(authority.sources.map(source => source.sourceTask?.id)).size !== authority.sources.length) throw Error('Complete receipt authority required');
      const cache = new Map(); let totalClaims = 0;
      async function exact(collection, id) {
        const key = collection + ':' + id;
        if (!cache.has(key)) {
          metrics.exactReads++;
          cache.set(key, Promise.resolve(store.read(collection, id)));
        }
        return copy(await cache.get(key));
      }
      const contexts = [];
      for (const source of authority.sources) {
        const { sourceTask, ownership, holds } = source;
        if (sourceTask?.company !== company || !sourceTask.id || holds?.complete !== true
          || holds.scope !== 'SOURCE_CONFIRMED' || holds.sourceTaskId !== sourceTask.id
          || !holds.heldByTask || typeof holds.heldByTask !== 'object' || Array.isArray(holds.heldByTask)) throw Error('Confirmed source holds required');
        const key = stockKey({ ...sourceTask, company }), positionId = hash(company, key, 'PURCHASE_SOURCE', sourceTask.id);
        const position = await exact('StockPositions', positionId), product = await exact('StockProducts', hash(company, key));
        // Intentionally no ACTIVE filter. A CLOSED stable-ID claim must not become a new insert.
        const page = await items.query('StockClaims').eq('company', company).eq('positionId', positionId)
          .ascending('_id').limit(31).find({ consistentRead: true, returnTotalCount: true });
        metrics.claimQueries++;
        if (!Array.isArray(page?.items) || !count(page.totalCount) || page.totalCount > 30
          || page.items.length !== page.totalCount || totalClaims + page.totalCount > 30
          || new Set(page.items.map(row => row._id)).size !== page.items.length) throw Error('Receipt claims exceed complete snapshot bound');
        totalClaims += page.totalCount;
        const claims = [];
        for (const listed of page.items) {
          if (typeof listed._id !== 'string' || !listed._id || listed.company !== company || listed.positionId !== positionId) throw Error('Claim query scope conflict');
          // Reuse the exact store's verified normalization/version mapping instead of a new decoder.
          const claim = await exact('StockClaims', listed._id);
          if (!claim || claim.company !== company || claim.positionId !== positionId) throw Error('Claim snapshot changed');
          claims.push(claim);
        }
        contexts.push({ sourceTask: copy(sourceTask), ownership: copy(ownership), position, product, claims,
          holdsVerified: true, heldByTask: copy(holds.heldByTask) });
      }
      return { event: copy(authority.event), contexts };
    });
    return { generation: snapshot.generation, metrics,
      plan: composeReceiptStockPlan({ company, event: snapshot.rows.event, contexts: snapshot.rows.contexts, generation: snapshot.generation }) };
  };
}

module.exports = { createReceiptStockReader };
