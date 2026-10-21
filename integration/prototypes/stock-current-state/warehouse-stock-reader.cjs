'use strict';

const { readCurrentProduct } = require('./current-product-reader.cjs');
const { prepareWarehouseReceipt } = require('./warehouse-receipt-plan.cjs');
function createWarehouseStockReader({ company, items, store, protocol, readAuthority }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function' || typeof store?.read !== 'function'
    || typeof protocol?.readSnapshot !== 'function' || typeof readAuthority !== 'function') throw Error('Server Warehouse stock dependencies required');
  // Intended as fenced commit.prepare; not a standalone unauthenticated save route.
  return async () => {
    const metrics = { queries: 0, exactReads: 0 };
    const snapshot = await protocol.readSnapshot(async () => {
      const authority = await readAuthority();
      if (authority?.kind !== 'RECEIVE' || !authority.memberId || !authority.validated
        || !Array.isArray(authority.products) || !authority.products.length) throw Error('Verified Warehouse authority required');
      const products = [];
      for (const product of authority.products) {
        if (product.identity?.company !== company || typeof product.buildState !== 'function') throw Error('Server product authority required');
        const rows = await readCurrentProduct({ company, identity: product.identity, items, store, metrics });
        products.push({ state: product.buildState(rows), rows });
      }
      return { validated: authority.validated, products, memberId: authority.memberId };
    });
    return { ...prepareWarehouseReceipt({ ...snapshot.rows, generation: snapshot.generation }),
      memberId: snapshot.rows.memberId, generation: snapshot.generation, metrics };
  };
}
module.exports = { createWarehouseStockReader };
