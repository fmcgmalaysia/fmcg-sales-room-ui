import { createHash, randomUUID } from 'crypto';
import { calculateGrossProfitMargin, calculateNetCartonCost } from 'backend/grossProfitMargin.js';

const blank = { costMyr: null, draft: null, published: null, pending: null };
const round = value => Number(value.toFixed(6));
const digest = (...fields) => createHash('sha256').update(JSON.stringify(fields)).digest('hex');
const positive = value => Number.isFinite(value) && value > 0;
const requestKey = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

function validateCommand(command) {
  if (typeof command?.selectionId !== 'string' || !/^[a-z\d_-]{1,120}$/i.test(command.selectionId) ||
      !Number.isSafeInteger(command.revision) || command.revision < 0 || command.revision > Number.MAX_SAFE_INTEGER - 2 ||
      typeof command.requestId !== 'string' || !requestKey.test(command.requestId)) throw Error('Invalid quotation command.');
}

function calculatePrice({ mode, value }, selection, customer, snapshot) {
  const { ea } = selection;
  const { rateToMyr, preferredCurrency: currency } = customer;
  if (!Number.isFinite(value) || !Number.isSafeInteger(ea) || ea < 1 || !positive(rateToMyr) || !/^[A-Z]{3}$/.test(currency)) {
    throw Error('Confirm the unit price, carton packing and exchange rate.');
  }
  if (!['EA', 'GP'].includes(mode) || (mode === 'GP' && (value >= 100 || !positive(snapshot.costMyr)))) {
    throw Error('Catch Cost and enter a Target GP below 100%.');
  }
  const priceEa = round(mode === 'EA' ? value : snapshot.costMyr / (1 - value / 100) / rateToMyr / ea);
  const priceCtn = round(priceEa * ea);
  if (!positive(priceEa) || !positive(priceCtn)) throw Error('Enter a valid selling price.');
  const gp = calculateGrossProfitMargin({ sellingPricePc: priceEa, eaPerCtn: ea, netCostCtn: snapshot.costMyr, rateToMyr });
  return { mode, value, priceEa, priceCtn, currency, gp: gp === null ? null : round(gp * 100) };
}

function rowSnapshot(row, cost) {
  const valid = cost?.costStatus === 'CAPTURED' && cost.unitBarcode === row.barcode && cost.costCurrency === 'MYR' &&
    Number.isFinite(Date.parse(cost.capturedAt)) && positive(cost.lpPc);
  const costMyr = valid ? calculateNetCartonCost(cost) : null;
  if (!positive(costMyr)) return { costError: 'Point Base cost unavailable. Previous cost retained.' };
  return { costMyr, costAt: cost.capturedAt, costError: '', costDetails: {
    lpEa: cost.lpPc, lpCtn: cost.lpCtn, disc1: cost.disc1 * 100, disc2: cost.disc2 * 100, disc3: cost.disc3,
    remark: typeof cost.note === 'string' ? cost.note.slice(0, 160) : ''
  } };
}

