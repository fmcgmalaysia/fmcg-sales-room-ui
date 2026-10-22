/* Candidate-only recovery shell. No fake workspace, inventory reads, cache scans,
   cache writes, UUID generation, legacy receipts or force-unlock capability. */
(() => {
  const operations = new Set(['EDIT','PLAN','PO','ADD_SOURCE','AVERAGE_COST','QTY','REORDER','ALLOCATE','SHORTAGE','QUANTITY_CASE','BORROW_APPROVE','BORROW_RETURN']);
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  function validRequest(request, company) {
    return request && request.type === 'PURCHASE_SAVE_REQUEST' && request.company === company
      && /^[a-f0-9-]{36}$/i.test(request.requestId || '') && operations.has(request.operation)
      && request.input && typeof request.input === 'object' && !Array.isArray(request.input)
      && request.stockProtocol === 1 && typeof request.stockBuild === 'string' && request.stockBuild.length > 0
      && Number.isSafeInteger(request.stockGeneration) && request.stockGeneration >= 0
      && Object.keys(request).every(key => ['type','company','requestId','operation','input','stockProtocol','stockBuild','stockGeneration'].includes(key))
      && JSON.stringify(request).length <= (request.operation.startsWith('BORROW_') ? 6000 : 200000);
  }
  function mount({ company, host, read, send, receipt, lockCompany, esc }) {
    let disposed = false, request = null, staff = null, retry = null, state = null, serial = 0, inFlight = false, completed = false;
    const alive = () => !disposed && host?.isConnected !== false;
    function text(message) { if (alive() && state) state.textContent = message; }
    function unknown() {
      if (!alive() || completed) return;
      inFlight = false; if (retry) retry.disabled = false;
      text('Result unconfirmed. Original request retained. Retry only this save. 结果尚未确认，原请求保留，只重试此保存。');
    }
    function submit() {
      if (!alive() || !request || completed || inFlight) return;
      // Only the exact cache key returned by original server Purchase auth. A
      // second tab/edit/member change must not substitute a new command here.
      try {
        const cached = JSON.parse(sessionStorage.getItem('fmcg-purchase-draft-v1/'+company+'/'+staff.staffId+'/'+staff.memberId) || 'null');
        if (!same(cached?.savePending, request)) {
          text('Original cache changed. Refresh and review. 原请求缓存已变更，请刷新核对。');
          retry.disabled = true; return;
        }
      } catch (_) { unknown(); return; }
      const attempt = ++serial; inFlight = true; retry.disabled = true;
      text('Resuming original save 正在继续原保存…');
      try { send(JSON.parse(JSON.stringify(request))); } catch (_) { unknown(); return; }
      setTimeout(() => { if (attempt === serial && inFlight) unknown(); }, 30000);
    }
    function reply(event) {
      if (!alive() || completed || !request || event.source !== window.parent) return;
      const message = event.data || {}, result = message.result;
      if (message.type !== 'PURCHASE_SAVE_RESULT' || message.company !== company || message.requestId !== request.requestId) return;
      if (message.ok && result?.ok === true && result.requestId === request.requestId
        && Number.isSafeInteger(result.stockGeneration) && result.stockGeneration > request.stockGeneration) {
        completed = true; inFlight = false; retry.disabled = true;
        text('Save confirmed. Reloading original workspace. 保存已确认，正在重新读取原工作台。');
        // Do not clear/rewrite session cache here. Original app completion will
        // reconcile its price/sort/allocation drafts AFTER an authorized workspace.
        receipt({ request: JSON.parse(JSON.stringify(request)), result, staff }); return;
      }
      if (!inFlight) return;
      if (message.ok && result?.ok === false && result.pending === true && result.requestId === request.requestId
        && ['BEFORE','APPLY','VERIFY'].includes(result.phase) && Number.isSafeInteger(result.completedCount)
        && Number.isSafeInteger(result.totalRecords) && result.totalRecords > 0 && result.completedCount >= 0
        && result.completedCount <= result.totalRecords) {
        inFlight = false; const attempt = serial;
        text('Saving 保存中… '+result.completedCount+' / '+result.totalRecords);
        setTimeout(() => { if (attempt === serial && !inFlight) submit(); }, 250); return;
      }
      unknown();
    }
    window.addEventListener('message', reply);
    Promise.resolve().then(() => read('PURCHASE_RESUME_CONTEXT_REQUEST')).then(context => {
      if (!alive() || context?.ok !== true || context.schema !== 'PURCHASE_RESUME_CONTEXT_V1' || context.company !== company
        || ['staffId','staffName','memberId'].some(key => typeof context.staff?.[key] !== 'string' || !context.staff[key])) return;
      staff = context.staff;
      const cached = JSON.parse(sessionStorage.getItem('fmcg-purchase-draft-v1/'+company+'/'+staff.staffId+'/'+staff.memberId) || 'null');
      if (!validRequest(cached?.savePending, company)) return;
      request = JSON.parse(JSON.stringify(cached.savePending));
      const section = document.createElement('section'); section.className = 'notice';
      section.innerHTML = '<h3>Resume original save 继续原保存</h3><p>'+esc(staff.staffName)+' · '+esc(request.operation)
        +'</p><p>Ref 操作编号: '+esc(request.requestId)+'</p><p role="status"></p><button class="btn primary" type="button">Retry same save 重试原保存</button>';
      state = section.querySelector('[role="status"]'); retry = section.querySelector('button');
      retry.addEventListener('click', submit); host.appendChild(section); lockCompany();
      text('Workspace unavailable. Original request retained; no save has been retried. 工作台尚未载入，原请求已保留，尚未重试保存。');
    }).catch(() => { /* Keep original load/login error; never inspect another key. */ });
    return () => { disposed = true; serial++; window.removeEventListener('message', reply); };
  }
  window.purchaseCurrentResume = { mount, validRequest };
})();
