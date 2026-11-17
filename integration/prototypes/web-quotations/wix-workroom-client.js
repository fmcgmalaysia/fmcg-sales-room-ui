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
let dragging = '';
let drafts = {};

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, value =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]);
const format = value => value == null ? '—' : new Intl.NumberFormat('en', { maximumFractionDigits: 6 }).format(value);
const customerId = () => $('#customer').value;
const scope = () => JSON.stringify([staffId, customerId()]);
const key = id => JSON.stringify([staffId, customerId(), id]);
const requestId = () => crypto.randomUUID();

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
      return '<img class="product-thumb" loading="lazy" width="36" height="35" alt="" src="' + escapeHtml(url.href) + '">';
    }
  } catch { /* Unknown product image. */ }
  return '<span class="empty-thumb">—</span>';
}

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
  const token = ++generation;
  const context = customerId();
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
    renderQuotes();
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

$('#customer').onchange = () => { message(); $('#search').value = ''; refresh(); };
$('#search').oninput = () => { if (current && !busy) renderQuotes(); };

content.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!current?.canEdit || !button || button.disabled || busy) return;
  const row = current.rows.find(item => item.id === button.closest('[data-row]')?.dataset.row);
  const action = button.dataset.action;
  if (action === 'apply' && row) {
    const input = calculatorInput(row);
    if (input && draftPrice(row, input)) editPrice(row, button.closest('[data-row]'), input, true);
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
