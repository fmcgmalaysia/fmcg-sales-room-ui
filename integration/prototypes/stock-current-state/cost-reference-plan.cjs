'use strict';

const { domainCollections } = require('./domain-scope.cjs');
const { hash } = require('./commit-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const taskFields = new Set(['lpPc', 'lpCtn', 'disc1', 'disc2', 'disc3', 'latestCostReference', 'costStatus', 'costErrorReason', 'lastCostCaptureTime']);
const events = new Set(['COST_RETRY_LOCK', 'COST_RETRY_ATTEMPT', 'COST_RETRY_CAPTURED', 'COST_RETRY_RESULT']);

// Trusted server composition only, NOT browser admission/auth or a live store.
// Run the ORIGINAL reference-only workflow against a private overlay. Collect its
// exact final writes for the common fence; never run its TTL lock deletion live.
async function prepareCostReference({ createPurchaseCostRetry, request, tables, captureCosts, now }) {
  const {Buffer}=require('node:buffer');
  const company = request?.company, [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const allowed = new Set([orders, tasks, journal]);
  if (typeof createPurchaseCostRetry !== 'function' || typeof captureCosts !== 'function' || typeof now !== 'function'
    || !tables || Object.keys(tables).some(c => !allowed.has(c)) || [...allowed].some(c => !Array.isArray(tables[c]))) throw Error('Complete private cost reference snapshot required');
  const initial = new Map(), overlay = new Map(), writes = new Map(), privateLocks = new Set();
  for (const c of allowed) for (const row of tables[c]) {
    const key = c + ':' + row._id;
    if (!row._id || initial.has(key) || row.company && row.company !== company) throw Error('Cost reference snapshot identity conflict');
    initial.set(key, copy(row)); overlay.set(key, copy(row));
  }
  // Existing old executions cannot be fenced by age. Require operational recovery,
  // even when the ORIGINAL retry would consider the old per-task lock expired.
  const lockId = hash(company, request.taskId, 'COST_LOCK');
  if (overlay.has(journal + ':' + lockId)) throw Error('Existing cost retry lock requires recovery; no TTL takeover');
  const target = initial.get(tasks + ':' + request.taskId);
  if (!target || target.company !== company || !target._version) throw Error('Exact migrated cost task required');
  const scope = c => { if (!allowed.has(c)) throw Error('Cost reference scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(overlay.get(c + ':' + id) || null); },
    one: async (c, criteria) => {
      scope(c); const matches = [...overlay.entries()].filter(([id, row]) => id.startsWith(c + ':') && Object.entries(criteria).every(([k, v]) => row[k] === v));
      if (matches.length > 1) throw Error('Duplicate cost reference record'); return copy(matches[0]?.[1] || null);
    },
    insert: async (c, row) => {
      scope(c); const key = c + ':' + row._id;
      if (c !== journal || !events.has(row.action) || row._id !== row.title || row.imageAltText !== request.taskId
        || row.description !== target.description || row.initiatedByStaffId !== request.staff?.staffId || overlay.has(key)) throw Error('Unexpected cost reference event');
      overlay.set(key, copy(row));
      if (row.action === 'COST_RETRY_LOCK') privateLocks.add(key);
      else writes.set(key, { collection: c, before: null, after: { ...copy(row), company } });
      return copy(row);
    },
    update: async (c, row) => {
      scope(c); const key = c + ':' + row._id, before = initial.get(key);
      if (!before || before.company !== company || !before._version || ![orders, tasks].includes(c)
        || c === tasks && row._id !== target._id || c === orders && (before.title !== target.description || before.sourceLineId !== target.imageAltText)) throw Error('Exact migrated cost domain row required');
      const permitted = c === tasks ? taskFields : new Set(['cbmCtn']);
      const fixed = value => Object.fromEntries(Object.entries(value).filter(([field]) => !permitted.has(field)));
      if (!same(fixed(before), fixed(row))) throw Error('Cost reference cannot change stock, PO, identity or other business fields');
      overlay.set(key, copy(row)); writes.set(key, { collection: c, before: copy(before), after: copy(row) }); return copy(row);
    },
    remove: async (c, id) => {
      scope(c); const key = c + ':' + id;
      if (c !== journal || !privateLocks.has(key) || overlay.get(key)?.action !== 'COST_RETRY_LOCK') throw Error('Only newly simulated cost lock may be removed');
      overlay.delete(key); privateLocks.delete(key);
    }
  };
  // Failed original executions are not promoted into successful plans. Their
  // error/audit orchestration remains an explicit integration requirement.
  const outcome = await createPurchaseCostRetry({ store, captureCosts, now })(copy(request));
  if (privateLocks.size || writes.size > 30 || Buffer.byteLength(JSON.stringify([...writes.values()])) > 180000) throw Error('Cost reference atomic boundary exceeded');
  return { plan: { writes: [...writes.values()] }, outcome: copy(outcome), replay: writes.size === 0 };
}
module.exports = { prepareCostReference };
