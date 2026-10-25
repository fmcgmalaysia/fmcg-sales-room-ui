/* Dedicated local test host. Only the known embedded candidate can request test
   actions. No HTTP/CMS/storage credentials, production grants or writer flags. */
(() => {
  let practice = window.createPractice(), inFlight = false, lastWorkspaceRequest = null;
  const frame = document.getElementById('practiceFrame'), status = document.getElementById('practiceStatus');
  function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
  function facts() {
    const a = practice.workspace().tasks.find(t => t.id === practice.IDS.A);
    document.getElementById('practiceFacts').textContent = '示例A · RCV ' + a.stockActualReceived + ' · ALLOC ' + a.stockAllocatedCumulative + ' · 待补回 ' + a.stockBorrowedOutstanding;
  }
  const reply = (m, type, values) => frame.contentWindow.postMessage({ type, requestId: m.requestId, company: m.company, ...values }, '*');
  function refresh() {
    facts();
    if (lastWorkspaceRequest) reply(lastWorkspaceRequest, 'PURCHASE_WORKSPACE_RESULT', { ok: true, workspace: practice.workspace() });
    // The original Purchase refresh owns its request identity and dialog guards.
    const button = frame.contentDocument?.getElementById('refresh'); if (button) button.click();
  }
  window.addEventListener('message', async event => {
    if (event.source !== frame.contentWindow || !event.data || typeof event.data.type !== 'string') return;
    const m = event.data;
    if (!m.type.endsWith('_REQUEST')) return;
    const type = m.type === 'PURCHASE_ORDER_SAVE_REQUEST' ? 'PURCHASE_SAVE_RESULT' : m.type.replace(/_REQUEST$/, '_RESULT');
    try {
      if (m.company !== 'NCT') throw Error('This test contains NCT examples only. 此测试仅包含NCT示例。');
      let result;
      if (m.type === 'PURCHASE_WORKSPACE_REQUEST') { lastWorkspaceRequest = m; reply(m, type, { ok: true, workspace: practice.workspace() }); facts(); return; }
      if (m.type === 'PURCHASE_BORROW_OPTIONS_REQUEST') result = practice.options(m.input.borrowerTaskId);
      else if (m.type === 'PURCHASE_BORROW_RELATIONS_REQUEST') result = practice.relations(m.input);
      else if (m.type === 'PURCHASE_BORROW_RETURN_OPTIONS_REQUEST') result = practice.returnOptions(m.input.relationId);
      else if (m.type === 'PURCHASE_ORDERS_REQUEST') result = { company: 'NCT', orders: [] };
      else if (m.type === 'PURCHASE_RESUME_CONTEXT_REQUEST') result = { ok: true, company: 'NCT', pending: null };
      else if (m.type === 'SALES_ROOM_SHIPMENT_REQUEST' && m.action === 'READ') result = practice.salesRead();
      else if (m.type === 'PURCHASE_SAVE_REQUEST' || m.type === 'SALES_ROOM_SHIPMENT_REQUEST') {
        if (inFlight) throw Error('A test save is processing. 本次测试正在保存。');
        inFlight = true;
        try { result = await practice.execute(m); facts(); message('测试保存完成。仅改变本次假数据；没有写入Wix。'); }
        finally { inFlight = false; }
        // A split plan changes the shared dataset. Notify the actual Purchase
        // app via its existing refresh, never edit its private JS state.
        if (m.type === 'SALES_ROOM_SHIPMENT_REQUEST') setTimeout(refresh, 0);
      } else {
        // Unrelated original background readers have no test fixture. Return an
        // honest unavailable reply without replacing the exercise instructions.
        reply(m, type, { ok: false, error: 'Outside this local exercise', department: m.department }); return;
      }
      reply(m, type, { ok: true, result });
    } catch (error) { message(error.message, true); reply(m, type, { ok: false, error: error.message }); }
  });
  const modalOpen = () => frame.contentDocument?.querySelector('dialog[open]');
  function ready() { if (inFlight || modalOpen()) { message('请先完成或关闭当前弹窗，再切换测试步骤。', true); return false; } return true; }
  document.getElementById('practiceSplit').onclick = () => { if (ready()) frame.contentWindow.masterShipments.open('EXAMPLE-A'); };
  const receipt = document.getElementById('practiceReceipt');
  document.getElementById('practiceReceive').onclick = () => { if (ready()) { document.getElementById('practiceReceiptError').textContent = ''; receipt.showModal(); } };
  document.getElementById('practiceReceiptCancel').onclick = () => receipt.close();
  document.getElementById('practiceReceiptSave').onclick = () => {
    const raw = document.getElementById('practiceAccepted').value;
    try {
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw Error('请填写非负整数箱数。');
      practice.receive(practice.IDS[document.getElementById('practiceSource').value], Number(raw));
      receipt.close(); refresh(); message('测试到货已保存，现有补回规则已执行。请查看 RCV、ALLOC 和未结关系。');
    } catch (error) { document.getElementById('practiceReceiptError').textContent = error.message; }
  };
  document.getElementById('practiceMove').onclick = () => { if (ready()) { practice.move(); refresh(); message('示例A移到收齐示例之后；调货关系仍绑定同一条稳定记录。'); } };
  document.getElementById('practiceArchive').onclick = () => { if (ready()) { practice.archive(practice.IDS.A); refresh(); message('示例A已从当前表归档；未结调货仍可在 Outstanding Borrowing 查看。'); } };
  document.getElementById('practiceRestart').onclick = () => { if (ready()) { practice = window.createPractice(); frame.srcdoc = frame.srcdoc; facts(); message('已重新开始一组假数据。没有清理或修改任何Wix记录。'); } };
  facts();
})();
