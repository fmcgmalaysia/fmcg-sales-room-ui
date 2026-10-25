'use strict';
// Retained, physically isolated fixture. This is NOT employee authorization,
// business-writer coverage, an activation verifier or a dispatch operation.
async function verifyR2BorrowRepayment({ items, runtime, original, hash, copy, input, enabled = false }) {
  if (!input || Array.isArray(input) || Object.keys(input).join(',') !== 'step'
    || !['SEED', 'BORROW', 'RECEIVE_PARTIAL', 'RECEIVE_REST', 'INSPECT'].includes(input.step)) throw Error('Fixed borrowing fixture step required');
  const prefix = 'SPT-R2BORROW-20261025-6c93:', physical = 'StockProtocolTest', company = 'NCT';
  const journal = 'NCTActivity', tasks = 'NCTTasks', positions = 'StockPositions', claims = 'StockClaims', products = 'StockProducts';
  const allowed = new Set([journal, tasks, positions, claims, products]);
  const build = 'BORROW-REPAY-FIXTURE-ONLY', counts = { queries: 0, inserts: 0, patches: 0, deletes: 0 };
  let mutationAttempted = false;
  const report = (ok, extra = {}) => ({ ok, schema: 'R2_BORROW_REPAYMENT_V1', step: input.step,
    operationsAttempted: { ...counts }, mutationAttempted, originalBusinessCollectionsAccepted: false,
    staffAuthorizationAccepted: false, activationReady: false, physicalDispatchEnabled: false, ...extra });
  if (!enabled) return report(false, { blocked: true, stage: 'CLOSED' });
  const address = (name, id) => { if (!allowed.has(name) || typeof id !== 'string' || !id) throw Error('Fixed borrowing scope'); return prefix + name + ':' + id; };
  const bounded = {
    query: name => { if (name !== physical || ++counts.queries > 240) throw Error('Borrow query budget/scope'); return items.query(name); },
    insert: async (name, row) => { if (name !== physical || !row?._id?.startsWith(prefix) || ++counts.inserts > 36) throw Error('Borrow insert budget/scope'); mutationAttempted = true; return items.insert(name, row); },
    patch: (name, id) => { if (name !== physical || !id?.startsWith(prefix) || ++counts.patches > 22) throw Error('Borrow patch budget/scope'); mutationAttempted = true; return items.patch(name, id); },
    remove: () => { throw Error('NO_DELETE_CAPABILITY'); }
  };
  const raw = runtime.createSdkConditionalStore({ items: bounded, company, collections: [physical] });
  const pack = (name, row) => ({ _id: address(name, row._id), company, _version: row._version || hash('FIXTURE_INSERT', row), details: copy(row) });
  const unpack = (name, id, row) => {
    if (!row) return null;
    if (row._id !== address(name, id) || row.details?._id !== id || row.details.company !== company
      || row.details._version && row.details._version !== row._version) throw Error('Exact borrowing fixture image required');
    return copy(row.details);
  };
  const store = {
    normalizeListedRow: (name, row) => { address(name, row?._id); if (row.company !== company || !row._version) throw Error('Exact normalized fixture image required'); return copy(row); },
    read: async (name, id) => unpack(name, id, await raw.read(physical, address(name, id))),
    readMany: async (name, ids) => (await raw.readMany(physical, ids.map(id => address(name, id)))).map((row, i) => unpack(name, ids[i], row)),
    insert: async (name, row) => unpack(name, row._id, await raw.insert(physical, pack(name, row))),
    compareAndSet: async (name, id, version, row) => { if (row?._id !== id) throw Error('Exact borrowing after-image required'); return unpack(name, id, await raw.compareAndSet(physical, address(name, id), version, pack(name, row))); },
    compareAndRemove: () => { throw Error('NO_LOCK_REMOVAL_CAPABILITY'); }
  };
  async function list(name) {
    if (!allowed.has(name)) throw Error('Fixed borrowing list scope');
    const page = await bounded.query(physical).startsWith('_id', prefix + name + ':').limit(161).find({ consistentRead: true, returnTotalCount: true });
    if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount > 160 || page.items.length !== page.totalCount) throw Error('Incomplete borrowing fixture list');
    return page.items.map(row => unpack(name, row.details?._id, raw.normalizeListedRow(physical, row)));
  }
  // Bounded server-owned fixture queries only. Never scan a business table or
  // reuse a previous-invocation cache for a commit decision.
  const logicalItems = { query: name => {
    if (!allowed.has(name)) throw Error('Fixed logical query scope');
    const filters = []; let limit = 50;
    const q = { eq: (key, value) => { filters.push(row => Array.isArray(row[key]) ? row[key].includes(value) : row[key] === value); return q; },
      gt: (key, value) => { filters.push(row => row[key] > value); return q; },
      hasSome: (key, value) => { filters.push(row => value.includes(row[key])); return q; },
      ascending: () => q, limit: value => { limit = value; return q; },
      find: async () => { const rows = (await list(name)).filter(row => filters.every(fn => fn(row))).sort((a, b) => a._id.localeCompare(b._id)); return { items: rows.slice(0, limit), totalCount: rows.length }; } };
    return q;
  } };
  const protocol = runtime.createSegmentedFencedProof({ company, store, domainWrites: true, coordination: 'CONTROL_CAS_CANDIDATE', stepsPerInvocation: 4 });
  // stockKey is deliberately supplied by the actual runtime-compatible model,
  // not guessed from the test's identity hash encoding.
  const productKey = original.stockKey({ company, barcode: '1', packing: '24x1', ea: 24 });
  const positionId = hash(company, productKey, 'PURCHASE_SOURCE', 'B');
  const member = department => ({ _id: department === 'PURCHASE' ? 'BP-M' : 'BW-M', loginEmail: department.toLowerCase() + '@fixture.invalid', status: 'APPROVED' });
  const staff = department => ({ title: department === 'PURCHASE' ? 'BP' : 'BW', description: member(department)._id,
    staffEmail: member(department).loginEmail, staffName: 'Retained fixture', staffStatus: 'ACTIVE', role: 'STAFF', departments: [department] });
  const context = { company, activity: await list(journal), suppliers: [{ id: 'SUP', name: 'Fixture supplier' }],
    customers: ['A', 'B'].map(id => ({ id: 'C-' + id, name: 'Fixture ' + id })),
    tasks: ['A', 'B'].map(id => ({ id, customerId: 'C-' + id, orderId: 'O-' + id, sourceLineId: 'L-' + id,
      barcode: '1', name: 'Retained fixture', packing: '24x1', ea: 24, requested: 100, ord: 100,
      po: 'PO-' + id, supplierId: 'SUP', lpCtn: 10, lpPc: 10 / 24, disc1: 0, disc2: 0, disc3: 0, history: [],
      procurement: { totalCtn: 100, customerCtn: 100 }, warehouse: id === 'B' ? { hasPhysicalReceipt: true, accepted: 100 } : null })) };
  if (context.activity.some(row => row.action === 'WAREHOUSE_RECEIPT_SAVED')) context.tasks[0].warehouse = original.readWarehouseTask({ title: 'A', description: 'O-A', imageAltText: 'L-A', purchaseQtyInCtn: 100 }, context.activity);
  const deps = department => ({ ...original, readMember: async () => member(department), readStaffRecords: async () => [staff(department)],
    readContext: async () => copy(context), readPurchaseRecords: async () => [],
    readCurrentTaskRows: async (_company, ids) => store.readMany(tasks, ids),
    readTransfer: async (_company, id) => store.read(journal, hash(company, 'STOCK_TRANSFER_CURRENT', id)),
    now: () => new Date('2026-10-25T04:00:00Z') });
  const coverage = Object.fromEntries(['RECEIPT','ALLOCATION','BORROWING','SALES_DEMAND','PURCHASE_SOURCE','PURCHASE_PLAN','PURCHASE_TASK','STOCK_EXCEPTION','STOCK_RESOLUTION','PACKING','WAREHOUSE_PREPARATION','SHIPMENT','ORDER_INTAKE','ORDER_UPDATE','COST_REFERENCE','MARGIN_REFERENCE','SHIPMENT_PLAN','QUANTITY_CASE','PURCHASE_ORDER_RECORD','ACCOUNT_PURCHASE_RECORD'].map(name => [name, { verified: true, build }]));
  // CMS may reorder object keys. Rebuild ONLY the original fixed JSON field
  // order for its already-retained hash; reject extra/missing fields and never
  // replace the retained version or accept changed values as a new request.
  const orderedFields = (row, fields) => { if (!row || Array.isArray(row) || Object.keys(row).length !== fields.length || fields.some(key => !Object.prototype.hasOwnProperty.call(row, key))) throw Error('Retained fixture command shape conflict'); return Object.fromEntries(fields.map(key => [key, row[key]])); };
  const receiptImage = request => { const row = orderedFields(request, ['requestId','stockProtocol','stockBuild','stockGeneration','input']); row.input = orderedFields(row.input, ['id','version','action','lines']); if (!Array.isArray(row.input.lines) || row.input.lines.length !== 1) throw Error('Retained fixture line scope conflict'); row.input.lines = row.input.lines.map(line => orderedFields(line, ['taskId','accepted','rejected','kind','reason','resolveIssue'])); return row; };
  try {
    if (await store.read(journal, protocol.ids.lockId)) throw Error('Unexpected fixture lock; retain without removal');
    if (input.step === 'SEED') {
      const occupied = await bounded.query(physical).startsWith('_id', prefix).limit(1).find({ consistentRead: true, returnTotalCount: true });
      if (!Array.isArray(occupied?.items) || occupied.items.length || occupied.totalCount !== 0) throw Error('Occupied borrowing fixture; no reset/adoption');
      const base = { company, stockKey: productKey, revision: 0, status: 'ACTIVE', _version: 'V0', reviewCodes: [] };
      for (const task of context.tasks) await store.insert(tasks, { _id: task.id, company, _version: 'T0', title: task.id,
        description: task.orderId, imageAltText: task.sourceLineId, stockCounterSchema: 2, stockCounterGeneration: 0, stockDispatchedCumulative: 0 });
      await store.insert(positions, { ...base, _id: positionId, sourceTaskId: 'B', poId: hash(company, 'PURCHASE_ORDER', ['B']), receiptAccepted: 100,
        replacementReceived: 0, dispatched: 0, onHand: 100, isolated: 0, available: 0, reservedUsable: 100, borrowRepaidCumulative: 0 });
      await store.insert(claims, { ...base, _id: hash(company, positionId, 'B'), positionId, taskId: 'B', customerId: 'C-B', reservedUsable: 100, isolatedAttributed: 0, dispatchedCumulative: 0 });
      await store.insert(products, { ...base, _id: hash(company, productKey), onHand: 100, isolated: 0, available: 0, reservedUsable: 100, lifecycleVersion: 2, nextBorrowSequence: 1 });
      await store.insert(journal, { _id: protocol.ids.controlId, company, generation: 0, pending: null, _version: 'BORROW-GENESIS', mode: 'ACTIVE', schemaVersion: 1, transferIndexVersion: 2, writerBuild: build });
      return report(true, { stage: 'SEEDED', generation: 0 });
    }
    const control = await protocol.readControl();
    if (control.writerBuild !== build || control.generation > 3) throw Error('Exact fixture control required');
    if (input.step === 'INSPECT') {
      if (control.pending) return report(true, { stage: 'PENDING', generation: control.generation, pending: copy(control.pending) });
      const rows = await list(claims), product = await store.read(products, hash(company, productKey));
      const relation = (await list(journal)).filter(row => row.action === 'STOCK_TRANSFER_CURRENT');
      const total = id => rows.filter(row => row.taskId === id).reduce((n, row) => n + row.reservedUsable, 0);
      const expected = [[100,0,100,0],[100,30,70,0],[120,30,90,20],[200,100,100,30]][control.generation];
      if (!expected || JSON.stringify([product.onHand,total('A'),total('B'),relation[0]?.details.relation.repaid || 0]) !== JSON.stringify(expected)
        || relation.length !== (control.generation ? 1 : 0) || relation.some(row => row.details.relation.quantity !== 30)
        || control.generation === 3 && relation[0].status !== 'CLOSED') throw Error('Borrowing/repayment conservation failed');
      const retainedCommand = await store.read(journal, hash(company, 'FIXTURE_COMMAND', 'RECEIVE_PARTIAL'));
      const retainedCommandIdentity = retainedCommand ? { stored: retainedCommand._version, observed: hash(retainedCommand.details?.request), originalFieldOrder: hash(receiptImage(retainedCommand.details?.request)) } : null;
      return report(true, { stage: control.generation === 3 ? 'FINAL_VERIFIED' : 'CHECKPOINT_VERIFIED', generation: control.generation, retainedCommandIdentity,
        onHand: product.onHand, borrowerAllocated: total('A'), lenderAllocated: total('B'), repaid: relation[0]?.details.relation.repaid || 0,
        debtClosed: relation[0]?.status === 'CLOSED', receiptCount: (await list(journal)).filter(row => row.action === 'WAREHOUSE_RECEIPT_SAVED').length });
    }
    const generation = { BORROW: 0, RECEIVE_PARTIAL: 1, RECEIVE_REST: 2 }[input.step];
    if (control.generation !== generation) throw Error('Exact fixture phase required; no completed re-execution');
    let outcome;
    if (input.step === 'BORROW') {
      const save = runtime.createCurrentBorrowingSave({ company, items: logicalItems, store, protocol, coverage, authorityDependencies: deps('PURCHASE') });
      outcome = await save({ company, requestId: '6c930001-2026-4250-8250-000000000001', kind: 'APPROVE', stockProtocol: 1, stockBuild: build, stockGeneration: 0,
        input: { expectedRevision: 0, borrowerTaskId: 'A', lenderSourceId: 'B', replacementSourceId: 'A', quantity: 30, reason: 'Retained native borrowing fixture' } });
    } else {
      const partial = input.step === 'RECEIVE_PARTIAL';
      const commandId = hash(company, 'FIXTURE_COMMAND', input.step);
      let retained = await store.read(journal, commandId);
      if (!retained) {
        if (control.pending) throw Error('Missing original retained fixture command; no adoption');
        const orders = original.projectWarehouseOrders({ company, purchaseOrders: original.projectPurchaseOrders({ company, workspace: context, records: [] }), tasks: context.tasks, activity: context.activity });
        const own = orders.find(po => po.lines.some(line => line.taskId === 'A'));
        if (!own) throw Error('Original fixture PO missing');
        const request = { requestId: partial ? '6c930002-2026-4250-8250-000000000002' : '6c930003-2026-4250-8250-000000000003', stockProtocol: 1, stockBuild: build, stockGeneration: generation,
          input: { id: own.id, version: own.version, action: 'RECEIVE', lines: [{ taskId: 'A', accepted: partial ? 20 : 80, rejected: 0,
            kind: partial ? 'PARTIAL' : 'DELIVERY', reason: partial ? 'Remaining delivery later' : '', resolveIssue: !partial }] } };
        retained = await store.insert(journal, { _id: commandId, company, _version: hash(request), action: 'FIXTURE_COMMAND', details: { request } });
      }
      const originalRequest = receiptImage(retained.details?.request);
      if (retained.action !== 'FIXTURE_COMMAND' || retained._version !== hash(originalRequest)) throw Error('Retained fixture command identity conflict');
      outcome = await runtime.createCurrentWarehouseReceiptSave({ company, items: logicalItems, store, protocol, coverage, authorityDependencies: deps('WAREHOUSE') })(copy(originalRequest));
    }
    const after = await protocol.readControl();
    return report(true, { stage: outcome.pending ? 'CHECKPOINT_CONFIRMED' : 'OPERATION_COMPLETE', outcome,
      generation: after.generation, pending: copy(after.pending) });
  } catch (error) { return report(false, { error: error.message, retainRequest: true, noAutomaticRetryResetOrCleanup: true }); }
}
module.exports = { verifyR2BorrowRepayment };
