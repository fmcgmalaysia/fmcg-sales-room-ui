const $ = selector => document.querySelector(selector);
const content = $('#content');
let current = null;
let generation = 0;
let pendingOrder = null;
let busy = false;
let dragging = '';
const calculator = new Map();
let drafts = JSON.parse(localStorage.getItem('web-quotation-qa-drafts') || '{}');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]));
const format = value => value === null || value === undefined ? '—' : new Intl.NumberFormat('en', { maximumFractionDigits: 6 }).format(value);
const customerId = () => $('#customer').value;
const view = () => ['quotes', 'catalogue', 'buyer'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'quotes';
const key = id => customerId() + '|' + id;
const requestId = () => crypto.randomUUID();
function remember() { localStorage.setItem('web-quotation-qa-drafts', JSON.stringify(drafts)); }
function message(text = '', error = false) { $('#notice').textContent = text; $('#notice').classList.toggle('error', error); }
async function api(action, body, context = customerId()) {
  const response = await fetch(`/api/${action}?customer=${encodeURIComponent(context)}&actor=${$('#actor').value}`, {
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'The request could not be completed.');
  return result;
}
function draftPrice(row, input = drafts[key(row.id)] || row.draft, roundEa = value => Number(value.toFixed(6))) {
  if (!input) return null;
  const value = input.value;
  const rate = current.customer.rateToMyr;
  const hasPack = Number.isSafeInteger(row.ea) && row.ea > 0;
  const hasFx = Number.isFinite(rate) && rate > 0;
  const hasCost = Number.isFinite(row.costMyr) && row.costMyr > 0;
  if ((input.mode === 'GP' && (!hasPack || !hasFx || !hasCost || value >= 100)) ||
      (input.mode === 'CTN' && !hasPack) || !Number.isFinite(value)) return null;
  let ea = input.mode === 'GP' ? row.costMyr / (1 - value / 100) / rate / row.ea : input.mode === 'CTN' ? value / row.ea : value;
  if (!Number.isFinite(ea) || ea <= 0) return null;
  ea = roundEa(ea);
  if (!(ea > 0)) return null;
  const rawCtn = hasPack ? ea * row.ea : null;
  const ctn = Number.isFinite(rawCtn) && rawCtn > 0 ? Number(rawCtn.toFixed(6)) : null;
  const revenue = ctn && hasFx ? ctn * rate : null;
  const profitMyr = Number.isFinite(revenue) && revenue > 0 && hasCost ? revenue - row.costMyr : null;
  return { mode: input.mode, value, priceEa: ea, priceCtn: ctn, profitMyr,
    gp: profitMyr === null ? null : profitMyr / revenue * 100 };
}
const fixed = number => Number.isFinite(number) ? number.toFixed(2) : '—';
const inputValue = number => Number.isFinite(number) ? number : '';
function calculatorInput(row) {
  return calculator.get(key(row.id)) || (row.draft?.mode === 'GP' ? row.draft : null);
}
function labeledValue(label, value, tone = '') {
  return `<div class="quote-value"><span class="quote-unit">${label}</span><span class="${tone}">${value}</span></div>`;
}
const optionalMoney = number => Number.isFinite(number) ? fixed(number) : '';
function quotationAmount(value, unit, valueAttribute = '') {
  return `<div class="quote-value quote-value-suffix"><span${valueAttribute}>${optionalMoney(value)}</span><span class="quote-unit">${unit}</span></div>`;
}
function quotationDiscount(label, value, percentage) {
  return `<div class="quote-value"><span class="quote-unit">${label}.</span><span>${optionalMoney(value)}</span><span>${percentage && Number.isFinite(value) ? '%' : ''}</span></div>`;
}
function gpTone(gp) {
  if (!Number.isFinite(gp)) return '';
  const margin = Number(gp.toFixed(2));
  return margin < 8 ? 'gp-risk' : margin > 8 ? 'gp-healthy' : '';
}
function profit(price) {
  if (!Number.isFinite(price?.gp)) return '';
  return labeledValue('GP', fixed(price.gp) + '%', gpTone(price.gp)) +
    labeledValue('CTN', fixed(price.profitMyr));
}
function riskCount() {
  return current.rows.filter(row => gpTone(draftPrice(row)?.gp) === 'gp-risk').length;
}
function quoteDate(value, withTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {})
  }).formatToParts(new Date(value));
  const { day, month, year, hour, minute } = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${day}-${month}-${year}${withTime ? ` ${hour}:${minute}` : ''}`;
}
function dirty(row) {
  const input = drafts[key(row.id)];
  return Boolean(input && (!row.draft || input.mode !== row.draft.mode || input.value !== row.draft.value));
}
function quoteChanged(row) {
  const price = draftPrice(row);
  return Boolean(price && (!row.published || price.priceEa !== row.published.priceEa || price.priceCtn !== row.published.priceCtn));
}
function quoteRow(row, number) {
  const price = draftPrice(row);
  const visible = Boolean(row.published?.enabled);
  const disabled = row.pending || busy || !current.canEdit;
  const target = calculatorInput(row);
  const suggestion = target ? draftPrice(row, target) : null;
  const details = row.costDetails || {};
  const previous = row.previousSp;
  const previousCurrency = previous?.currency !== current.customer.preferredCurrency ? escapeHtml(previous?.currency) + ' ' : '';
  const placeholder = ({ '0999000000007': '🍪', '0999000000008': '🥫', '0999000000009': '🧴', '0999000000010': '🍪' })[row.barcode] || '—';
  const desc = escapeHtml(row.name);
  return `<tr data-row="${escapeHtml(row.id)}" class="${dirty(row) ? 'row-dirty' : ''}">
    <td class="move-cell"><button type="button" class="move-row" draggable="true" aria-label="Move ${desc}" title="Drag, or use Alt + Up or Down" ${!current.canEdit ? 'disabled' : ''}>⠿</button></td>
    <td class="row-number">${String(number).padStart(3, '0')}</td>
    <td class="image-cell"><span class="demo-thumb" aria-label="Sample product icon">${placeholder}</span></td>
    <td class="desc-cell"><span class="barcode">${escapeHtml(row.barcode)}</span><div class="product-name">${desc}</div><span class="packing">${escapeHtml(row.packing)}</span></td>
    <td class="previous-sp"><span class="mobile-label">Last SP</span><span data-previous-sp>${previous ? previousCurrency + fixed(previous.priceCtn) + ' / CTN' : ''}</span><small>${quoteDate(previous?.siDate)}</small></td>
    <td><span class="mobile-label">Selling price · ${current.customer.preferredCurrency}</span><label class="quote-value quote-value-suffix"><input aria-label="Unit price for ${desc}" data-mode="EA" type="number" step="any" value="${inputValue(price?.priceEa)}" ${disabled ? 'disabled' : ''}><span class="quote-unit">EA</span></label>${quotationAmount(price?.priceCtn, 'CT', ' data-carton')}</td>
    <td><span class="mobile-label">Profit</span><span data-profit>${profit(price)}</span></td>
    <td><span class="mobile-label">List cost</span>${quotationAmount(details.lpEa, 'EA')}${quotationAmount(details.lpCtn, 'CT')}</td>
    <td class="disc-cell"><span class="mobile-label">Discount</span>${quotationDiscount(1, details.disc1, true)}${quotationDiscount(2, details.disc2, true)}${quotationDiscount(3, details.disc3, false)}</td>
    <td class="cost-cell"><span class="mobile-label">Net cost · MYR per CTN</span><b class="${details.priceStale === true && Number.isFinite(row.costMyr) ? 'stale-cost' : ''}"${details.priceStale === true ? ' title="Point Base price needs verification"' : ''}>${fixed(row.costMyr)}</b><small class="${row.costError ? 'warning' : ''}" title="${escapeHtml(row.costError || row.costAt || '')}">${row.costError ? 'Check cost' : row.costAt ? '' : 'Awaiting cost'}</small></td>
    <td class="remark-cell"><span class="mobile-label">Remark</span>${escapeHtml(details.remark || '—')}</td>
    <td><span class="mobile-label">View Quote</span><div class="quote-actions"><button role="switch" aria-label="Show quote for ${desc}" aria-checked="${visible}" class="switch" data-action="toggle" ${disabled || (!visible && (!price || row.costMyr === null)) ? 'disabled' : ''}></button><span class="quote-label">${row.pending ? 'Confirming…' : visible ? quoteDate(row.published.publishedAt) : ''}</span></div>
    <div class="quote-actions quote-edits"><button class="update" data-action="draft" ${disabled || !dirty(row) || !price ? 'disabled' : ''}>Save draft</button>${visible ? `<button class="update primary" data-action="publish" ${disabled || !quoteChanged(row) ? 'disabled' : ''}>Update quote</button>` : ''}</div></td>
    <td class="calc-cell"><span class="mobile-label">Margin</span><input aria-label="Target margin for ${desc}" data-calc="GP" type="number" step="1" placeholder="0%" value="${inputValue(target?.mode === 'GP' ? target.value : Number.isFinite(suggestion?.gp) ? Math.round(suggestion.gp) : null)}" ${disabled ? 'disabled' : ''}></td>
    <td class="calc-cell"><span class="mobile-label">Selling</span><input aria-label="Target unit price for ${desc}" data-calc="EA" type="number" step="any" placeholder="0.00" value="${target?.mode === 'EA' ? inputValue(target.value) : suggestion ? fixed(suggestion.priceEa) : ''}" ${disabled ? 'disabled' : ''}></td>
    <td class="calc-cell"><button type="button" class="update primary" data-action="apply" aria-label="Apply calculator for ${desc}" ${disabled || !suggestion ? 'disabled' : ''}>Apply</button></td>
  </tr>`;
}
function quoteRows() {
  const order = JSON.parse(localStorage.getItem('qa-quote-order:' + customerId()) || '[]');
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...current.rows].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}
function renderQuotes() {
  const search = $('#search').value.toLowerCase();
  const rows = quoteRows().filter(row => [row.name, row.barcode, row.packing, row.costDetails?.remark].join(' ').toLowerCase().includes(search));
  const currency = current.customer.preferredCurrency;
  const quoted = current.rows.filter(row => row.published?.enabled).length;
  const risk = riskCount();
  const latestCost = current.rows.reduce((latest, row) => Date.parse(row.costAt) > Date.parse(latest) ||
    (!latest && Number.isFinite(Date.parse(row.costAt))) ? row.costAt : latest, '');
  const customerName = escapeHtml(current.customer.fullName || current.customer.name || $('#customer').selectedOptions[0]?.textContent || '');
  content.innerHTML = `<div class="toolbar quote-summary"><div>
    <div class="quote-customer"><h2>${customerName}</h2><span class="currency">${currency}</span></div>
    <div class="toolbar-meta"><span class="muted">Current FX &nbsp; 1 ${currency} = MYR ${format(current.customer.rateToMyr)}</span><span class="muted">Last Cost Refresh &nbsp; ${quoteDate(latestCost, true) || '—'}</span><button class="primary" id="catch-cost" ${busy || !current.canEdit || !current.rows.length ? 'disabled' : ''}>${busy ? 'Working…' : 'Catch Cost'}</button></div>
    </div><dl class="quote-counts"><div><dt>Total Selected</dt><dd>${current.rows.length}</dd></div><div><dt>Quoted</dt><dd>${quoted}</dd></div><div><dt>Awaiting Quote</dt><dd>${current.rows.length - quoted}</dd></div><div><dt>High-Risk Quotes</dt><dd id="quote-risk-count" class="${risk ? 'gp-risk' : ''}">${risk}</dd></div></dl></div>` + (rows.length ? `
    <div class="table-wrap quote-grid"><table><colgroup>${[24, 34, 35, '', 77, 86, 72, 70, 73, 66, 156, 89, 45, 48, 42].map(width => `<col${width ? ` style="width:${width}px"` : ''}>`).join('')}</colgroup>
    <thead><tr><th rowspan="2" aria-label="Move"></th><th rowspan="2">Row</th><th rowspan="2">Image</th><th rowspan="2">Descriptions</th><th class="quote-left" rowspan="2">Last SP</th><th class="quote-left" rowspan="2">Selling Price</th><th class="quote-left" rowspan="2">Profit<small>MYR</small></th><th rowspan="2">List Cost<small>MYR</small></th><th rowspan="2">Disc</th><th rowspan="2">Net Cost<small>MYR · CTN</small></th><th rowspan="2">Remark</th><th rowspan="2">View Quote</th><th class="calc-cell calc-group" colspan="3">Target Profit Calculator</th></tr>
    <tr class="calc-headings"><th class="calc-cell">Margin</th><th class="calc-cell">Selling</th><th class="calc-cell" aria-label="Apply"></th></tr></thead>
    <tbody>${rows.map((row, index) => quoteRow(row, index + 1)).join('')}</tbody></table></div>` :
    `<div class="empty">${current.rows.length ? 'No matching products.' : 'Products selected in Catalogue appear here.'}<br><button data-go="catalogue">Open Catalogue</button></div>`);
}
function renderCatalogue() {
  const selected = new Set(current.selected.selectedProductIds);
  const search = $('#search').value.toLowerCase();
  content.innerHTML = `<div class="product-grid">${current.products.filter(product => [product.name, product.barcode].join(' ').toLowerCase().includes(search)).map(product => `<article class="product-card"><span class="barcode">${escapeHtml(product.barcode)}</span><h2>${escapeHtml(product.name)}</h2><p>${escapeHtml(product.description)}</p><button class="${selected.has(product._id) ? '' : 'primary'}" data-select="${product._id}" ${selected.has(product._id) ? 'disabled' : ''}>${selected.has(product._id) ? 'Selected' : 'Select for quote'}</button></article>`).join('')}</div>`;
}
function renderBuyer() {
  content.innerHTML = `<div class="buyer-list">${current.myList.map(row => `<article class="buyer-item" data-item="${escapeHtml(row.id)}"><div><span class="barcode">${escapeHtml(row.barcode)}</span><h2>${escapeHtml(row.itemName)}</h2><p>${escapeHtml(row.packingSize)}</p></div><div>${row.quoteActive ? `<b>${current.context.currency} ${format(row.vipPriceCtn)}</b><small class="packing">per carton</small>` : '<span class="status-tag">Awaiting quotation</span>'}</div><label class="muted">Quantity CTN<input type="number" min="0" step="1" value="0" data-qty="${escapeHtml(row.id)}" aria-label="Quantity for ${escapeHtml(row.itemName)}" ${row.quoteActive ? '' : 'disabled'}></label></article>`).join('') || '<div class="empty">Choose products in Catalogue to request a quotation.</div>'}</div><div class="buyer-actions"><button data-go="catalogue">Add more items</button><button id="download" ${current.myList.length ? '' : 'disabled'}>Download Excel</button><button class="primary" id="order" ${current.myList.some(row => row.quoteActive) ? '' : 'disabled'}>Send order request</button></div>${current.orders.length ? `<div class="orders"><h2>Order requests</h2>${current.orders.map(order => `<p>${escapeHtml(order.orderId)}<br>${order.totalCartons} CTN · ${order.currency} ${format(order.estimatedTotal)} · ${escapeHtml(order.status)}</p>`).join('')}</div>` : ''}`;
}
function render() {
  if (!current) return;
  if (view() === 'quotes') renderQuotes();
  else if (view() === 'catalogue') renderCatalogue();
  else renderBuyer();
}
async function refresh() {
  const token = ++generation;
  const target = view();
  $('#company').hidden = target === 'quotes';
  $('#title').textContent = { quotes: 'Quotations', catalogue: 'Catalogue', buyer: 'Buyer Room' }[target];
  document.querySelectorAll('nav a').forEach(link => link.classList.toggle('active', link.dataset.view === target));
  try {
    const result = await api({ quotes: 'quotes', catalogue: 'catalogue', buyer: 'buyer' }[target]);
    if (generation !== token) return;
    current = result;
    render();
  } catch (error) {
    if (generation !== token) return;
    current = null; content.innerHTML = '<div class="empty">This workspace is unavailable for the selected QA identity.</div>'; message(error.message, true);
  }
}
async function saveDraft(row, context) {
  const draftKey = context + '|' + row.id;
  const input = drafts[draftKey];
  if (!input || !dirty(row)) return row.revision;
  const savedInput = JSON.stringify(input);
  const result = await api('draft', { selectionId: row.id, input, revision: row.revision, requestId: requestId() }, context);
  if (JSON.stringify(drafts[draftKey]) === savedInput) { delete drafts[draftKey]; remember(); }
  return result.revision;
}
function editPrice(row, tr, next, updateEa = false) {
  drafts[key(row.id)] = next;
  if (row.draft && next.mode === row.draft.mode && next.value === row.draft.value) delete drafts[key(row.id)];
  remember();
  const price = draftPrice(row);
  if (updateEa) tr.querySelector('[data-mode=EA]').value = inputValue(price?.priceEa);
  tr.querySelector('[data-carton]').textContent = optionalMoney(price?.priceCtn);
  tr.querySelector('[data-profit]').innerHTML = profit(price);
  const risk = riskCount();
  const count = $('#quote-risk-count');
  count.textContent = risk;
  count.classList.toggle('gp-risk', Boolean(risk));
  tr.classList.toggle('row-dirty', dirty(row));
  tr.querySelector('[data-action=draft]').disabled = !dirty(row) || !price;
  tr.querySelector('[data-action=toggle]').disabled = !row.published?.enabled && (!price || row.costMyr === null);
  const update = tr.querySelector('[data-action=publish]');
  if (update) update.disabled = !quoteChanged(row);
}
content.addEventListener('input', event => {
  const input = event.target.closest('[data-mode], [data-calc]');
  if (!input || input.disabled || busy) return;
  const tr = input.closest('[data-row]');
  const row = current.rows.find(row => row.id === tr.dataset.row);
  const value = input.value === '' ? null : input.dataset.calc === 'GP' ? Math.trunc(Number(input.value)) : Number(input.value);
  if (input.dataset.calc === 'GP' && value !== null && Number(input.value) !== value) input.value = value;
  if (input.dataset.mode) {
    editPrice(row, tr, { mode: 'EA', value });
    return;
  }
  const next = { mode: input.dataset.calc, value };
  calculator.set(key(row.id), next);
  const price = draftPrice(row, next);
  const other = tr.querySelector(`[data-calc=${next.mode === 'GP' ? 'EA' : 'GP'}]`);
  const calculated = next.mode === 'GP' ? price?.priceEa : price?.gp;
  other.value = Number.isFinite(calculated) ? next.mode === 'GP' ? fixed(calculated) : Math.round(calculated) : '';
  tr.querySelector('[data-action=apply]').disabled = !price;
});
function moveQuoteRow(from, to) {
  if (!current?.canEdit || busy || from === to) return;
  const ids = quoteRows().map(row => row.id);
  const source = ids.indexOf(from), target = ids.indexOf(to);
  if (source < 0 || target < 0) return;
  ids.splice(source, 1);
  ids.splice(target, 0, from);
  localStorage.setItem('qa-quote-order:' + customerId(), JSON.stringify(ids));
  renderQuotes();
  content.querySelector(`[data-row="${CSS.escape(from)}"] .move-row`)?.focus({ preventScroll: true });
}
content.addEventListener('dragstart', event => {
  const handle = event.target.closest('.move-row');
  if (!handle || handle.disabled || busy) { event.preventDefault(); return; }
  dragging = handle.closest('[data-row]').dataset.row;
  event.dataTransfer.setData('text/plain', dragging);
  event.dataTransfer.effectAllowed = 'move';
});
content.addEventListener('dragover', event => {
  if (dragging && event.target.closest('[data-row]')) event.preventDefault();
});
content.addEventListener('drop', event => {
  const target = event.target.closest('[data-row]');
  if (!dragging || !target) return;
  event.preventDefault();
  moveQuoteRow(dragging, target.dataset.row);
  dragging = '';
});
content.addEventListener('dragend', () => { dragging = ''; });
content.addEventListener('keydown', event => {
  const handle = event.target.closest('.move-row');
  if (!handle || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const row = handle.closest('[data-row]');
  const target = event.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
  if (!target) return;
  event.preventDefault();
  moveQuoteRow(row.dataset.row, target.dataset.row);
});
content.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled || busy) return;
  if (button.dataset.action === 'apply') {
    const tr = button.closest('[data-row]');
    const row = current.rows.find(item => item.id === tr.dataset.row);
    const input = calculatorInput(row);
    if (input && draftPrice(row, input)) editPrice(row, tr, input, true);
    return;
  }
  if (button.dataset.go) { location.hash = button.dataset.go; return; }
  if (button.id === 'download') { location.href = `/api/excel?customer=${customerId()}`; return; }
  const context = customerId();
  const targetView = view();
  busy = true; button.disabled = true;
  message();
  try {
    let result;
    if (button.dataset.select) { result = await api('select', { productId: button.dataset.select }); message('Product added to your selection.'); }
    else if (button.id === 'catch-cost') {
      result = await api('cost', {});
      message(`${result.updated} costs updated${result.failed ? ` · ${result.failed} could not be confirmed` : ''}${result.pending ? ` · ${result.pending} awaiting quote confirmation` : ''}.`, result.failed > 0);
    } else if (button.dataset.action) {
      const row = current.rows.find(row => row.id === button.closest('[data-row]').dataset.row);
      const action = button.dataset.action;
      // Hiding a live quotation must not depend on an unfinished price edit.
      // Keep that edit locally so it can be completed after the quote is hidden.
      const hiding = action === 'toggle' && row.published?.enabled;
      const revision = hiding ? row.revision : await saveDraft(row, context);
      if (action === 'draft') message('Draft saved.');
      else {
        const enabled = action === 'publish' || !row.published?.enabled;
        result = await api('publish', { selectionId: row.id, enabled, revision, requestId: requestId() }, context);
        message(result.pending ? result.message : enabled ? 'Quotation is visible to this customer.' : 'Quotation hidden. Existing orders retain their prices.');
      }
    } else if (button.id === 'order') {
      const lines = [...content.querySelectorAll('[data-qty]')].filter(input => Number(input.value) > 0).map(input => ({ itemId: input.dataset.qty, quantityCtn: Number(input.value) }));
      if (!lines.length) throw Error('Enter an order quantity.');
      const fingerprint = JSON.stringify([context, lines]);
      if (!pendingOrder || pendingOrder.fingerprint !== fingerprint) pendingOrder = { fingerprint, requestId: requestId() };
      result = await api('order', { lines, requestId: pendingOrder.requestId });
      pendingOrder = null;
      message('Order request received.');
    }
  } catch (error) { message(error.message, true); }
  finally {
    busy = false;
    if (context === customerId() && targetView === view()) await refresh();
  }
});
$('#menu').onclick = () => {
  const open = $('#navigation').classList.toggle('open'); $('#menu').setAttribute('aria-expanded', String(open));
};
function contextChange() {
  message(); pendingOrder = null; $('#search').value = '';
  $('#staff').textContent = { sales: 'QA Sales', admin: 'QA Admin', support: 'QA Support' }[$('#actor').value];
  refresh();
}
$('#customer').onchange = contextChange;
$('#actor').onchange = contextChange;
$('#search').oninput = render;
window.onhashchange = () => { message(); $('#search').value = ''; $('#navigation').classList.remove('open'); $('#menu').setAttribute('aria-expanded', 'false'); refresh(); };
setInterval(() => { if (!busy && view() === 'quotes' && current?.rows?.some(row => row.pending) && !document.activeElement.matches('input')) refresh(); }, 2000);
refresh();
