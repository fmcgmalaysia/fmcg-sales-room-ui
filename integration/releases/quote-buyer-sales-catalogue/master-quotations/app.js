/* The generator appends the approved grid and calculator. The Wix page
 * supplies scope through postMessage. This iframe never assigns a role. */
const $ = selector => document.querySelector(selector);
const content = $('#content');
const trustedParents = new Set(['https://www.ltpos.ai', 'https://ltpos.ai', 'https://fmcg999.wixstudio.com']);
const referrerOrigin = document.referrer ? new URL(document.referrer).origin : '';
let trustedParent = trustedParents.has(referrerOrigin) ? referrerOrigin : '';
const requests = new Map();
const calculator = new Map();
const publicationAttempts = new Map();
const publishingRows = new Set();
let publicationRead;
let current = null;
let staffId = '';
let generation = 0;
let busy = false;
let drafts = {};

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, value =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]);
const format = value => value == null ? '—' : new Intl.NumberFormat('en', { maximumFractionDigits: 6 }).format(value);
const customerId = () => $('#customer').value;
const key = id => JSON.stringify([staffId, customerId(), id]);
const requestId = () => crypto.randomUUID();
const compareSortIds = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;
const formatCents = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 2 }).format;
const roundCents = value => Number(formatCents(value));
const calculatorPrice = (row, input) => draftPrice(row, input, roundCents);
const calculatorMatchesPrice = (price, suggestion) => suggestion?.priceEa > 0 && price?.priceEa > 0 &&
  roundCents(price.priceEa) === suggestion.priceEa;
const desktopGrid = window.matchMedia('(min-width: 601px)');
const quoteOverscan = 16;
let quoteWindow;
let quoteFrame = 0;

function initialQuoteRows(rows) {
  return desktopGrid.matches && rows.length > 120 ? '' : rows.map((row, index) => quoteRow(row, index + 1)).join('');
}

function mountQuoteRows(rows, scrollPosition) {
  const body = content.querySelector('.quote-grid tbody');
  quoteWindow = body && { body, rows, scroller: body.closest('.quote-grid') };
  if (!quoteWindow) return;
  updateQuoteWindow(scrollPosition?.top);
  if (desktopGrid.matches && scrollPosition) {
    quoteWindow.scroller.scrollTo(scrollPosition.left, scrollPosition.top);
  }
}

function updateQuoteWindow(scrollTop) {
  if (!quoteWindow || !quoteWindow.body.isConnected) return;
  const { body, rows, scroller } = quoteWindow;
  if (rows.length <= 120) return;
  const virtual = desktopGrid.matches;
  scroller.classList.toggle('windowed-quote-grid', virtual);
  const quoteRowHeight = parseFloat(getComputedStyle(scroller).getPropertyValue('--quote-row-height'));
  const first = virtual ? Math.min(rows.length - 1,
    Math.max(0, Math.floor((scrollTop ?? scroller.scrollTop) / quoteRowHeight) - quoteOverscan)) : 0;
  const end = virtual ? Math.min(rows.length, first + Math.ceil(scroller.clientHeight / quoteRowHeight) + quoteOverscan * 2) : rows.length;
  if (quoteWindow.first === first && quoteWindow.end === end) return;
  quoteWindow.first = first;
  quoteWindow.end = end;

  const active = body.contains(document.activeElement) ? document.activeElement : null;
  const retained = new Map([...body.querySelectorAll('tr[data-row]')].map(row => [row.dataset.row, row]));
  const wanted = new Set(rows.slice(first, end).map(row => row.id));
  if (active && !wanted.has(active.closest('[data-row]').dataset.row)) active.blur();
  for (const [id, element] of retained) if (!wanted.has(id)) element.remove();
  for (const spacer of body.querySelectorAll('.quote-spacer')) spacer.remove();

  let anchor = body.firstElementChild;
  for (let index = first; index < end; index++) {
    const row = rows[index];
    const element = retained.get(row.id);
    if (element === anchor && element) anchor = anchor.nextElementSibling;
    else if (!element) {
      if (anchor) anchor.insertAdjacentHTML('beforebegin', quoteRow(row, index + 1));
      else body.insertAdjacentHTML('beforeend', quoteRow(row, index + 1));
    }
  }
  const spacer = count => `<tr class="quote-spacer" aria-hidden="true"><td colspan="14" style="height:${count * quoteRowHeight}px"></td></tr>`;
  if (first) body.insertAdjacentHTML('afterbegin', spacer(first));
  if (end < rows.length) body.insertAdjacentHTML('beforeend', spacer(rows.length - end));
}

