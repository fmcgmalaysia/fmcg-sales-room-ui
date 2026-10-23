/* UI review fixture only. No CMS/HTTP capability and no successful save reply.
   The real candidate app, supplier dialog and borrowing components are unchanged. */
(() => {
  const idA = 'a'.repeat(32), idB = 'b'.repeat(32), generation = 8;
  const base = { barcode: '9556404007035', name: '7 UP (CAN)', packing: '320ML x 24', ea: 24,
    ord: 100, requested: 100, inc: 0, lpPc: 1.5, lpCtn: 36, disc1: 0, disc2: 0, disc3: 0,
    netCostCtn: 36, costStatus: 'CAPTURED', history: [], masterReceivedAt: '2026-10-23T01:00:00Z',
    stage: 'NEW_INCOMING', gp: .2, transactionCurrency: 'USD', estimatedShipmentDate: '2026-10-30',
    editVersion: 'UX-REVIEW-V1', stockTransferOutstanding: false,stockArrangements:[],
    procurement: { totalCtn: 100, customerCtn: 100, expectedExtra: 0, revision: 'UX-REVIEW-P1',
      draftPlan: false, transportMode: 'SUPPLIER_DELIVER' } };
  const workspace = { company: 'NCT', staff: { staffId: 'UX-REVIEW-ONLY', memberId: 'UX-REVIEW-ONLY',
      staffName: 'UI REVIEW · 示例', canEditCustomerDemand: false }, fetchedAt: '2026-10-23T01:00:00Z',
    sourcesVersion: 'UX-REVIEW-S1', customers: [{ id: 'EXAMPLE-A', name: 'Example Customer A', shortName: 'EXAMPLE A 示例客户A' },
      { id: 'EXAMPLE-B', name: 'Example Customer B', shortName: 'EXAMPLE B 示例客户B' }],
    suppliers: [{ id: 'EXAMPLE-SUP-A', name: 'Example Supplier A', shortName: 'EXAMPLE SUPPLIER A' },
      { id: 'EXAMPLE-SUP-B', name: 'Example Supplier B', shortName: 'EXAMPLE SUPPLIER B' }],
    stockAllocationView:'CURRENT_V2',allocations:[],
    tasks: [{ ...base, id: idA, customerId: 'EXAMPLE-A', orderId: 'EXAMPLE-ORDER-A', sourceLineId: 'EXAMPLE-LINE-A',
      stockActualReceived:80,stockHasReceipt:true,stockAllocatedCumulative:80,stockAllocationFacts:{usable:80,held:0,dispatched:0,availableToArrange:80,review:false},procurement:{...base.procurement,totalCtn:90,customerCtn:90},
      supplierId: 'EXAMPLE-SUP-A', po: 'EXAMPLE-PO-A', warehouse: { hasPhysicalReceipt: true, accepted: 80 } },
      { ...base, id: idB, customerId: 'EXAMPLE-B', orderId: 'EXAMPLE-ORDER-B', sourceLineId: 'EXAMPLE-LINE-B',
        stockActualReceived:100,stockHasReceipt:true,stockAllocatedCumulative:100,stockAllocationFacts:{usable:100,held:0,dispatched:0,availableToArrange:100,review:false},supplierId: 'EXAMPLE-SUP-B', po: 'EXAMPLE-PO-B', warehouse: { hasPhysicalReceipt: true, accepted: 100 } }],
    shipmentPlans: [], stockCurrent: { schema: 'PURCHASE_TRANSFERS_V2', stockProtocol: 1,
      stockBuild: 'UX-REVIEW-ONLY', stockGeneration: generation, generation } };
  const summary = document.querySelector('#uxReviewResult');
  function refuse(message) {
    summary.textContent = message;
    summary.hidden = false;
  }
  function result(message, type, value) {
    window.postMessage({ type, requestId: message.requestId, company: message.company, ok: true, result: value }, '*');
  }
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const m = event.data || {};
    if (typeof m.type !== 'string' || !m.type.endsWith('_REQUEST')) return;
    if (m.type === 'PURCHASE_WORKSPACE_REQUEST') {
      if (m.company !== 'NCT') {
        window.postMessage({ type: 'PURCHASE_WORKSPACE_RESULT', requestId: m.requestId, company: m.company,
          ok: false, error: 'This interface fixture is NCT only. 本界面示例仅包含NCT。' }, '*'); return;
      }
      window.postMessage({ type: 'PURCHASE_WORKSPACE_RESULT', requestId: m.requestId, company: m.company,
        ok: true, workspace: structuredClone(workspace) }, '*'); return;
    }
    if (m.type === 'PURCHASE_ORDERS_REQUEST') {
      result(m, 'PURCHASE_ORDERS_RESULT', { company: 'NCT', orders: [] }); return;
    }
    if (m.type === 'PURCHASE_BORROW_OPTIONS_REQUEST') {
      const borrower = m.input?.borrowerTaskId, eligible = borrower === idA;
      result(m, 'PURCHASE_BORROW_OPTIONS_RESULT', { ok: true, schema: 'CURRENT_BORROW_OPTIONS_V2', company: 'NCT',
        borrowerTaskId: borrower, expectedRevision: 1, stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1,
          stockBuild: 'UX-REVIEW-ONLY', stockGeneration: generation }, options: eligible ? [{ borrowerTaskId: idA,
          lenderTaskId: idB, lenderCustomerId: 'EXAMPLE-B', lenderSourceId: idB, replacementSourceId: idA,
          lenderPoId: 'EXAMPLE-PO-B', replacementPoId: 'EXAMPLE-PO-A', lenderPoNumber: 'EXAMPLE-PO-B',
          replacementPoNumber: 'EXAMPLE-PO-A', maximumQuantity: 10 }] : [] }); return;
    }
    if (m.type === 'PURCHASE_BORROW_RELATIONS_REQUEST') {
      result(m, 'PURCHASE_BORROW_RELATIONS_RESULT', { ok: true, schema: 'CURRENT_BORROW_RELATIONS_V1', company: 'NCT',
        view: m.input?.view, taskId: m.input?.view === 'TASK' ? m.input.taskId : null,
        generation, version: 'c'.repeat(32), offset: 0, total: 0, items: [], halo: false, nextCursor: null }); return;
    }
    if (m.type === 'PURCHASE_SAVE_REQUEST' || m.type === 'PURCHASE_ORDER_SAVE_REQUEST') {
      // The original app may retain its attempted request as an unconfirmed draft.
      // Never fake approval, stock, a halo, receipt, generation or save success.
      refuse('NOT SAVED 未保存：这是现有采购界面的候选。真实批准尚未接通；未改变任何客户、采购单或库存。');
      window.postMessage({ type: 'PURCHASE_SAVE_RESULT', requestId: m.requestId, company: m.company,
        ok: false, error: 'UI review only. No CMS save capability. 界面验收版，无真实保存能力。' }, '*'); return;
    }
    result(m, m.type.replace(/_REQUEST$/, '_RESULT'), { ok: false,
      error: 'Outside this borrowing interface review. 此入口不在本次借货界面验收范围。' });
  });
  const labels = new MutationObserver(() => {
    const label = document.querySelector('nav .demo');
    if (label && label.textContent !== 'UI REVIEW · EXAMPLE DATA') label.textContent = 'UI REVIEW · EXAMPLE DATA';
  });
  labels.observe(document.body, { childList: true, subtree: true });
})();
