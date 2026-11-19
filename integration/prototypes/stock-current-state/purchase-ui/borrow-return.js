/* Unused return is distinct from automatic receipt repayment. Never infer its
   quantity from debt alone; original tracker owns all mutation/retry identity. */
(() => {
  const mounted = new WeakMap(), count = n => Number.isSafeInteger(n) && n >= 0;
  function mount({ container, workspace, relations, read, submit, canSubmit, isCurrent, rowLabel, esc }) {
    if (!container || !Array.isArray(relations) || !relations.length || [read, submit, canSubmit, isCurrent, esc].some(fn => typeof fn !== 'function')) return;
    const meta = workspace?.stockCurrent;
    if (meta?.schema !== 'PURCHASE_TRANSFERS_V2' || meta.stockProtocol !== 1 || !meta.stockBuild || !count(meta.stockGeneration)
      || meta.generation !== meta.stockGeneration) return;
    const old = mounted.get(container); if (old) { old.cancelled = true; old.section.remove(); }
    const section = document.createElement('section'); section.className = 'purchase-borrow-approval purchase-borrow-return'; container.appendChild(section);
    const state = { section, cancelled: false, serial: 0, submitting: false }; mounted.set(container, state);
    const active = serial => !state.cancelled && state.serial === serial && isCurrent() && section.isConnected !== false;
    const identify = taskId => {
      const task = workspace.tasks?.find(t => t.id === taskId), customer = workspace.customers?.find(c => c.id === task?.customerId);
      return [rowLabel?.(taskId), customer?.shortName || customer?.name || task?.customerId || taskId].filter(Boolean).join(' · ');
    };
    const po = sourceId => workspace.tasks?.find(task => task.id === sourceId)?.po || sourceId;
    const linkLabel = relation => identify(relation.borrowerTaskId)+' → '+identify(relation.lenderTaskId)
      +' · Borrowed P.O. 借出采购单 '+po(relation.lenderSourceId)+' · Replacement P.O. 补回采购单 '+po(relation.replacementSourceId);
    section.innerHTML = '<h4>Return Unused Borrow 未使用借货退回</h4><p class="borrow-approval-status">Only unused, unpacked, unshipped borrowed cartons. 仅退回未使用、未备货、未出库的借入货；不代替到货自动补回。</p>'
      +'<select data-borrow-return-choice aria-label="Borrowing link 调货关系"><option value="">Select link 选择关系</option>'
      +relations.map((r,i) => '<option value="'+i+'">'+esc(linkLabel(r)+' · '+r.remaining)+'</option>').join('')+'</select> '
      +'<button type="button" class="btn" data-borrow-return-check>Check unused qty 核对可退回箱数</button><p role="status" class="borrow-approval-status" data-borrow-return-status></p>';
    const choice = section.querySelector('[data-borrow-return-choice]'), check = section.querySelector('[data-borrow-return-check]');
    check.onclick = async () => {
      if (state.submitting || !active(state.serial)) return;
      const status = section.querySelector('[data-borrow-return-status]');
      if (!canSubmit()) { status.textContent = 'Save or cancel existing edits first 请先保存或取消现有修改。'; return; }
      const relation = /^\d+$/.test(choice.value) ? relations[Number(choice.value)] : null;
      if (!relation) { status.textContent = 'Select an existing borrowing link 请先选择现有调货关系。'; return; }
      const serial = ++state.serial; check.disabled = true; status.textContent = 'Checking current physical ownership 正在核对现有实货归属…';
      try {
        const result = await read('PURCHASE_BORROW_RETURN_OPTIONS_REQUEST', { input: { relationId: relation.id } });
        if (!active(serial)) return;
        if (result?.ok !== true || result.schema !== 'CURRENT_BORROW_RETURN_OPTIONS_V2' || result.company !== workspace.company
          || result.relationId !== relation.id || result.borrowerTaskId !== relation.borrowerTaskId || result.lenderTaskId !== relation.lenderTaskId
          || result.lenderSourceId !== relation.lenderSourceId || result.replacementSourceId !== relation.replacementSourceId
          || !count(result.expectedRevision) || !count(result.remaining) || result.remaining !== relation.remaining
          || !count(result.maximumQuantity) || result.maximumQuantity > Math.min(9999, result.remaining)
          || result.stockCurrent?.schema !== 'CURRENT_STOCK_V2' || result.stockCurrent.stockProtocol !== 1
          || result.stockCurrent.stockBuild !== meta.stockBuild || result.stockCurrent.stockGeneration !== meta.stockGeneration) {
          throw Error('Borrowing changed or unconfirmed. Refresh and review. 调货已变动或尚未确认，请刷新核对。');
        }
        if (!result.maximumQuantity) { status.textContent = 'No unused cartons can currently be returned. Outstanding repayment remains. 暂无可退回的未使用借货；欠补关系仍保留。'; return; }
        section.innerHTML = '<h4>Return Unused Borrow 未使用借货退回</h4><p>'+esc(linkLabel(relation))
          +' · Max 最多 '+result.maximumQuantity+'</p><div class="borrow-approval-fields"><label>Qty 箱数<input data-borrow-return-quantity type="number" min="1" max="'+result.maximumQuantity+'" step="1" inputmode="numeric"></label>'
          +'<label>Reason 原因<input data-borrow-return-reason maxlength="1000"></label></div><p role="status" class="borrow-approval-status error" data-borrow-return-error></p>'
          +'<button type="button" class="btn primary" data-borrow-return-approve>Approve Unused Return 批准未使用借货退回</button>';
        const quantity = section.querySelector('[data-borrow-return-quantity]'), reason = section.querySelector('[data-borrow-return-reason]'),
          error = section.querySelector('[data-borrow-return-error]'), approve = section.querySelector('[data-borrow-return-approve]');
        approve.onclick = () => {
          if (!active(serial) || state.submitting) return;
          const q = Number(quantity.value), note = reason.value.trim();
          if (!canSubmit() || !/^\d+$/.test(quantity.value) || !Number.isSafeInteger(q) || q < 1 || q > result.maximumQuantity || !note || note.length > 1000) {
            error.textContent = 'Check quantity, reason and existing edits 请核对箱数、原因，并先处理原修改或保存。'; return;
          }
          state.submitting = true; approve.disabled = true;
          try {
            submit({ relationId: relation.id, expectedRevision: result.expectedRevision, quantity: q, reason: note });
            error.textContent = 'Confirm or retry using the original save tracker 请通过原保存进度确认或重试。';
          } catch (e) { state.submitting = false; approve.disabled = false; error.textContent = e?.message || 'Return not submitted 尚未提交退回。'; }
        };
      } catch (error) { if (active(serial)) { status.textContent = error?.message || 'Unused return unconfirmed 未使用借货退回尚未确认。'; status.className = 'borrow-approval-status error'; } }
      finally { if (active(serial)) check.disabled = false; }
    };
  }
  window.purchaseBorrowReturn = { mount };
})();
