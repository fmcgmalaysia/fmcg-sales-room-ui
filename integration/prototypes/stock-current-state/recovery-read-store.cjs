'use strict';

const { planCollections } = require('./domain-scope.cjs');
const { createSdkFieldCodec } = require('./sdk-field-codec.cjs');
// Deliberately QUERY-ONLY. Returned capability has no insert/update/CAS/remove.
// Only for the Wix Admin inspection boundary, not a business writer fallback.
function createRecoveryReadStore({ items, company, dateTimeFields = {} }) {
  if (typeof items?.query !== 'function' || !['NCT', 'GHR'].includes(company)) throw Error('Private recovery read scope required');
  const allowed = new Set(planCollections(company, true)), metadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId']);
  const fieldCodec = createSdkFieldCodec({ collections: [...allowed], dateTimeFields });
  return { read: async (collection, id) => {
    if (!allowed.has(collection) || typeof id !== 'string' || !id || id.length > 128) throw Error('Private recovery exact scope violation');
    const page = await items.query(collection).eq('_id', id).limit(2).find({ consistentRead: true });
    if (!Array.isArray(page?.items) || page.items.length > 1) throw Error('Ambiguous recovery record');
    const row = page.items[0]; if (!row) return null;
    if (row._id !== id || row.company !== company) throw Error('Recovery record identity conflict');
    const result = Object.fromEntries(Object.entries(row).filter(([k]) => !metadata.has(k) && k !== 'stockCommitVersion')
      .map(([k, v]) => [k, fieldCodec.decode(collection, k, v)]));
    if (Object.hasOwn(row, 'stockCommitVersion')) {
      if (typeof row.stockCommitVersion !== 'string' || !row.stockCommitVersion) throw Error('Invalid recovery storage version');
      result._version = row.stockCommitVersion;
    }
    return result;
  } };
}
module.exports = { createRecoveryReadStore };