function queueQuoteWindow() {
  if (quoteFrame) return;
  quoteFrame = requestAnimationFrame(() => {
    quoteFrame = 0;
    updateQuoteWindow();
  });
}
content.addEventListener('scroll', queueQuoteWindow, { capture: true, passive: true });
window.addEventListener('resize', queueQuoteWindow, { passive: true });

function quoteRows() {
  const withSortId = [];
  const withoutSortId = [];
  for (const row of current.rows) {
    (row.sortId ? withSortId : withoutSortId).push(row);
  }
  withSortId.sort((left, right) => compareSortIds(left.sortId, right.sortId));
  return withSortId.concat(withoutSortId);
}

function sellingPrice(row) {
  const local = drafts[key(row.id)];
  if (!local && row.published?.enabled) return draftPrice(row, { mode: 'EA', value: row.published.priceEa });
  return draftPrice(row);
}

function updateCalculatorApply(row, tr, price, suggestion) {
  const button = tr.querySelector('[data-action=apply]');
  const applied = calculatorMatchesPrice(price, suggestion);
  button.toggleAttribute('data-applied', applied);
  button.setAttribute('aria-label', `${applied ? 'Calculator price applied to' : 'Apply calculator for'} ${row.name}`);
  button.disabled = applied || !suggestion || !current.canEdit || row.pending || busy;
}

function readStorage(name, fallback) {
  try { return JSON.parse(localStorage.getItem('master-quotations-v1:' + name)) ?? fallback; }
  catch { return fallback; }
}
function writeStorage(name, value) {
  try { localStorage.setItem('master-quotations-v1:' + name, JSON.stringify(value)); }
  catch { /* Remain usable if storage is unavailable in a framed browser. */ }
}
function remember() { writeStorage('drafts:' + staffId, drafts); }
function rememberPublications() { writeStorage('publishes:' + staffId, [...publicationAttempts.entries()]); }
function quoteResumeButton(row) {
  return current.canEdit && current.canPublish !== false && !publishingRows.has(row.id) && publicationAttempts.has(key(row.id))
    ? '<button class="update primary" data-action="resume">Confirm status</button>' : '';
}
function message(value = '', error = false, warning = false) {
  $('#notice').textContent = value;
  $('#notice').classList.toggle('error', error);
  $('#notice').classList.toggle('cost-warning', warning);
}

function productImage(value) {
  try {
    const url = new URL(value);
    if (url.origin === 'https://static.wixstatic.com' && url.pathname.startsWith('/media/')) {
      return '<img class="product-thumb" loading="lazy" width="58" height="52" alt="" src="' + escapeHtml(url.href) + '">';
    }
  } catch { /* Unknown product image. */ }
  return '<span class="empty-thumb">—</span>';
}

const productPreview = document.createElement('img');
productPreview.className = 'quote-product-preview';
productPreview.alt = '';
productPreview.hidden = true;
document.body.append(productPreview);
let previewThumbnail;

function hideProductPreview() {
  if (!previewThumbnail) return;
  previewThumbnail = null;
  productPreview.hidden = true;
  productPreview.removeAttribute('src');
}

content.addEventListener('pointerover', event => {
  const thumbnail = event.target.closest('.product-thumb');
  if (event.pointerType !== 'mouse' || !thumbnail || thumbnail === previewThumbnail) return;
  previewThumbnail = thumbnail;
  productPreview.src = thumbnail.currentSrc || thumbnail.src;
  productPreview.hidden = false;
  const anchor = thumbnail.getBoundingClientRect();
  const { width, height } = productPreview.getBoundingClientRect();
  const gap = 10;
  const nextToImage = anchor.right + gap + width <= innerWidth - gap
    ? anchor.right + gap : anchor.left - width - gap;
  productPreview.style.left = Math.max(gap, Math.min(nextToImage, innerWidth - width - gap)) + 'px';
  productPreview.style.top = Math.max(gap, Math.min(anchor.top - 18, innerHeight - height - gap)) + 'px';
});
content.addEventListener('pointerout', event => {
  if (event.target === previewThumbnail) hideProductPreview();
});
window.addEventListener('scroll', hideProductPreview, { capture: true, passive: true });
window.addEventListener('resize', hideProductPreview, { passive: true });

