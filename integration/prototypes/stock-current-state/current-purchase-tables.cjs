'use strict';
const { domainCollections } = require('./domain-scope.cjs');
const { copy } = require('./segmented-plan.cjs');
// Server-only bridge to ORIGINAL all()/pagination. No replacement query engine,
// synthetic stock facts or N+1 exact reads for every listed historical row.
function createCurrentPurchaseTables({ company, readOriginalTable, store }) {
  if (!['NCT','GHR'].includes(company) || typeof readOriginalTable !== 'function' || typeof store?.normalizeListedRow !== 'function') {
    throw Error('Original paged Purchase reader and conditional normalization required');
  }
  const [orders,tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  return async (selectedCompany, staff) => {
    if (selectedCompany !== company || !staff?.memberId || !staff.staffId) throw Error('Private original Purchase table scope required');
    const collections = [orders,tasks,journal,'SharedSuppliers','PurchaseOrders'];
    const listed = await Promise.all(collections.map(collection => readOriginalTable(collection)));
    return Object.fromEntries(collections.map((collection,index) => {
      let rows = listed[index];
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row._id !== 'string' || !row._id)
        || new Set(rows.map(row => row._id)).size !== rows.length) throw Error('Complete distinct original Purchase table required');
      // Shared supplier identities are intentionally global in the original system.
      if (collection === 'SharedSuppliers') return [collection,copy(rows)];
      if (collection === 'PurchaseOrders') rows = rows.filter(row => row.company === company);
      return [collection,rows.map(row => {
        if (collection === journal && !Object.hasOwn(row,'stockCommitVersion') && !(row.owner && row.attempt && !row.action && !row.details)) {
          // Immutable PRE-ACTIVE journal history need not be rewritten/versioned.
          // Keep original Date->JSON snapshots and identities. Such records are not
          // conditional before-images; current mutations still use exact SDK reads.
          if (row.company && row.company !== company) throw Error('Original Purchase journal company conflict');
          return copy(row);
        }
        return store.normalizeListedRow(collection,row);
      })];
    }));
  };
}
module.exports = { createCurrentPurchaseTables };
