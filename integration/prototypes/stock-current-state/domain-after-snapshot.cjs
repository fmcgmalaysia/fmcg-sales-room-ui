'use strict';

const { domainCollections } = require('./domain-scope.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
// Pure simulation of the exact domain images to feed ORIGINAL projectors. Never
// save this snapshot or infer stock from caller-supplied after quantities.
function domainAfterSnapshot({ company, tables, plan }) {
  const journal = company === 'NCT' ? 'NCTActivity' : company === 'GHR' ? 'NCTActivity1' : null;
  if (!journal) throw Error('Supported company required');
  const allowed = new Set([...domainCollections(company), journal]), result = copy(tables), seen = new Set();
  if (!Array.isArray(plan?.writes)) throw Error('Original conditional domain plan required');
  for (const change of plan.writes) {
    const id = change.after?._id, identity = change.collection + ':' + id;
    if (!allowed.has(change.collection) || !Array.isArray(result[change.collection]) || !id || seen.has(identity)
      || change.after.company !== company) throw Error('Domain after-image scope conflict');
    seen.add(identity);
    const matches = result[change.collection].filter(r => r._id === id);
    if (matches.length > 1 || JSON.stringify(matches[0] || null) !== JSON.stringify(change.before)) throw Error('Exact domain before-image required');
    result[change.collection] = result[change.collection].filter(r => r._id !== id).concat(copy(change.after));
  }
  return result;
}
function projectDomainAfter({ company, staff, tables, plan, projectPurchaseWorkspace }) {
  if (typeof projectPurchaseWorkspace !== 'function') throw Error('Original Purchase projector required');
  const next = domainAfterSnapshot({ company, tables, plan }), [orders, tasks] = domainCollections(company), activity = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  return { ...projectPurchaseWorkspace({ company, staff, orders: next[orders], tasks: next[tasks], activity: next[activity], suppliers: next.SharedSuppliers }), activity: next[activity] };
}
module.exports = { domainAfterSnapshot, projectDomainAfter };