function api(action, input, context = customerId()) {
  if (parent === window) return Promise.reject(Error('Open Quotations from the MASTER workroom.'));
  if (!trustedParent && (referrerOrigin || action !== 'customers')) {
    return Promise.reject(Error('Open Quotations from the MASTER workroom.'));
  }
  const id = requestId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      requests.delete(id);
      reject(Error('The response could not be confirmed. Retry the same action.'));
    }, 35000);
    requests.set(id, { action, context, resolve, reject, timer });
    const message = { type: 'MASTER_QUOTATION_REQUEST', requestId: id, action, customerId: context, input };
    if (trustedParent) parent.postMessage(message, trustedParent);
    else for (const origin of trustedParents) parent.postMessage(message, origin);
  });
}

window.addEventListener('message', event => {
  if (event.source !== parent || !trustedParents.has(event.origin) || (trustedParent && event.origin !== trustedParent)) return;
  const m = event.data;
  if (m?.type !== 'MASTER_QUOTATION_RESULT') return;
  const pending = requests.get(m.requestId);
  if (!pending || m.action !== pending.action || m.customerId !== pending.context) return;
  trustedParent = event.origin;
  requests.delete(m.requestId);
  clearTimeout(pending.timer);
  if (m.ok === true) pending.resolve(m.result);
  else {
    if (m.accessDenied === true) {
      generation++;
      current = null;
      content.replaceChildren();
      message(m.error || 'Your staff access could not be confirmed.', true);
    }
    pending.reject(Error(m.error || 'The quotation action could not be confirmed.'));
  }
});

async function refresh() {
  hideProductPreview();
  const token = ++generation;
  const context = customerId();
  const scrollPosition = quoteWindow && current?.customer?.customerId === context
    ? { left: quoteWindow.scroller.scrollLeft, top: quoteWindow.scroller.scrollTop } : null;
  current = null;
  content.replaceChildren();
  if (!context) return;
  try {
    const result = await api('quotes', undefined, context);
    if (token !== generation) return;
    if (result?.customer?.customerId !== context || result.staffId !== staffId ||
        !/^[A-Z]{3}$/.test(result.customer.preferredCurrency) || !Array.isArray(result.rows)) {
      throw Error('The quotation workspace could not be verified.');
    }
    current = result;
    renderQuotes(scrollPosition);
  } catch (error) {
    if (token === generation) message(error.message, true);
  }
}

async function initialize() {
  try {
    const result = await api('customers', undefined, '');
    if (typeof result.staffId !== 'string' || !result.staffId || !Array.isArray(result.customers)) {
      throw Error('Staff access could not be confirmed.');
    }
    staffId = result.staffId;
    drafts = readStorage('drafts:' + staffId, {});
    const remembered = readStorage('publishes:' + staffId, []);
    if (Array.isArray(remembered)) {
      for (const entry of remembered) if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[1]?.requestId) publicationAttempts.set(...entry);
    }
    $('#staff').textContent = result.staffName || '';
    $('#customer').replaceChildren(...result.customers.map(item => new Option(item.name, item.customerId)));
    $('#customer').disabled = !result.customers.length;
    message(result.customers.length ? '' : 'No quotation customers are assigned to your account.');
    if (result.customers.length) await refresh();
  } catch (error) { message(error.message, true); }
}

$('#customer').onchange = () => { message(); refresh(); };

function hideChangedQuote(tr) {
  if (!tr || busy || current?.canPublish === false) return;
  const row = current?.rows.find(item => item.id === tr.dataset.row);
  const next = row && drafts[key(row.id)];
  if (row?.published?.enabled && next && next.value !== row.published.priceEa) {
    tr.querySelector('[data-action=toggle]').click();
  }
}

content.addEventListener('change', event => {
  const price = event.target.closest('[data-mode=EA]');
  if (price) hideChangedQuote(price.closest('[data-row]'));
});

const quotationEditFields = '[data-mode=EA], [data-calc=GP]';
content.addEventListener('focusin', event => {
  if (event.target.matches(quotationEditFields)) event.target.dataset.replaceOnInput = '';
});

