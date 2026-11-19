'use strict';

const copy = value => JSON.parse(JSON.stringify(value));
// Private original prepare capture only. PHOTOS deliberately excluded: its
// existing external allocation/upload identity protocol must not be replaced.
async function validateOriginalPacking({ createPackingListOperations, company, staff, requestId, input, context, now }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.lists)
    || typeof createPackingListOperations !== 'function' || typeof now !== 'function' || !input || input.action === 'PHOTOS') throw Error('Original non-photo packing snapshot required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', scratch = new Map(), boundary = new Error('Private packing preparation boundary');
  let captured, reads = 0;
  const scope = c => { if (c !== journal) throw Error('Packing snapshot scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.record?.action !== 'SUPPORT_PACKING_LIST_CURRENT'
          || row.details.plan.uploads?.length) throw Error('Unexpected packing preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Packing apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private packing lock removal allowed'); scratch.delete(id);
    }
  };
  const save = createPackingListOperations({ store, now, names: { [company]: { activity: journal } }, readContext: async (c, employee) => {
    if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected packing apply/read'); return copy(context);
  } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original packing boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original packing preparation incomplete');
  return captured;
}
module.exports = { validateOriginalPacking };
