'use strict';

const { stockKey } = require('./current-model.cjs');
const { originalProductState } = require('./original-product-state.cjs');
const { readCurrentProduct } = require('./current-product-reader.cjs');
const { currentWarehouseReadyContext } = require('./current-warehouse-ready-context.cjs');
const { preparePackingHoldTransition } = require('./borrowing-stock-plan.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const nonPhoto = input => ['PACK', 'LOAD', 'UNPACK'].includes(input?.action)
  && (input.photos === undefined || Array.isArray(input.photos) && input.photos.length === 0);

// Capture the ORIGINAL prepare, never its apply or external document protocol.
// Only a private journal exists here; no actual lock/event/file can be mutated.
async function validateOriginalPreparation({ createPreparationOperations, company, staff, requestId, input, context, now }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks)
    || !Array.isArray(context.activity) || !nonPhoto(input) || typeof createPreparationOperations !== 'function'
    || typeof now !== 'function') throw Error('Original non-photo Warehouse preparation required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', scratch = new Map(), boundary = new Error('Private Warehouse prepare boundary');
  let captured, reads = 0;
  const scope = c => { if (c !== journal) throw Error('Warehouse preparation scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'WAREHOUSE_PREPARATION_SAVED'
          || !Array.isArray(row.details.plan.uploads) || row.details.plan.uploads.length) throw Error('Unexpected Warehouse preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Warehouse apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    },
    remove: async (c, id) => {
      scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private Warehouse lock removal allowed'); scratch.delete(id);
    }
  };
  const save = createPreparationOperations({ store, names: { [company]: { activity: journal } }, now,
    documentService: async () => { throw Error('External Warehouse documents forbidden'); },
    readContext: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected Warehouse apply/read'); return copy(context);
    } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original Warehouse boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original Warehouse preparation incomplete');
  return captured;
}

// Candidate composition for the existing authenticated Warehouse gateway. Not an
// endpoint or admission switch. All co-writers/apply-only guards must be fenced
// before adoption. PHOTOS still require the protected external upload protocol.
function createLegacyWarehousePreparation(deps) {
  const { company, readMember, readStaffRecords, requireWarehouseStaff, readContext, readPurchaseRecords, projectPurchaseOrders,
    createPreparationOperations, projectPreparation, readPreparation, readAllocations, readCustomerShipments, readPackingLists,
    packingHeld, protocol, items, store, now } = deps;
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requireWarehouseStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, createPreparationOperations, projectPreparation, readPreparation, readAllocations, readCustomerShipments,
    readPackingLists, packingHeld, now].some(f => typeof f !== 'function') || typeof protocol?.readSnapshot !== 'function'
    || typeof items?.query !== 'function' || typeof store?.read !== 'function') throw Error('Server Warehouse preparation dependencies required');
  async function load(request, save) {
    if (request?.company !== company || save && !nonPhoto(request.input)) throw Error('Supported company/non-photo Warehouse request required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requireWarehouseStaff(member, []);
    // Same permission boundary as the ORIGINAL saveWarehousePreparation wrapper.
    const staff = { ...requireWarehouseStaff(member, await readStaffRecords()), memberId: member._id, canPrepareWarehouse: true };
    const metrics = { queries: 0, exactReads: 0 };
    const snapshot = await protocol.readSnapshot(async () => {
      const original = await readContext(company, staff);
      if (original?.company !== company || !Array.isArray(original.tasks) || !Array.isArray(original.activity)) throw Error('Original Warehouse context required');
      const orders = projectPurchaseOrders({ company, workspace: original, records: await readPurchaseRecords(company, staff) });
      const identities = new Map(), products = [];
      for (const task of original.tasks.filter(t => !t.procurementSource && !t.specialPurchase || t.warehouse?.hasPhysicalReceipt === true)) {
        const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea }; identities.set(stockKey(identity), identity);
      }
      const build = (context, identity) => originalProductState({ company, context, orders, identity, readAllocations,
        readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
      for (const identity of identities.values()) {
        const rows = await readCurrentProduct({ company, identity, items, store, metrics });
        products.push({ identity, rows, state: build(original, identity).buildState(rows) });
      }
      const context = currentWarehouseReadyContext({ context: original, states: products.map(p => p.state), readAllocations, readCustomerShipments });
      const projected = projectPreparation(context);
      if (!save) return { projected };
      const selected = projected.filter(row => row.id === request.input.id);
      if (selected.length !== 1) throw Error('Exact Warehouse preparation task required');
      const product = products.find(p => p.state.tasks.some(t => t.id === selected[0].taskId));
      if (!product) throw Error('Warehouse preparation current product unavailable');
      const validated = await validateOriginalPreparation({ createPreparationOperations, company, staff, requestId: request.requestId,
        input: request.input, context, now }), event = validated.event;
      if (event.initiatedByStaffId !== staff.staffId || event.description !== selected[0].id || event.imageAltText !== selected[0].taskId
        || event.image !== selected[0].customerId || validated.version !== request.input.version) throw Error('Original Warehouse event identity conflict');
      const state = build(context, product.identity).buildState(product.rows);
      const after = build({ ...context, activity: [...context.activity, event] }, product.identity).buildState(product.rows);
      return { state, rows: product.rows, event, packingHolds: after.packingHolds };
    });
    if (!save) return { rows: snapshot.rows.projected, memberId: staff.memberId, generation: snapshot.generation, metrics };
    return { ...preparePackingHoldTransition({ ...snapshot.rows, generation: snapshot.generation }),
      memberId: staff.memberId, generation: snapshot.generation, metrics };
  }
  return { read: request => load(request, false), prepare: request => load(request, true) };
}
module.exports = { validateOriginalPreparation, createLegacyWarehousePreparation };
