// Install only in the FMCGMALAYSIA source site backend. Existing auth and payload writers are injected.
import wixData from 'wix-data';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import { createHash } from 'crypto';
import { createNctSubmissionDelivery } from 'backend/nctSubmissionDelivery.js';

const ORDERS = 'WixBuyerOrders', LINES = 'WixBuyerOrderLines', AUDIT = 'WixOrderAudit';
const MASTER_ENDPOINT = 'https://fmcg999.wixstudio.com/master/_functions/nctIntake';
const options = { suppressAuth: true, consistentRead: true };
const text = value => String(value == null ? '' : value).trim();
const data = row => row ? JSON.parse(row.payload) : null;
const lockId = id => 'ORDER-LOCK-' + id;
async function one(collection, field, value) {
  const result = await wixData.query(collection).eq(field, value).limit(2).find(options);
  if (result.items.length > 1) throw new Error('Duplicate operational record. Admin review is required.');
  return result.items[0] || null;
}
async function ownLock(id) {
  const record = await one(AUDIT, '_id', lockId(id));
  return { record, value: data(record) };
}

export async function submitNctSalesOrder({ orderId, staff, authorizeCustomer, readPayloadRows, putPayload, lockedOrderEntry, initialError }) {
  const id = text(orderId);
  if (!id || !text(staff?.staffId) || !text(staff.staffName)) throw new Error('Verified order and staff are required.');
  let firstRead = true;
  const store = {
    async readOrder(key) {
      if (firstRead && lockedOrderEntry) { firstRead = false; return lockedOrderEntry; }
      firstRead = false;
      const matches = (await readPayloadRows(ORDERS)).filter(row => text(row.data.orderId) === key);
      if (matches.length > 1) throw new Error('Duplicate operational order. Admin review is required.');
      return matches[0] || null;
    },
    async readLock(key) { return (await ownLock(key)).value; },
    async insertLock(key, proposal) {
      if (lockedOrderEntry) {
        // The protected withSalesOrderMutation already acquired this exact ordinary Sales lock.
        const current = await ownLock(key);
        if (!current.record || current.value.action !== 'ORDER_MUTATION_LOCK' || current.value.source ||
            current.value.orderId !== key || current.value.customerId !== proposal.customerId) throw new Error('Existing Sales lock changed.');
        const record = await wixData.update(AUDIT, { ...current.record, payload: JSON.stringify(proposal) }, { suppressAuth: true });
        return data(record);
      }
      const record = await wixData.insert(AUDIT, {
        _id: lockId(key), title: lockId(key), payload: JSON.stringify(proposal)
      }, { suppressAuth: true });
      return data(record);
    },
    async savePrepared(key, proposal) {
      const current = await ownLock(key);
      if (!current.record || current.value.source !== 'NCT MASTER INTAKE' || current.value.orderId !== key ||
          current.value.customerId !== proposal.customerId || current.value.preparedBody) throw new Error('Submission lock changed.');
      await wixData.update(AUDIT, { ...current.record, payload: JSON.stringify(proposal) }, { suppressAuth: true });
    },
    async releaseOwnLock(key, submissionId) {
      if (lockedOrderEntry) return; // The original Sales wrapper owns cleanup for this call.
      const current = await ownLock(key);
      if (!current.record) return;
      if (current.value.source !== 'NCT MASTER INTAKE' || current.value.orderId !== key ||
          (current.value.preparedBody && current.value.preparedBody.submissionId !== submissionId)) return;
      await wixData.remove(AUDIT, current.record._id, { suppressAuth: true });
    },
    async writeAcceptedAuditOnce(body, receipt) {
      const eventId = 'NCT-SUBMITTED-' + createHash('sha256').update(body.orderId).digest('hex').slice(0, 32);
      const proposed = { auditId: eventId, action: 'ORDER_SUBMITTED', orderId: body.orderId,
        customerId: body.customerId, at: body.submittedAt, actorStaffId: body.submittedByStaffId,
        actorName: body.submittedByStaffName, actorEmail: body.submittedByEmail,
        detail: { destination: 'NCT', submissionId: body.submissionId, masterReceipt: receipt,
          submittedFxSnapshot: body.fxRate, transactionCurrency: body.transactionCurrency } };
      let existing = await one(AUDIT, '_id', eventId);
      if (!existing) {
        try { existing = await wixData.insert(AUDIT, { _id: eventId, title: eventId,
          payload: JSON.stringify(proposed) }, { suppressAuth: true }); }
        catch (error) { existing = await one(AUDIT, '_id', eventId); if (!existing) throw error; }
      }
      const saved = data(existing);
      if (saved.orderId !== body.orderId || saved.detail?.submissionId !== body.submissionId ||
          saved.detail?.masterReceipt?.receiptId !== receipt.receiptId) throw new Error('Submission audit identity conflict.');
    },
    async saveTransferred(key, body, receipt) {
      const current = await store.readOrder(key);
      if (!current || current.data.customerId !== body.customerId) throw new Error('Source order identity changed.');
      if (current.data.masterReceipt) {
        if (current.data.masterReceipt.receiptId !== receipt.receiptId) throw new Error('Source receipt conflict.');
        return;
      }
      if (current.data.destination || current.data.submittedAt) throw new Error('Order was transferred without this receipt.');
      await putPayload(ORDERS, current.record.title, { ...current.data, status: 'SUBMITTED TO NCT',
        destination: 'NCT', submittedAt: body.submittedAt, submittedBy: body.submittedByEmail,
        submittedByStaffId: body.submittedByStaffId, submittedByStaffName: body.submittedByStaffName,
        nctSubmissionBody: body, masterReceipt: receipt });
    }
  };
  const submit = createNctSubmissionDelivery({ store,
    async loadSnapshot(order) {
      const currency = text(order.currency).toUpperCase();
      const [rateResult, lineRows, auditRows] = await Promise.all([
        wixData.query('WixFxRates').eq('currency', currency).limit(2).find(options),
        readPayloadRows(LINES), readPayloadRows(AUDIT)
      ]);
      if (rateResult.items.length !== 1 || rateResult.items[0].active !== true) throw new Error('Current Admin FX rate is unavailable.');
      return { currentAdminRate: rateResult.items[0],
        lines: lineRows.map(row => row.data).filter(line => text(line.orderId) === id && !line.addedToOrderId)
          .sort((a, b) => text(a.lineId).localeCompare(text(b.lineId))),
        history: auditRows.map(row => row.data).filter(event => text(event.orderId) === id && event.action !== 'ORDER_MUTATION_LOCK') };
    },
    async deliver(body) {
      const secret = await getSecret('MASTER_INTAKE_SHARED_SECRET');
      if (!secret) throw new Error('Master intake credential is not configured.');
      const result = await fetch(MASTER_ENDPOINT, { method: 'post', headers: {
        'Content-Type': 'application/json', Authorization: 'Bearer ' + secret
      }, body: JSON.stringify(body) });
      if (!result.ok) throw new Error('Master did not acknowledge this submission.');
      return result.json();
    }
  });
  if (initialError) {
    // A regular Buyer/Sales lock is never bypassed. Only an existing NCT snapshot or receipt can resume.
    const current = await ownLock(id), order = await store.readOrder(id);
    if (!(current.value?.source === 'NCT MASTER INTAKE' && current.value.preparedBody) && !order?.data.masterReceipt) throw initialError;
  }
  try { return await submit({ orderId: id, staff, authorizeCustomer }); }
  catch (error) {
    if (lockedOrderEntry) {
      try { error.keepOrderMutationLock = Boolean((await ownLock(id)).value?.preparedBody); }
      catch (_) { error.keepOrderMutationLock = true; }
    }
    throw error;
  }
}
