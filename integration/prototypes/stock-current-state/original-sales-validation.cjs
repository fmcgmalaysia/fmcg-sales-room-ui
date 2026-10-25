'use strict';

const copy = value => JSON.parse(JSON.stringify(value));
// Validation seam only: original customer-scoped staff must be supplied by the real
// Sales authority, never browser claims. No real journal store or mutation accepted.
async function validateOriginalSales({ createSalesOrderAdjustmentOperations, company, staff, requestId, input, context, readPlans, planVersion, now }) {
  if (typeof createSalesOrderAdjustmentOperations !== 'function' || !['NCT', 'GHR'].includes(company)
    || context?.company !== company || !Array.isArray(context.activity) || typeof readPlans !== 'function'
    || typeof planVersion !== 'function' || typeof now !== 'function') throw Error('Original Sales validation dependencies required');
  const collection = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const scratch = new Map(), boundary = new Error('Private Sales preparation boundary'); let captured, reads = 0;
  const scope = c => { if (c !== collection) throw Error('Unexpected Sales journal collection'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'SALES_ORDER_ADJUSTMENT_SAVED') throw Error('Unexpected Sales preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Legacy Sales apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => { scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private Sales lock may be removed'); scratch.delete(id); }
  };
  const save = createSalesOrderAdjustmentOperations({ store, names: { [company]: { activity: collection } }, readPlans, planVersion, now,
    readContext: async (c, employee) => { if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected Sales apply/read'); return copy(context); } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original Sales boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original Sales preparation incomplete');
  return captured;
}
module.exports = { validateOriginalSales };
