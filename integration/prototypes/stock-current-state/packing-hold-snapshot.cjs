'use strict';

// Reuses the existing validated list parser and packingHeld implementation.
// Server-owned context only; no query, storage, source split or new authorization.
const { hash } = require('./commit-proof.cjs');
function createPackingHoldSnapshot({ readPackingLists, packingHeld }) {
  if (typeof readPackingLists !== 'function' || typeof packingHeld !== 'function') throw Error('Existing packing readers required');
  return ({ company, activity, taskIds }) => {
    if (!['NCT', 'GHR'].includes(company) || !Array.isArray(activity) || !Array.isArray(taskIds)
      || taskIds.some(id => typeof id !== 'string' || !id) || new Set(taskIds).size !== taskIds.length) throw Error('Server packing context required');
    const lists = readPackingLists(activity, company);
    const heldByTask = Object.fromEntries(taskIds.map(taskId => {
      let held = 0;
      for (const list of lists) {
        const quantity = packingHeld(list, taskId);
        if (!Number.isSafeInteger(quantity) || quantity < 0) throw Error('Packing quantity requires review');
        held += quantity;
        if (!Number.isSafeInteger(held)) throw Error('Packing hold overflow');
      }
      return [taskId, held];
    }));
    return { company, complete: true, scope: 'TASK_TOTAL', heldByTask,
      version: hash(company, lists.map(list => [list.id, list.revision]).sort((a, b) => a[0].localeCompare(b[0]))) };
  };
}
module.exports = { createPackingHoldSnapshot };
