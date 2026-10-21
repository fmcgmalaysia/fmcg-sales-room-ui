'use strict';

const { stockKey } = require('./current-model.cjs');
const { originalProductState } = require('./original-product-state.cjs');
const { readCurrentProduct } = require('./current-product-reader.cjs');
const { currentPackingContext } = require('./current-packing-context.cjs');
const { validateOriginalPacking } = require('./original-packing-validation.cjs');
const { preparePackingStock } = require('./packing-stock-plan.cjs');
// Private candidate for the existing authenticated read/save gateways. Every read
// shares the company control barrier. No legacy apply/photo/file side effects.
function createPackingStockPreparation(deps) {
  const { company, readMember, readStaffRecords, requirePackingStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, projectPackingContext, createPackingListOperations, readAllocations, readCustomerShipments,
    readPackingLists, packingHeld, items, store, protocol, now } = deps;
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requirePackingStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, projectPackingContext, createPackingListOperations, readAllocations, readCustomerShipments,
    readPackingLists, packingHeld, now].some(f => typeof f !== 'function') || typeof items?.query !== 'function'
    || typeof store?.read !== 'function' || typeof protocol?.readSnapshot !== 'function') throw Error('Server packing stock dependencies required');
  async function load(request, save) {
    if (request?.company !== company || !['SUPPORT', 'WAREHOUSE'].includes(request.department)
      || save && request.input?.action === 'PHOTOS') throw Error('Supported company/non-photo packing request required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePackingStaff(member, [], request.department);
    const staff = requirePackingStaff(member, await readStaffRecords(), request.department), metrics = { queries: 0, exactReads: 0 };
    const snapshot = await protocol.readSnapshot(async () => {
      const original = await readContext(company, staff);
      if (original?.company !== company || !Array.isArray(original.tasks) || !Array.isArray(original.activity)) throw Error('Original packing company context required');
      const packing = projectPackingContext(original), identities = new Map();
      for (const task of packing.tasks) {
        const source = original.tasks.filter(t => t.id === task.taskId);
        if (source.length !== 1) throw Error('Exact original packing task required');
        const identity = { company, barcode: source[0].barcode, packing: source[0].packing, ea: source[0].ea };
        identities.set(stockKey(identity), identity);
      }
      const orders = projectPurchaseOrders({ company, workspace: original, records: await readPurchaseRecords(company, staff) }), products = [];
      for (const identity of identities.values()) {
        const builder = originalProductState({ company, context: original, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld });
        const rows = await readCurrentProduct({ company, identity, items, store, metrics });
        products.push({ state: builder.buildState(rows), rows });
      }
      const context = currentPackingContext({ context: packing, states: products.map(p => p.state) });
      if (!save) return { context };
      const validated = await validateOriginalPacking({ createPackingListOperations, company, staff, requestId: request.requestId, input: request.input, context, now });
      const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
      metrics.exactReads++;
      const currentRecord = await store.read(journal, validated.record._id), prior = context.lists.find(l => l.id === validated.record.description);
      if (JSON.stringify(currentRecord?.details?.list || null) !== JSON.stringify(prior || null)) throw Error('Packing current record changed');
      // Reuse original stored-list validation, including evidence/bounds, before mapping.
      readPackingLists([{ ...validated.record, company }], company);
      const lines = new Set([...(prior?.lines || []), ...(prior?.change?.lines || []), ...validated.record.details.list.lines,
        ...(validated.record.details.list.change?.lines || [])].map(l => l.taskId));
      return { validated, currentRecord, products: products.filter(p => p.state.tasks.some(t => lines.has(t.id))) };
    });
    if (!save) return { context: snapshot.rows.context, memberId: staff.memberId, generation: snapshot.generation, metrics };
    return { ...preparePackingStock({ company, ...snapshot.rows, generation: snapshot.generation, packingHeld }),
      memberId: staff.memberId, generation: snapshot.generation, metrics };
  }
  return { read: request => load(request, false), prepare: request => load(request, true) };
}
module.exports = { createPackingStockPreparation };
