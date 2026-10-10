import { createHash } from 'crypto';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
const clone = value => JSON.parse(JSON.stringify(value));
const id = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
const priceFields = ['lpPc', 'lpCtn', 'disc1', 'disc2', 'disc3'];
export function createPurchaseCostRetry({ store, captureCosts, now = () => new Date() }) {
  async function once(collection, record) {
    const found = await store.read(collection, record._id); if (found) return found;
    try { return await store.insert(collection, record); }
    catch (error) { const saved = await store.read(collection, record._id); if (!saved) throw error; return saved; }
  }
  return async ({ company, taskId, requestId, staff }) => {
    const names = PURCHASE_COLLECTIONS[company];
    if (!names || !/^[a-f0-9]{32}$/.test(taskId || '') || !/^[a-f0-9-]{36}$/i.test(requestId || '') ||
        !staff?.staffId || !staff.staffName || !staff.memberId) throw Error('Verified task, employee and retry identity are required.');
    const task = await store.read(names.tasks, taskId); if (!task || task.title !== taskId) throw Error('Task not found.');
    const order = await store.one(names.orders, { title: task.description, sourceLineId: task.imageAltText });
    if (order?.salesInvoiceNumber) throw Error('Customer invoice has locked this transaction.');
    const receipt = await store.one(names.activity, { description: task.description, action: 'ORDER_RECEIVED', result: 'ACCEPTED' });
    if (!order || receipt?.details?.submissionId !== order.submissionId || !receipt.details.taskIds?.includes(taskId)) throw Error('Master receipt is not complete.');
    const base = [company, taskId, requestId, staff.memberId], resultId = id(...base, 'RESULT'), lockId = id(company, taskId, 'COST_LOCK');
    const prior = await store.read(names.activity, resultId);
    if (prior?.details?.outcome) return clone(prior.details.outcome);
    const at = now().toISOString(), active = await store.read(names.activity, lockId);
    if (active && new Date(active.activityTime).getTime() + 120000 > now().getTime()) throw Error('Cost retry is still processing. Refresh this task before trying again.');
    if (active) await store.remove(names.activity, lockId);
    const event = (kind, eventId, details, result, message) => ({ _id: eventId, title: eventId, description: task.description,
      image: task.imageAltText, imageAltText: taskId, action: kind, activityTime: new Date(at), actorType: 'STAFF',
      initiatedByStaffId: staff.staffId, initiatedByStaffName: staff.staffName, result, message,
      details: { requestId, actorMemberId: staff.memberId, ...details } });
    await store.insert(names.activity, event('COST_RETRY_LOCK', lockId, {}, 'PROCESSING', 'One task cost retry in progress'));
    try {
      await once(names.activity, event('COST_RETRY_ATTEMPT', id(...base, 'ATTEMPT'), {}, 'REQUESTED', 'POINTBASE reference requested for this task only'));
      const captureId = id(...base, 'CAPTURE'); let captured = await store.read(names.activity, captureId);
      if (!captured) {
        const map = await captureCosts([order.description]), cost = map?.[order.description];
        if (!cost || cost.unitBarcode !== order.description || cost.costCurrency !== 'MYR' ||
            !['CAPTURED','ERROR'].includes(cost.costStatus) || !Array.isArray(cost.costIssues) || !Number.isFinite(Date.parse(cost.capturedAt))) throw Error('POINTBASE_RESULT_INVALID');
        captured = await once(names.activity, event('COST_RETRY_CAPTURED', captureId, { snapshot: clone(cost) }, cost.costStatus, cost.costIssues.join('; ') || 'Reference captured'));
      }
      const cost = captured.details.snapshot, current = await store.read(names.tasks, taskId);
      if (!current || current.description !== task.description || current.imageAltText !== task.imageAltText) throw Error('Task identity changed.');
      const changed = [], retained = [], updates = { ...current, latestCostReference: clone(cost), costStatus: cost.costStatus,
        costErrorReason: cost.costIssues.join('; '), lastCostCaptureTime: new Date(cost.capturedAt) };
      const manual = Array.isArray(current.manualCostField) ? current.manualCostField : [];
      for (const field of priceFields) {
        // Reference-only for existing prices. Fill only initial unavailable and still-empty fields.
        if (current[field] == null && current.originalCostSnapshot?.[field] == null && !manual.includes(field) && typeof cost[field] === 'number' && Number.isFinite(cost[field])) {
          updates[field] = cost[field]; changed.push(field);
        } else retained.push(field);
      }
      await store.update(names.tasks, updates);
      if (order.cbmCtn == null && typeof cost.cbmPerCtn === 'number' && cost.cbmPerCtn > 0) {
        const freshOrder = await store.read(names.orders, order._id);
        if (freshOrder?.cbmCtn == null) { await store.update(names.orders, { ...freshOrder, cbmCtn: cost.cbmPerCtn }); changed.push('cbmCtn'); }
      }
      const outcome = { ok: true, requestId, company, taskId, costStatus: cost.costStatus, costIssues: [...cost.costIssues],
        capturedAt: cost.capturedAt, changedFields: changed, retainedFields: retained };
      await once(names.activity, event('COST_RETRY_RESULT', resultId, { outcome }, 'RECORDED',
        'POINTBASE reference refreshed; existing prices preserved. Filled: ' + (changed.join(', ') || 'none')));
      return outcome;
    } catch (error) {
      const code = /^POINTBASE_[A-Z0-9_]+$/.test(String(error?.code || error?.message || '')) ? String(error.code || error.message) : 'COST_RETRY_SAVE_FAILED';
      await once(names.activity, event('COST_RETRY_RESULT', resultId, { outcome: { ok:false, requestId, company, taskId, error:code } }, 'FAILED', code));
      throw error;
    } finally { await store.remove(names.activity, lockId); }
  };
}
