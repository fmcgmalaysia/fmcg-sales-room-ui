'use strict';
const { hash } = require('./commit-proof.cjs');
const { same } = require('./segmented-plan.cjs');

// Add ONE absent maintenance control. Never changes an existing LEGACY/ACTIVE
// control, acquires/releases a lock, retries an unknown insert, or enables writes.
function createMaintenanceControlInitializer({ company, store, authenticateAdmin, verifyLegacyDrain,
  verifyPrivateRetention, verifyControlSchema }) {
  if (!['NCT', 'GHR'].includes(company) || ['read', 'insert'].some(key => typeof store?.[key] !== 'function')
    || [authenticateAdmin, verifyLegacyDrain, verifyPrivateRetention, verifyControlSchema].some(fn => typeof fn !== 'function')) {
    throw Error('Actual private maintenance initialization dependencies required');
  }
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const id = hash(company, 'STOCK_CONTROL'), lockId = hash(company + '/PURCHASE', 'LOCK');
  function request(input) {
    if (!input || Object.keys(input).join(',') !== 'requestId' || !/^[a-f0-9-]{36}$/i.test(input.requestId || '')) throw Error('Original maintenance initialization request required');
  }
  async function authorize(owner) {
    const admin = await authenticateAdmin();
    if (admin?.isAdmin !== true || typeof admin.memberId !== 'string' || !admin.memberId || owner && owner !== admin.memberId) throw Error('Actual maintenance administrator required');
    if (await verifyLegacyDrain({ company, purpose: 'INITIALIZE_MAINTENANCE_CONTROL' }) !== true) throw Error('Legacy request drain is not verified');
    if (await verifyPrivateRetention({ company, collection: journal }) !== true) throw Error('Private native control retention is not verified');
    if (await verifyControlSchema({ company, collection: journal }) !== true) throw Error('Native maintenance control fields are not verified');
    return admin.memberId;
  }
  const original = (input, memberId) => ({ _id: id, company, mode: 'MAINTENANCE', schemaVersion: 1,
    transferIndexVersion: 2, generation: 0, pending: null,
    _version: hash(company, 'MAINTENANCE_CONTROL_V1', input.requestId, memberId) });
  async function read(expected) {
    // Absence of a lock is only an additional conflict check, NEVER drain proof.
    if (await store.read(journal, lockId) !== null) throw Error('Existing business lock requires review; never release');
    const actual = await store.read(journal, id);
    if (actual !== null && !same(actual, expected)) throw Error('Existing control differs; never overwrite or change mode');
    return actual;
  }
  async function inspect(input) {
    request(input); const memberId = await authorize(), expected = original(input, memberId), actual = await read(expected);
    await authorize(memberId);
    return { company, controlId: id, requestId: input.requestId, initialized: actual !== null,
      mode: actual ? 'MAINTENANCE' : null, activationReady: false };
  }
  async function initialize(input) {
    request(input); const memberId = await authorize(), expected = original(input, memberId), before = await read(expected);
    await authorize(memberId);
    const fresh = await read(expected);
    if (!same(before, fresh)) throw Error('Maintenance initialization boundary changed');
    if (fresh === null) await store.insert(journal, expected);
    // Unknown outcomes propagate immediately. Only a later explicit inspection
    // of the SAME request can confirm ownership; no automatic resubmission.
    if (!same(await read(expected), expected)) throw Error('Maintenance control insert unconfirmed');
    await authorize(memberId);
    return { company, controlId: id, requestId: input.requestId, initialized: true,
      created: fresh === null, mode: 'MAINTENANCE', activationReady: false };
  }
  return { initialize, inspect };
}
module.exports = { createMaintenanceControlInitializer };
