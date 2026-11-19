'use strict';

const { domainCollections } = require('./domain-scope.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
// Validation-only invocation of the ORIGINAL prepare. Tables are an authenticated
// server snapshot; no real store, external service or legacy apply is invoked.
async function validateOriginalPurchase({ createPurchaseOperations, request, tables, now }) {
  const company = request?.company, [orders, tasks] = domainCollections(company);
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const allowed = new Set([orders, tasks, journal, 'SharedSuppliers', 'PurchaseOrders']);
  if (typeof createPurchaseOperations !== 'function' || typeof now !== 'function'
    || !tables || [...allowed].some(c => !Array.isArray(tables[c])) || Object.keys(tables).some(c => !allowed.has(c))) throw Error('Complete original Purchase snapshot required');
  const scratch = new Map(), boundary = new Error('Private Purchase prepare boundary'); let captured;
  const scope = c => { if (!allowed.has(c)) throw Error('Purchase snapshot scope violation'); };
  const store = {
    all: async c => { scope(c); return copy(tables[c]); },
    read: async (c, id) => { scope(c); return copy(c === journal && scratch.has(id) ? scratch.get(id) : tables[c].find(r => r._id === id) || null); },
    one: async (c, criteria) => { scope(c); return copy(tables[c].find(r => Object.entries(criteria).every(([k, v]) => r[k] === v)) || null); },
    insert: async (c, row) => {
      if (c !== journal) throw Error('Legacy Purchase domain write forbidden during validation');
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.operation !== request.operation) throw Error('Unexpected Purchase preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Legacy Purchase apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      if (c !== journal || scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private Purchase lock may be removed'); scratch.delete(id);
    }
  };
  try { await createPurchaseOperations({ store, now })(copy(request)); throw Error('Original Purchase boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || scratch.size || !Array.isArray(captured.updates) || !Array.isArray(captured.events)) throw Error('Original Purchase preparation incomplete');
  return captured;
}
module.exports = { validateOriginalPurchase };
