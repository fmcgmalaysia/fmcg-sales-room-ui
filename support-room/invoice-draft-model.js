(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SupportInvoiceDraft = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const whole = value => Number.isSafeInteger(value) && value >= 0;
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const metric = (value, qty, scale) => typeof value === 'number' && Number.isFinite(value) && value > 0
    && Number.isSafeInteger(Math.round(value * scale) * qty) ? Math.round(value * scale) * qty : null;
  const mergeKey = row => JSON.stringify([row.company, row.customerId, row.invoicePartyKey, row.currency, row.shipmentGroup]);

  // Candidate contract only. Inputs must eventually come from an authenticated
  // server projection and delivery-batch invoice coverage, not browser calculations.
  function projectRows(input) {
    if (!input || !['NCT', 'GHR'].includes(input.company) || !Array.isArray(input.rows)) throw Error('Company task rows are required.');
    const seen = new Set();
    return input.rows.map(source => {
      if (!text(source.id) || seen.has(source.id)) throw Error('Duplicate or missing delivery task identity.');
      seen.add(source.id);
      if (source.company !== input.company) throw Error('Company mismatch.');
      const issues = [];
      if (![source.customerId, source.invoicePartyKey, source.currency, source.shipmentGroup, source.warehouseVersion, source.invoiceCoverageVersion].every(text)
        || !/^[A-Z]{3}$/.test(source.currency || '')) issues.push('IDENTITY_INCOMPLETE');
      if (![source.taskQty, source.loadedQty, source.invoicedQty, source.pendingInvoiceQty].every(whole)
        || source.loadedQty > source.taskQty) issues.push('QUANTITY_REQUIRES_REVIEW');
      const used = source.invoicedQty + source.pendingInvoiceQty;
      if (whole(used) && whole(source.loadedQty) && used > source.loadedQty) issues.push('LOADED_BELOW_INVOICE_COVERAGE');
      if (source.stale === true || source.orphaned === true) issues.push('WAREHOUSE_TASK_CHANGED');
      if (source.loadedConfirmed !== true && source.loadedQty > 0) issues.push('LOADING_NOT_CONFIRMED');
      const invoiceQty = issues.length ? null : source.loadedQty - used;
      const selectable = !issues.length && invoiceQty > 0;
      const cbmMicro = selectable ? metric(source.cbmPerCtn, invoiceQty, 1000000) : null;
      const netWeightGrams = selectable ? metric(source.netWeightKgPerCtn, invoiceQty, 1000) : null;
      const amountCents = selectable && whole(source.sellingPriceCtnCents) && source.sellingPriceCtnCents > 0
        && Number.isSafeInteger(invoiceQty * source.sellingPriceCtnCents) ? invoiceQty * source.sellingPriceCtnCents : null;
      const missing = selectable ? [cbmMicro === null && 'CBM', netWeightGrams === null && 'NET_WEIGHT', amountCents === null && 'PRICE'].filter(Boolean) : [];
      const status = issues.length ? 'REVIEW' : source.loadedQty === 0 ? 'WAIT_LOADING'
        : invoiceQty === 0 ? source.pendingInvoiceQty > 0 ? 'INVOICE_PENDING' : 'INVOICED'
          : missing.length ? 'NEEDS_DATA' : 'READY';
      return { ...source, invoiceQty, selectable, cbmMicro, netWeightGrams, amountCents, missing, issues, status, mergeKey: mergeKey(source) };
    });
  }

  function buildDraft(rows, selectedIds, versions) {
    if (!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length) throw Error('Select distinct loaded rows.');
    const selected = selectedIds.map(id => {
      const matches = rows.filter(row => row.id === id);
      if (matches.length !== 1 || !matches[0].selectable) throw Error('Selected loading row is no longer eligible.');
      const row = matches[0];
      // A selection must retain its original loading and invoice-coverage version.
      if (versions?.[id] !== row.warehouseVersion || versions?.[id + ':invoice'] !== row.invoiceCoverageVersion) {
        throw Error('Loading or invoiced quantity changed. Reselect the row.');
      }
      return row;
    });
    if (new Set(selected.map(row => row.mergeKey)).size !== 1) throw Error('Select the same company, customer, bill-to, currency and shipment.');
    const sum = key => selected.some(row => row[key] === null) ? null : selected.reduce((total, row) => total + row[key], 0);
    const first = selected[0], amountCents = sum('amountCents'), cbmMicro = sum('cbmMicro'), netWeightGrams = sum('netWeightGrams');
    if ([amountCents, cbmMicro, netWeightGrams].some(value => value !== null && !Number.isSafeInteger(value))) throw Error('Invoice totals exceed the supported quantity.');
    return { company: first.company, customerId: first.customerId, customerName: first.customerName, currency: first.currency,
      shipmentGroup: first.shipmentGroup, invoicePartyKey: first.invoicePartyKey,
      lines: selected.map(row => ({ ...row })), quantity: selected.reduce((sum, row) => sum + row.invoiceQty, 0),
      amountCents, cbmMicro, netWeightGrams, canPreview: amountCents !== null && cbmMicro !== null && netWeightGrams !== null,
      missing: [...new Set(selected.flatMap(row => row.missing))] };
  }
  return { projectRows, buildDraft, mergeKey };
});