// Adapters run on MASTER only. deliver accepts a fixed customer-safe projection and
// must return a fresh or durable receipt for the same idempotency key.
export function createMasterQuotationService({ revisions, readSelections, readSelection, readCosts, deliver }) {
  async function selections(customerId) {
    const rows = await readSelections(customerId);
    if (!Array.isArray(rows) || rows.some(row => row.customerId !== customerId || row.removed)) throw Error('Selection scope could not be confirmed.');
    return rows;
  }

  async function selection(customerId, selectionId) {
    const row = await readSelection(customerId, selectionId);
    if (row?.id !== selectionId || row.customerId !== customerId || row.removed) throw Error('Selection is unavailable.');
    return row;
  }

  function append(customerId, selectionId, expectedRevision, commandId, fingerprint, snapshot) {
    return revisions.append({ customerId, selectionId, expectedRevision, commandId, fingerprint, snapshot });
  }

  return {
    async list({ customer }) {
      const { customerId } = customer;
      const rows = await selections(customerId);
      const batched = revisions.latestFor ? await revisions.latestFor(customerId, rows.map(row => row.id)) : null;
      return Promise.all(rows.map(async row => {
        const last = batched ? batched.get(row.id) : await revisions.latest(customerId, row.id);
        const { pending, ...snapshot } = last?.snapshot || blank;
        if (snapshot.published && (snapshot.published.selectionEpoch || '') !== (row.selectionEpoch || '')) {
          snapshot.published = { ...snapshot.published, enabled: false };
        }
        return { id: row.id, barcode: row.barcode, name: row.name, packing: row.packing, ea: row.ea, imageUrl: row.imageUrl,
          ...snapshot, pending: Boolean(pending), revision: last?.revision ?? 0 };
      }));
    },

    async catchCost({ staffId, customer }) {
      const { customerId } = customer;
      const rows = await selections(customerId);
      if (!rows.length) return { updated: 0, failed: 0 };
      const costs = await readCosts([...new Set(rows.map(row => row.barcode))]);
      const latest = revisions.latestFor ? await revisions.latestFor(customerId, rows.map(row => row.id)) : null;
      let updated = 0;
      let failed = 0;
      for (const row of rows) {
        try {
          const last = latest ? latest.get(row.id) : await revisions.latest(customerId, row.id);
          const previous = last?.snapshot || blank;
          if (previous.pending) { failed++; continue; }
          const cost = rowSnapshot(row, costs?.[row.barcode]);
          const snapshot = { ...previous, ...cost };
          if (cost.costAt && snapshot.draft) snapshot.draft = calculatePrice(snapshot.draft, row, customer, snapshot);
          await append(customerId, row.id, last?.revision ?? 0, randomUUID(), digest('cost', staffId, row.id, cost), snapshot);
          if (cost.costError) failed++;
          else updated++;
        } catch { failed++; }
      }
      return { updated, failed };
    },

    async saveDraft({ staffId, customer }, command) {
      validateCommand(command);
      const { customerId } = customer;
      const { selectionId, revision, requestId, input } = command;
      const row = await selection(customerId, selectionId);
      const previous = revision === 0 ? blank : (await revisions.at(customerId, selectionId, revision))?.snapshot;
      if (!previous || previous.pending) throw Error('The previous quotation needs confirmation.');
      const draft = calculatePrice(input ?? {}, row, customer, previous);
      const saved = await append(customerId, selectionId, revision, requestId, digest('draft', staffId, input.mode, input.value), { ...previous, draft });
      return { revision: saved.revision };
    },

    async publish({ staffId, customer }, command) {
      validateCommand(command);
      const { customerId } = customer;
      const { selectionId, revision, requestId, enabled } = command;
      if (typeof enabled !== 'boolean') throw Error('Choose quote visibility.');
      const row = await selection(customerId, selectionId);
      const fingerprint = digest('publish', staffId, enabled);
      const reserved = await revisions.at(customerId, selectionId, revision + 1);
      let intent = reserved;
      if (!intent) {
        const previous = revision === 0 ? blank : (await revisions.at(customerId, selectionId, revision))?.snapshot;
        if (!previous || previous.pending || (enabled && (!previous.draft || !positive(previous.costMyr)))) {
          throw Error('Save a draft with a confirmed cost first.');
        }
        const price = enabled ? calculatePrice(previous.draft, row, customer, previous) : previous.published;
        if (!price) throw Error('There is no customer quote to withdraw.');
        const version = (previous.published?.version ?? 0) + 1;
        const pending = { customerId, selectionId, barcode: row.barcode, requestId, version, enabled, currency: price.currency,
          priceEa: price.priceEa, priceCtn: price.priceCtn, ...(row.selectionEpoch ? { selectionEpoch: row.selectionEpoch } : {}) };
        intent = await append(customerId, selectionId, revision, requestId, fingerprint, { ...previous, pending });
      }
      const { pending, ...previous } = intent.snapshot;
      if (intent.commandId !== requestId || intent.fingerprint !== fingerprint || !pending) throw Error('This quotation changed.');

      const completed = await revisions.at(customerId, selectionId, revision + 2);
      const completionDigest = digest('acknowledged', fingerprint);
      if (completed) {
        if (completed.commandId !== requestId || completed.fingerprint !== completionDigest) throw Error('This quotation changed.');
        return { revision: completed.revision };
      }
      let receipt;
      try {
        receipt = await deliver(pending);
        if (receipt?.ok !== true || receipt.customerId !== customerId || receipt.selectionId !== selectionId ||
            receipt.requestId !== requestId || receipt.version !== pending.version) throw Error('Quote receipt mismatch.');
      } catch { return { pending: true, message: 'Waiting for the customer quotation receipt.' }; }
      const { priceEa, priceCtn, currency, version } = pending;
      const visible = enabled && receipt.superseded !== true;
      const published = { priceEa, priceCtn, currency, version, enabled: visible,
        ...(pending.selectionEpoch ? { selectionEpoch: pending.selectionEpoch } : {}) };
      const priorPrice = previous.published;
      const previousSp = visible && priorPrice?.enabled && Number.isFinite(priorPrice.priceCtn) &&
        (priorPrice.priceCtn !== priceCtn || priorPrice.currency !== currency)
        ? { priceCtn: priorPrice.priceCtn, currency: priorPrice.currency } : previous.previousSp;
      const saved = await append(customerId, selectionId, intent.revision, requestId, completionDigest,
        { ...previous, pending: null, published, ...(previousSp ? { previousSp } : {}) });
      return { revision: saved.revision };
    }
  };
}