for (const type of ['focusout', 'input']) {
  content.addEventListener(type, event => delete event.target.dataset.replaceOnInput);
}

content.addEventListener('beforeinput', event => {
  if (event.target.dataset.replaceOnInput !== undefined && event.inputType.startsWith('insert')) {
    event.target.value = '';
  }
});

content.addEventListener('keydown', event => {
  const field = event.target.closest(quotationEditFields);
  if (!field || field.disabled || event.altKey || event.ctrlKey || event.metaKey) return;
  const tr = field.closest('[data-row]');
  const movesRow = ['ArrowUp', 'ArrowDown'].includes(event.key);
  if (field.dataset.mode === 'EA' && field.value && (event.key === 'Enter' || movesRow)) {
    field.value = fixed(roundCents(Number(field.value)));
  }
  if (event.key === 'Enter' && field.dataset.mode === 'EA') {
    event.preventDefault();
    hideChangedQuote(tr);
    return;
  }
  if (event.key === 'Enter' && field.dataset.calc) {
    event.preventDefault();
    if (busy) return;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (!movesRow) return;
  event.preventDefault();
  const adjacent = event.key === 'ArrowUp' ? tr.previousElementSibling : tr.nextElementSibling;
  const target = adjacent?.querySelector(field.dataset.calc ? '[data-calc=GP]' : '[data-mode=EA]');
  if (target && !target.disabled) target.focus();
});

content.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!current?.canEdit || !button || button.disabled || busy) return;
  const row = current.rows.find(item => item.id === button.closest('[data-row]')?.dataset.row);
  const action = button.dataset.action;
  if (action === 'apply' && row) {
    const input = calculatorInput(row);
    const price = input && calculatorPrice(row, input);
    if (price) {
      const tr = button.closest('[data-row]');
      editPrice(row, tr, { mode: 'EA', value: price.priceEa }, true);
      hideChangedQuote(tr);
    }
    return;
  }
  if (!row && button.id !== 'catch-cost') return;
  if (['publish', 'toggle', 'resume'].includes(action)) {
    if (current.canPublish !== false && !publishingRows.has(row.id)) await publishQuoteRow(row, action);
    return;
  }
  if (publishingRows.size) return;
  const context = customerId();
  busy = true;
  button.disabled = true;
  $('#customer').disabled = true;
  message();
  try {
    if (button.id === 'catch-cost') {
      const result = await api('cost', {}, context);
      message(`Catch Cost: ${result.updated} updated · ${result.failed} failed.`,
        result.failed > 0 && result.updated === 0, result.failed > 0 && result.updated > 0);
    } else if (action === 'draft') {
      await saveDraft(row, context);
      message('Draft saved.');
    }
  } catch (error) { message(error.message, true); }
  finally {
    busy = false;
    $('#customer').disabled = false;
    if (context === customerId()) await refresh();
  }
});

function repaintPublicationRow(row, workspace) {
  if (current !== workspace) return;
  const index = quoteWindow?.rows.indexOf(row) ?? -1;
  if (index !== -1) {
    const tr = [...quoteWindow.body.querySelectorAll('tr[data-row]')].find(item => item.dataset.row === row.id);
    if (tr) tr.outerHTML = quoteRow(row, index + 1);
  }
  const quoted = workspace.rows.filter(item => item.published?.enabled).length;
  $('#quoted-count').textContent = quoted;
  $('#awaiting-quote-count').textContent = workspace.rows.length - quoted;
  const risk = riskCount();
  $('#quote-risk-count').textContent = risk;
  $('#quote-risk-count').classList.toggle('gp-risk', Boolean(risk));
  $('#customer').disabled = publishingRows.size > 0;
  $('#catch-cost').disabled = publishingRows.size > 0 || !workspace.canEdit || !workspace.rows.length;
}

function readPublicationRows(context) {
  if (!publicationRead) {
    publicationRead = api('quotes', undefined, context).finally(() => { publicationRead = null; });
  }
  return publicationRead;
}

