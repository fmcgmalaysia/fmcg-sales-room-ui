(() => {
  'use strict';

  const currencies = ['MYR', 'USD', 'SGD'];
  const moneyFormat = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const reportDateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' });
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const money = cents => Number.isSafeInteger(cents) ? moneyFormat.format(cents / 100) : '—';
  const elapsedDay = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / 86400000 : null;
  };

  function ageBalances(rows, today) {
    if (!Array.isArray(rows)) return null;
    const todayNumber = elapsedDay(today);
    if (todayNumber === null) return null;
    const report = { total: 0, aging: [0, 0, 0, 0, 0], unknown: 0, nextSeven: 0 };
    for (const { balance, dueDate } of rows) {
      if (!Number.isSafeInteger(balance)) return null;
      if (balance <= 0) continue;
      report.total += balance;
      if (!Number.isSafeInteger(report.total)) return null;
      const due = elapsedDay(dueDate);
      if (due === null) {
        report.unknown += balance;
        continue;
      }
      const late = todayNumber - due;
      const bucket = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
      report.aging[bucket] += balance;
      if (late <= 0 && late > -7) report.nextSeven += balance;
    }
    report.overdue = report.aging.slice(1).reduce((sum, balance) => sum + balance, 0);
    report.complete = report.unknown === 0;
    return report;
  }

  function receivableReport(ledger, currency, today) {
    const invoices = ledger?.invoicePayments?.invoices;
    return ageBalances(Array.isArray(invoices) ? invoices.filter(invoice => invoice.currency === currency)
      .map(invoice => ({ balance: invoice.dueCents, dueDate: invoice.dueDate })) : null, today);
  }

  function payableReport(snapshot, currency, today) {
    if (!Array.isArray(snapshot?.orders) || snapshot.queryView) return null;
    const orders = snapshot.orders.filter(row => row.currency === currency);
    const confirmed = orders.filter(row => Number.isSafeInteger(row.finance?.payableCents));
    const report = ageBalances(confirmed.map(row => ({ balance: row.finance.balanceCents, dueDate: row.dueDate })), today);
    if (report) {
      report.pendingInvoices = orders.filter(row => !Number.isSafeInteger(row.finance?.payableCents)
        && (row.documents || []).some(doc => doc.type === 'INV' && doc.linked && !doc.superseded)).length;
    }
    return report;
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { ageBalances, receivableReport, payableReport };
    return;
  }

  const state = { company: '', currency: 'MYR', kind: 'ar', receivables: null, payables: null, pending: '', notice: '', stamp: String };
  const ready = () => Boolean(state.receivables || state.payables);
  const panel = () => document.querySelector('.finance-overview[data-company="' + state.company + '"]');
  const counts = value => Number.isSafeInteger(value) ? String(value) : '—';

  function readReceivables() {
    if (state.pending || !state.company) return;
    const company = state.company, requestId = crypto.randomUUID();
    state.pending = requestId;
    state.notice = '';
    window.parent.postMessage({ type: 'ACCOUNT_CUSTOMER_LEDGER_REQUEST', company, requestId }, '*');
    setTimeout(() => {
      if (state.pending !== requestId || state.company !== company) return;
      state.pending = '';
      state.notice = 'Receivables could not be refreshed. Use Refresh to retry.';
      renderSummary();
    }, 30000);
  }

  function exposure(label, report, kind) {
    const percentage = report?.complete && report.total > 0 ? (100 * report.overdue / report.total).toFixed(1) : null;
    const cannotAge = !report || report.total > 0 && report.unknown === report.total;
    const noun = kind === 'ar' ? 'Receivables' : 'Payables';
    return '<section class="fo-metric"><div class="fo-label"><h2>'+label+'</h2><span>'+escape(state.currency)+'</span></div>'
      +'<p class="fo-total">'+money(report?.total)+'</p><div class="fo-metric-body">'
      +'<div class="fo-ring is-overdue" style="--value:'+(percentage ?? 0)+'%" role="img" aria-label="'+(percentage === null ? 'Overdue percentage unavailable' : percentage+' percent overdue')+'"><div><b>'+(percentage === null ? '—' : percentage+'%')+'</b><small>Overdue</small></div></div>'
      +'<div class="fo-breakdown"><span>Overdue '+noun+'</span><b>'+money(cannotAge ? null : report.overdue)+'</b>'
      +(report?.unknown ? '<small>Missing due date · '+money(report.unknown)+'</small>' : '')
      +(report?.pendingInvoices ? '<small>'+report.pendingInvoices+' supplier invoice'+(report.pendingInvoices === 1 ? '' : 's')+' awaiting confirmation</small>' : '')
      +'<button type="button" data-finance-aging="'+kind+'">View aging <span aria-hidden="true">↘</span></button></div></div></section>';
  }

  function renderSummary() {
    const root = panel();
    if (!root) return;
    const asOf = new Date();
    const today = reportDateFormat.format(asOf);
    const ar = receivableReport(state.receivables?.customerAccount, state.currency, today);
    const ap = payableReport(state.payables, state.currency, today);
    const aging = state.kind === 'ar' ? ar : ap;
    const amounts = !aging ? Array(6).fill(null) : aging.total > 0 && aging.total === aging.unknown
      ? [null, null, null, null, null, aging.unknown] : [...aging.aging, aging.unknown];
    const labels = ['Not yet due', '1–30 days overdue', '31–60 days overdue', '61–90 days overdue', '91+ days overdue', 'Missing Due Date'];
    const max = Math.max(1, ...amounts);
    const pending = state.receivables?.customerAccount?.pendingDocuments;
    const review = Array.isArray(pending) ? pending.filter(row => row.status === 'AWAITING_REVIEW') : null;
    const supplierReview = state.payables?.orders?.filter(row => row.procurementHandoff?.stage === 'SUBMITTED');
    const due = report => report?.complete ? money(report.nextSeven) : '—';
    root.querySelector('[data-overview-metrics]').innerHTML =
      exposure('Accounts Receivable', ar, 'ar') + exposure('Accounts Payable', ap, 'ap')
      + '<section class="fo-metric"><div class="fo-label"><h2>Bank Facilities</h2></div><p class="fo-total">—</p><div class="fo-metric-body"><div class="fo-ring" style="--value:0%" aria-hidden="true"><div><b>—</b><small>Utilized</small></div></div><p class="fo-unavailable">Not configured</p></div></section>';
    root.querySelector('[data-overview-aging]').innerHTML = labels.map((label, index) =>
      '<li><div><span>'+label+'</span><b>'+money(amounts[index])+'</b></div><span class="fo-track"><i style="--value:'+((amounts[index] || 0) / max * 100)+'%"></i></span></li>').join('');
    root.querySelector('[data-overview-due-ar]').textContent = due(ar);
    root.querySelector('[data-overview-due-ap]').textContent = due(ap);
    root.querySelector('[data-overview-receipts]').textContent = counts(review?.filter(row => row.type === 'CUSTOMER_RECEIPT').length);
    root.querySelector('[data-overview-suppliers]').textContent = counts(supplierReview?.length);
    root.querySelector('[data-overview-charges]').textContent = counts(review?.filter(row => ['CHARGE_INV','DEBIT_NOTE'].includes(row.type)).length);
    const readTimes = [state.receivables?.readAt, state.payables?.readAt].filter(time => Number.isFinite(Date.parse(time)));
    const lastCompleteRead = readTimes.sort()[0];
    root.querySelector('[data-overview-status]').textContent = state.notice || (state.pending ? 'Loading receivables…'
      : lastCompleteRead ? 'Balances as of '+state.stamp(lastCompleteRead)+' MYT'
        : ready() ? 'Snapshot time unavailable' : 'Loading financial records…');
    const more = (state.receivables?.customerAccount?.invoicePayments?.invoices || []).map(row => row.currency)
      .filter(code => /^[A-Z]{3}$/.test(code) && !currencies.includes(code));
    const select = root.querySelector('select');
    for (const code of new Set(more)) {
      if (!Array.from(select.options).some(option => option.value === code)) select.add(new Option(code));
    }
    select.value = state.currency;
    root.querySelectorAll('[data-overview-unit]').forEach(node => { node.textContent = state.currency; });
    root.querySelectorAll('[data-finance-aging][aria-pressed]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.financeAging === state.kind));
    });
  }

  function render({ root, company, data, error, stamp }) {
    if (state.company !== company) {
      Object.assign(state, { company, currency: 'MYR', kind: 'ar', receivables: null, payables: null, pending: '', notice: '' });
    }
    state.stamp = stamp;
    state.payables = data?.company === company && !data.queryView ? data : null;
    root.innerHTML = '<section class="finance-overview" data-company="'+company+'">'
      + '<header class="fo-heading"><div><h1>Financial Overview</h1><p aria-live="polite" data-overview-status></p></div><div>'
      + '<label class="fo-currency">Receivables &amp; payables currency <select>'+currencies.map(code => '<option'+(code === state.currency ? ' selected' : '')+'>'+code+'</option>').join('')+'</select></label>'
      + '<button id="accountRefresh" type="button">Refresh</button></div></header>'
      + (error ? '<p class="account-notice error" role="alert">'+escape(error)+'</p>' : '')
      + '<section class="fo-cash"><div><h2>Cash on Hand</h2><p>Balances not configured</p></div><dl>'+currencies.map(code => '<div><dt>'+code+'</dt><dd>—</dd></div>').join('')+'</dl></section>'
      + '<div class="fo-metrics" data-overview-metrics></div><div class="fo-work">'
      + '<section class="fo-panel"><div class="fo-section-head"><div><h2>Aging by Due Date</h2><p>Outstanding balances · <span data-overview-unit></span></p></div><div class="fo-switch" role="group" aria-label="Aging type"><button type="button" data-finance-aging="ar" aria-pressed="true">Receivables</button><button type="button" data-finance-aging="ap" aria-pressed="false">Payables</button></div></div><ol class="fo-aging" data-overview-aging aria-live="polite"></ol></section>'
      + '<div class="fo-side"><section class="fo-panel"><div class="fo-section-head"><div><h2>Due in the Next 7 Days</h2><p><span data-overview-unit></span> · Excludes overdue items</p></div></div><dl><div><dt>Due to receive</dt><dd data-overview-due-ar></dd></div><div><dt>Due to pay</dt><dd data-overview-due-ap></dd></div></dl></section>'
      + '<section class="fo-panel"><h2>Pending Review</h2><dl><div><dt>Customer payment proofs</dt><dd data-overview-receipts></dd></div><div><dt>Supplier payment requests</dt><dd data-overview-suppliers></dd></div><div><dt>Charge invoices &amp; debit notes</dt><dd data-overview-charges></dd></div></dl></section></div></div></section>';
    const shell = panel();
    shell.querySelector('select').onchange = event => { state.currency = event.target.value; renderSummary(); };
    shell.onclick = event => {
      const button = event.target.closest('[data-finance-aging]');
      if (!button) return;
      state.kind = button.dataset.financeAging;
      const fromMetric = !button.hasAttribute('aria-pressed');
      renderSummary();
      if (fromMetric) shell.querySelector('[aria-pressed="true"]').focus();
    };
    if (state.payables && !state.receivables && !state.notice) readReceivables();
    renderSummary();
  }

  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window.parent || message?.type !== 'ACCOUNT_CUSTOMER_LEDGER_RESULT'
      || message.requestId !== state.pending || message.company !== state.company) return;
    state.pending = '';
    if (message.ok && message.result?.company === state.company && Array.isArray(message.result.customerAccount?.invoicePayments?.invoices)) {
      state.receivables = message.result;
      state.notice = '';
    } else {
      state.receivables = null;
      state.notice = 'Receivables are unavailable. Use Refresh to retry.';
    }
    renderSummary();
  });

  window.accountFinanceOverview = { render, refresh: readReceivables };
})();
