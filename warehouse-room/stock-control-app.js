(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search), finance = document.body.dataset.department === 'ACCOUNT';
  const embedded = ['warehouse', 'account'].includes(params.get('embedded'));
  const label = (en, zh) => finance ? en : en + ' ' + zh;
  const readType = finance ? 'FINANCE_STOCK_LIST' : 'STOCK_CONTROL';
  const loginType = finance ? 'ACCOUNT' : 'WAREHOUSE';
  const money = value => Number.isSafeInteger(value) ? (value / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const unitCost = value => Number.isFinite(value) ? value.toLocaleString('en-GB', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '—';
  if (embedded) document.documentElement.classList.add('warehouse-embedded');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const amount = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('en-GB') : '<span class="unknown">' + label('Review Required', '待核对') + '</span>';
  const issueLabels = { OWNERSHIP_NOT_CONFIRMED: 'Customer allocation requires review 客户分配需核对',
    RESERVED_STOCK_SHORTAGE: 'Customer claim exceeds usable stock 客户需求超过可用货物',
    SETTLED_GOODS_LOCATION_REQUIRES_REVIEW: 'Physical location of settled goods is unconfirmed 已结案货物的实物去向未确认',
    ALLOCATION_TARGET_REQUIRES_REVIEW: 'Customer or product identity requires review 客户或产品身份需核对',
    SHIPMENT_EXCEEDS_ALLOCATION: 'Shipment exceeds recorded customer allocation 发货超过已记录分配',
    STOCK_SNAPSHOT_MISMATCH: 'Stock quantities require reconciliation 库存数量需核对' };
  const initialCompany = new URLSearchParams(location.search).get('company');
  let company = ['NCT', 'GHR'].includes(initialCompany) ? initialCompany : 'NCT', data = null, requestId = '', pending = null, timer = null, searchTimer = null;
  $('company').value = company;
  let cursor = null, previous = [], queued = null;
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
    if (pending) { queued = { cursor: nextCursor, previous: nextPrevious }; return; }
    requestId = crypto.randomUUID(); pending = { id: requestId, company, cursor: nextCursor, previous: nextPrevious };
    notice(label('Reading stock…', '正在读取库存…')); paging(); clearTimeout(timer);
    parent.postMessage({ type: readType + '_READ_REQUEST', company, requestId,
      input: { search: $('search').value.trim(), filter: $('filter').value, cursor: nextCursor, pageSize: 50 } }, '*');
    const id = requestId;
    timer = setTimeout(() => { if (pending?.id !== id) return; pending = null; requestId = ''; paging();
      if (drainQueued()) return;
      notice(label('Stock read is unconfirmed. Previous results are retained; click Refresh.', '库存读取尚未确认，原结果保留，请点击刷新。'), true); }, 30000);
  }
  function drainQueued() {
    if (!queued) return false;
    const next = queued; queued = null; request(next.cursor, next.previous); return true;
  }
  function render() {
    const items = data?.items || [];
    $('stock-rows').innerHTML = items.map(row => '<tr><td><button class="product" data-key="' + esc(row.key) + '">' + esc(row.name)
      + '<small>' + esc(row.barcode) + ' · ' + esc(row.packing) + '</small></button>'
      + (row.reviewRequired ? '<small class="unknown">' + label('Review Required', '待核对') + '</small>' : '') + '</td>'
      + [row.onHand, row.reservedUsable, row.available, row.isolated].map(value => '<td class="num">' + amount(value) + '</td>').join('')
      + (finance ? '<td class="num">' + unitCost(row.valuation?.averageCost) + '</td><td class="num">' + money(row.valuation?.valueCents) + '</td><td><span class="stock-status ' + (row.valuation?.status === 'CONFIRMED' ? 'confirmed' : 'pending') + '">' + (row.valuation?.status === 'CONFIRMED' ? 'Confirmed' : 'Cost review') + '</span></td>' : '') + '</tr>').join('')
      || '<tr><td colspan="' + (finance ? 8 : 5) + '" class="empty">' + (data ? label('No matching stock records', '没有符合条件的库存记录') : label('Waiting for verified stock data', '等待已确认的库存资料')) + '</td></tr>';
    $('total').textContent = data ? data.total + label(' products', '项产品') : '';
    $('page-label').textContent = data && data.total ? (data.offset + 1) + '–' + (data.offset + items.length) + ' of ' + data.total : '';
    const counts = data?.counts;
    for (const [id, key] of [['count-stock', 'onHand'], ['count-free', 'available'], ['count-isolated', 'isolated'], ['count-review', 'reservedUsable']]) {
      const summary = data?.summary?.[key];
      $(id).textContent = summary ? summary.quantity.toLocaleString('en-GB') + (summary.unknownProducts ? '+' : '') : '—';
      $(id).nextElementSibling.textContent = summary?.unknownProducts ? label('Partial · unknown quantities', '部分汇总 · 含待核对数量') : 'CTN';
    }
    if (finance) { const v = data?.summary?.valuation;
      $('stock-value').textContent = v ? 'MYR ' + money(v.knownValueCents) : '—';
      $('cost-coverage').textContent = v ? v.complete ? 'All shown stock valued' : 'Partial value · ' + v.unvaluedQuantity + ' CTN pending' + (v.unknownQuantitySources ? ' · unknown quantities' : '') : '';
    }
    for (const button of document.querySelectorAll('[data-filter]')) {
      button.classList.toggle('active', button.dataset.filter === $('filter').value);
      if (button.dataset.filter === 'REVIEW') button.classList.toggle('has-issues', (counts?.reviewProducts || 0) > 0);
    }
    paging();
  }
  function showSources(row) {
    $('source-name').textContent = row.name;
    $('source-product').textContent = row.barcode + ' · ' + row.packing;
    $('source-summary').innerHTML = [label('On Hand', '在仓') + ': ' + amount(row.onHand), label('Reserved', '已预留') + ': ' + amount(row.reservedUsable),
      label('Available', '可分配') + ': ' + amount(row.available), label('Isolated', '隔离') + ': ' + amount(row.isolated)].map(text => '<span>' + text + '</span>').join('');
    $('sources').innerHTML = row.sources.map(source => '<tr><td><b>' + esc(source.po || source.sourceTaskId) + '</b><small>' + esc(source.sourceTaskId) + '</small></td><td class="num">'
      + amount(source.onHand) + '</td><td>' + source.reservations.map(entry => '<div>' + esc(entry.customerName || entry.taskId) + ': ' + amount(entry.outstandingQuantity) + '</div>').join('')
      + '</td><td class="num">' + amount(source.available) + '</td><td class="num">' + amount(source.isolated) + '</td>'
      + (finance ? '<td class="num">' + unitCost(source.valuation?.unitCost) + '</td><td class="num">' + money(source.valuation?.valueCents) + '</td>' : '') + '</tr>').join('')
      || '<tr><td colspan="' + (finance ? 7 : 5) + '" class="empty">' + label('No remaining source quantity', '暂无剩余来源数量') + '</td></tr>';
    const issues = [...new Set(row.sources.flatMap(source => source.issues))];
    const notes = issues.map(code => finance ? (issueLabels[code] || code).replace(/\s*[\u3400-\u9fff].*$/, '') : issueLabels[code] || code);
    if (finance && row.valuation?.status !== 'CONFIRMED') notes.push('Unconfirmed costs or quantities are excluded from the known value. Partial FOC receipts require paid/free composition confirmation.');
    $('source-review').textContent = notes.join('\n');
    $('source-dialog').showModal();
    layout();
  }
  $('stock-rows').onclick = event => { const button = event.target.closest('[data-key]'); if (!button) return;
    const row = data?.items.find(item => item.key === button.dataset.key); if (row) showSources(row); };
  $('close-source').onclick = $('done-source').onclick = () => $('source-dialog').close();
  $('refresh').onclick = () => { clearTimeout(searchTimer); request(); };
  $('login').onclick = () => parent.postMessage({ type: loginType + '_LOGIN_REQUEST', company }, '*');
  $('next').onclick = () => { if (data?.nextCursor) request(data.nextCursor, [...previous, cursor]); };
  $('previous').onclick = () => { if (previous.length) request(previous[previous.length - 1], previous.slice(0, -1)); };
  $('search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => request(), 400); };
  $('filter').onchange = () => { clearTimeout(searchTimer); request(); };
  document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { $('filter').value = button.dataset.filter; request(); });
  $('company').onchange = () => { if ($('source-dialog').open) { $('company').value = company; return; }
    clearTimeout(timer); clearTimeout(searchTimer); pending = null; queued = null;
    company = $('company').value; data = null; cursor = null; previous = []; $('staff').textContent = ''; $('read-at').textContent = '';
    $('search').value = ''; $('filter').value = 'ON_HAND'; $('login').hidden = false; render(); request(); };
  window.addEventListener('message', event => {
    if (event.source !== parent) return;
    const message = event.data || {};
    if (embedded && message.type === 'STOCK_CONTROL_REFRESH' && message.company === company) { request(); return; }
    if (message.type === loginType + '_LOGIN_RESULT') { if (message.ok) request(); return; }
    if (message.type !== readType + '_READ_RESULT' || message.company !== company || message.requestId !== pending?.id) return;
    clearTimeout(timer); const current = pending; pending = null;
    if (drainQueued()) return;
    if (!message.ok) { notice(message.error || label('Stock could not be read', '库存读取未完成'), true); paging(); return; }
    const result = message.result;
    if (result?.company !== company || !Array.isArray(result.items) || !result.counts || !Number.isSafeInteger(result.total)
      || result.permissions?.read !== true || !result.summary || finance && !result.summary.valuation) { notice(label('Stock response requires review', '库存回执需核对'), true); paging(); return; }
    data = result; cursor = current.cursor; previous = current.previous;
    $('staff').textContent = result.staff?.staffName || ''; $('login').hidden = !!result.staff?.staffName;
    const at = new Date(result.readAt);
    $('read-at').textContent = Number.isFinite(at.getTime()) ? label('Updated', '更新时间') + ' ' + new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(at) : '';
    notice(''); render();
    layout();
  });
  render(); request();
})();
