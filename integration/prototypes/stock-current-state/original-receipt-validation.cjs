'use strict';

// Isolated compatibility bridge: execute the unchanged original receipt prepare
// against a private journal, stopping BEFORE its legacy apply. No real store is
// accepted here. The resulting event still needs the fenced multi-product plan.
const copy = value => JSON.parse(JSON.stringify(value));
async function validateOriginalReceipt({ createWarehouseOperations, company, staff, requestId, input, orders, activity, now }) {
  if (typeof createWarehouseOperations !== 'function' || !['NCT', 'GHR'].includes(company)
    || !Array.isArray(orders) || !Array.isArray(activity) || typeof now !== 'function') throw Error('Original receipt validation dependencies required');
  const collection = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const scratch = new Map(), stopped = new Error('Private receipt preparation boundary');
  let captured = null, orderReads = 0;
  const scope = c => { if (c !== collection) throw Error('Unexpected receipt journal collection'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    all: async c => { scope(c); return copy(activity); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || !row.details.plan?.event || scratch.size !== 1) throw Error('Unexpected receipt prepare sequence');
        captured = copy(row.details.plan);
        throw stopped;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK'
        || scratch.size || scratch.has(row._id)) throw Error('Legacy receipt apply is forbidden in validation');
      scratch.set(row._id, copy(row));
      return copy(row);
    },
    remove: async (c, id) => {
      scope(c);
      if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private validation lock may be removed');
      scratch.delete(id);
    }
  };
  const operations = createWarehouseOperations({ store, names: { [company]: { activity: collection } },
    readOrders: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++orderReads !== 1) throw Error('Unexpected receipt apply/read');
      return copy(orders);
    }, now });
  try {
    await operations.save({ company, staff: copy(staff), requestId, input: copy(input) });
    throw Error('Original receipt prepare boundary was not reached');
  } catch (error) {
    if (error !== stopped) throw error;
  }
  if (scratch.size || !captured || orderReads !== 1 || captured.event.action !== 'WAREHOUSE_RECEIPT_SAVED'
    || captured.event.details?.company !== company) throw Error('Original receipt preparation incomplete');
  return captured;
}
module.exports = { validateOriginalReceipt };
