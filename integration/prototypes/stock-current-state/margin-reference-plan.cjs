'use strict';

const { domainCollections } = require('./domain-scope.cjs');
const { hash } = require('./commit-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const cacheFields = new Set(['gp', 'adminFxSource', 'salesInvoiceSummary']);

// Private composition of ORIGINAL margin refresh, not an authenticated gateway or
// replacement GP formula. Results requiring a write must not be exposed as committed
// before the common fence succeeds. No legacy GP lock is ever deleted in real storage.
async function prepareMarginReference({ createPurchaseMarginRefresh, company, tables, workspace, readRates, now }) {
  const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const allowed = new Set([orders, tasks, journal]);
  if (typeof createPurchaseMarginRefresh !== 'function' || typeof readRates !== 'function' || typeof now !== 'function'
    || workspace?.company !== company || !Array.isArray(workspace.tasks) || !tables
    || Object.keys(tables).some(c => !allowed.has(c)) || [...allowed].some(c => !Array.isArray(tables[c]))) throw Error('Complete private margin context required');
  const initial = new Map(), overlay = new Map(), writes = new Map(), privateLocks = new Set(), audits = new Map(), updated = new Set();
  let violation;
  function refuse(message) { violation ||= new Error(message); throw violation; }
  for (const c of allowed) for (const row of tables[c]) {
    const key = c + ':' + row._id;
    if (!row._id || initial.has(key) || row.company && row.company !== company
      || c !== journal && (row.company !== company || !row._version)) throw Error('Exact migrated margin snapshot required');
    initial.set(key, copy(row)); overlay.set(key, copy(row));
  }
  const scope = c => { if (!allowed.has(c)) refuse('Margin context scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(overlay.get(c + ':' + id) || null); },
    insert: async (c, row) => {
      scope(c); const key = c + ':' + row._id;
      if (c !== journal || !row._id || row._id !== row.title || overlay.has(key)) refuse('Unexpected margin insert');
      if (row.action === undefined) {
        const task = tables[tasks].find(t => hash(company, t.title, 'GP_LOCK') === row._id);
        if (!task || row.description !== task.description || row.details?.actorMemberId !== 'SYSTEM_GP' || !row.details.requestId) refuse('Unexpected margin lock');
        privateLocks.add(key);
      } else {
        const task = tables[tasks].find(t => t.title === row.imageAltText);
        if (row.action !== 'GP_RECALCULATED' || row.result !== 'CALCULATED' || row.actorType !== 'SYSTEM' || !task
          || row.description !== task.description || row.image !== task.imageAltText
          || !privateLocks.has(journal + ':' + hash(company, task.title, 'GP_LOCK'))
          || !Number.isFinite(row.details?.after?.gp)) refuse('Unexpected margin audit');
        audits.set(key, copy(row)); writes.set(key, { collection: c, before: null, after: { ...copy(row), company } });
      }
      overlay.set(key, copy(row)); return copy(row);
    },
    update: async (c, row) => {
      scope(c); const key = c + ':' + row._id, before = initial.get(key);
      if (c !== orders || !before || before.company !== company || !before._version) refuse('Only exact margin order cache may change');
      const fixed = value => Object.fromEntries(Object.entries(value).filter(([field]) => !cacheFields.has(field)));
      if (!same(fixed(before), fixed(row))) refuse('Margin cannot change price, identity, invoice lock or quantity');
      const matches = [...audits.entries()].filter(([, event]) => event.description === before.title && event.image === before.sourceLineId
        && event.details.after.gp === row.gp && event.details.after.rateToMyr === row.adminFxSource);
      if (matches.length !== 1 || updated.has(matches[0][0])) refuse('Exact preceding margin evidence required');
      updated.add(matches[0][0]); overlay.set(key, copy(row)); writes.set(key, { collection: c, before: copy(before), after: copy(row) }); return copy(row);
    },
    remove: async (c, id) => {
      scope(c); const key = c + ':' + id;
      if (c !== journal || !privateLocks.has(key)) refuse('Only newly simulated margin lock may be removed');
      overlay.delete(key); privateLocks.delete(key);
    }
  };
  const results = await createPurchaseMarginRefresh({ store, readRates, now })({ company, names: { orders, tasks, activity: journal },
    orders: copy(tables[orders]), tasks: copy(tables[tasks]), activity: copy(tables[journal]), workspace: copy(workspace) });
  // ORIGINAL refresh intentionally catches cache failures. A rejected adapter write
  // must still invalidate the WHOLE private plan, never publish orphan audit evidence.
  if (violation) throw violation;
  if (privateLocks.size || audits.size !== updated.size || typeof results?.entries !== 'function'
    || writes.size > 30 || Buffer.byteLength(JSON.stringify({ writes: [...writes.values()] })) > 180000) throw Error('Complete bounded margin plan required');
  return { plan: { writes: [...writes.values()] }, results: [...results.entries()], mustCommit: writes.size > 0,
    activationReady: false, blockers: ['ORIGINAL_AUTH_READ_GATEWAY_REQUIRED', 'PRODUCTION_MARGIN_CAPACITY_REQUIRED'] };
}
// The ORIGINAL cache already saves each demand line independently. Preserve that
// boundary for a busy workroom instead of turning its entire read into one giant
// transaction. A group MUST retain all original supplier children of its mother.
async function prepareMarginReferenceGroup(args) {
  const target = args.workspace?.tasks?.filter(t => t.id === args.targetTaskId && !t.procurementSource);
  if (target?.length !== 1) throw Error('Exact original margin demand group required');
  const tasks = args.workspace.tasks.filter(t => t.id === args.targetTaskId || t.customerDemandTaskId === args.targetTaskId);
  return prepareMarginReference({ ...args, workspace: { ...args.workspace, tasks } });
}
module.exports = { prepareMarginReference, prepareMarginReferenceGroup };
