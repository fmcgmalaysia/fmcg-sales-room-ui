import { FULFILMENT_ACTION, readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';

const readOptions = { suppressAuth: true, consistentRead: true };

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date;
}

export function createLastInvoicedPrices(wixData) {
  return async function readLastInvoicedPrices(customerId, selections) {
    const barcodes = new Set(selections.map(row => row.barcode));
    if (!barcodes.size) return new Map();
    const history = await Promise.all(Object.entries(PURCHASE_COLLECTIONS).map(async ([company, { activity }]) => {
      const events = [];
      let page = await wixData.query(activity).eq('image', customerId).eq('action', FULFILMENT_ACTION)
        .eq('result', 'SAVED').limit(1000).find(readOptions);
      while (true) {
        events.push(...page.items);
        if (!page.hasNext()) break;
        page = await page.next();
      }
      return readCustomerShipments(events).filter(row => row.company === company && row.customerId === customerId);
    }));
    const latest = new Map();
    for (const shipment of history.flat()) {
      const invoice = shipment.invoice;
      if (!['INVOICED', 'DISPATCHED'].includes(shipment.status) || !validDate(invoice?.date) ||
          !/^[A-Z]{3}$/.test(invoice.currency)) continue;
      const issued = Number.isFinite(Date.parse(invoice.at)) ? new Date(invoice.at).toISOString() : '';
      for (const line of shipment.lines) {
        if (!barcodes.has(line.barcode) || !Number.isFinite(line.sellingPriceCtn) || line.sellingPriceCtn <= 0) continue;
        const key = invoice.date + '|' + issued;
        const price = { priceCtn: line.sellingPriceCtn, currency: invoice.currency, siDate: invoice.date };
        const previous = latest.get(line.barcode);
        if (!previous || key > previous.key) latest.set(line.barcode, { key, price });
        else if (key === previous.key &&
          (previous.price?.priceCtn !== price.priceCtn || previous.price?.currency !== price.currency)) {
          previous.price = null;
        }
      }
    }
    return new Map([...latest].filter(([, entry]) => entry.price).map(([barcode, entry]) => [barcode, entry.price]));
  };
}
