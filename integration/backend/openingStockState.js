import { stockPosition } from 'backend/inventoryExceptions.js';
import { operationId } from 'backend/purchaseOperationJournal.js';

export const OPENING_STOCK_POSTED = 'OPENING_STOCK_POSTED';
export const OPENING_STOCK_COST_CONFIRMED = 'OPENING_STOCK_COST_CONFIRMED';
export const openingStockId = (company, barcode) => operationId('OPENING_STOCK', company, barcode);
export const isOpeningBarcode = value => typeof value === 'string' && /^\d{6,24}$/.test(value);
export const isOpeningQuantity = value => Number.isSafeInteger(value) && value >= 0 && value <= 999999;
export const isOpeningAddition = value => isOpeningQuantity(value) && value <= 9999;
export const isOpeningCost = value => Number.isSafeInteger(value) && value > 0 && value <= 9999999999;

export function readOpeningStock(company, activity) {
  const entries = new Map();
  const costEntries = [];
  for (const event of activity) {
    if (event.result !== 'SAVED' || ![OPENING_STOCK_POSTED, OPENING_STOCK_COST_CONFIRMED].includes(event.action)) continue;
    const fact = event.details;
    if (!fact || fact.company !== company || !isOpeningBarcode(fact.barcode) ||
        event.imageAltText !== openingStockId(company, fact.barcode) || !event.initiatedByStaffId ||
        !Number.isFinite(Date.parse(event.activityTime))) throw Error('Opening stock record requires review.');
    if (event.action === OPENING_STOCK_COST_CONFIRMED) {
      costEntries.push(event);
      continue;
    }
    if (entries.has(fact.barcode) || !fact.name || !fact.packing || !isOpeningQuantity(fact.ea) || !fact.ea ||
        !isOpeningQuantity(fact.counted) || !isOpeningQuantity(fact.before) ||
        !isOpeningAddition(fact.added) || fact.counted - fact.before !== fact.added ||
        (fact.unitCostScaled !== null && !isOpeningCost(fact.unitCostScaled)) ||
        (!fact.added && fact.unitCostScaled !== null) || !fact.reference || !Number.isFinite(Date.parse(fact.countedAt))) {
      throw Error('Opening stock record requires review.');
    }
    entries.set(fact.barcode, { ...fact, id: event.imageAltText, recordedAt: new Date(event.activityTime).toISOString() });
  }
  for (const event of costEntries) {
    const { barcode, unitCostScaled, reference } = event.details;
    const opening = entries.get(barcode);
    if (!opening?.added || opening.unitCostScaled !== null || !isOpeningCost(unitCostScaled) || !reference) {
      throw Error('Opening stock valuation record requires review.');
    }
    opening.unitCostScaled = unitCostScaled;
  }
  return entries;
}

// Keep opening balances out of customer demand, supplier P.O.s and payment review.
// These derived sources use the existing physical outflow and allocation records.
export function projectOpeningStockSources(company, activity) {
  return [...readOpeningStock(company, activity).values()].map(entry => ({
    id: entry.id, orderId: '', sourceLineId: entry.id, customerId: '', name: entry.name,
    barcode: entry.barcode, packing: entry.packing, ea: entry.ea, specialPurchase: true,
    openingStock: true, archived: true, history: [], requested: 0, ord: 0,
    procurement: { totalCtn: 0, customerCtn: 0, expectedExtra: 0 },
    warehouse: { accepted: entry.added, hasPhysicalReceipt: true, stock: stockPosition(entry.id, entry.added, activity) },
    netCostCtn: entry.unitCostScaled === null ? null : entry.unitCostScaled / 10000,
    costCurrency: 'MYR'
  }));
}
