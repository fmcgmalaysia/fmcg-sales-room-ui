const $ = selector => document.querySelector(selector);
const content = $('#content');
let current = null;
let generation = 0;
let pendingOrder = null;
let busy = false;
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
function draftPrice(row) {
  const input = drafts[key(row.id)] || row.draft;
  if (!input) return null;
  const value = input.value;
  const rate = current.customer.rateToMyr;
  let ea = input.mode === 'GP' ? row.costMyr / (1 - value / 100) / rate / row.ea : input.mode === 'CTN' ? value / row.ea : value;
  if (value === null || !Number.isFinite(value) || (input.mode === 'GP' && (value >= 100 || !(row.costMyr > 0))) || !(ea > 0)) return null;
  ea = Number(ea.toFixed(6));
  const ctn = Number((ea * row.ea).toFixed(6));
  return { mode: input.mode, value, priceEa: ea, priceCtn: ctn, gp: row.costMyr === null ? null : (ctn * rate - row.costMyr) / (ctn * rate) * 100 };
}
function dirty(row) {
  const input = drafts[key(row.id)];
  return Boolean(input && (!row.draft || input.mode !== row.draft.mode || input.value !== row.draft.value));
}
function quoteChanged(row) {
  const price = draftPrice(row);
  return Boolean(price && (!row.published || price.priceEa !== row.published.priceEa || price.priceCtn !== row.published.priceCtn));
}
function quoteRow(row) {
  const price = draftPrice(row);
  const gp = price?.mode === 'GP' ? price.value : price?.gp;
  const visible = Boolean(row.published?.enabled);
  const disabled = row.pending || busy || !current.canEdit;
  const value = number => number === undefined || number === null ? '' : Number(number.toFixed(6));
  return `<tr data-row="${escapeHtml(row.id)}" class="${dirty(row) ? 'row-dirty' : ''}">
    <td><span class="barcode">${escapeHtml(row.barcode)}</span><div class="product-name">${escapeHtml(row.name)}</div><span class="packing">${escapeHtml(row.packing)}</span></td>
    <td class="cost-cell"><span class="mobile-label">Net cost · MYR / CTN</span><span class="value">${format(row.costMyr)}</span><small class="${row.costError ? 'warning' : ''}">${escapeHtml(row.costError || (row.costAt ? 'Caught ' + new Date(row.costAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Awaiting Catch Cost'))}</small></td>
    <td><label class="input-label" for="gp-${row.id}">Target GP %</label><input id="gp-${row.id}" aria-label="Target GP for ${escapeHtml(row.name)}" data-mode="GP" type="number" step="any" value="${value(gp)}" ${disabled ? 'disabled' : ''}><small class="field-note">${price?.mode === 'GP' ? 'Target GP pricing' : 'Calculated GP'}</small></td>
    <td><label class="input-label" for="ea-${row.id}">Unit price · ${current.customer.preferredCurrency}</label><input id="ea-${row.id}" aria-label="Unit price for ${escapeHtml(row.name)}" data-mode="EA" type="number" step="any" value="${value(price?.priceEa)}" ${disabled ? 'disabled' : ''}></td>
    <td><label class="input-label" for="ctn-${row.id}">Carton price · ${current.customer.preferredCurrency}</label><input id="ctn-${row.id}" aria-label="Carton price for ${escapeHtml(row.name)}" data-mode="CTN" type="number" step="any" value="${value(price?.priceCtn)}" ${disabled ? 'disabled' : ''}></td>
    <td><span class="mobile-label">Customer quote</span><div class="quote-actions"><button role="switch" aria-label="Show quote for ${escapeHtml(row.name)}" aria-checked="${visible}" class="switch" data-action="toggle" ${disabled || (!visible && (!price || row.costMyr === null)) ? 'disabled' : ''}></button><span class="quote-label">${row.pending ? 'Confirming…' : visible ? 'Visible' : 'Not shown'}</span></div>
    <div class="live-price">${visible ? `${row.published.currency} ${format(row.published.priceCtn)} / CTN` : 'Set a price to publish'}${visible && row.publishedGp !== null ? `<br><span class="${row.publishedGp < 0 ? 'gp-negative' : ''}">Current GP ${Number(row.publishedGp.toFixed(2))}%</span>` : ''}</div>
    <div class="quote-actions"><button class="update" data-action="draft" ${disabled || !dirty(row) || !price ? 'disabled' : ''}>Save draft</button>${visible ? `<button class="update primary" data-action="publish" ${disabled || !quoteChanged(row) ? 'disabled' : ''}>Update quote</button>` : ''}</div></td>
  </tr>`;
}
function renderQuotes() {
  const search = $('#search').value.toLowerCase();
  const rows = current.rows.filter(row => [row.name, row.barcode, row.packing].join(' ').toLowerCase().includes(search));
  content.innerHTML = `<div class="toolbar"><div class="toolbar-meta"><span class="currency">${current.customer.preferredCurrency}</span><span class="muted">${current.rows.length} products · 1 ${current.customer.preferredCurrency} = MYR ${format(current.customer.rateToMyr)}</span></div><button class="primary" id="catch-cost" ${busy || !current.canEdit || !current.rows.length ? 'disabled' : ''}>${busy ? 'Working…' : 'Catch Cost'}</button></div>` + (rows.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Net Cost<small>MYR / CTN</small></th><th>Target GP<small>%</small></th><th>Unit Price<small>${current.customer.preferredCurrency} / EA</small></th><th>Carton Price<small>${current.customer.preferredCurrency} / CTN</small></th><th>Customer Quote</th></tr></thead><tbody>${rows.map(quoteRow).join('')}</tbody></table></div>` : `<div class="empty">${current.rows.length ? 'No matching products.' : 'Products selected in Catalogue appear here.'}<br><button data-go="catalogue">Open Catalogue</button></div>`);
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
content.addEventListener('input', event => {
  const input = event.target.closest('[data-mode]');
  if (!input) return;
  const tr = input.closest('[data-row]');
  const row = current.rows.find(row => row.id === tr.dataset.row);
  const next = { mode: input.dataset.mode, value: input.value === '' ? null : Number(input.value) };
  drafts[key(row.id)] = next;
  if (row.draft && next.mode === row.draft.mode && next.value === row.draft.value) delete drafts[key(row.id)];
  remember();
  const price = draftPrice(row);
  const values = { GP: price?.mode === 'GP' ? price.value : price?.gp, EA: price?.priceEa, CTN: price?.priceCtn };
  tr.querySelectorAll('[data-mode]').forEach(field => {
    if (field !== input) field.value = values[field.dataset.mode] === undefined || values[field.dataset.mode] === null ? '' : Number(values[field.dataset.mode].toFixed(6));
  });
  tr.classList.toggle('row-dirty', dirty(row));
  tr.querySelector('.field-note').textContent = next.mode === 'GP' ? 'Target GP pricing' : 'Calculated GP';
  tr.querySelector('[data-action=draft]').disabled = !dirty(row) || !price;
  tr.querySelector('[data-action=toggle]').disabled = !row.published?.enabled && (!price || row.costMyr === null);
  const update = tr.querySelector('[data-action=publish]');
  if (update) update.disabled = !quoteChanged(row);
});
content.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled || busy) return;
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
  $('#company').value = customerId() === 'QA-A' ? 'NCT' : 'GHR';
  $('#company-name').textContent = $('#company').value === 'NCT' ? 'North Cape Trading Sdn. Bhd.' : 'Global HR';
  refresh();
}
$('#customer').onchange = contextChange;
$('#actor').onchange = contextChange;
$('#company').onchange = () => { $('#customer').value = $('#company').value === 'NCT' ? 'QA-A' : 'QA-B'; contextChange(); };
$('#search').oninput = render;
window.onhashchange = () => { message(); $('#search').value = ''; $('#navigation').classList.remove('open'); $('#menu').setAttribute('aria-expanded', 'false'); refresh(); };
setInterval(() => { if (!busy && view() === 'quotes' && current?.rows?.some(row => row.pending) && !document.activeElement.matches('input')) refresh(); }, 2000);
refresh();
