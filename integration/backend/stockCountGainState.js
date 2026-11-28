const reportAction = 'STOCK_COUNT_GAIN_REPORTED';
const confirmAction = 'STOCK_COUNT_GAIN_CONFIRMED';

export const stockCountGainActions = { report: reportAction, confirm: confirmAction };

function wholeCartons(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function readStockCountGains(activity) {
  const reports = new Map();
  const approvals = new Map();
  for (const event of activity) {
    if (event.result !== 'SAVED' || ![reportAction, confirmAction].includes(event.action)) continue;
    const data = event.details;
    if (!event.title || !event.imageAltText || !event.initiatedByStaffId || !data ||
        !['NCT', 'GHR'].includes(data.company) || !Number.isFinite(Date.parse(event.activityTime))) {
      throw Error('Stock count gain record requires review.');
    }
    const fact = { ...data, sourceTaskId: event.imageAltText, staffId: event.initiatedByStaffId,
      staffName: event.initiatedByStaffName, at: new Date(event.activityTime).toISOString() };
    if (event.action === reportAction) {
      if (reports.has(event.title) || !wholeCartons(data.onHand) || !wholeCartons(data.counted) ||
          data.counted <= data.onHand || data.counted - data.onHand > 9999 || !data.barcode || !data.po ||
          !data.reference || !data.reason || !data.stockVersion) throw Error('Stock count report requires review.');
      reports.set(event.title, { ...fact, id: event.title, quantity: data.counted - data.onHand });
    } else {
      if (!data.reportId || approvals.has(data.reportId) || !Number.isSafeInteger(data.valueCents) ||
          data.valueCents <= 0 || !Number.isFinite(data.unitCost) || data.unitCost <= 0 ||
          !wholeCartons(data.quantity) || data.quantity === 0 ||
          Math.round(data.unitCost * data.quantity * 100) !== data.valueCents || !data.reason) {
        throw Error('Stock count gain confirmation requires review.');
      }
      approvals.set(data.reportId, { ...fact, id: event.title });
    }
  }
  for (const approval of approvals.values()) {
    const report = reports.get(approval.reportId);
    if (!report || approval.company !== report.company || approval.sourceTaskId !== report.sourceTaskId ||
        approval.quantity !== report.quantity) {
      throw Error('Stock count gain has no matching report.');
    }
  }
  return [...reports.values()].map(report => ({ ...report, approval: approvals.get(report.id) ?? null }));
}
