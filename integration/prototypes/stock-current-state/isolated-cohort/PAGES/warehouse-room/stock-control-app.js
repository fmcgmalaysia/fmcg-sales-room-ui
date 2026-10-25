(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const embedded = new URLSearchParams(location.search).get('embedded') === 'warehouse';
  if (embedded) document.documentElement.classList.add('warehouse-embedded');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const amount = value => value === null ? '<span class="unknown">Review Required 待核对</span>' : Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('en-GB') : '<span class="unknown">Review Required 待核对</span>';
  const issueLabels = { OWNERSHIP_NOT_CONFIRMED: 'Customer allocation requires review 客户分配需核对',
    RESERVED_STOCK_SHORTAGE: 'Customer claim exceeds usable stock 客户需求超过可用货物',
    SETTLED_GOODS_LOCATION_REQUIRES_REVIEW: 'Physical location of settled goods is unconfirmed 已结案货物的实物去向未确认',
    ALLOCATION_TARGET_REQUIRES_REVIEW: 'Customer or product identity requires review 客户或产品身份需核对',
    SHIPMENT_EXCEEDS_ALLOCATION: 'Shipment exceeds recorded customer allocation 发货超过已记录分配',
    STOCK_SNAPSHOT_MISMATCH: 'Stock quantities require reconciliation 库存数量需核对' };
  const initialCompany = new URLSearchParams(location.search).get('company');
  let company = ['NCT', 'GHR'].includes(initialCompany) ? initialCompany : 'NCT', data = null, requestId = '', pending = null, timer = null, searchTimer = null;
  $('company').value = company;
  let cursor = null, previous = [];
  function layout() {
    if (embedded) parent.postMessage({ type: 'STOCK_CONTROL_LAYOUT', company,
      height: document.body.scrollHeight, busy: $('source-dialog').open }, location.origin === 'null' ? '*' : location.origin);
  }
  if (embedded) {
    new ResizeObserver(layout).observe(document.body);
    $('source-dialog').addEventListener('close', layout);
  }
  function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
  function paging() {
    $('previous').disabled = !!pending || !previous.length;
    $('next').disabled = !!pending || !data?.nextCursor;
    $('refresh').disabled = !!pending;
  }
  function request(nextCursor = null, nextPrevious = []) {
    if ($('source-dialog').open) return;
    requestId = crypto.randomUUID(); pending = { id: requestId, company, cursor: nextCursor, previous: nextPrevious };
    notice('Reading stock 正在读取库存…'); paging(); clearTimeout(timer);
    parent.postMessage({ type: 'STOCK_CONTROL_READ_REQUEST', company, requestId,
      input: { search: $('search').value.trim(), filter: $('filter').value, cursor: nextCursor, pageSize: 50 } }, '*');
    const id = requestId;
    timer = setTimeout(() => { if (pending?.id !== id) return; pending = null; requestId = ''; paging();
      notice('Stock read is unconfirmed. Previous results are retained; click Refresh. 库存读取尚未确认，原结果保留，请点击刷新。', true); }, 30000);
  }
  function render() {
    const items = data?.items || [];
    $('stock-rows').innerHTML = items.map(row => '<tr><td><button class="product" data-key="' + esc(row.key) + '">' + esc(row.name)
      + '<small>' + esc(row.barcode) + ' · ' + esc(row.packing) + '</small></button>'
      + (row.reviewRequired ? '<small class="unknown">Review Required 待核对</small>' : '') + '</td>'
      + [row.onHand, row.reservedUsable, row.available, row.isolated].map(value => '<td class="num">' + amount(value) + '</td>').join('') + '</tr>').join('')
      || '<tr><td colspan="5" class="empty">' + (data ? 'No matching stock records 没有符合条件的库存记录' : 'Waiting for verified stock data 等待已确认的库存资料') + '</td></tr>';
    $('total').textContent = data ? data.total + ' products 项产品' : '';
    $('page-label').textContent = data && data.total ? (data.offset + 1) + '–' + (data.offset + items.length) + ' of ' + data.total : '';
    const counts = data?.counts;
    for (const [id, key] of [['count-stock', 'onHandProducts'], ['count-free', 'availableProducts'], ['count-isolated', 'isolatedProducts'], ['count-review', 'reviewProducts']]) {
      $(id).textContent = counts ? String(counts[key]) : '';
    }
    for (const button of document.querySelectorAll('[data-filter]')) {
      button.classList.toggle('active', button.dataset.filter === $('filter').value);
      if (button.dataset.filter === 'REVIEW') button.classList.toggle('has-issues', (counts?.reviewProducts || 0) > 0);
    }
    paging();
  }
// Inserted inside the existing Stock Control UI closure by the mechanical builder.
let detailState = null, detailPending = null, detailTimer = null;
function detailNotice(message, error = false) {
  $('source-review').textContent = message; $('source-review').classList.toggle('reading', !error);
}
function detailPaging() {
  $('source-previous').disabled = !!detailPending || detailState?.stale === true || !detailState?.previous?.length;
  $('source-next').disabled = !!detailPending || !detailState?.page?.nextCursor;
  $('source-back').hidden = detailState?.kind !== 'claims';
  $('source-back').disabled = !!detailPending || detailState?.stale === true;
}
function readDetails(nextCursor = null, previousPages = []) {
  if (!detailState || detailState.stale || !$('source-dialog').open || detailPending) return;
  const id = crypto.randomUUID(); detailPending = { id, company, kind: detailState.kind, positionId: detailState.positionId,
    cursor: nextCursor, previous: previousPages, key: detailState.product.key };
  detailNotice('Reading stock details 正在读取库存明细…'); detailPaging(); clearTimeout(detailTimer);
  parent.postMessage({ type: 'STOCK_CONTROL_SOURCE_READ_REQUEST', company, requestId: id, input: {
    kind: detailState.kind, stockKey: detailState.product.key, ...(detailState.kind === 'claims' ? { positionId: detailState.positionId } : {}),
    cursor: nextCursor, pageSize: 25 } }, '*');
  detailTimer = setTimeout(() => {
    if (detailPending?.id !== id) return;
    detailPending = null; detailPaging(); detailNotice('Stock details unconfirmed. Close and refresh. 库存明细尚未确认，请关闭后刷新。', true);
  }, 30000);
}
function renderDetails() {
  const page = detailState.page, claims = detailState.kind === 'claims';
  $('source-columns').innerHTML = claims ? '<th>Customer 客户</th><th>Task 任务</th><th class="num">Reserved 预留</th><th class="num">Isolated 隔离</th><th></th>'
    : '<th>Source 来源</th><th class="num">On Hand 在手</th><th>Customer Reservation 客户预留</th><th class="num">Available 自由</th><th class="num">Isolated 隔离</th>';
  $('sources').innerHTML = (page?.items || []).map(source => claims
    ? '<tr><td>' + esc(source.customerName || source.customerId) + '</td><td>' + esc(source.taskId) + '</td><td class="num">' + amount(source.reservedUsable)
      + '</td><td class="num">' + amount(source.isolatedAttributed) + '</td><td></td></tr>'
    : '<tr><td><b>' + esc(source.poNumber || source.poId || source.sourceTaskId) + '</b><small>' + esc(source.sourceTaskId) + '</small></td><td class="num">'
      + amount(source.onHand) + '</td><td><button class="primary" data-position="' + esc(source._id) + '">View reservations 查看预留</button>'
      + '<small>' + amount(source.reservedUsable) + '</small></td><td class="num">' + amount(source.available) + '</td><td class="num">' + amount(source.isolated) + '</td></tr>').join('')
    || '<tr><td colspan="5" class="empty">' + (claims ? 'No active reservations 没有有效预留' : 'No active stock sources 没有有效库存来源') + '</td></tr>';
  $('source-page').textContent = page?.total ? (page.offset + 1) + '–' + (page.offset + page.items.length) + ' of ' + page.total : '';
  const codes = [...new Set((page?.items || []).flatMap(row => row.reviewCodes || []))];
  detailNotice(codes.map(code => issueLabels[code] || code).join('\n'), codes.length > 0);
  if (page?.customerNamesUnavailable) detailNotice('Customer names unavailable; IDs retained. 客户名称暂不可读取，保留客户编号。', true);
  detailPaging(); layout();
}
function showSources(row) {
  if (pending || detailPending) return;
  if (row.sourceDetails !== 'PAGED' || data?.schema !== 'CURRENT_STOCK_V1') { notice('Stock view requires refresh 库存页面需要刷新', true); return; }
  detailState = { product: row, generation: data.generation, kind: 'positions', positionId: null, cursor: null, previous: [], page: null, positionsNavigation: null };
  $('source-name').textContent = row.name; $('source-product').textContent = row.barcode + ' · ' + row.packing;
  $('source-summary').innerHTML = ['On Hand 在手: ' + amount(row.onHand), 'Reserved 可用预留: ' + amount(row.reservedUsable),
    'Available 自由: ' + amount(row.available), 'Isolated 隔离: ' + amount(row.isolated)].map(text => '<span>' + text + '</span>').join('');
  $('sources').innerHTML = '<tr><td colspan="5" class="empty">Reading stock sources 正在读取库存来源…</td></tr>';
  $('source-page').textContent = ''; $('source-dialog').showModal(); detailPaging(); layout(); readDetails();
}
$('sources').onclick = event => {
  const button = event.target.closest('[data-position]'); if (!button || detailPending || detailState?.kind !== 'positions') return;
  const source = detailState.page?.items.find(row => row._id === button.dataset.position); if (!source) return;
  detailState.positionsNavigation = { cursor: detailState.cursor, previous: detailState.previous };
  detailState.kind = 'claims'; detailState.positionId = source._id; detailState.page = null; detailState.cursor = null; detailState.previous = [];
  $('sources').innerHTML = '<tr><td colspan="5" class="empty">Reading customer reservations 正在读取客户预留…</td></tr>'; readDetails();
};
$('source-previous').onclick = () => { if (detailState?.previous.length && !detailPending) readDetails(detailState.previous.at(-1), detailState.previous.slice(0, -1)); };
$('source-next').onclick = () => { if (detailState?.page?.nextCursor && !detailPending) readDetails(detailState.page.nextCursor, [...detailState.previous, detailState.cursor]); };
$('source-back').onclick = () => {
  if (detailState?.kind !== 'claims' || detailPending) return;
  const previousPage = detailState.positionsNavigation; detailState.kind = 'positions'; detailState.positionId = null; detailState.page = null;
  readDetails(previousPage?.cursor || null, previousPage?.previous || []);
};
$('source-dialog').addEventListener('close', () => { clearTimeout(detailTimer); detailPending = null; detailState = null; });
window.addEventListener('message', event => {
  if (event.source !== parent) return; const message = event.data || {}, expected = detailPending;
  if (!expected || !detailState || !$('source-dialog').open || message.type !== 'STOCK_CONTROL_SOURCE_READ_RESULT'
    || message.company !== company || message.requestId !== expected.id) return;
  clearTimeout(detailTimer); detailPending = null;
  const page = message.result;
  if (!message.ok) { detailNotice(message.error || 'Stock details unavailable 库存明细暂不可读取', true); detailPaging(); return; }
  if (page?.schema !== 'CURRENT_STOCK_DETAIL_V1' || page.company !== company || page.product?.key !== expected.key || !Array.isArray(page.items)
    || page.items.length > 25 || !Number.isSafeInteger(page.total) || page.total < 0 || !Number.isSafeInteger(page.offset) || page.offset < 0
    || page.offset > page.total || page.items.length !== Math.min(25, page.total - page.offset)) {
    detailNotice('Stock response requires review 库存回执需核对', true); detailPaging(); return;
  }
  if (page.generation !== detailState.generation || ['onHand', 'reservedUsable', 'available', 'isolated'].some(k => page.product[k] !== detailState.product[k])) {
    detailState.page = null; detailState.stale = true; $('sources').innerHTML = ''; detailPaging();
    detailNotice('Stock changed. Close details and refresh the list. 库存已变动，请关闭明细后刷新列表。', true); return;
  }
  detailState.page = page; detailState.cursor = expected.cursor; detailState.previous = expected.previous; renderDetails();
});

  $('stock-rows').onclick = event => { const button = event.target.closest('[data-key]'); if (!button) return;
    const row = data?.items.find(item => item.key === button.dataset.key); if (row) showSources(row); };
  $('close-source').onclick = $('done-source').onclick = () => $('source-dialog').close();
  $('refresh').onclick = () => { clearTimeout(searchTimer); request(); };
  $('login').onclick = () => parent.postMessage({ type: 'WAREHOUSE_LOGIN_REQUEST', company }, '*');
  $('next').onclick = () => { if (data?.nextCursor) request(data.nextCursor, [...previous, cursor]); };
  $('previous').onclick = () => { if (previous.length) request(previous[previous.length - 1], previous.slice(0, -1)); };
  $('search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => request(), 400); };
  $('filter').onchange = () => { clearTimeout(searchTimer); request(); };
  document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { $('filter').value = button.dataset.filter; request(); });
  $('company').onchange = () => { if ($('source-dialog').open) { $('company').value = company; return; }
    company = $('company').value; data = null; cursor = null; previous = []; $('staff').textContent = ''; $('read-at').textContent = '';
    $('search').value = ''; $('filter').value = 'ON_HAND'; $('login').hidden = false; render(); request(); };
  window.addEventListener('message', event => {
    if (event.source !== parent) return;
    const message = event.data || {};
    if (embedded && message.type === 'STOCK_CONTROL_REFRESH' && message.company === company) { request(); return; }
    if (message.type === 'WAREHOUSE_LOGIN_RESULT') { if (message.ok) request(); return; }
    if (message.type !== 'STOCK_CONTROL_READ_RESULT' || message.company !== company || message.requestId !== pending?.id) return;
    clearTimeout(timer); const current = pending; pending = null;
    if (!message.ok) { notice(message.error || 'Stock could not be read 库存读取未完成', true); paging(); return; }
    const result = message.result;
    if (result?.schema !== 'CURRENT_STOCK_V1' || result?.company !== company || !Array.isArray(result.items) || !result.counts || !Number.isSafeInteger(result.total)
      || result.permissions?.read !== true) { notice('Stock response requires review 库存回执需核对', true); paging(); return; }
    data = result; cursor = current.cursor; previous = current.previous;
    $('staff').textContent = result.staff?.staffName || ''; $('login').hidden = !!result.staff?.staffName;
    const at = new Date(result.readAt);
    $('read-at').textContent = Number.isFinite(at.getTime()) ? 'Master CMS · ' + new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at) : '';
    notice(''); render();
    layout();
  });
  render(); request();
})();
