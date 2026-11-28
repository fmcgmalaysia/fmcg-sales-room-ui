(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const company = params.get('company');
  if (params.get('embedded') !== 'account' || !['NCT', 'GHR'].includes(company)) return;

  const trigger = document.getElementById('opening-stock');
  const dialog = document.getElementById('opening-stock-dialog');
  const form = dialog.querySelector('form');
  const field = name => form.elements.namedItem(name);
  const previewButton = field('preview');
  const saveButton = field('save');
  const retryButton = field('retry');
  const detail = dialog.querySelector('[data-product]');
  const summary = dialog.querySelector('[data-quantities]');
  const notice = dialog.querySelector('[data-feedback]');
  const countFields = dialog.querySelector('[data-count-fields]');
  const costFields = dialog.querySelector('[data-cost-fields]');
  const origin = location.origin === 'null' ? '*' : location.origin;
  let pending = null;
  let preview = null;
  let timer;
  let sessionKey;
  let unresolved = null;
  const status = message => { notice.textContent = message; };
  const number = value => value === null ? 'Review required' : Number(value).toLocaleString('en-GB');

  function refreshForm() {
    const busy = Boolean(pending);
    const adding = preview && !preview.opening;
    const missingCost = preview?.opening?.costPending;
    const counted = field('counted').valueAsNumber;
    countFields.hidden = !adding || Boolean(unresolved);
    costFields.hidden = (!adding && !missingCost) || Boolean(unresolved);
    previewButton.disabled = busy || Boolean(unresolved);
    field('barcode').disabled = busy || Boolean(unresolved);
    retryButton.hidden = !unresolved;
    retryButton.disabled = busy;
    saveButton.hidden = Boolean(unresolved) || !adding && !missingCost;
    saveButton.disabled = busy || (adding && (!Number.isSafeInteger(counted) || counted < preview.onHand));
    saveButton.textContent = missingCost ? 'Confirm cost' : 'Post opening stock';
    if (!preview) { detail.textContent = ''; summary.textContent = ''; return; }
    detail.textContent = [preview.name, preview.barcode, preview.packing].join(' · ');
    summary.textContent = 'On hand ' + number(preview.onHand) + ' CTN · Reserved ' + number(preview.reserved) +
      ' CTN · Available ' + number(preview.available) + ' CTN · Isolated ' + number(preview.isolated) + ' CTN';
    if (adding && preview.incoming) summary.textContent += ' · Open P.O. ' + number(preview.incoming) + ' CTN';
    if (adding && Number.isSafeInteger(counted) && counted >= preview.onHand) {
      summary.textContent += ' · To add ' + number(counted - preview.onHand) + ' CTN';
    } else if (adding && Number.isSafeInteger(counted)) {
      summary.textContent += ' · A lower count requires Stock Take review.';
    }
    if (preview.opening) summary.textContent += ' · Opening count ' + number(preview.opening.counted) +
      ' CTN · Added ' + number(preview.opening.added) + ' CTN · ' + preview.opening.reference;
  }

  function send(kind, input = {}, requestId = crypto.randomUUID()) {
    if (pending) return;
    pending = { kind, requestId };
    refreshForm();
    if (kind !== 'ACCESS') status(kind === 'PREVIEW' ? 'Checking current stock…' : 'Waiting for the Finance receipt…');
    parent.postMessage({ type: 'FINANCE_OPENING_STOCK_' + kind + '_REQUEST', company, requestId, input }, origin);
    timer = setTimeout(() => {
      pending = null;
      refreshForm();
      if (kind !== 'ACCESS') status(kind === 'SAVE' ? 'Receipt unconfirmed. Retry the same save.' : 'Stock read timed out. Try again.');
    }, 35000);
  }

  function reset() {
    form.reset();
    preview = null;
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16);
    field('countedAt').value = today;
    status(unresolved ? 'A previous save has no confirmed receipt. Check the same save first.' : '');
    refreshForm();
  }

  trigger.addEventListener('click', () => { reset(); dialog.showModal(); });
  field('close').addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  field('barcode').addEventListener('input', () => { preview = null; refreshForm(); });
  field('counted').addEventListener('input', refreshForm);
  previewButton.addEventListener('click', () => {
    if (field('barcode').reportValidity()) {
      preview = null;
      send('PREVIEW', { barcode: field('barcode').value.trim() });
    }
  });
  retryButton.addEventListener('click', () => { if (unresolved) send('SAVE', unresolved.input, unresolved.requestId); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!preview || pending || unresolved || saveButton.disabled) return;
    const isCost = Boolean(preview.opening?.costPending);
    const requiredFields = isCost ? ['unitCost', 'reference'] : ['counted', 'countedAt', 'countConfirmed', 'unitCost', 'reference'];
    if (requiredFields.some(name => !field(name).reportValidity())) return;
    const unitCost = field('unitCost').value.trim();
    if (isCost && !unitCost) { status('Enter the verified cost in MYR per carton.'); return; }
    const input = { mode: isCost ? 'CONFIRM_COST' : 'POST', barcode: preview.barcode, version: preview.version,
      reference: field('reference').value.trim(), unitCostScaled: unitCost ? Math.round(Number(unitCost) * 10000) : null };
    if (!isCost) Object.assign(input, { counted: field('counted').valueAsNumber, countConfirmed: field('countConfirmed').checked,
      countedAt: new Date(field('countedAt').value + ':00+08:00').toISOString() });
    unresolved = { input, requestId: crypto.randomUUID() };
    try { sessionStorage.setItem(sessionKey, JSON.stringify(unresolved)); }
    catch (_) { unresolved = null; status('The browser cannot retain a save receipt. Enable session storage to continue.'); return; }
    send('SAVE', unresolved.input, unresolved.requestId);
  });
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== parent || event.origin !== location.origin || !message || message.company !== company ||
        !pending || message.requestId !== pending.requestId ||
        message.type !== 'FINANCE_OPENING_STOCK_' + pending.kind + '_RESULT') return;
    const kind = pending.kind;
    clearTimeout(timer);
    pending = null;
    if (kind === 'ACCESS') {
      if (message.ok && message.result?.allowed === true && /^[a-f0-9]{32}$/.test(message.result.recoveryScope || '')) {
        sessionKey = 'finance-opening-stock-pending:' + message.result.recoveryScope;
        try { unresolved = JSON.parse(sessionStorage.getItem(sessionKey)); } catch (_) { /* New session. */ }
        if (!unresolved?.requestId || !unresolved?.input) unresolved = null;
        trigger.hidden = false;
      }
    } else if (kind === 'PREVIEW') {
      preview = message.ok ? message.result : null;
      status(!message.ok ? message.error : preview.opening ?
        preview.opening.costPending ? 'Opening stock recorded. Cost is pending.' : 'Opening stock has already been recorded.' :
        'Enter the physical count from your cutover record.');
    } else {
      if (message.ok && message.result?.ok === true) {
        const saved = unresolved;
        sessionStorage.removeItem(sessionKey);
        unresolved = null;
        preview = null;
        status(saved.input.mode === 'CONFIRM_COST' ? 'Opening cost confirmed.' :
          number(message.result.added) + ' CTN added. Opening count ' + number(message.result.counted) + ' CTN.');
        parent.postMessage({ type: 'FINANCE_OPENING_STOCK_REFRESH', company }, origin);
      } else if (message.result?.rejected === true) {
        sessionStorage.removeItem(sessionKey);
        unresolved = null;
        preview = null;
        status(message.error);
      } else {
        status(message.error || 'Receipt unconfirmed. Retry the same save.');
      }
    }
    refreshForm();
  });
  send('ACCESS');
})();