async function publishQuoteRow(row, action) {
  const workspace = current;
  const context = customerId();
  const rowKey = key(row.id);
  publishingRows.add(row.id);
  repaintPublicationRow(row, workspace);
  try {
    let packet = publicationAttempts.get(rowKey);
    if (!packet) {
      if (action === 'resume') throw Error('Reload the customer to see the current quotation.');
      const enabled = action === 'publish' || !row.published?.enabled;
      const revision = enabled ? await saveDraft(row, context, true) : row.revision;
      packet = { selectionId: row.id, enabled, revision, requestId: requestId() };
      publicationAttempts.set(rowKey, packet);
      rememberPublications();
    }
    const result = await api('publish', packet, context);
    if (current !== workspace) return;
    if (result.pending) {
      row.pending = true;
      message(result.message || 'Confirming the quotation.');
      return;
    }
    if (!Number.isSafeInteger(result.revision)) throw Error('The quotation could not be confirmed.');
    const matchingRow = response => response?.customer?.customerId === context && response.staffId === staffId
      ? response.rows?.find(item => item.id === row.id && item.revision >= result.revision) : null;
    // A shared read may have started before a second product finished publishing.
    const latest = matchingRow(await readPublicationRows(context)) || matchingRow(await readPublicationRows(context));
    if (current !== workspace) return;
    if (!latest || latest.pending) throw Error('The quotation could not be confirmed. Check its status.');
    Object.assign(row, latest);
    if (drafts[rowKey] && !dirty(row)) { delete drafts[rowKey]; remember(); }
    publicationAttempts.delete(rowKey);
    rememberPublications();
    message(row.published?.enabled ? 'Quotation is visible to this customer.' : 'Quotation hidden. Existing orders retain their prices.');
  } catch (error) {
    if (current === workspace) message(error.message, true);
  } finally {
    publishingRows.delete(row.id);
    repaintPublicationRow(row, workspace);
  }
}

