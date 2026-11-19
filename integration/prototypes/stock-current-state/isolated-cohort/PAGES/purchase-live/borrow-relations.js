/* Read-only relation detail inside the EXISTING supplier planning dialog. */
(() => {
  const mounted = new WeakMap(), count = value => Number.isSafeInteger(value) && value >= 0;
  function mount({ container, workspace, rootId, read, rowLabel, esc, submitReturn, canSubmit }) {
    if (!container || typeof read !== 'function' || typeof esc !== 'function') return;
    const old = mounted.get(container); if (old) { old.cancelled = true; old.section.remove(); }
    const root = workspace?.tasks?.find(task => task.id === rootId), meta = workspace?.stockCurrent;
    const sources = workspace?.tasks?.filter(task => task.id === rootId || task.customerDemandTaskId === rootId) || [];
    if (!root || meta?.schema !== 'PURCHASE_TRANSFERS_V2' || !count(meta.generation) || !sources.some(task => task.stockTransferOutstanding === true)) return;
    const section = document.createElement('section'); section.className = 'purchase-borrow-relations';
    section.setAttribute('aria-label', 'Borrowing links 调货关系'); container.appendChild(section);
    const state = { cancelled: false, serial: 0, offset: 0, version: null, total: null, section }, pageSize = 5, generation = meta.generation;
    mounted.set(container, state);
    const active = serial => !state.cancelled && state.serial === serial && section.isConnected !== false;
    function identify(taskId, sourceId) {
      const task = workspace.tasks.find(t => t.id === taskId), source = workspace.tasks.find(t => t.id === sourceId);
      const customer = workspace.customers?.find(c => c.id === task?.customerId), label = rowLabel?.(taskId);
      return [label, customer?.shortName || customer?.name || task?.customerId, source?.po].filter(Boolean).map(esc).join(' · ')
        || esc(taskId);
    }
    function status(message, error = false, offset = state.offset) {
      section.innerHTML = '<h4>Borrowing Links 调货关系</h4><p class="borrow-link-status'+(error?' error':'')+'" role="status">'+esc(message)+'</p>'
        +(error?'<button type="button" class="btn primary" data-borrow-link-retry>Retry 重试</button>':'');
      const retry = section.querySelector('[data-borrow-link-retry]'); if (retry) retry.onclick = () => load(offset);
    }
    async function load(offset = 0) {
      const serial = ++state.serial;
      status('Reading approved links 正在读取已批准的调货关系…');
      try {
        const result = await read('PURCHASE_BORROW_RELATIONS_REQUEST', { input: { view: 'TASK', taskId: rootId, pageSize,
          ...(offset ? { cursor: { version: state.version, offset } } : {}) } });
        if (!active(serial)) return;
        if (result?.ok !== true || result.schema !== 'CURRENT_BORROW_RELATIONS_V1' || result.company !== workspace.company
          || result.view !== 'TASK' || result.taskId !== rootId || result.generation !== generation
          || !/^[a-f0-9]{32}$/.test(result.version || '') || result.offset !== offset || !count(result.total) || !result.total
          || !Array.isArray(result.items) || result.items.length !== Math.min(pageSize, result.total - offset)
          || state.version !== null && (state.version !== result.version || state.total !== result.total)
          || new Set(result.items.map(r => r.id)).size !== result.items.length
          || result.items.some(r => !r.id || ![r.borrowerTaskId, r.lenderTaskId].includes(rootId)
            || r.borrowerTaskId === r.lenderTaskId || !r.lenderSourceId || !r.replacementSourceId
            || !count(r.quantity) || !r.quantity || !count(r.repaid) || !count(r.returned) || !count(r.remaining)
            || !r.remaining || r.quantity !== r.repaid + r.returned + r.remaining)
          || offset + result.items.length < result.total && (result.nextCursor?.version !== result.version || result.nextCursor?.offset !== offset + result.items.length)
          || offset + result.items.length === result.total && result.nextCursor) throw Error('Borrowing changed or unconfirmed 调货关系已变动或尚未确认，请刷新任务栏后核对。');
        state.offset = offset; state.version = result.version; state.total = result.total;
        section.innerHTML = '<h4>Borrowing Links 调货关系 <small>'+result.total+'</small></h4><ul>'+result.items.map(r => {
          const borrowed = r.borrowerTaskId === rootId, other = borrowed ? r.lenderTaskId : r.borrowerTaskId;
          return '<li><div><span class="borrow-link-kind">'+(borrowed?'Borrowed from 借入自':'Lent to 借出给')+'</span> <strong>'
            +identify(other, borrowed ? r.lenderSourceId : r.replacementSourceId)+'</strong></div><div class="borrow-link-numbers">'
            +'<span>Total 总数 <b>'+r.quantity+'</b></span><span>Repaid 已补回 <b>'+r.repaid+'</b></span><span>Returned 已退回 <b>'+r.returned
            +'</b></span><span class="borrow-link-remaining">To repay 待补回 <b>'+r.remaining+'</b></span></div></li>';
        }).join('')+'</ul><p class="borrow-link-note">The halo remains until all linked quantities are settled. 所有调货关系结清后才移除天使圈；已发货不会清除待补回数量。</p>'
          +'<div class="borrow-link-pages"><span>'+(offset+1)+'–'+(offset+result.items.length)+' · '+result.total+'</span>'
          +(offset?'<button type="button" class="btn" data-borrow-link-prev>Previous 上一页</button>':'')
          +(result.nextCursor?'<button type="button" class="btn" data-borrow-link-next>Next 下一页</button>':'')+'</div>';
        const prev = section.querySelector('[data-borrow-link-prev]'), next = section.querySelector('[data-borrow-link-next]');
        if (prev) prev.onclick = () => load(Math.max(0, state.offset - pageSize)); if (next) next.onclick = () => load(result.nextCursor.offset);
        window.purchaseBorrowReturn?.mount({ container: section, workspace, relations: result.items, read,
          submit: submitReturn, canSubmit, rowLabel, esc, isCurrent: () => active(serial) });
      } catch (error) { if (active(serial)) status(error?.message || 'Borrowing links unconfirmed 调货关系尚未确认', true, offset); }
    }
    load();
  }
  window.purchaseBorrowRelations = { mount };
})();
