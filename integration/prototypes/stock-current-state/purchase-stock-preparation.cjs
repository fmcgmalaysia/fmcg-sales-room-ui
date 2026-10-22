'use strict';

const { domainCollections } = require('./domain-scope.cjs');
const { stockKey } = require('./current-model.cjs');
const { validateOriginalPurchase } = require('./original-purchase-validation.cjs');
const { preparePurchaseDomain } = require('./purchase-domain-plan.cjs');
const { projectDomainAfter } = require('./domain-after-snapshot.cjs');
const { originalProductState } = require('./original-product-state.cjs');
const { readCurrentProduct } = require('./current-product-reader.cjs');
const { readScopedCurrentProduct } = require('./scoped-current-reader.cjs');
const { preparePurchaseStock } = require('./purchase-stock-plan.cjs');
const { hash } = require('./commit-proof.cjs');
const { validateOriginalSource, prepareSourceDomain } = require('./original-source-validation.cjs');
// Server-owned adapter candidate, intended as fenced commit.prepare. It is not a
// gateway, does not apply a legacy save, and cannot certify unconnected co-writers.
function createPurchaseStockPreparation(deps) {
  const { company, readMember, readStaffRecords, requirePurchaseStaff, readTables, protocol, items, store,
    createPurchaseOperations, createPurchaseSourceOperations, taskEditVersion, operationId, projectPurchaseWorkspace, projectPurchaseOrders,
    readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation, now } = deps;
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requirePurchaseStaff, readTables,
    createPurchaseOperations, taskEditVersion, operationId, projectPurchaseWorkspace, projectPurchaseOrders,
    readAllocations, readCustomerShipments, readPackingLists, packingHeld, now].some(f => typeof f !== 'function')
    || typeof protocol?.readSnapshot !== 'function' || typeof items?.query !== 'function' || typeof store?.read !== 'function') throw Error('Server Purchase stock dependencies required');
  const current = protocol.planFormat === 'SEGMENTED_V2';
  if (current && typeof deps.readCurrentTaskRows !== 'function') throw Error('Private v2 Purchase task checkpoint reader required');
  const planFormat = current ? 'SEGMENTED_V2' : 'PROOF_V1';
  return async request => {
    if (request?.company !== company) throw Error('Purchase company conflict');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePurchaseStaff(member, []);
    const staff = { ...requirePurchaseStaff(member, await readStaffRecords()), memberId: member._id };
    // Private current-save admission identity, not an input/browser approval.
    if (request.staffId !== undefined && request.staffId !== staff.staffId) throw Error('Purchase preparation identity changed');
    const trusted = { company, staff: request.operation === 'ADD_SOURCE' ? { ...staff, canAddPurchaseSource: true } : staff,
      requestId: request.requestId, operation: request.operation, input: request.input };
    const metrics = { queries: 0, exactReads: 0 };
    const snapshot = await protocol.readSnapshot(async control => {
      let tables = await readTables(company, staff);
      const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
      const lockId = hash(company + '/PURCHASE', 'LOCK'), lock = tables[journal]?.find(row => row._id === lockId);
      if (lock) {
        const current = await store.read(journal, lockId), owner = hash(company + '/PURCHASE', request.requestId, member._id);
        // This is a private read-only snapshot for ORIGINAL validation, not removal
        // of the real lock. Other request, legacy, mismatched or unknown locks stay blocked.
        if (lock.company !== company || lock.owner !== owner || typeof lock.attempt !== 'string' || !lock.attempt
          || lock.action || lock.details || JSON.stringify(current) !== JSON.stringify(lock)) throw Error('Purchase preparation lock is not owned by this request');
        tables = { ...tables, [journal]: tables[journal].filter(row => row._id !== lockId) };
      }
      const beforeContext = { ...projectPurchaseWorkspace({ company, staff, orders: tables[orders], tasks: tables[tasks], activity: tables[journal], suppliers: tables.SharedSuppliers }), activity: tables[journal] };
      const source = request.operation === 'ADD_SOURCE';
      const validated = source ? await validateOriginalSource({ createPurchaseSourceOperations, request: trusted, tables, workspace: beforeContext, now })
        : await validateOriginalPurchase({ createPurchaseOperations, request: trusted, tables, now });
      const domainPlan = source ? prepareSourceDomain({ validated, request: trusted, tables })
        : preparePurchaseDomain({ validated, request: trusted, tables, taskEditVersion, operationId, planFormat,
          currentDisplayOrderVersion: deps.currentDisplayOrderVersion });
      if (current) for (const write of domainPlan.writes.filter(w => w.collection === tasks && w.before === null)) {
        Object.assign(write.after, { stockCounterSchema: 2, stockDispatchedCumulative: 0, stockCounterGeneration: control.generation + 1 });
      }
      const afterContext = projectDomainAfter({ company, staff, tables, plan: domainPlan, projectPurchaseWorkspace });
      const identities = new Map();
      const changedTaskIds = new Set(domainPlan.writes.filter(w => w.collection === tasks).map(w => w.after._id));
      for (const update of source ? [{ id: validated.task._id }] : validated.updates.filter(update => changedTaskIds.has(update.id))) {
        const found = [beforeContext, afterContext].flatMap(context => context.tasks.filter(t => t.id === update.id));
        if (!found.length) throw Error('Purchase changed task missing from original projection');
        const identity = { company, barcode: found[0].barcode, packing: found[0].packing, ea: found[0].ea }, key = stockKey(identity);
        if (found.some(t => stockKey({ company, barcode: t.barcode, packing: t.packing, ea: t.ea }) !== key)) throw Error('Purchase cannot replace product identity');
        identities.set(key, identity);
      }
      const products = [];
      for (const identity of identities.values()) {
        const builder = context => originalProductState({ company, context, identity,
          orders: projectPurchaseOrders({ company, workspace: context, records: tables.PurchaseOrders }),
          readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
        const before = builder(beforeContext), after = builder(afterContext);
        const changedIds = domainPlan.writes.filter(w => w.collection === tasks).map(w => w.after._id);
        const sourceIds = [...new Set([...before.sources, ...after.sources].filter(s => changedIds.includes(s.id)).map(s => s.id))];
        const demandTaskIds = [...new Set([...before.demands, ...after.demands].filter(t => changedIds.includes(t.id)
          || [...before.sources, ...after.sources].some(s => changedIds.includes(s.id) && s.ownerTaskId === t.id)).map(t => t.id))];
        const rows = current ? await readScopedCurrentProduct({ company, identity, items, store, metrics,
          transferIndexVersion: control?.transferIndexVersion, sourceTaskIds: sourceIds, demandTaskIds })
          : await readCurrentProduct({ company, identity, items, store, metrics });
        let beforeRows = rows, afterRows = rows;
        if (current) {
          // Intake/bootstrap must have initialized this product; a Purchase edit
          // is not permission to reconstruct a missing current checkpoint.
          if (!rows.product || rows.product.lifecycleVersion !== 2) throw Error('Current Purchase product checkpoint required');
          const forBuilder = builder => ({ ...rows, sourceTaskIds: rows.sourceTaskIds.filter(id => builder.sources.some(s => s.id === id)) });
          beforeRows = forBuilder(before); afterRows = forBuilder(after);
          const taskIds = [...new Set([...before.scopeTaskIds(beforeRows), ...after.scopeTaskIds(afterRows)])];
          const taskRows = await deps.readCurrentTaskRows(company, taskIds, staff);
          beforeRows = { ...beforeRows, taskRows, generation: control.generation };
          afterRows = { ...afterRows, taskRows, generation: control.generation };
        }
        const unconfirmedSourceIds = afterContext.tasks.filter(t => t.procurementSource && !t.po && t.procurement?.draftPlan
          && stockKey({ company, barcode: t.barcode, packing: t.packing, ea: t.ea }) === stockKey(identity))
          .map(t => t.id).filter(id => domainPlan.writes.some(w => w.collection === tasks && w.after._id === id));
        products.push({ state: before.buildState(beforeRows), after: after.buildState(afterRows), rows, unconfirmedSourceIds });
      }
      return { domainPlan, products };
    });
    // A split-display-only EDIT can legitimately have no changed raw task image.
    // Its one immutable event is still fenced; do not fabricate a stock revision.
    const displayOnly = request.operation === 'EDIT' && request.input?.edits?.length === 0 && request.input.displayRows !== undefined
      && snapshot.rows.domainPlan.writes.every(w => w.collection === (company === 'NCT' ? 'NCTActivity' : 'NCTActivity1')
        && w.after.action === 'PURCHASE_DISPLAY_ORDER_SAVED');
    return { ...(displayOnly ? { plan: snapshot.rows.domainPlan, states: [] }
      : preparePurchaseStock({ company, ...snapshot.rows, generation: snapshot.generation, planFormat })),
      memberId: staff.memberId, generation: snapshot.generation, metrics };
  };
}
module.exports = { createPurchaseStockPreparation };
