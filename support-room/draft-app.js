/* Isolated design draft. No postMessage, CMS, fetch, real invoice writes or storage. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const model = window.SupportInvoiceDraft;
  const f = (value, decimals = 2) => value === null ? '<span class="missing">Missing 待补充</span>' : Number(value).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const money = (cents, currency) => cents === null ? '<span class="missing">Missing 待补充</span>' : esc(currency) + ' ' + f(cents / 100);
  const dim = (value, scale, decimals) => value === null ? '<span class="missing">Missing 待补充</span>' : f(value / scale, decimals);
  const base = (id, extra = {}) => ({ id, taskId: id, company: 'NCT', customerId: '168', customerName: '168 LTD',
    invoicePartyKey: 'BILL-168', currency: 'USD', shipmentGroup: 'SHIPMENT-168-A', warehouseVersion: 'LOAD-' + id,
    invoiceCoverageVersion: 'INVOICE-' + id, taskQty: 100, loadedQty: 80, invoicedQty: 20, pendingInvoiceQty: 0,
    loadedConfirmed: true, cbmPerCtn: 0.0118, netWeightKgPerCtn: 8.4, sellingPriceCtnCents: 1008,
    barcode: '9556404007035', name: '7 UP (CAN)', packing: '320ML × 24', batch: 'This shipment 本次发货',
    loadedAt: '21 Oct 2026 08:12', loadedBy: 'LAW', ...extra });
  const samples = [
    base('LOAD-001'),
    base('LOAD-002', { taskQty: 50, loadedQty: 50, invoicedQty: 0, barcode: '955558920293', name: 'A&W SARSAPARILLA PET',
      packing: '500ML × 24', sellingPriceCtnCents: 1320, cbmPerCtn: 0.0185, netWeightKgPerCtn: 12 }),
    base('LOAD-003', { taskId: 'LOAD-001', taskQty: 20, loadedQty: 20, invoicedQty: 0, batch: 'Split row 拆单行' }),
    base('LOAD-004', { taskQty: 30, loadedQty: 30, invoicedQty: 30, barcode: '4902430896887', name: 'AMBIPUR CAR GEL - ROMANCE ROSE',
      packing: '75G × 24', sellingPriceCtnCents: 3696, cbmPerCtn: 0.0066, netWeightKgPerCtn: 1.8 }),
    base('LOAD-005', { taskQty: 200, loadedQty: 0, invoicedQty: 0, loadedConfirmed: false, loadedAt: '',
      shipmentGroup: 'SHIPMENT-168-B', batch: 'Next shipment 下次发货' }),
    base('LOAD-006', { customerId: 'SCOMM', customerName: 'SCOMM (MYR)', invoicePartyKey: 'BILL-SCOMM', currency: 'MYR',
      taskQty: 100, loadedQty: 40, invoicedQty: 0, barcode: '4710363521543', name: 'MAGICLEAN TOILET BLEACH POWER - LEMON',
      packing: '500ML × 12', sellingPriceCtnCents: 4250, cbmPerCtn: 0.0144, netWeightKgPerCtn: 6,
      shipmentGroup: 'SHIPMENT-SCOMM-A' }),
    base('LOAD-007', { taskQty: 10, loadedQty: 10, invoicedQty: 0, barcode: 'EXAMPLE-NW-MISSING', name: 'PRODUCT WITH NET WEIGHT PENDING',
      netWeightKgPerCtn: null, sellingPriceCtnCents: 1100 }),
    base('LOAD-008', { taskQty: 50, loadedQty: 15, invoicedQty: 20, name: 'LOADING CORRECTION REQUIRES REVIEW',
      barcode: 'EXAMPLE-LOAD-REVIEW', stale: true }),
    base('GHR-001', { company: 'GHR', customerId: 'GHR-CUSTOMER', customerName: 'GHR EXAMPLE CUSTOMER', invoicePartyKey: 'GHR-BILL',
      currency: 'USD', taskQty: 40, loadedQty: 40, invoicedQty: 0, shipmentGroup: 'GHR-SHIPMENT-A' })
  ];
  const history = [{ company: 'NCT', id: 'DEMO-INV-001', date: '20 Oct 2026', customerName: '168 LTD', customerId: '168',
    quantity: 20, currency: 'USD', amountCents: 20160, cbmMicro: 236000, netWeightGrams: 168000,
    lines: [{ name: '7 UP (CAN)', barcode: '9556404007035', packing: '320ML × 24', invoiceQty: 20,
      amountCents: 20160, cbmMicro: 236000, netWeightGrams: 168000 }], status: 'Awaiting Dispatch 待出库' }];
  const selected = new Map();
  let company = 'NCT', rows = [], view = 'active', draft = null, invoiceDirty = false;
  const statusLabel = row => ({ READY: 'Ready to Invoice 待开票', WAIT_LOADING: 'Awaiting Loading 待装货',
    INVOICED: 'Invoiced 已开票', INVOICE_PENDING: 'Processing 处理中', NEEDS_DATA: 'Missing Data 待补资料', REVIEW: 'Review Required 待核对' })[row.status];
  const statusClass = row => row.status === 'READY' ? 'ready' : row.status === 'INVOICED' ? 'invoiced' : ['REVIEW', 'NEEDS_DATA'].includes(row.status) ? 'issue' : '';
  const isAttention = row => ['REVIEW', 'NEEDS_DATA'].includes(row.status);
  const activeKey = () => rows.find(row => selected.has(row.id))?.mergeKey;
  const compatible = row => !activeKey() || activeKey() === row.mergeKey;
  const capturedVersions = () => Object.fromEntries([...selected].flatMap(([id, version]) => [[id, version.loading], [id + ':invoice', version.invoice]]));
  const selectedDraft = () => model.buildDraft(rows, [...selected.keys()], capturedVersions());

  function project() {
    rows = model.projectRows({ company, rows: samples.filter(row => row.company === company) });
    const customer = $('customer').value;
    $('customer').innerHTML = '<option value="">All Customers 全部客户</option>' + [...new Map(rows.map(row => [row.customerId, row.customerName]))]
      .map(([id, name]) => '<option value="' + esc(id) + '">' + esc(name) + '</option>').join('');
    $('customer').value = rows.some(row => row.customerId === customer) ? customer : '';
    $('company-name').textContent = company === 'NCT' ? 'North Cape Trading Sdn. Bhd.' : 'Global HR · Example company';
  }
  function visibleRows() {
    const query = $('search').value.trim().toLowerCase(), customer = $('customer').value, status = $('status').value;
    return rows.filter(row => (!customer || row.customerId === customer)
      && (!query || [row.name, row.barcode, row.customerName, row.batch].join(' ').toLowerCase().includes(query))
      && (status === 'ALL' || status === 'REVIEW' ? status === 'ALL' || isAttention(row) : row.status === status));
  }
  function choose(row, enabled) {
    if (!enabled) selected.delete(row.id);
    else if (row.selectable && compatible(row)) selected.set(row.id, { loading: row.warehouseVersion, invoice: row.invoiceCoverageVersion });
  }
  function render() {
    $('ready-count').textContent = rows.filter(row => row.status === 'READY').length;
    $('waiting-count').textContent = rows.filter(row => row.status === 'WAIT_LOADING').length;
    $('issue-count').textContent = rows.filter(isAttention).length;
    const visible = visibleRows();
    $('rows').innerHTML = visible.map(row => {
      const disabled = !row.selectable || !compatible(row), index = rows.indexOf(row) + 1;
      const action = isAttention(row) ? '<button class="text-action urgent" data-detail="' + esc(row.id) + '">Details 查看原因</button>' : '';
      return '<tr class="' + (selected.has(row.id) ? 'selected' : '') + '"><td><input type="checkbox" data-check="' + esc(row.id) + '" aria-label="Select row ' + index + '" ' + (selected.has(row.id) ? 'checked ' : '') + (disabled ? 'disabled' : '') + '></td>'
        + '<td>' + String(index).padStart(3, '0') + '</td><td>' + esc(row.loadedAt || '') + (row.loadedAt ? '<small>by ' + esc(row.loadedBy) + '</small>' : '') + '</td>'
        + '<td><span class="customer-name">' + esc(row.customerName) + '</span><small>' + esc(row.shipmentGroup) + '</small></td>'
        + '<td class="description"><span class="code">' + esc(row.barcode) + '</span><strong>' + esc(row.name) + '</strong><small>' + esc(row.packing) + '</small><small>' + esc(row.batch) + '</small></td>'
        + '<td class="num qty">' + row.loadedQty + '</td><td class="num qty">' + row.invoicedQty + (row.pendingInvoiceQty ? '<small>Pending ' + row.pendingInvoiceQty + '</small>' : '') + '</td>'
        + '<td class="num qty">' + (row.invoiceQty === null ? '<span class="missing">Review 待核对</span>' : row.invoiceQty > 0 ? '<span class="to-invoice">' + row.invoiceQty + '</span>' : '0') + '</td>'
        + '<td class="num">' + money(row.sellingPriceCtnCents, row.currency) + '</td>'
        + '<td class="num">' + (row.invoiceQty > 0 ? money(row.amountCents, row.currency) : '') + '</td>'
        + '<td class="num">' + (row.invoiceQty > 0 ? dim(row.cbmMicro, 1000000, 4) : '') + '</td>'
        + '<td class="num">' + (row.invoiceQty > 0 ? dim(row.netWeightGrams, 1000, 2) : '') + '</td>'
        + '<td><span class="passive ' + statusClass(row) + '">' + esc(statusLabel(row)) + '</span>' + action + '</td>'
        + '<td class="messages"><button data-peer="SALES" data-id="' + esc(row.id) + '" aria-label="Contact Sales">S</button><button data-peer="WAREHOUSE" data-id="' + esc(row.id) + '" aria-label="Contact Warehouse">W</button></td></tr>';
    }).join('') || '<tr><td colspan="14">No matching tasks 没有符合条件的任务</td></tr>';
    $('row-count').textContent = visible.length + ' rows 行';
    const eligible = visible.filter(row => row.selectable && compatible(row));
    $('select-all').checked = eligible.length > 0 && eligible.every(row => selected.has(row.id));
    $('select-all').indeterminate = eligible.some(row => selected.has(row.id)) && !$('select-all').checked;
    $('select-all').disabled = !eligible.length;
    $('selection').hidden = !selected.size;
    $('clear').disabled = !selected.size;
    if (selected.size) {
      const total = selectedDraft();
      $('selected-count').textContent = selected.size + ' rows selected 已勾选';
      $('selected-context').textContent = total.customerName + ' · ' + total.currency + ' · ' + total.shipmentGroup;
      $('selected-qty').textContent = total.quantity + ' CTN';
      $('selected-value').innerHTML = money(total.amountCents, total.currency);
      $('selected-cbm').innerHTML = dim(total.cbmMicro, 1000000, 4) + ' m³';
      $('selected-weight').innerHTML = dim(total.netWeightGrams, 1000, 2) + ' kg';
      $('selection-help').textContent = 'Selection locked to '+total.customerName+' · '+total.currency+' · '+total.shipmentGroup+'。只可继续勾选相同客户、币种及发货批次。';
    } else $('selection-help').textContent = 'Tick loaded rows for one invoice. 勾选已装货行，合并为一张发票。';
  }
  function lineRows(lines, currency) {
    return lines.map(row => '<tr><td><b>' + esc(row.name) + '</b><small>' + esc(row.barcode) + ' · ' + esc(row.packing) + '</small></td><td class="num">'
      + row.invoiceQty + '</td><td class="num">' + money(row.amountCents, currency) + '</td><td class="num">' + dim(row.cbmMicro, 1000000, 4)
      + '</td><td class="num">' + dim(row.netWeightGrams, 1000, 2) + '</td></tr>').join('');
  }
  function totalsMarkup(total) {
    return '<span>' + total.quantity + ' CTN</span><span>' + money(total.amountCents, total.currency) + '</span><span>'
      + dim(total.cbmMicro, 1000000, 4) + ' m³</span><span>' + dim(total.netWeightGrams, 1000, 2) + ' kg</span>';
  }
  function openInvoice() {
    try { draft = selectedDraft(); } catch (error) { $('notice').textContent = error.message; return; }
    $('invoice-customer').textContent = draft.customerName;
    $('invoice-context').textContent = draft.company + ' · ' + draft.currency + ' · ' + draft.shipmentGroup;
    $('invoice-lines').innerHTML = lineRows(draft.lines, draft.currency);
    $('invoice-totals').innerHTML = totalsMarkup(draft);
    $('invoice-warning').textContent = draft.canPreview ? '' : 'Complete the missing '+draft.missing.join(', ')+' before preparing an invoice. 请先补齐缺失资料。';
    $('invoice-number').value = '';
    $('invoice-date').value = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    $('invoice-note').value = ''; $('invoice-error').textContent = ''; invoiceDirty = false;
    $('preview-invoice').disabled = !draft.canPreview;
    $('invoice').showModal();
  }
  function showReadonly(title, html) {
    $('readonly-title').textContent = title; $('readonly-body').innerHTML = html; $('readonly').showModal();
  }
  function showHistory(item) {
    showReadonly(item.id, '<p class="subtle">Example invoice 示例发票 · Read-only 只读</p><div class="invoice-sheet"><h3>SALES INVOICE</h3><p>'
      + esc(item.customerName) + ' · ' + esc(item.date) + '</p><div class="table-frame compact"><table><thead><tr><th>Product</th><th>Qty</th><th>Amount</th><th>CBM</th><th>Net Weight kg</th></tr></thead><tbody>'
      + lineRows(item.lines, item.currency) + '</tbody></table></div><div class="invoice-totals">' + totalsMarkup(item) + '</div><p>' + esc(item.status) + '</p></div>');
  }
  $('rows').addEventListener('change', event => { if (!event.target.matches('[data-check]')) return; const row = rows.find(row => row.id === event.target.dataset.check); choose(row, event.target.checked); render(); });
  $('rows').addEventListener('click', event => {
    const detail = event.target.closest('[data-detail]'), peer = event.target.closest('[data-peer]');
    if (detail) {
      const row = rows.find(row => row.id === detail.dataset.detail);
      showReadonly('Review Required 待核对', '<p><b>' + esc(row.name) + '</b></p><p>Loaded 已装货: ' + row.loadedQty + ' · Invoiced 已开票: ' + row.invoicedQty + '</p><p>'
        + esc([...row.issues, ...row.missing].join(', ')) + '</p><p class="subtle">Quantity changes belong to Warehouse. Product dimensions need a verified source. 数量差异请货仓处理；体积及净重需有已确认的数据来源。</p>');
    }
    if (peer) {
      const row = rows.find(row => row.id === peer.dataset.id), name = peer.dataset.peer === 'SALES' ? 'Sales Dept. 销售部' : 'Warehouse 货仓';
      showReadonly(name, '<p><b>' + esc(row.customerName) + '</b></p><p>' + esc(row.name) + ' · ' + esc(row.shipmentGroup) + '</p><p class="subtle">Chat entry concept only. No messages are sent from this draft. 此处仅展示聊天入口与业务上下文，初稿不发送消息。</p>');
    }
  });
  $('select-all').onchange = () => {
    const enabled = $('select-all').checked;
    const visible = visibleRows();
    // First visible eligible row establishes context; other customers never join.
    for (const row of visible) if (!enabled || row.selectable && compatible(row)) choose(row, enabled);
    render();
  };
  $('clear').onclick = () => { selected.clear(); render(); };
  $('search').oninput = render; $('status').onchange = render; $('customer').onchange = render;
  document.querySelectorAll('[data-status]').forEach(button => button.onclick = () => { $('status').value = button.dataset.status; render(); });
  $('merge').onclick = openInvoice;
  for (const id of ['invoice-number', 'invoice-date', 'invoice-note']) $(id).oninput = () => { invoiceDirty = true; };
  function closeInvoice() {
    if (invoiceDirty && !window.confirm('Discard this unsaved invoice draft? 放弃本次未保存的发票草稿？')) return;
    $('invoice').close(); invoiceDirty = false;
  }
  $('invoice').addEventListener('cancel', event => { event.preventDefault(); closeInvoice(); });
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.dataset.close === 'invoice' ? closeInvoice() : $(button.dataset.close).close());
  $('preview-invoice').onclick = () => {
    try {
      draft = selectedDraft();
      const number = $('invoice-number').value.trim(), date = $('invoice-date').value;
      if (!draft.canPreview) throw Error('Complete missing dimensions and price first. 请先补齐资料。');
      if (!number || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw Error('Enter an invoice number and valid date. 请填写发票号码与有效日期。');
      if (history.some(row => row.company === company && row.id.toUpperCase() === number.toUpperCase())) throw Error('Example invoice number already exists. 示例发票号码已存在。');
      showReadonly('Invoice Preview 发票预览', '<div class="invoice-sheet"><p class="watermark">DRAFT · NOT ISSUED · 示例，未开票</p><h3>SALES INVOICE</h3><p><b>' + esc(number) + '</b> · ' + esc(date)
        + '</p><p>' + esc(draft.customerName) + ' · ' + esc(draft.shipmentGroup) + '</p><div class="table-frame compact"><table><thead><tr><th>Product</th><th>Qty</th><th>Amount</th><th>CBM</th><th>Net Weight kg</th></tr></thead><tbody>'
        + lineRows(draft.lines, draft.currency) + '</tbody></table></div><div class="invoice-totals">' + totalsMarkup(draft) + '</div><p>' + esc($('invoice-note').value) + '</p></div>');
    } catch (error) { $('invoice-error').textContent = error.message; }
  };
  function renderHistory() {
    const values = history.filter(row => row.company === company);
    $('history').innerHTML = values.map(item => '<tr><td>' + esc(item.date) + '</td><td><button class="text-action" data-history="' + esc(item.id) + '">' + esc(item.id) + '</button></td><td>'
      + esc(item.customerName) + '</td><td>' + item.quantity + '</td><td>' + money(item.amountCents, item.currency) + '</td><td>' + dim(item.cbmMicro, 1000000, 4)
      + '</td><td>' + dim(item.netWeightGrams, 1000, 2) + '</td><td><span class="passive">' + esc(item.status) + '</span></td></tr>').join('') || '<tr><td colspan="8">No example invoices 暂无示例发票</td></tr>';
  }
  $('history').onclick = event => { const button = event.target.closest('[data-history]'); if (button) showHistory(history.find(row => row.company === company && row.id === button.dataset.history)); };
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => {
    view = button.dataset.view; $('active-content').hidden = view !== 'active'; $('history-content').hidden = view !== 'history';
    $('title').innerHTML = view === 'active' ? 'Active Tasks <small>客户开票任务</small>' : 'Invoice History <small>发票历史</small>';
    document.querySelectorAll('[data-view]').forEach(other => other.classList.toggle('active', other === button));
    if (view === 'history') renderHistory();
  });
  $('company').onchange = () => {
    if (selected.size && !window.confirm('Clear the current checkbox selection to change company? 切换公司并清除当前勾选？')) { $('company').value = company; return; }
    company = $('company').value; selected.clear(); $('status').value = 'ALL'; $('customer').value = ''; $('search').value = ''; project(); render(); renderHistory();
  };
  project(); render(); renderHistory();
})();
