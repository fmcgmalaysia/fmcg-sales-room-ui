import { randomBytes } from 'crypto';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { taskEditVersion } from 'backend/purchaseTaskIdentity.js';
import { calculateGrossProfitMargin, calculateNetCartonCost } from 'backend/grossProfitMargin.js';
const finite = value => typeof value === 'number' && Number.isFinite(value);
// GP is a backend read cache. Financial consumers must refresh open transactions.
// The future Sales Co invoice save must acquire GP_LOCK and COST_LOCK and freeze
// GP, FX and financial amounts together; a bare invoice number is not a lock snapshot.
export function createPurchaseMarginRefresh({ store, readRates, now = () => new Date() }) {
  return async ({ company, names, orders, tasks, workspace }) => {
    const results = new Map(), open = [];
    for (const row of workspace.tasks) {
      const order = orders.find(item => item.title === row.orderId && item.sourceLineId === row.sourceLineId);
      const task = tasks.find(item => item.title === row.id);
      if (!order || !task) continue;
      if (String(order.salesInvoiceNumber || '').trim()) {
        results.set(row.id, String(order.financialLockedBy || '').trim() && finite(order.gp) ? order.gp : null);
      } else open.push({ row, order, task });
    }
    let rates;
    try { rates = open.length ? await readRates([...new Set(open.map(({ order }) => order.transactionCurrency))]) : []; }
    catch (_) { for (const { row } of open) results.set(row.id, null); return results; }
    for (const { row, order, task } of open) {
      const matches = rates.filter(rate => rate.currency === order.transactionCurrency);
      const rate = matches.length === 1 ? matches[0] : null, cost = calculateNetCartonCost(task);
      const gp = calculateGrossProfitMargin({ sellingPricePc: order.sellingPricePc, eaPerCtn: order.orderId, netCostCtn: cost, rateToMyr: rate?.rateToMyr });
      results.set(row.id, gp);
      if (gp === null || (order.gp === gp && order.adminFxSource === rate.rateToMyr)) continue;
      const lockId = operationId(company, task.title, 'GP_LOCK'), requestId = randomBytes(16).toString('hex');
      let held = false;
      try {
        if (await store.read(names.activity, lockId) || await store.read(names.activity, operationId(company, task.title, 'COST_LOCK'))) { results.set(row.id, null); continue; }
        await store.insert(names.activity, { _id: lockId, title: lockId, description: order.title, activityTime: now(), details: { requestId, actorMemberId: 'SYSTEM_GP' } });
        held = true;
        const currentTask = await store.read(names.tasks, task._id), currentOrder = await store.read(names.orders, order._id);
        if (!currentTask || !currentOrder || taskEditVersion(currentTask) !== taskEditVersion(task) ||
            currentOrder.title !== order.title || currentOrder.sourceLineId !== order.sourceLineId || currentOrder.customerId !== order.customerId ||
            String(currentOrder.salesInvoiceNumber || '').trim() || currentOrder.sellingPricePc !== order.sellingPricePc ||
            currentOrder.orderId !== order.orderId || currentOrder.transactionCurrency !== order.transactionCurrency) { results.set(row.id, null); continue; }
        const at = now(), eventId = operationId(company, requestId, 'GP');
        // Preserve evidence before caching. No customer-facing selling/FX fields are projected.
        await store.insert(names.activity, { _id: eventId, title: eventId, description: order.title, image: order.sourceLineId, imageAltText: task.title,
          action: 'GP_RECALCULATED', result: 'CALCULATED', actorType: 'SYSTEM', activityTime: at,
          message: 'Open transaction margin calculated with current Admin FX', details: { requestId, before: { gp: currentOrder.gp ?? null, rateToMyr: currentOrder.adminFxSource ?? null },
            after: { gp, rateToMyr: rate.rateToMyr }, currency: order.transactionCurrency, fxUpdatedAt: rate.updatedAt || null, netCostCtn: cost } });
        await store.update(names.orders, { ...currentOrder, gp, adminFxSource: rate.rateToMyr });
      } catch (_) { results.set(row.id, null); }
      finally { if (held) { try { const lock = await store.read(names.activity, lockId); if (lock?.details?.requestId === requestId) await store.remove(names.activity, lockId); } catch (_) { results.set(row.id, null); } } }
    }
    return results;
  };
}
