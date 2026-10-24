// Purchase uses the same current-stock renderer as Warehouse. Only the two
// authenticated read operations cross this pane; no allocation or stock save.
(() => {
  let current = null;
  function mount({ container, company, read }) {
    if (!container || !['NCT', 'GHR'].includes(company) || typeof read !== 'function') return;
    if (current) current.cancelled = true;
    const frame = document.createElement('iframe'), state = { frame, company, cancelled: false, requests: new Set() };
    current = state;
    frame.title = 'Purchase Stock Control 采购库存管理';
    frame.src = '../warehouse-room/stock-control.html?v=20261024-r2&embedded=warehouse&company=' + company;
    frame.style.cssText = 'display:block;width:100%;height:560px;border:0;background:transparent';
    container.replaceChildren(frame);
    const active = () => current === state && !state.cancelled && frame.isConnected;
    state.receive = async event => {
      if (!active() || event.source !== frame.contentWindow || event.origin !== location.origin) return;
      const message = event.data || {};
      if (message.company !== company) return;
      if (message.type === 'STOCK_CONTROL_LAYOUT') {
        if (Number.isFinite(message.height)) frame.style.height = Math.max(560, Math.min(20000, Math.ceil(message.height))) + 'px';
        return;
      }
      if (message.type === 'WAREHOUSE_LOGIN_REQUEST') { parent.postMessage({ type: 'PURCHASE_LOGIN_REQUEST' }, '*'); return; }
      if (!['STOCK_CONTROL_READ_REQUEST', 'STOCK_CONTROL_SOURCE_READ_REQUEST'].includes(message.type)
        || !/^[a-f0-9-]{36}$/i.test(message.requestId || '') || JSON.stringify(message).length > 6000
        || state.requests.has(message.requestId) || state.requests.size >= 4) return;
      const detail = message.type === 'STOCK_CONTROL_SOURCE_READ_REQUEST', requestId = message.requestId;
      const type = detail ? 'STOCK_CONTROL_SOURCE_READ_RESULT' : 'STOCK_CONTROL_READ_RESULT';
      state.requests.add(requestId);
      try {
        const result = await read(detail ? 'PURCHASE_STOCK_SOURCES_REQUEST' : 'PURCHASE_STOCK_CONTROL_REQUEST', { input: message.input || {} });
        if (active()) frame.contentWindow.postMessage({ type, company, requestId, ok: result?.ok === true, result,
          ...(result?.ok === true ? {} : { error: result?.error || 'Current stock unconfirmed 当前库存尚未确认。' }) }, location.origin);
      } catch (_) {
        if (active()) frame.contentWindow.postMessage({ type, company, requestId, ok: false, error: 'Current stock unconfirmed 当前库存尚未确认。' }, location.origin);
      } finally { state.requests.delete(requestId); }
    };
  }
  window.addEventListener('message', event => current?.receive(event));
  window.purchaseStockControl = { mount };
})();
