'use strict';

const copy = value => JSON.parse(JSON.stringify(value));
// Private validation-only original journal. No real store is accepted. Its lock
// exists in local memory only; original apply is never allowed to save separately.
async function validateOriginalAllocation({ createPlannerAllocationOperations, company, staff, requestId, input, workspace, activity, now }) {
  if (typeof createPlannerAllocationOperations !== 'function' || !['NCT', 'GHR'].includes(company)
    || workspace?.company !== company || !Array.isArray(activity) || typeof now !== 'function') throw Error('Original allocation validation dependencies required');
  const collection = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const scratch = new Map(), boundary = new Error('Private allocation prepare boundary');
  let captured, reads = 0;
  const scope = c => { if (c !== collection) throw Error('Unexpected allocation journal collection'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    all: async c => { scope(c); return copy(activity); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'PLANNER_ALLOCATION_SAVED') throw Error('Unexpected allocation preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Legacy allocation apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    },
    remove: async (c, id) => { scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private allocation lock may be removed'); scratch.delete(id); }
  };
  const save = createPlannerAllocationOperations({ store, names: { [company]: { activity: collection } }, now,
    readWorkspace: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected allocation apply/read');
      return copy(workspace);
    } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original allocation boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original allocation preparation incomplete');
  return captured;
}
module.exports = { validateOriginalAllocation };
