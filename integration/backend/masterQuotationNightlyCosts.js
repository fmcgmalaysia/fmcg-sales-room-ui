const batchSize = 100;

export function createQuotationNightlyCosts({ readCustomers, readSelections, readCosts, refreshCosts, now = () => new Date() }) {
  return async function runNightlyCosts() {
    const runDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' }).format(now());
    const customers = await readCustomers();
    const groups = [];
    const barcodes = new Set();
    const result = { customers: 0, updated: 0, unchanged: 0, pending: 0, failed: 0, failedCustomers: 0 };
    for (const { customerId } of customers) {
      try {
        const rows = await readSelections(customerId);
        if (!Array.isArray(rows) || rows.some(row => row.customerId !== customerId || row.removed ||
            !/^[0-9]{6,22}$/.test(row.barcode))) throw Error('Invalid scheduled quotation selection.');
        if (!rows.length) continue;
        groups.push({ customerId, rows });
        for (const row of rows) barcodes.add(row.barcode);
      } catch { result.failedCustomers++; }
    }
    const ids = [...barcodes];
    const costs = new Map();
    for (let index = 0; index < ids.length; index += batchSize) {
      const batch = ids.slice(index, index + batchSize);
      try {
        const matched = await readCosts(batch);
        for (const barcode of batch) if (Object.hasOwn(matched, barcode)) costs.set(barcode, matched[barcode]);
      } catch { /* A failed batch retains the last known costs for those products. */ }
    }
    for (const group of groups) {
      try {
        const counts = await refreshCosts({ ...group, costs, runDay });
        for (const key of ['updated', 'unchanged', 'pending', 'failed']) result[key] += counts[key];
        result.customers++;
      } catch { result.failedCustomers++; }
    }
    return result;
  };
}
