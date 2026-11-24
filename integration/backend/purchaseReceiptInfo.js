// Read-only Purchase detail. Warehouse's validated receipt chain remains the authority.
import { readWarehouseReceipts } from 'backend/warehouseReceiving.js';

export function purchaseReceiptInfo(purchaseOrders, activity) {
  const byTask = new Map();
  for (const po of purchaseOrders) {
    const receivedTasks = new Set();
    for (const event of readWarehouseReceipts(po.id, activity).history) {
      for (const line of event.details.lines) {
        if (!po.taskIds.includes(line.taskId)) continue;
        const rows = byTask.get(line.taskId) || [];
        rows.push({ id: event.title, poId: po.id, po: po.number,
          at: new Date(event.activityTime).toISOString(), by: event.initiatedByStaffName || '',
          kind: line.kind, received: line.accepted - line.beforeAccepted,
          rejected: line.rejected - line.beforeRejected, totalReceived: line.accepted,
          reason: typeof line.reason === 'string' ? line.reason.trim() : '',
          shortfall: Number.isSafeInteger(line.planned) && line.planned >= line.accepted ? line.planned - line.accepted : null,
          followUp: receivedTasks.has(line.taskId) });
        if (line.kind !== 'CORRECTION') receivedTasks.add(line.taskId);
        byTask.set(line.taskId, rows);
      }
    }
  }
  return byTask;
}
