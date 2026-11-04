/* Separate Purchase debt view. Deliberately never filters by task.archived or
   uses customer shipping status to settle a borrowing relationship. */
(() => {
  const mounted = new WeakMap(), count = n => Number.isSafeInteger(n) && n >= 0;
  function mount({ container, workspace, read, canSubmit, submitReturn, rowLabel, esc }) {
    if (!container || typeof read !== 'function' || typeof esc !== 'function') return;
    const prior = mounted.get(container); if (prior) prior.cancelled = true;
    const state = { serial: 0, cancelled: false, version: null, total: null, offset: 0 }, meta = workspace?.stockCurrent;
    mounted.set(container, state);
    const active = serial => !state.cancelled && state.serial === serial && container.isConnected !== false;
    const header = '<div class="heading"><div><h1>Outstanding Borrowing<small>未结调货</small></h1></div></div>';
    if (meta?.schema !== 'PURCHASE_TRANSFERS_V2' || meta.stockProtocol !== 1 || !meta.stockBuild || !count(meta.stockGeneration)
      || meta.stockGeneration !== meta.generation) {
      container.innerHTML = header+'<p role="status">Current borrowing view unavailable 当前调货列表尚未启用。</p>'; return;
    }
    const pageSize = 25;
    function taskLabel(id) {
      const task = workspace.tasks?.find(t => t.id === id), customer = workspace.customers?.find(c => c.id === task?.customerId);
      return '<strong>'+esc(customer?.shortName || customer?.name || task?.customerId || id)+'</strong><small>'
        +esc(rowLabel?.(id) || id)+(task?.archived ? ' · History 历史行' : '')+'</small>';
    }
    function sourceLabel(id) { return esc(workspace.tasks?.find(t => t.id === id)?.po || id); }
    function productLabel(relation) {
      const task = workspace.tasks?.find(t => [relation.lenderSourceId, relation.replacementSourceId, relation.borrowerTaskId, relation.lenderTaskId].includes(t.id));
      return task ? '<small>'+esc(task.barcode || '')+'</small><strong>'+esc(task.name || 'Product name unavailable 产品名称待核对')+'</strong><small>'+esc(task.packing || '')+'</small>'
        : '<small>Product details unavailable 产品资料待核对</small><small>'+esc(relation.lenderSourceId)+'</small>';
    }
    function feedback(message, failed, offset) {
      container.innerHTML = header+'<p role="status" class="borrow-outstanding-status'+(failed?' error':'')+'">'+esc(message)+'</p>'
        +(failed?'<button type="button" class="btn" data-borrow-outstanding-retry>Retry 重试</button>':'');
      const retry = container.querySelector('[data-borrow-outstanding-retry]'); if (retry) retry.onclick = () => load(offset);
    }
    async function load(offset = 0) {
      const serial = ++state.serial; feedback('Reading outstanding relationships 正在读取未结调货关系…', false, offset);
      try {
        const result = await read('PURCHASE_BORROW_RELATIONS_REQUEST', { input: { view: 'OUTSTANDING', pageSize,
          ...(offset ? { cursor: { version: state.version, offset } } : {}) } });
        if (!active(serial)) return;
        if (result?.ok !== true || result.schema !== 'CURRENT_BORROW_RELATIONS_V1' || result.company !== workspace.company
          || result.view !== 'OUTSTANDING' || result.taskId !== null || result.generation !== meta.generation
          || !/^[a-f0-9]{32}$/.test(result.version || '') || result.offset !== offset || !count(result.total) || offset > result.total
          || !Array.isArray(result.items) || result.items.length !== Math.min(pageSize, result.total - offset)
          || result.halo !== (result.total > 0) || state.version !== null && (result.version !== state.version || result.total !== state.total)
          || new Set(result.items.map(r => r.id)).size !== result.items.length
          || result.items.some(r => !r.id || !r.borrowerTaskId || !r.lenderTaskId || r.borrowerTaskId === r.lenderTaskId
            || !r.lenderSourceId || !r.replacementSourceId || !count(r.revision) || !count(r.quantity) || !r.quantity
            || !count(r.repaid) || !count(r.returned) || !count(r.remaining) || !r.remaining || r.quantity !== r.repaid + r.returned + r.remaining)
          || result.total === 0 && workspace.tasks?.some(t => t.stockTransferOutstanding === true)
          || offset + result.items.length < result.total && (result.nextCursor?.offset !== offset + result.items.length || result.nextCursor?.version !== result.version)
          || offset + result.items.length === result.total && result.nextCursor) {
          throw Error('Borrowing changed or unconfirmed. Refresh the workspace. 调货资料已变动或尚未确认，请刷新工作间。');
        }
        state.offset = offset; state.version = result.version; state.total = result.total;
        container.innerHTML = header+'<p class="borrow-outstanding-note">Shipping or history does not settle borrowing. 发货或归档不等于调货结清；未结关系在此继续跟进。</p>'
          +'<p class="borrow-outstanding-count">'+result.total+' outstanding relationships 未结关系</p>'
          +(result.total ? '<div class="borrow-outstanding-scroll"><table><thead><tr><th>Borrower 借入方</th><th>Lender 借出方</th><th>Product 产品</th><th>Borrowed 借入</th><th>Repaid 补回</th><th>Returned 退回</th><th>To Repay 待补回</th></tr></thead><tbody>'
            +result.items.map(r => '<tr><td>'+taskLabel(r.borrowerTaskId)+'<small>Replacement P.O. 补回采购单 '+sourceLabel(r.replacementSourceId)+'</small></td><td>'
              +taskLabel(r.lenderTaskId)+'<small>Borrowed P.O. 借出采购单 '+sourceLabel(r.lenderSourceId)+'</small></td><td>'+productLabel(r)+'</td><td>'+r.quantity+'</td><td>'+r.repaid+'</td><td>'+r.returned
              +'</td><td><span class="borrow-outstanding-qty">'+r.remaining+'</span></td></tr>').join('')+'</tbody></table></div>'
            : '<p role="status">No outstanding borrowing 暂无未结调货</p>')
          +'<div class="borrow-outstanding-pages">'+(result.total?'<span>'+(offset+1)+'–'+(offset+result.items.length)+' · '+result.total+'</span>':'')
          +(offset?'<button type="button" class="btn" data-borrow-outstanding-prev>Previous 上一页</button>':'')
          +(result.nextCursor?'<button type="button" class="btn" data-borrow-outstanding-next>Next 下一页</button>':'')+'</div>';
        const prev = container.querySelector('[data-borrow-outstanding-prev]'), next = container.querySelector('[data-borrow-outstanding-next]');
        if (prev) prev.onclick = () => load(Math.max(0, state.offset - pageSize)); if (next) next.onclick = () => load(result.nextCursor.offset);
        if (result.items.length) window.purchaseBorrowReturn?.mount({ container, workspace, relations: result.items, read,
          submit: submitReturn, canSubmit, rowLabel, esc, isCurrent: () => active(serial) });
      } catch (error) { if (active(serial)) feedback(error?.message || 'Outstanding borrowing unconfirmed 未结调货尚未确认。', true, offset); }
    }
    load();
  }
  window.purchaseBorrowOutstanding = { mount };
})();
