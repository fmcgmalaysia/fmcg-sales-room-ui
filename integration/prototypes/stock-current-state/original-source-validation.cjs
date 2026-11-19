'use strict';

const { domainCollections } = require('./domain-scope.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
// Read-only original ADD_SOURCE preparation, with a private in-memory journal.
// Staff flag is resolved by the authenticated server gateway, never from input.
async function validateOriginalSource({ createPurchaseSourceOperations, request, tables, workspace, now }) {
  const { company, staff } = request, [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const allowed = new Set([orders, tasks, journal, 'SharedSuppliers', 'PurchaseOrders']);
  if (typeof createPurchaseSourceOperations !== 'function' || typeof now !== 'function' || workspace?.company !== company
    || !tables || [...allowed].some(c => !Array.isArray(tables[c])) || Object.keys(tables).some(c => !allowed.has(c))) throw Error('Complete original source snapshot required');
  const scratch = new Map(), boundary = new Error('Private source prepare boundary'); let captured, reads = 0;
  const scope = c => { if (!allowed.has(c)) throw Error('Source snapshot scope violation'); };
  const store = {
    all: async c => { scope(c); return copy(tables[c]); },
    read: async (c, id) => { scope(c); return copy(scratch.get(c + ':' + id) || tables[c].find(r => r._id === id) || null); },
    one: async (c, criteria) => { scope(c); return copy(tables[c].find(r => Object.entries(criteria).every(([k, v]) => r[k] === v)) || null); },
    insert: async (c, row) => {
      if (c !== journal) throw Error('Source domain apply forbidden');
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || !row.details.plan?.task || !Array.isArray(row.details.plan.events)) throw Error('Unexpected source preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Source apply forbidden');
      scratch.set(c + ':' + row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      if (c !== journal || scratch.get(c + ':' + id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private source lock removal allowed');
      scratch.delete(c + ':' + id);
    }
  };
  const save = createPurchaseSourceOperations({ store, now, names: { [company]: { orders, tasks, activity: journal } },
    readWorkspace: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected source apply/read');
      return copy(workspace);
    } });
  try { await save({ ...copy(request), input: { ...copy(request.input), action: 'ADD_SOURCE' } }); throw Error('Original source boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original source preparation incomplete');
  return captured;
}
function prepareSourceDomain({ validated, request, tables }) {
  const { company } = request, [, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const task = validated?.task, added = validated?.events?.filter(e => e.action === 'PURCHASE_SOURCE_ADDED');
  if (!task?._id || task.title !== task._id || task.procurementSource !== true || task.specialPurchase
    || task.purchaseQtyInCtn !== 0 || !task.customerDemandTaskId || tables[tasks].some(t => t._id === task._id)
    || added?.length !== 1 || added[0].imageAltText !== task._id || added[0].details?.parentTaskId !== task.customerDemandTaskId
    || task.company || task._version) throw Error('Original new procurement source required');
  const writes = [{ collection: tasks, before: null, after: { ...copy(task), company } }];
  for (const event of validated.events) {
    if (!event._id || event.title !== event._id || !event.action?.startsWith('PURCHASE_') || event.result !== 'SAVED'
      || tables[journal].some(e => e._id === event._id) || event.initiatedByStaffId !== request.staff.staffId) throw Error('Original source event required');
    writes.push({ collection: journal, before: null, after: { ...copy(event), company } });
  }
  if (new Set(writes.map(w => w.collection + ':' + w.after._id)).size !== writes.length || writes.length > 30
    || Buffer.byteLength(JSON.stringify({ writes })) > 180000) throw Error('Source domain plan exceeds atomic proof bounds');
  return { writes };
}
module.exports = { validateOriginalSource, prepareSourceDomain };
