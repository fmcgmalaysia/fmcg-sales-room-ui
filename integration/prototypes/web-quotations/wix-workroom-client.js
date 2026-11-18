/* The generator appends the approved grid and calculator. The Wix page
 * supplies scope through postMessage. This iframe never assigns a role. */
const $ = selector => document.querySelector(selector);
const content = $('#content');
const trustedParent = 'https://fmcg999.wixstudio.com';
const requests = new Map();
const calculator = new Map();
const publicationAttempts = new Map();
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
  return current.canEdit && current.canPublish !== false && publicationAttempts.has(key(row.id))
    ? '<button class="update primary" data-action="resume">Confirm status</button>' : '';
}
function message(value = '', error = false) {
  $('#notice').textContent = value;
  $('#notice').classList.toggle('error', error);
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
  const id = requestId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      requests.delete(id);
      reject(Error('The response could not be confirmed. Retry the same action.'));
    }, 35000);
    requests.set(id, { action, context, resolve, reject, timer });
    parent.postMessage({ type: 'MASTER_QUOTATION_REQUEST', requestId: id, action, customerId: context, input }, trustedParent);
  });
}

window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== trustedParent) return;
  const m = event.data;
  if (m?.type !== 'MASTER_QUOTATION_RESULT') return;
  const pending = requests.get(m.requestId);
  if (!pending || m.action !== pending.action || m.customerId !== pending.context) return;
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

content.addEventListener('focusin', event => {
  const field = event.target.closest('[data-calc]');
  if (field && !field.disabled) {
    field.dataset.beforeFocus = field.value;
    field.value = '';
  }
});

content.addEventListener('focusout', event => {
  const field = event.target.closest('[data-calc]');
  if (field?.dataset.beforeFocus !== undefined) {
    if (!field.value) field.value = field.dataset.beforeFocus;
    delete field.dataset.beforeFocus;
  }
});

content.addEventListener('input', event => {
  if (event.target.matches('[data-calc]')) delete event.target.dataset.beforeFocus;
});

content.addEventListener('keydown', event => {
  const field = event.target.closest('[data-mode=EA], [data-calc]');
  if (!field || field.disabled || event.altKey || event.ctrlKey || event.metaKey) return;
  const tr = field.closest('[data-row]');
  if (event.key === 'Enter' && field.dataset.mode === 'EA') {
    event.preventDefault();
    if (field.value) field.value = fixed(roundCents(Number(field.value)));
    hideChangedQuote(tr);
    return;
  }
  if (event.key === 'Enter' && field.dataset.calc) {
    event.preventDefault();
    if (busy) return;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    if (field.dataset.calc === 'EA' && field.value !== '') {
      field.value = fixed(roundCents(Number(field.value)));
    }
    return;
  }
  const vertical = ['ArrowUp', 'ArrowDown'].includes(event.key);
  const horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key);
  if (!vertical && !(horizontal && field.dataset.calc)) return;
  event.preventDefault();
  const target = vertical
    ? (event.key === 'ArrowUp' ? tr.previousElementSibling : tr.nextElementSibling)?.querySelector(
        field.dataset.calc ? `[data-calc=${field.dataset.calc}]` : '[data-mode=EA]')
    : event.key === 'ArrowLeft' && field.dataset.calc === 'EA' ? tr.querySelector('[data-calc=GP]')
      : event.key === 'ArrowRight' && field.dataset.calc === 'GP' ? tr.querySelector('[data-calc=EA]') : null;
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
      tr.querySelector('[data-calc=EA]').value = fixed(price.priceEa);
      hideChangedQuote(tr);
    }
    return;
  }
  if (!row && button.id !== 'catch-cost') return;
  if (['publish', 'toggle', 'resume'].includes(action) && current.canPublish === false) return;
  const context = customerId();
  busy = true;
  button.disabled = true;
  $('#customer').disabled = true;
  message();
  try {
    if (button.id === 'catch-cost') {
      const result = await api('cost', {}, context);
      message(`${result.updated} costs updated${result.failed ? ` · ${result.failed} could not be confirmed` : ''}.`, result.failed > 0);
    } else if (action === 'draft') {
      await saveDraft(row, context);
      message('Draft saved.');
    } else if (['toggle', 'publish', 'resume'].includes(action)) {
      const rowKey = key(row.id);
      let packet = publicationAttempts.get(rowKey);
      if (!packet) {
        if (action === 'resume') throw Error('Reload the customer to see the current quotation.');
        const enabled = action === 'publish' || !row.published?.enabled;
        const revision = enabled ? await saveDraft(row, context) : row.revision;
        packet = { selectionId: row.id, enabled, revision, requestId: requestId() };
        publicationAttempts.set(rowKey, packet);
        rememberPublications();
      }
      const result = await api('publish', packet, context);
      if (result.pending) message(result.message || 'Confirming the quotation.');
      else {
        publicationAttempts.delete(rowKey);
        rememberPublications();
        message(packet.enabled ? 'Quotation is visible to this customer.' : 'Quotation hidden. Existing orders retain their prices.');
      }
    }
  } catch (error) { message(error.message, true); }
  finally {
    busy = false;
    $('#customer').disabled = false;
    if (context === customerId()) await refresh();
  }
});

setTimeout(initialize, 0);