setTimeout(initialize, 0);

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
  return current.rows.filter(row => gpTone(sellingPrice(row)?.gp) === 'gp-risk').length;
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
  const price = sellingPrice(row);
  return Boolean(price && (!row.published || price.priceEa !== row.published.priceEa || price.priceCtn !== row.published.priceCtn));
}
function quoteRow(row, number) {
  const price = sellingPrice(row);
  const visible = Boolean(row.published?.enabled);
  const publishing = publishingRows.has(row.id);
  const disabled = row.pending || publishing || busy || !current.canEdit;
  const target = calculatorInput(row);
  const suggestion = target ? calculatorPrice(row, target) : null;
  const details = row.costDetails || {};
  const previous = row.lastSale;
  const previousCurrency = previous?.currency !== current.customer.preferredCurrency ? escapeHtml(previous?.currency) + ' ' : '';
  const image = productImage(row.imageUrl);
  const desc = escapeHtml(row.name);
  return `<tr aria-rowindex="${number + 2}" data-row="${escapeHtml(row.id)}" class="${dirty(row) ? 'row-dirty' : ''}">
    <td class="row-number">${String(number).padStart(3, '0')}</td>
    <td class="image-cell">${image}</td>
    <td class="desc-cell"><span class="barcode">${escapeHtml(row.barcode)}</span><div class="product-name" title="${desc}">${desc}</div><span class="packing">${escapeHtml(row.packing)}</span></td>
    <td class="previous-sp"><span class="mobile-label">Last SP</span><span data-previous-sp>${previous ? previousCurrency + fixed(previous.priceCtn) + ' / CTN' : ''}</span><small>${quoteDate(previous?.siDate)}</small></td>
    <td><span class="mobile-label">Selling price · ${current.customer.preferredCurrency}</span><label class="quote-value quote-value-suffix"><input aria-label="Unit price for ${desc}" data-mode="EA" type="number" step="any" placeholder="0.00" value="${price ? fixed(price.priceEa) : ''}" ${disabled ? 'disabled' : ''}><span class="quote-unit">EA</span></label>${quotationAmount(price?.priceCtn, 'CT', ' data-carton')}</td>
    <td><span class="mobile-label">Profit</span><span data-profit>${profit(price)}</span></td>
    <td><span class="mobile-label">List cost</span>${quotationAmount(details.lpEa, 'EA')}${quotationAmount(details.lpCtn, 'CT')}</td>
    <td class="disc-cell"><span class="mobile-label">Discount</span>${quotationDiscount(1, details.disc1, true)}${quotationDiscount(2, details.disc2, true)}${quotationDiscount(3, details.disc3, false)}</td>
    <td class="cost-cell"><span class="mobile-label">Net cost per CTN</span><b class="${details.priceStale === true && Number.isFinite(row.costMyr) ? 'stale-cost' : ''}"${details.priceStale === true ? ' title="Point Base price needs verification"' : ''}>${fixed(row.costMyr)}</b><small class="${row.costError ? 'warning' : ''}" title="${escapeHtml(row.costError || row.costAt || '')}">${row.costError ? 'Check cost' : row.costAt ? '' : 'Awaiting cost'}</small></td>
    <td class="remark-cell"><span class="mobile-label">Remark</span>${escapeHtml(details.remark || '—')}</td>
    <td><span class="mobile-label">View Quote</span><div class="quote-actions"><button role="switch" aria-label="Show quote for ${desc}" aria-checked="${visible}" class="switch" data-action="toggle" ${disabled || current.canPublish === false || (!visible && !Number.isFinite(price?.gp)) ? 'disabled' : ''}></button><span class="quote-label" aria-live="polite">${publishing ? 'Publishing…' : row.pending ? 'Confirming…' : visible ? quoteDate(row.published.publishedAt) : ''}</span></div>
    <div class="quote-actions quote-edits">${quoteResumeButton(row)}<button hidden class="update" data-action="draft" ${disabled || !dirty(row) || !price ? 'disabled' : ''}>Save draft</button>${visible ? `<button hidden class="update primary" data-action="publish" ${disabled || current.canPublish === false || !quoteChanged(row) ? 'disabled' : ''}>Update quote</button>` : ''}</div></td>
    <td class="calc-cell"><span class="mobile-label">Margin</span><label class="calc-margin"><input aria-label="Target margin for ${desc}" data-calc="GP" type="number" step="1" placeholder="0" value="${inputValue(target?.mode === 'GP' ? target.value : Number.isFinite(suggestion?.gp) ? Math.round(suggestion.gp) : null)}" ${disabled ? 'disabled' : ''}><span aria-hidden="true">%</span></label></td>
    <td class="calc-cell"><span class="mobile-label">Selling</span><output class="calc-selling" aria-label="Target unit price for ${desc}" data-calculated-selling>${suggestion ? fixed(suggestion.priceEa) : '0.00'}</output></td>
    <td class="calc-cell"><button type="button" class="update primary" data-action="apply" aria-label="${calculatorMatchesPrice(price, suggestion) ? 'Calculator price applied to' : 'Apply calculator for'} ${desc}" ${calculatorMatchesPrice(price, suggestion) ? 'data-applied' : ''} ${disabled || !suggestion || calculatorMatchesPrice(price, suggestion) ? 'disabled' : ''}><span class="calc-apply-label">Apply</span><svg class="calc-applied-check" aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 12c2 .4 3.6 1.8 5 4 2.3-4.7 5.9-8 11-10.5" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></td>
  </tr>`;
}
function renderQuotes(scrollPosition) {
  const rows = quoteRows();
  const currency = current.customer.preferredCurrency;
  const quoted = current.rows.filter(row => row.published?.enabled).length;
  const risk = riskCount();
  const latestCost = current.rows.reduce((latest, row) => Date.parse(row.costAt) > Date.parse(latest) ||
    (!latest && Number.isFinite(Date.parse(row.costAt))) ? row.costAt : latest, '');
  const customerName = escapeHtml(current.customer.fullName || current.customer.name || $('#customer').selectedOptions[0]?.textContent || '');
  content.innerHTML = `<div class="toolbar quote-summary"><div>
    <div class="quote-customer"><h2>${customerName}</h2><span class="currency">${currency}</span></div>
    <div class="toolbar-meta"><span class="muted">Current FX &nbsp; 1 ${currency} = MYR ${format(current.customer.rateToMyr)}</span><span class="muted">Last Cost Refresh &nbsp; ${quoteDate(latestCost, true) || '—'}</span><button class="primary" id="catch-cost" ${busy || !current.canEdit || !current.rows.length ? 'disabled' : ''}>${busy ? 'Working…' : 'Catch Cost'}</button></div>
    </div><dl class="quote-counts"><div><dt>Total Selected</dt><dd>${current.rows.length}</dd></div><div><dt>Quoted</dt><dd id="quoted-count">${quoted}</dd></div><div><dt>Awaiting Quote</dt><dd id="awaiting-quote-count">${current.rows.length - quoted}</dd></div><div><dt>High-Risk Quotes</dt><dd id="quote-risk-count" class="${risk ? 'gp-risk' : ''}">${risk}</dd></div></dl></div>` + (rows.length ? `
    <div class="table-wrap quote-grid" tabindex="0" role="region" aria-label="Quotation products"><table aria-rowcount="${rows.length + 2}"><colgroup>${[42, 62, '', 74, 94, 91, 82, 77, 75, 142, 72, 53, 56, 49].map(width => `<col${width ? ` style="width:${width}px"` : ''}>`).join('')}</colgroup>
    <thead><tr><th rowspan="2">Row</th><th rowspan="2">Image</th><th rowspan="2">Descriptions</th><th class="quote-left" rowspan="2">Last SP</th><th class="quote-right" rowspan="2">Selling Price</th><th class="quote-left" rowspan="2">Profit</th><th class="quote-right" rowspan="2">List Cost</th><th rowspan="2">Discount</th><th class="quote-right" rowspan="2">Net Cost</th><th rowspan="2">Remark</th><th rowspan="2">View Quote</th><th class="calc-cell calc-group" colspan="3">Target Profit Calculator</th></tr>
    <tr class="calc-headings"><th class="calc-cell">Margin</th><th class="calc-cell">Selling</th><th class="calc-cell" aria-label="Apply"></th></tr></thead>
    <tbody>${initialQuoteRows(rows)}</tbody></table></div>` :
    `<div class="empty">${current.rows.length ? 'No matching products.' : 'Products selected in Catalogue appear here.'}</div>`);
  mountQuoteRows(rows, scrollPosition);
}
async function saveDraft(row, context, keepLocal = false) {
  const draftKey = key(row.id);
  const input = drafts[draftKey];
  if (!input || !dirty(row)) return row.revision;
  const savedInput = JSON.stringify(input);
  const result = await api('draft', { selectionId: row.id, input, revision: row.revision, requestId: requestId() }, context);
  if (!keepLocal && JSON.stringify(drafts[draftKey]) === savedInput) { delete drafts[draftKey]; remember(); }
  return result.revision;
}
function editPrice(row, tr, next, updateEa = false) {
  drafts[key(row.id)] = next;
  if (row.draft && next.mode === row.draft.mode && next.value === row.draft.value) delete drafts[key(row.id)];
  remember();
  const price = sellingPrice(row);
  if (updateEa) tr.querySelector('[data-mode=EA]').value = price ? fixed(price.priceEa) : '';
  tr.querySelector('[data-carton]').textContent = optionalMoney(price?.priceCtn);
  const target = calculatorInput(row);
  updateCalculatorApply(row, tr, price, target ? calculatorPrice(row, target) : null);
  tr.querySelector('[data-profit]').innerHTML = profit(price);
  const risk = riskCount();
  const count = $('#quote-risk-count');
  count.textContent = risk;
  count.classList.toggle('gp-risk', Boolean(risk));
  tr.classList.toggle('row-dirty', dirty(row));
  tr.querySelector('[data-action=draft]').disabled = !dirty(row) || !price;
  tr.querySelector('[data-action=toggle]').disabled = current.canPublish === false || !row.published?.enabled && !Number.isFinite(price?.gp);
  const update = tr.querySelector('[data-action=publish]');
  if (update) update.disabled = current.canPublish === false || !quoteChanged(row);
}
content.addEventListener('input', event => {
  const input = event.target.closest('[data-mode], [data-calc]');
  if (!input || input.disabled || busy) return;
  const tr = input.closest('[data-row]');
  const row = current.rows.find(row => row.id === tr.dataset.row);
  const value = input.value === '' ? null : input.dataset.calc === 'GP' ? Math.trunc(Number(input.value)) : Number(input.value);
  if (input.dataset.calc === 'GP' && value !== null && Number(input.value) !== value) input.value = value;
  if (input.dataset.mode) {
    editPrice(row, tr, { mode: 'EA', value: value === null ? null : roundCents(value) });
    return;
  }
  const next = { mode: input.dataset.calc, value };
  calculator.set(key(row.id), next);
  const price = calculatorPrice(row, next);
  const other = tr.querySelector('[data-calculated-selling]');
  const calculated = price?.priceEa;
  other.value = Number.isFinite(calculated) ? fixed(calculated) : '0.00';
  updateCalculatorApply(row, tr, sellingPrice(row), price);
});
