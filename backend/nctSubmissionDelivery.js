import { buildNctSubmission } from './nctSubmissionPayload.js';

const clone = value => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function verifiedReceipt(receipt, body) {
  if (receipt?.ok !== true || receipt.destination !== 'NCT' || receipt.orderId !== body.orderId ||
      receipt.submissionId !== body.submissionId || typeof receipt.receiptId !== 'string' || !receipt.receiptId ||
      !Number.isFinite(Date.parse(receipt.masterReceivedAt)) || !Array.isArray(receipt.taskIds) ||
      receipt.taskIds.length !== body.lines.length || new Set(receipt.taskIds).size !== body.lines.length ||
      receipt.taskIds.some(id => typeof id !== 'string' || !id) ||
      !Number.isSafeInteger(receipt.costErrorTaskCount) || receipt.costErrorTaskCount < 0 ||
      receipt.costErrorTaskCount > body.lines.length) throw new Error('Master has not confirmed complete receipt. Retry Submit to NCT for this same order.');
  return clone(receipt);
}

/** Backend only. The caller must run existing active staff/customer authorization on EVERY call.
 * The adapter uses the existing ORDER-LOCK key so Buyer additions and Sales edits are blocked
 * while an uncertain delivery is outstanding. It never replaces another workflow's lock.
 */
export function createNctSubmissionDelivery({ store, loadSnapshot, deliver, now = () => new Date() }) {
  return async function submit({ orderId, staff, authorizeCustomer }) {
    const initial = await store.readOrder(orderId);
    if (!initial || initial.data.orderId !== orderId || initial.data.receiptOnly) throw new Error('Open the active order, not its addition receipt.');
    await authorizeCustomer(initial.data.customerId);
    if (initial.data.masterReceipt) {
      if (initial.data.destination !== 'NCT' || !initial.data.nctSubmissionBody) throw new Error('Stored Master receipt identity conflict.');
      const receipt = verifiedReceipt(initial.data.masterReceipt, initial.data.nctSubmissionBody);
      await store.releaseOwnLock(orderId, receipt.submissionId);
      return receipt;
    }
    if (initial.data.destination || initial.data.submittedAt) throw new Error('Order has already been transferred.');
    let lock, created = false;
    const proposal = { action: 'ORDER_MUTATION_LOCK', source: 'NCT MASTER INTAKE',
      orderId, customerId: initial.data.customerId, at: now().toISOString(), preparedBody: null };
    try { lock = await store.insertLock(orderId, proposal); created = true; }
    catch (error) { lock = await store.readLock(orderId); if (!lock) throw error; }
    if (lock.source !== 'NCT MASTER INTAKE' || lock.orderId !== orderId ||
        lock.customerId !== initial.data.customerId || (!created && !lock.preparedBody)) {
      throw new Error('This order is being updated or prepared. Retry this same order shortly.');
    }
    let body = lock.preparedBody, preparedWriteStarted = false;
    if (created) {
      try {
        const current = await store.readOrder(orderId);
        if (!current || current.data.customerId !== initial.data.customerId) throw new Error('Order identity changed.');
        const snapshot = await loadSnapshot(current.data);
        body = buildNctSubmission({ ...snapshot, order: current.data, staff,
          submittedAt: lock.at, submissionId: 'NCT-' + orderId });
        preparedWriteStarted = true;
        await store.savePrepared(orderId, { ...lock, preparedBody: clone(body) });
        // A confirmed readback is required BEFORE any request can reach Master.
        const saved = await store.readLock(orderId);
        if (!same(saved?.preparedBody, body)) throw new Error('The submission snapshot was not saved.');
      } catch (error) {
        // An uncertain snapshot write may already be visible to another retry. Never erase it.
        if (!preparedWriteStarted) await store.releaseOwnLock(orderId, '');
        else {
          try {
            const saved = await store.readLock(orderId);
            if (saved && !saved.preparedBody && saved.source === 'NCT MASTER INTAKE') {
              await store.releaseOwnLock(orderId, '');
            }
          } catch (_) { /* Preserve the lock until a confirmed read is available. */ }
        }
        throw error;
      }
    }
    body = clone(body);
    if (body.orderId !== orderId || body.customerId !== initial.data.customerId) throw new Error('Prepared submission identity conflict.');
    let receipt;
    try { receipt = verifiedReceipt(await deliver(body), body); }
    catch (error) {
      // Keep the saved snapshot and existing mutation lock. Do not guess whether Master received it.
      throw new Error('Master receipt is not confirmed. The order and its submitted quantities are preserved. Retry Submit to NCT for this same order.');
    }
    await store.writeAcceptedAuditOnce(body, receipt);
    await store.saveTransferred(orderId, body, receipt);
    await store.releaseOwnLock(orderId, body.submissionId);
    return receipt;
  };
}
