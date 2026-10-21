'use strict';

const { domainCollections } = require('./domain-scope.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
// Maps unchanged original domain intent. Requires migration-tagged exact row versions.
// Does NOT replace stock/share guards, cost locks or all-writer authorization.
function preparePurchaseDomain({ validated, request, tables, taskEditVersion, operationId }) {
  const company = request.company, [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  if (!validated || validated.operation !== request.operation || !Array.isArray(validated.updates) || !Array.isArray(validated.events)
    || !validated.time || validated.displayOrder || typeof taskEditVersion !== 'function' || typeof operationId !== 'function') throw Error('Supported original Purchase plan required; display order needs its own adapter');
  const changes = new Map(), writes = [];
  for (const change of validated.updates) {
    if (!change.id || changes.has(change.id) || !change.patch || !change.orderId || !change.lineId) throw Error('Distinct Purchase task intent required');
    changes.set(change.id, change);
    const before = tables[tasks].find(r => r._id === change.id) || null;
    const matches = tables[orders].filter(r => r.title === change.orderId && r.sourceLineId === change.lineId);
    if (matches.length !== 1 || matches[0].salesInvoiceNumber) throw Error('Original customer order unavailable or invoice locked');
    if (before && (before.company !== company || !before._version || taskEditVersion(before) !== change.expected)
      || !before && change.expected !== null) throw Error('Migration-tagged exact Purchase task before-image required');
    const costLock = operationId(company, change.patch.title || change.id, 'COST_LOCK');
    if (tables[journal].some(r => r._id === costLock)) throw Error('Original task cost lock still active');
    if (Object.hasOwn(change.patch, '_version') || Object.hasOwn(change.patch, 'company') || change.patch._id && change.patch._id !== change.id) throw Error('Purchase patch cannot replace protocol ownership');
    if (before && (before.description !== change.orderId || before.imageAltText !== change.lineId)) throw Error('Purchase task identity conflict');
    const after = { ...(before || {}), ...copy(change.patch), _id: change.id, company };
    if (!before || taskEditVersion(before) !== taskEditVersion(after)) writes.push({ collection: tasks, before: copy(before), after });
  }
  for (const event of validated.events) {
    const change = changes.get(event.taskId);
    if (!change || !event.action) throw Error('Original Purchase event task missing');
    const id = operationId(company, request.requestId, request.staff.memberId, event.taskId, event.action);
    writes.push({ collection: journal, before: null, after: { _id: id, title: id, company, description: change.orderId,
      image: change.lineId, imageAltText: event.shareRootId || event.taskId, action: event.action, activityTime: validated.time,
      actorType: 'STAFF', initiatedByStaffId: request.staff.staffId, initiatedByStaffName: request.staff.staffName,
      result: 'SAVED', message: event.action.replaceAll('_', ' '), details: { requestId: request.requestId, ...copy(event) } } });
  }
  if (!writes.length || writes.length > 30 || Buffer.byteLength(JSON.stringify({ writes })) > 180000
    || new Set(writes.map(w => w.collection + ':' + w.after._id)).size !== writes.length) throw Error('Purchase domain exceeds atomic proof bound');
  return { writes };
}
module.exports = { preparePurchaseDomain };
