'use strict';
const { hash } = require('./commit-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
// Capture ORIGINAL legacy invoice cancellation or supplier credit preparation.
// The original policies run; original apply/file/bank paths never run here.
async function prepareAccountOriginalAuxiliary({ company, staff, requestId, input, rows, before, creditBefore,
  createAccountReviewOperations, createSupplierCreditOperations, now }) {
  const credit = input?.action === 'APPLY_CREDIT', review = input?.action === 'INVOICE_CHECK';
  if (!['NCT','GHR'].includes(company) || !credit && !review || !Array.isArray(rows)
    || rows.some(row => row.company !== company || !row.id) || new Set(rows.map(row => row.id)).size !== rows.length
    || typeof now !== 'function' || typeof (credit ? createSupplierCreditOperations : createAccountReviewOperations) !== 'function'
    || review && before && (before._id !== input.id || before.company !== company || !before._version)
    || credit && creditBefore !== null) throw Error('Original Account auxiliary authority required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', scratch = new Map(), boundary = new Error('Original Account auxiliary prepare boundary');
  let captured, reads = 0;
  const store = {
    read: async (collection, id) => {
      if (collection === journal) return copy(scratch.get(id) || null);
      if (credit || collection !== 'PurchaseOrders' || id !== input.id) throw Error('Original Account auxiliary read scope');
      return copy(before || null);
    }, insert: async (collection, row) => {
      if (collection === journal && row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || !row.details.plan || row.details.plan.upload || row.details.plan.trash || row.details.plan.extraUploads?.length) throw Error('Original auxiliary plan scope');
        captured = copy(row.details.plan); throw boundary;
      }
      if (collection !== journal || row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Original Account auxiliary apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (collection, id) => {
      if (collection !== journal || scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private auxiliary lock removal'); scratch.delete(id);
    }
  };
  const dependencies = { store, now, names: { [company]: { activity: journal } }, listOrders: async (selected, actor) => {
    if (selected !== company || actor.memberId !== staff.memberId || ++reads !== 1) throw Error('Original auxiliary apply/read forbidden'); return copy(rows);
  } };
  const operation = credit ? createSupplierCreditOperations(dependencies) : createAccountReviewOperations(dependencies).save;
  try { await operation({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original auxiliary boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original auxiliary preparation incomplete');
  if (credit) {
    const event = captured.event, id = hash(company, requestId, staff.memberId, 'CREDIT');
    if (Object.keys(captured).some(key => !['sourceVersion','targetVersion','event'].includes(key))
      || captured.sourceVersion !== input.sourceVersion || captured.targetVersion !== input.version
      || !event || event._id !== id || event.title !== id || event.description !== input.id || event.action !== 'SUPPLIER_CREDIT_APPLIED'
      || event.result !== 'SAVED' || event.actorType !== 'STAFF' || event.initiatedByStaffId !== staff.staffId || event.initiatedByStaffName !== staff.staffName
      || event.details?.company !== company || event.details.sourceId !== input.sourceId || event.details.targetId !== input.id
      || event.details.supplierId !== rows.find(row => row.id === input.id)?.supplierId || event.details.cents !== input.cents
      || event.details.reason !== String(input.reason || '').trim() || event.message !== event.details.reason
      || typeof event.activityTime !== 'string' || !Number.isFinite(Date.parse(event.activityTime))) throw Error('Original supplier credit event identity required');
    return { writes: [{ collection: journal, before: null, after: { ...event, company } }] };
  }
  const { record, event, expected } = captured, id = hash(company, requestId, staff.memberId, 'ACCOUNT_REVIEW');
  if (Object.keys(captured).some(key => !['record','event','expected'].includes(key)) || !record || !event || record._id !== input.id
    || record.title !== input.id || record.company !== company || expected !== (before ? hash(before) : null)
    || event.id !== id || event.action !== 'SUPPLIER_INVOICE_CHECK_CHANGED' || event.result !== 'SAVED'
    || event.actorStaffId !== staff.staffId || event.actor !== staff.staffName || !same(record.details?.audit?.at(-1), event)
    || !same(record.details.audit.slice(0,-1), before?.details?.audit || []) || typeof event.time !== 'string' || !Number.isFinite(Date.parse(event.time))) throw Error('Original invoice review record/audit identity required');
  const omit = (value, keys) => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !keys.includes(key)));
  if (before && !same(omit(record,['details']),omit(before,['details']))
    || !same(omit(record.details,['taskIds','createdAt','createdBy','updatedAt','audit','invoiceCheck']),omit(before?.details,['taskIds','createdAt','createdBy','updatedAt','audit','invoiceCheck']))) throw Error('Invoice cancellation cannot change finance, files or stock');
  return { writes: [{ collection: 'PurchaseOrders', before: copy(before || null), after: record }] };
}
module.exports = { prepareAccountOriginalAuxiliary };
