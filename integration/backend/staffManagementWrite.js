import wixData from 'wix-data';

const collection = 'StaffMasterAccess';
const lockId = 'staff-management-write-lock';
const readOptions = { suppressAuth: true, consistentRead: true };
const writeOptions = { suppressAuth: true };

export async function readStaffSaveStatus() {
  const locks = await wixData.query(collection).eq('_id', lockId).limit(1).find(readOptions);
  const lock = locks.items[0];
  if (!lock) return { state: 'CLEAR' };
  const result = await wixData.query(collection).eq('staffManagementRequestId', lock.requestId).limit(2).find(readOptions);
  const row = result.items[0];
  const confirmed = result.items.length === 1 && row.staffManagementFingerprint === lock.fingerprint;
  return { state: confirmed ? 'CONFIRMED_LOCK_HELD' : 'UNCONFIRMED', requestId: lock.requestId };
}

// One short-lived serialization record, in the existing employee collection.
// No timeout-based lock stealing: a delayed write must not race a newer grant.
// An uncertain write retains the lock. Only the invocation which inserted the
// lock may release it; a retry can read the result but cannot release another
// invocation's lock. No Activity entries are created. Request markers replace
// fields on the employee row rather than accumulating request-history rows.
export async function writeStaffManagement({ requestId, fingerprint, actorId, prepare, project }) {
  if (!/^[a-f0-9-]{36}$/i.test(String(requestId ?? '')) || !actorId || !fingerprint) {
    throw Error('Invalid employee save request.');
  }
  const lock = { _id: lockId, staffStatus: 'CONTROL', requestId, fingerprint, actorId };
  try {
    await wixData.insert(collection, lock, writeOptions);
  } catch (error) {
    const held = await wixData.get(collection, lockId, readOptions);
    if (!held || held.requestId !== requestId || held.actorId !== actorId || held.fingerprint !== fingerprint) {
      throw Error('Another employee change is being confirmed. Reload before saving again.');
    }
    const result = await wixData.query(collection).eq('staffManagementRequestId', requestId).limit(2).find(readOptions);
    if (result.items.length !== 1 || result.items[0].staffManagementFingerprint !== fingerprint) {
      throw Error('This employee change is awaiting confirmation. Do not create a replacement request.');
    }
    return project(result.items[0]);
  }
  let proposed, priorResult;
  try {
    const prior = await wixData.query(collection).eq('staffManagementRequestId', requestId).limit(2).find(readOptions);
    if (prior.items.length) {
      if (prior.items.length !== 1 || prior.items[0].staffManagementFingerprint !== fingerprint) throw Error('Employee request does not match its saved result.');
      priorResult = project(prior.items[0]);
    } else {
      proposed = await prepare();
    }
  } catch (error) {
    await wixData.remove(collection, lockId, writeOptions);
    throw error;
  }
  if (priorResult) {
    await wixData.remove(collection, lockId, writeOptions);
    return priorResult;
  }
  const row = { ...proposed.row, staffManagementRequestId: requestId, staffManagementFingerprint: fingerprint };
  // Keep the lock if the service cannot confirm whether a write committed.
  let confirmed;
  try {
    const saved = proposed.insert
      ? await wixData.insert(collection, row, writeOptions)
      : await wixData.update(collection, row, writeOptions);
    confirmed = await wixData.get(collection, saved._id, readOptions);
  } catch {
    // A lost write response is not proof of failure. The original owner may
    // confirm its exact row and finish; it must never repeat the write here.
    try { confirmed = await wixData.get(collection, row._id, readOptions); }
    catch { throw Error('Employee save is awaiting confirmation. Retry the same request.'); }
  }
  if (confirmed?.staffManagementRequestId !== requestId || confirmed.staffManagementFingerprint !== fingerprint) {
    throw Error('Employee save is awaiting confirmation. Retry the same request.');
  }
  await wixData.remove(collection, lockId, writeOptions);
  return project(confirmed);
}
