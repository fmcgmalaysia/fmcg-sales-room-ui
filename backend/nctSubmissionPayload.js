/** Internal source backend mapper. Call only after existing staff/customer authorization. */
const text = value => String(value == null ? '' : value).trim();
const clone = value => JSON.parse(JSON.stringify(value));
export function buildNctSubmission({ order, lines, staff, currentAdminRate, submittedAt, submissionId, history }) {
  if (!order || order.receiptOnly || order.isComplete !== true ||
      !['CONFIRMED', 'PROFORMA REQUESTED'].includes(text(order.status).toUpperCase())) throw new Error('Open a complete, unsubmitted order.');
  if (order.destination || order.submittedAt) throw new Error('Order has already been transferred.');
  const currency = text(order.currency).toUpperCase();
  if (text(currentAdminRate?.currency).toUpperCase() !== currency || currentAdminRate.active === false ||
      !Number.isFinite(currentAdminRate.rateToMyr) || currentAdminRate.rateToMyr <= 0) throw new Error('Current Admin FX rate is unavailable.');
  if (!text(staff?.staffId) || !text(staff.staffName || staff.title) || !text(submissionId) ||
      !Number.isFinite(Date.parse(submittedAt))) throw new Error('Verified submitting staff and stable submission identity are required.');
  if (!Array.isArray(lines) || !lines.length) throw new Error('No submitted product lines.');
  const mapped = lines.map(line => {
    if (text(line.orderId) !== text(order.orderId) || text(line.customerId) !== text(order.customerId) || line.addedToOrderId) throw new Error('Order line identity mismatch.');
    const qty = line.effectiveRequestedQtyCtn ?? line.requestedQtyCtn ?? line.quantityCtn;
    const ea = line.eaPerCtn, pc = line.lockedUnitPriceEa;
    if (!Number.isSafeInteger(qty) || qty < 0 || !Number.isSafeInteger(ea) || ea <= 0 ||
        !Number.isFinite(pc) || pc <= 0) throw new Error('Order line requires its locked EA, selling price per piece and current carton quantity.');
    if (text(line.currency).toUpperCase() !== currency) throw new Error('Order line transaction currency mismatch.');
    return { sourceLineId: text(line.lineId), unitBarcode: text(line.barcode), itemName: text(line.itemName),
      packingSize: text(line.packingSize), eaPerCtn: ea, qtyCtn: qty, sellingPricePc: pc };
  }).filter(line => line.qtyCtn > 0);
  if (!mapped.length) throw new Error('All order lines have zero quantity.');
  return {
    sourceSiteId: '5292b63a-30e5-4c0e-8762-a1b127bbc651', destination: 'NCT',
    orderId: text(order.orderId), customerId: text(order.customerId), customerCompanyName: text(order.companyName),
    submissionId: text(submissionId), submittedAt, submittedByStaffId: text(staff.staffId),
    submittedByStaffName: text(staff.staffName || staff.title), submittedByEmail: text(staff.loginEmail), transactionCurrency: currency,
    fxRate: currentAdminRate.rateToMyr, customerPoNumber: text(order.customerPoNumber),
    estimatedShipmentDate: text(order.estimatedShipmentDate), buyerReceivedBy: text(order.confirmedBy), lines: mapped,
    sourceSnapshot: { order: clone(order), lines: clone(lines), history: clone(history || []), adminFx: clone(currentAdminRate) }
  };
}
