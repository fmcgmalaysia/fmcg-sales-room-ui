import { projectOrderOutlook, outlookContextAt, outlookPeriod } from 'backend/financeInventoryOutlook.js';
import { projectStockValuationPage } from 'backend/stockValuationService.js';
import { operationId } from 'backend/purchaseOperationJournal.js';

export function closingShipmentMonth(company, asOf, now) {
  const end = outlookPeriod(company, asOf, String(asOf).slice(0,7));
  const nextDay = new Date(end + 8 * 3600000).toISOString().slice(0,10);
  if (!nextDay.endsWith('-01') || !Number.isFinite(now.getTime()) || now.getTime() < end)
    throw Error('Select a completed month.');
  return nextDay.slice(0,7);
}

export function prepareOriginalMonthEnd(raw, company, asOf, now) {
  const shipmentMonth = closingShipmentMonth(company, asOf, now);
  if (raw.company !== company) throw Error('Stock company mismatch.');
  const {context,orderRows} = outlookContextAt(raw, asOf, shipmentMonth);
  const outlook = projectOrderOutlook(company, asOf, shipmentMonth, context, orderRows);
  const closedAt = now.toISOString();
  const products = [];
  let cursor = null, totals;
  do {
    const page = projectStockValuationPage(context, {pageSize:100,cursor}, closedAt);
    if (!page.summary.valuation.complete || page.counts.reviewProducts)
      throw Error('Reconcile stock quantities and costs before confirming the closing balance.');
    totals = page.summary;
    products.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  const report = {company, asOf, totals, products, outlook};
  return {report, revision:operationId(report)};
}

// The archive adapter commits one immutable original per company and closing date.
export async function confirmOriginalMonthEnd({company, asOf, closedBy, now, archive, readRows, revision}) {
  closingShipmentMonth(company, asOf, now);
  if (typeof closedBy !== 'string' || !closedBy.trim()) throw Error('Finance identity required.');
  const existing = await archive.read(company, asOf);
  if (existing) return existing;
  const prepared = prepareOriginalMonthEnd(await readRows(company), company, asOf, now);
  if (revision !== undefined && revision !== prepared.revision) throw Error('Closing balance changed. Review it again.');
  return archive.insertOriginal({...prepared.report,closedAt:now.toISOString(),closedBy,version:1});
}
