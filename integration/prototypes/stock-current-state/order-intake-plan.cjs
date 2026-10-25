'use strict';

const { domainCollections } = require('./domain-scope.cjs');
const { hash } = require('./commit-proof.cjs');
const { appendIntakeProductCheckpoints } = require('./intake-product-checkpoint.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
// Candidate ONLY after original nctReceiver authentication. This is not an HTTP
// gateway and possession of a payload is NOT proof of the intake shared secret.
async function prepareOrderIntake({ createNctIntake, createNctReceiptReader, company, body, tables, captureCosts, now,
  planFormat = 'PROOF_V1', generation, productRows }) {
  const {Buffer}=require('node:buffer');
  if (!['PROOF_V1', 'SEGMENTED_V2'].includes(planFormat) || planFormat === 'SEGMENTED_V2' && (!Number.isSafeInteger(generation) || generation < 0 || !Number.isSafeInteger(generation + 1))) throw Error('Server intake protocol/generation required');
  const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const opposite = company === 'NCT' ? 'GHR' : 'NCT', otherJournal = opposite === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const allowed = new Set([orders, tasks, journal, otherJournal]);
  if (body?.destination !== company || typeof createNctIntake !== 'function' || typeof createNctReceiptReader !== 'function'
    || typeof captureCosts !== 'function' || typeof now !== 'function' || !tables
    || Object.keys(tables).some(c => !allowed.has(c)) || [...allowed].some(c => !Array.isArray(tables[c]))) throw Error('Complete private intake snapshot required');
  const overlay = new Map(), writes = [];
  for (const c of allowed) for (const row of tables[c]) {
    const key = c + ':' + row._id, expectedCompany = c === otherJournal ? opposite : company;
    if (!row._id || overlay.has(key) || row.company && row.company !== expectedCompany) throw Error('Intake snapshot scope/identity conflict');
    overlay.set(key, copy(row));
  }
  const permittedEvents = new Set(['INTAKE_PREPARED', 'COST_CAPTURE', 'ORDER_RECEIVED']);
  const store = {
    read: async (c, id) => { if (!allowed.has(c)) throw Error('Intake read scope violation'); return copy(overlay.get(c + ':' + id) || null); },
    insert: async (c, row) => {
      const key = c + ':' + row._id;
      if (![orders, tasks, journal].includes(c) || !row._id || overlay.has(key)
        || c === journal && !permittedEvents.has(row.action)
        || c === orders && (row.title !== body.orderId || row.customerId !== body.customerId || row.submissionId !== body.submissionId)
        || c === tasks && row.description !== body.orderId
        || c === journal && row.description !== body.orderId) throw Error('Unexpected original intake insert');
      const proposed = { ...copy(row), company };
      // The original validator has already checked the date-only source value.
      // Preserve the existing CMS Date field, not a midnight DateTime conversion.
      if (c === orders) proposed.estimatedShipmentDate = body.estimatedShipmentDate || null;
      if (c === tasks && planFormat === 'SEGMENTED_V2') Object.assign(proposed, {
        stockCounterSchema: 2, stockDispatchedCumulative: 0, stockCounterGeneration: generation + 1 });
      overlay.set(key, proposed); writes.push({ collection: c, before: null, after: proposed }); return copy(proposed);
    }
  };
  // ORIGINAL core validates identity/quote/FX/date, reuses durable captured costs,
  // preserves existing task manual edits, and inserts ORDER_RECEIVED last.
  const outcome = await createNctIntake({ store, captureCosts, now })(copy(body));
  const receipt = await createNctReceiptReader({ store })(copy(body));
  if (JSON.stringify(outcome) !== JSON.stringify(receipt) || outcome.ok !== true
    || writes.length && writes.at(-1).after.action !== 'ORDER_RECEIVED'
    || writes.length > (planFormat === 'SEGMENTED_V2' ? 10000 : 30)
    || Buffer.byteLength(JSON.stringify({ writes })) > (planFormat === 'SEGMENTED_V2' ? 8 * 1024 * 1024 : 180000)) throw Error('Complete bounded original intake receipt required');
  const taskRows = outcome.taskIds.map(id => overlay.get(tasks + ':' + id));
  if (taskRows.some(row => !row || row.description !== body.orderId)
    || writes.some(w => w.collection === tasks && (!outcome.taskIds.includes(w.after._id) || w.after.receivedQtyInCtn !== null
      || w.after.ourPoNumber !== '' || w.after.supplierId !== ''))) throw Error('Original initial task identity required');
  const plan = planFormat === 'SEGMENTED_V2' ? appendIntakeProductCheckpoints({ company, body, plan: { writes }, productRows, generation }) : { writes };
  return { plan, outcome: copy(outcome), replay: writes.length === 0,
    // Company fence cannot serialize a concurrent opposite-company intake. Real
    // immutable routing/cross-company arbitration still requires proof before live.
    activationReady: false, blockers: ['ORIGINAL_AUTH_GATEWAY_REQUIRED', 'CROSS_COMPANY_ROUTING_PROOF_REQUIRED', 'PRODUCTION_INTAKE_CAPACITY_REQUIRED'] };
}
function intakeProtocolIdentity({ sourceSiteId, orderId, destination }) {
  if (sourceSiteId !== '5292b63a-30e5-4c0e-8762-a1b127bbc651' || typeof orderId !== 'string' || !orderId.trim()
    || !['NCT', 'GHR'].includes(destination)) throw Error('Original intake identity required');
  const digest = hash('ORDER_INTAKE', sourceSiteId, orderId, destination);
  return { requestId: digest.slice(0, 8) + '-' + digest.slice(8, 12) + '-4' + digest.slice(13, 16) + '-8' + digest.slice(17, 20) + '-' + digest.slice(20),
    memberId: 'INTERNAL_ORDER_INTAKE:' + sourceSiteId };
}
module.exports = { prepareOrderIntake, intakeProtocolIdentity };
