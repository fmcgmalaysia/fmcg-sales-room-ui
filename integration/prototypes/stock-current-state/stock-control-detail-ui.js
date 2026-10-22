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
