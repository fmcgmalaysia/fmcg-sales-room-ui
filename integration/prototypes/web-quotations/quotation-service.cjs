const number = value => typeof value === 'number' && Number.isFinite(value);
const round = value => Number(value.toFixed(6));
const copy = value => structuredClone(value);

// The prototype adapter supplies persistence, verified staff, Point Base and
// the existing customer publication boundary. No credentials enter the page.
function createQuotationService({ state, save, policy, calculateGrossProfitMargin, selections, customers, readCosts, deliver }) {
  let queue = Promise.resolve();
  function serial(action) {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  }
  function authorize(actor, customerId, action) {
    const customer = customers().find(row => row.customerId === customerId);
    if (!customer || !policy.canEnterDepartment(actor, 'SALES MANAGEMENT', action === 'VIEW' ? 'VIEW' : 'EDIT', customer.company) ||
        !policy.canUseSalesRoomCustomer(actor, action, customerId)) throw Error('You do not have access to this quotation.');
    return customer;
  }
  function rowsFor(customerId) {
    return selections(customerId).map(item => {
      const key = customerId + '|' + item.id;
      return { ...item, ...(state.quotes[key] || { revision: 0, costMyr: null, draft: null, published: null, pending: null }) };
    });
  }
  function find(customerId, selectionId) {
    const row = rowsFor(customerId).find(item => item.id === selectionId);
    if (!row) throw Error('This product is no longer in the customer selection.');
    return row;
  }
  function store(customerId, row) {
    state.quotes[customerId + '|' + row.id] = copy(row);
    save();
  }
  function pricing(row, customer, input) {
    if (!number(input.value)) throw Error('Enter a valid number.');
    if (!Number.isSafeInteger(row.ea) || row.ea <= 0) throw Error('Packing quantity is unavailable.');
    if (!number(customer.rateToMyr) || customer.rateToMyr <= 0) throw Error('The currency rate is unavailable.');
    let priceEa;
    if (input.mode === 'GP') {
      if (input.value >= 100) throw Error('Target GP must be below 100%.');
      if (!number(row.costMyr) || row.costMyr <= 0) throw Error('Catch Cost before setting Target GP.');
      priceEa = row.costMyr / (1 - input.value / 100) / customer.rateToMyr / row.ea;
    } else if (input.mode === 'EA') priceEa = input.value;
    else if (input.mode === 'CTN') priceEa = input.value / row.ea;
    else throw Error('Select Target GP, unit price or carton price.');
    priceEa = round(priceEa);
    if (!number(priceEa) || priceEa <= 0) throw Error('The selling price must be greater than zero.');
    const priceCtn = round(priceEa * row.ea);
    const gp = calculateGrossProfitMargin({ sellingPricePc: priceEa, eaPerCtn: row.ea, netCostCtn: row.costMyr, rateToMyr: customer.rateToMyr });
    return { mode: input.mode, value: input.value, priceEa, priceCtn, gp: gp === null ? null : round(gp * 100), currency: customer.preferredCurrency };
  }
  function requireRevision(row, revision) {
    if (row.pending) throw Error('The previous quote is being confirmed. Your changes are retained.');
    if (row.revision !== revision) throw Error('This product has changed. Review the latest values before saving.');
  }
  function operationId(requestId) {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(requestId)) throw Error('A valid request ID is required.');
  }
  function receipt(actor, customerId, requestId, body) {
    operationId(requestId);
    const fingerprint = JSON.stringify([actor._id, customerId, body]);
    const prior = state.receipts[requestId];
    if (prior && prior.fingerprint !== fingerprint) throw Error('This request ID has different contents.');
    return { fingerprint, prior };
  }
  async function finishPending(customerId, row) {
    const pending = row.pending;
    if (!pending) return;
    await deliver(copy(pending.packet));
    if (pending.published.enabled && row.published?.priceCtn > 0 &&
        (row.published.priceCtn !== pending.published.priceCtn || row.published.currency !== pending.published.currency)) {
      row.previousSp = { priceCtn: row.published.priceCtn, currency: row.published.currency };
    }
    row.published = pending.published;
    row.pending = null;
    row.revision++;
    state.receipts[pending.requestId] = { fingerprint: pending.fingerprint, result: { ok: true, revision: row.revision } };
    store(customerId, row);
  }
  return {
    list(actor, customerId) {
      const customer = authorize(actor, customerId, 'VIEW');
      const canEdit = policy.canEnterDepartment(actor, 'SALES MANAGEMENT', 'EDIT', customer.company) && policy.canUseSalesRoomCustomer(actor, 'EDIT_QUOTATION', customerId);
      return copy({ customer, canEdit, rows: rowsFor(customerId).map(row => {
        const liveGp = row.published?.enabled ? calculateGrossProfitMargin({ sellingPricePc: row.published.priceEa, eaPerCtn: row.ea, netCostCtn: row.costMyr, rateToMyr: customer.rateToMyr }) : null;
        return { ...row, publishedGp: liveGp === null ? null : round(liveGp * 100), pending: Boolean(row.pending) };
      }) });
    },
    catchCost(actor, customerId) {
      return serial(async () => {
        const customer = authorize(actor, customerId, 'EDIT_QUOTATION');
        const rows = rowsFor(customerId);
        const results = await readCosts([...new Set(rows.map(row => row.barcode))]);
        let updated = 0, failed = 0, pending = 0;
        for (const row of rows) {
          if (row.pending) { pending++; continue; }
          const cost = results[row.barcode];
          if (!cost || !number(cost.netCostCtn) || cost.netCostCtn <= 0) {
            row.costError = cost?.error || 'Cost could not be confirmed. Previous cost retained.';
            failed++;
          } else {
            row.costMyr = cost.netCostCtn;
            row.costDetails = cost.details || null;
            row.costAt = cost.at;
            row.costError = '';
            if (row.draft) row.draft = pricing(row, customer, row.draft);
            updated++;
          }
          row.revision++;
          store(customerId, row);
        }
        return { ok: failed === 0, updated, failed, pending };
      });
    },
    saveDraft(actor, customerId, selectionId, input, revision, requestId) {
      return serial(async () => {
        const customer = authorize(actor, customerId, 'EDIT_QUOTATION');
        const checked = receipt(actor, customerId, requestId, ['DRAFT', selectionId, input, revision]);
        if (checked.prior) return checked.prior.result;
        const row = find(customerId, selectionId);
        requireRevision(row, revision);
        const draft = pricing(row, customer, input);
        if (JSON.stringify(draft) !== JSON.stringify(row.draft)) { row.draft = draft; row.revision++; }
        const result = { ok: true, revision: row.revision };
        state.receipts[requestId] = { fingerprint: checked.fingerprint, result };
        store(customerId, row);
        return result;
      });
    },
    publish(actor, customerId, selectionId, enabled, revision, requestId) {
      return serial(async () => {
        const customer = authorize(actor, customerId, 'PUBLISH_QUOTATION');
        if (typeof enabled !== 'boolean') throw Error('Choose whether this quote is visible.');
        const checked = receipt(actor, customerId, requestId, ['PUBLISH', selectionId, enabled, revision]);
        if (checked.prior) return checked.prior.result;
        const row = find(customerId, selectionId);
        if (row.pending?.requestId === requestId && row.pending.fingerprint === checked.fingerprint) {
          await finishPending(customerId, row);
          return state.receipts[requestId].result;
        }
        requireRevision(row, revision);
        if (enabled && (!row.draft || !number(row.costMyr) || row.costMyr <= 0)) throw Error('Catch Cost and enter a selling price first.');
        const draft = enabled ? pricing(row, customer, row.draft) : row.published;
        const version = (row.published?.version || 0) + 1;
        const published = { enabled, priceEa: draft?.priceEa || 0, priceCtn: draft?.priceCtn || 0, currency: customer.preferredCurrency, version };
        const packet = { customerId, selectionId, unitBarcode: row.barcode, enabled, priceEa: published.priceEa,
          priceCtn: published.priceCtn, currency: published.currency, version, requestId, at: new Date().toISOString() };
        row.pending = { requestId, fingerprint: checked.fingerprint, packet, published };
        store(customerId, row);
        try { await finishPending(customerId, row); }
        catch (_) { return { ok: false, pending: true, message: 'Confirming the quotation. Your request is retained.' }; }
        return state.receipts[requestId].result;
      });
    },
    recover() {
      return serial(async () => {
        let remaining = 0;
        for (const stored of Object.values(state.quotes)) {
          if (!stored.pending) continue;
          const row = copy(stored);
          try { await finishPending(row.pending.packet.customerId, row); } catch (_) { remaining++; }
        }
        return remaining;
      });
    }
  };
}

module.exports = { createQuotationService };
