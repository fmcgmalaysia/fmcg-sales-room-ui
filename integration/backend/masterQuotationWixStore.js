import { createMasterQuotationRevisionStore } from 'backend/masterQuotationRevisionStore.js';

const READ = { suppressAuth: true, consistentRead: true };
const WRITE = { suppressAuth: true };
const BATCH_SIZE = 100;

// Pass the name of the preconfigured private collection at deployment, never from the browser.
export function createMasterQuotationWixStore(wixData, collection) {
  const byCustomer = customerId => wixData.query(collection).eq('customerId', customerId);
  const store = createMasterQuotationRevisionStore({
    insert: row => wixData.insert(collection, row, WRITE),
    read: async id => (await wixData.query(collection).eq('_id', id).limit(1).find(READ)).items[0] ?? null,
    latest: async (customerId, selectionId) => (await byCustomer(customerId).eq('selectionId', selectionId)
      .descending('revision').limit(1).find(READ)).items[0] ?? null
  });

  return {
    ...store,
    async latestFor(customerId, selectionIds) {
      const ids = [...new Set(selectionIds)];
      const versions = new Map();
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        const remaining = new Set(batch);
        let result = await byCustomer(customerId).hasSome('selectionId', batch).descending('revision').limit(1000).find(READ);
        while (true) {
          for (const row of result.items) {
            if (row.customerId !== customerId) throw Error('Unexpected customer quotation.');
            if (!remaining.delete(row.selectionId)) continue;
            versions.set(row.selectionId, row);
          }
          if (!remaining.size || !result.hasNext()) break;
          result = await result.next();
        }
      }
      return versions;
    }
  };
}
