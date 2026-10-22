'use strict';

const { hash } = require('./commit-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const patches = Object.freeze({ TERM: ['termDays'], ACK_PAYMENT: ['paymentHandoff'], REQUEST_PAYMENT: ['termDays', 'paymentRequestRevision', 'procurementHandoff', 'paymentHandoff'],
  SUBMIT_FINANCE: ['procurementHandoff', 'chasePayment'], WITHDRAW_FINANCE: ['procurementHandoff'], REQUEST_RETURN: ['procurementHandoff'], DOCUMENT_ISSUE_RESPONSE: ['documentIssues'] });

// Original authenticated Purchase gateway must supply staff/context. This capture
// cannot authenticate a browser and never runs legacy apply or Drive operations.
async function preparePurchaseOrderRecord({ company, staff, requestId, input, context, records, createPurchaseOrderOperations, now }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
    || !Array.isArray(records) || !Object.hasOwn(patches, input?.action) || typeof createPurchaseOrderOperations !== 'function'
    || typeof now !== 'function') throw Error('Original non-file Purchase order context required');
  if (records.some(r => r.company !== company || !r._id) || new Set(records.map(r => r._id)).size !== records.length) throw Error('Exact company PO records required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', scratch = new Map(), boundary = new Error('Private PO record prepare boundary');
  let captured, reads = 0;
  const scope = c => { if (![journal, 'PurchaseOrders'].includes(c)) throw Error('PO record scope violation'); };
  const store = {
    all: async c => { scope(c); if (c !== 'PurchaseOrders') throw Error('Unexpected PO journal scan'); return copy(records); },
    read: async (c, id) => { scope(c); return copy(c === journal ? scratch.get(id) || null : records.find(r => r._id === id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (c === journal && row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || !row.details.plan?.record || row.details.plan.upload || row.details.plan.trash) throw Error('Unexpected PO record preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (c !== journal || row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('PO record apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      scope(c); if (c !== journal || scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private PO lock removal allowed'); scratch.delete(id);
    }
  };
  const operations = createPurchaseOrderOperations({ store, now, names: { [company]: { activity: journal } },
    documentService: async () => { throw Error('External PO file operation forbidden'); }, readWorkspace: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected PO record apply/read'); return copy(context);
    } });
  try { await operations.save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original PO record boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  const record = captured?.record, event = captured?.event, before = records.find(r => r._id === input.id) || null;
  if (!record || !event || reads !== 1 || scratch.size || record._id !== input.id || record.title !== input.id || record.company !== company
    || before && !before._version || captured.expected !== (before ? hash(before) : null) || captured.expectedVersion !== input.version
    || event.actorStaffId !== staff.staffId || record.details.audit.at(-1)?.id !== event.id
    || !same(record.details.audit.slice(0, -1), before?.details?.audit || [])) throw Error('Original exact PO record/event required');
  const allowedDetails = new Set([...patches[input.action], 'taskIds', 'createdAt', 'createdBy', 'updatedAt', 'audit']);
  const fixed = details => Object.fromEntries(Object.entries(details || {}).filter(([k]) => !allowedDetails.has(k)));
  const top = value => Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'details'));
  if (before && !same(top(before), top(record)) || !same(fixed(before?.details), fixed(record.details))) throw Error('PO metadata action cannot change unrelated finance, document or identity fields');
  return { plan: { writes: [{ collection: 'PurchaseOrders', before: copy(before), after: record }] },
    event, expectedVersion: captured.expectedVersion, expectedBasis: captured.expectedBasis };
}
module.exports = { preparePurchaseOrderRecord };
