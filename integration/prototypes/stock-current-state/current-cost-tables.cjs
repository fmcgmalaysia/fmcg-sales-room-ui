'use strict';
const { domainCollections } = require('./domain-scope.cjs');
const { hash } = require('./commit-proof.cjs');
// Only rows consumed by the ORIGINAL one-task reference retry; never all activity.
function createCurrentCostTables({ company, items, store }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function'
    || typeof store?.read !== 'function' || typeof store?.normalizeListedRow !== 'function') throw Error('Private exact cost reader required');
  const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  return async (selectedCompany, taskId, staff, requestId) => {
    if (selectedCompany !== company || !/^[a-f0-9]{32}$/.test(taskId || '') || !/^[a-f0-9-]{36}$/i.test(requestId || '')
      || typeof staff?.memberId !== 'string' || !staff.memberId || typeof staff.staffId !== 'string' || !staff.staffId) throw Error('Original exact cost scope required');
    const tables = { [orders]: [], [tasks]: [], [journal]: [] }, seen = new Set();
    function retain(collection, row, immutableHistory = false) {
      if (row !== null) {
        if (!row || typeof row._id !== 'string' || !row._id || row.company !== company
          && !(immutableHistory && collection === journal && row.company === undefined)) throw Error('Cost row company/identity conflict');
        const key = collection + ':' + row._id;
        if (!seen.has(key)) { seen.add(key); tables[collection].push(row); }
      }
      return row;
    }
    const exact = async (collection, id) => retain(collection, await store.read(collection, id));
    async function one(collection, criteria) {
      let query = items.query(collection);
      for (const [key, value] of Object.entries(criteria)) query = query.eq(key, value);
      const page = await query.limit(2).find({ consistentRead: true });
      if (!Array.isArray(page?.items) || page.items.length > 1) throw Error('Ambiguous original cost record');
      if (!page.items.length) return null;
      const raw = page.items[0];
      // Original pre-ACTIVE immutable receipt/special-task evidence does not need
      // a rewritten company/version field. It is NEVER a conditional before-image.
      const history = collection === journal && raw && !Object.hasOwn(raw, 'stockCommitVersion')
        && ['ORDER_RECEIVED', 'SPECIAL_PURCHASE_ADDED'].includes(criteria.action);
      const row = history ? JSON.parse(JSON.stringify(raw)) : store.normalizeListedRow(collection, raw);
      if (Object.entries(criteria).some(([key, value]) => row[key] !== value)) throw Error('Cost query identity conflict');
      return retain(collection, row, history);
    }
    const task = await exact(tasks, taskId);
    if (!task || !task._version || task.title !== taskId || !task.description || !task.imageAltText) throw Error('Original migrated cost task required');
    await one(orders, { title: task.description, sourceLineId: task.imageAltText });
    const receipt = await one(journal, { description: task.description, action: 'ORDER_RECEIVED', result: 'ACCEPTED' });
    if (task.specialPurchase === true && receipt?.details?.taskIds && !receipt.details.taskIds.includes(taskId)) {
      const event = await one(journal, { action: 'SPECIAL_PURCHASE_ADDED', imageAltText: taskId, result: 'SAVED' });
      if (event?.details?.parentTaskId) await exact(tasks, event.details.parentTaskId);
    }
    await exact(journal, hash(company, taskId, 'COST_LOCK'));
    for (const kind of ['RESULT', 'ATTEMPT', 'CAPTURE']) await exact(journal, hash(company, taskId, requestId, staff.memberId, kind));
    return tables;
  };
}
module.exports = { createCurrentCostTables };
