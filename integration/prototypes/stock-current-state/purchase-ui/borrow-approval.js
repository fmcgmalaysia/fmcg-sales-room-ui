/* Purchase-only action in the existing supplier dialog. Original save tracker
   owns request identity, retry, persistence and confirmed-workspace refresh. */
(() => {
  const mounted = new WeakMap(), count = n => Number.isSafeInteger(n) && n >= 0;
  function mount({ container, workspace, rootId, read, submit, canSubmit, rowLabel, esc }) {
    if (!container || [read, submit, canSubmit, esc].some(fn => typeof fn !== 'function')) return;
    const previous = mounted.get(container); if (previous) { previous.cancelled = true; previous.section.remove(); }
    const root = workspace?.tasks?.find(task => task.id === rootId), meta = workspace?.stockCurrent;
    if (!root || root.procurementSource || root.specialPurchase) return;
    const section = document.createElement('section'); section.className = 'purchase-borrow-approval';
    section.setAttribute('aria-label', 'Approve borrowing 批准借货'); container.appendChild(section);
    const state = { section, cancelled: false, serial: 0, submitting: false }; mounted.set(container, state);
    const enabled = meta?.schema === 'PURCHASE_TRANSFERS_V2' && meta.stockProtocol === 1 && meta.stockBuild
      && count(meta.stockGeneration) && meta.stockGeneration === meta.generation;
    if (!enabled) {
      // Installing the real interface does NOT activate inventory writes. Show
      // availability honestly; never quote an unchecked amount or fake a save.
      section.innerHTML = '<h4>Borrow Stock 借货调配</h4><button type="button" class="btn" data-borrow-availability>View borrowing requirements 查看借货条件</button><div data-borrow-closed hidden></div>';
      section.querySelector('[data-borrow-availability]').onclick = () => {
        const box = section.querySelector('[data-borrow-closed]'); box.hidden = false;
        box.innerHTML = '<p role="status">Borrowing saves are not enabled yet. 借货保存尚未启用；原采购操作不受影响。</p>'
          +'<div class="borrow-approval-detail"><div><span>Borrow from 借出客户及采购单</span><strong>Not checked 尚未核对</strong></div>'
          +'<div><span>Repay from 本客户补回采购单</span><strong>'+esc(root.po || 'Not assigned 尚未开单')+'</strong></div></div>'
          +'<p>Both customers need matching approved P.O.s and sufficient uncommitted quantities. 双方须具备同公司同规格有效采购单及足量未承诺数量。</p>'
          +'<div class="borrow-approval-fields"><label>Qty 箱数<input type="number" disabled aria-label="Borrowing quantity unavailable 借货数量尚不可填"></label>'
          +'<label>Reason 原因<input type="text" disabled></label></div>'
          +'<label class="borrow-approval-consent"><input type="checkbox" disabled>Approve transfer and automatic repayment 批准借货及自动补回</label>'
          +'<button type="button" class="btn primary" disabled>Approve Borrowing 批准借货</button>';
      };
      return;
    }
    const active = serial => !state.cancelled && state.serial === serial && section.isConnected !== false;
    function message(text, error = false) {
      section.innerHTML = '<h4>Borrow Stock 借货调配</h4><p role="status" class="borrow-approval-status'+(error?' error':'')+'">'+esc(text)+'</p>';
    }
    function entry() {
      section.innerHTML = '<h4>Borrow Stock 借货调配</h4><button type="button" class="btn" data-borrow-options>Check eligible P.O.s 查看可借货采购单</button>';
      section.querySelector('[data-borrow-options]').onclick = load;
    }
    async function load() {
      if (state.submitting || !canSubmit()) { message('Save or cancel existing edits first 请先保存或取消现有修改。', true); return; }
      const serial = ++state.serial; message('Checking actual stock and your replacement P.O. 正在核对可借货数量及本行补回采购单…');
      try {
        const result = await read('PURCHASE_BORROW_OPTIONS_REQUEST', { input: { borrowerTaskId: rootId } });
        if (!active(serial)) return;
        if (result?.ok !== true || result.schema !== 'CURRENT_BORROW_OPTIONS_V2' || result.company !== workspace.company
          || result.borrowerTaskId !== rootId || !count(result.expectedRevision) || !Array.isArray(result.options)
          || result.options.length > 2000 || result.stockCurrent?.schema !== 'CURRENT_STOCK_V2'
          || result.stockCurrent.stockProtocol !== meta.stockProtocol || result.stockCurrent.stockBuild !== meta.stockBuild
          || result.stockCurrent.stockGeneration !== meta.stockGeneration
          || new Set(result.options.map(o => JSON.stringify([o.lenderSourceId, o.replacementSourceId]))).size !== result.options.length
          || result.options.some(o => o.borrowerTaskId !== rootId || !o.lenderTaskId || o.lenderTaskId === rootId
            || !o.lenderSourceId || !o.replacementSourceId || !o.lenderPoId || !o.replacementPoId
            || !count(o.maximumQuantity) || o.maximumQuantity < 1 || o.maximumQuantity > 9999)) {
          throw Error('Stock changed or unconfirmed. Refresh before approval. 库存已变动或尚未确认，请刷新后批准。');
        }
        if (!result.options.length) { message('No eligible P.O. pair. Both customers must have confirmed matching P.O.s and uncommitted stock. 暂无可借货组合；双方须有同规格有效采购单及可用数量。'); return; }
        const customerName = taskId => {
          const task = workspace.tasks.find(t => t.id === taskId), customer = workspace.customers?.find(c => c.id === task?.customerId);
          return customer?.shortName || customer?.name || task?.customerId || taskId;
        };
        const identify = option => {
          const task = workspace.tasks.find(t => t.id === option.lenderTaskId), customer = workspace.customers?.find(c => c.id === task?.customerId);
          return [rowLabel?.(option.lenderTaskId), customer?.shortName || customer?.name || option.lenderCustomerId || option.lenderTaskId,
            option.lenderPoNumber || option.lenderPoId, '→', option.replacementPoNumber || option.replacementPoId,
            'Max 最多 '+option.maximumQuantity].filter(Boolean).join(' · ');
        };
        section.innerHTML = '<h4>Borrow Stock 借货调配</h4><p class="borrow-approval-for">Borrowing for 借入客户 <strong>'+esc(customerName(rootId))+'</strong></p><div class="borrow-approval-fields"><label>Eligible P.O. pair 可借货采购单组合'
          +'<select data-borrow-pair><option value="">Select 请选择</option>'+result.options.map((o, i) => '<option value="'+i+'">'+esc(identify(o))+'</option>').join('')+'</select></label>'
          +'<label>Qty 箱数<input data-borrow-quantity type="number" min="1" max="9999" step="1" inputmode="numeric" placeholder="CTN"></label>'
          +'<label>Reason 原因<input data-borrow-reason type="text" maxlength="1000"></label></div>'
          +'<div data-borrow-detail class="borrow-approval-detail" aria-live="polite">Select the P.O. pair to review both parties. 请选择采购单组合，核对借出方与补回来源。</div>'
          +'<p data-borrow-limit class="borrow-approval-limit"></p>'
          +'<label class="borrow-approval-consent"><input data-borrow-consent type="checkbox">Approve this transfer and automatic repayment from the selected future P.O. 批准本次调货，并以所选采购单后续收货自动补回。</label>'
          +'<p role="status" data-borrow-error class="borrow-approval-status error"></p><button type="button" class="btn primary" data-borrow-approve>Approve Borrowing 批准借货</button>';
        const pair = section.querySelector('[data-borrow-pair]'), quantity = section.querySelector('[data-borrow-quantity]'), reason = section.querySelector('[data-borrow-reason]'),
          consent = section.querySelector('[data-borrow-consent]'), button = section.querySelector('[data-borrow-approve]'), error = section.querySelector('[data-borrow-error]');
        const detail = section.querySelector('[data-borrow-detail]'), limit = section.querySelector('[data-borrow-limit]');
        pair.onchange = () => {
          const option = /^\d+$/.test(pair.value) ? result.options[Number(pair.value)] : null;
          quantity.max = option ? String(option.maximumQuantity) : '9999';
          // A different pair is a different future obligation. Never retain the
          // previous explicit consent or silently adjust the employee's quantity.
          consent.checked = false;
          if (!option) {
            detail.textContent = 'Select the P.O. pair to review both parties. 请选择采购单组合，核对借出方与补回来源。';
            limit.textContent = ''; return;
          }
          detail.innerHTML = '<div><span>Borrow from 借出客户</span><strong>'+esc(customerName(option.lenderTaskId))+'</strong><span>'+esc(option.lenderPoNumber || option.lenderPoId)+'</span></div>'
            +'<div><span>Repay from 补回来源</span><strong>'+esc(customerName(rootId))+'</strong><span>'+esc(option.replacementPoNumber || option.replacementPoId)+'</span></div>';
          limit.textContent = 'Checked maximum 已核对可借数量 '+option.maximumQuantity+' CTN · Order and P.O. quantities stay unchanged. 客户订单与采购单数量不变。';
        };
        button.onclick = () => {
          if (!active(serial) || state.submitting) return;
          const option = /^\d+$/.test(pair.value) ? result.options[Number(pair.value)] : null, q = Number(quantity.value), note = reason.value.trim();
          if (!canSubmit()) { error.textContent = 'Save or cancel existing edits first 请先保存或取消现有修改。'; return; }
          if (!option || !/^\d+$/.test(quantity.value) || !Number.isSafeInteger(q) || q < 1 || q > option.maximumQuantity || !note || note.length > 1000 || !consent.checked) {
            error.textContent = 'Select both P.O.s, valid quantity, reason and repayment approval. 请确认采购单、有效箱数、原因及自动补回授权。'; return;
          }
          state.submitting = true; button.disabled = true;
          try {
            submit({ borrowerTaskId: rootId, lenderSourceId: option.lenderSourceId, replacementSourceId: option.replacementSourceId,
              expectedRevision: result.expectedRevision, quantity: q, reason: note });
            error.textContent = 'Use the original save tracker to confirm or retry. 请通过原保存进度确认或重试，不重复批准。';
          } catch (e) { state.submitting = false; button.disabled = false; error.textContent = e?.message || 'Approval not submitted 尚未提交批准。'; }
        };
      } catch (error) {
        if (!active(serial)) return;
        message(error?.message || 'Borrowing options unconfirmed 可借货资料尚未确认。', true);
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn'; retry.textContent = 'Retry 重试'; retry.onclick = load; section.appendChild(retry);
      }
    }
    entry();
  }
  window.purchaseBorrowApproval = { mount };
})();
