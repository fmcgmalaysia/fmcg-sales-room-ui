// Warehouse-owned pane. Only stock reads/login are relayed; business saves are not.
(() => {
  let frame = null, company = '', activeRequest = '', busy = false;
  const origin = location.origin;
  const targetOrigin = origin === 'null' ? '*' : origin; // Local file previews have opaque origins; source checks remain mandatory.
  window.warehouseStockTab = {
    render(container, selectedCompany) {
      if (!['NCT', 'GHR'].includes(selectedCompany)) return;
      if (frame?.isConnected && company === selectedCompany) return;
      company = selectedCompany; activeRequest = ''; busy = false;
      frame = document.createElement('iframe');
      frame.title = 'Warehouse Stock Control 库存管理';
      frame.src = 'stock-control.html?v=20261021-stock-tab-v1&embedded=warehouse&company=' + company;
      frame.style.cssText = 'display:block;width:100%;height:560px;border:0;background:transparent';
      container.replaceChildren(frame);
    },
    isBusy: () => busy,
    refresh() {
      if (frame?.isConnected && !busy) frame.contentWindow.postMessage({ type: 'STOCK_CONTROL_REFRESH', company }, targetOrigin);
    }
  };
  window.addEventListener('message', event => {
    const message = event.data || {};
    if (frame?.isConnected && event.source === frame.contentWindow && event.origin === origin) {
      if (message.company !== company) return;
      if (message.type === 'STOCK_CONTROL_LAYOUT') {
        if (Number.isFinite(message.height)) frame.style.height = Math.max(560, Math.min(20000, Math.ceil(message.height))) + 'px';
        if (typeof message.busy === 'boolean') busy = message.busy;
        return;
      }
      if (message.type === 'WAREHOUSE_LOGIN_REQUEST') {
        parent.postMessage({ type: 'WAREHOUSE_LOGIN_REQUEST' }, '*'); return;
      }
      if (message.type !== 'STOCK_CONTROL_READ_REQUEST' || typeof message.requestId !== 'string'
        || !message.requestId || message.requestId.length > 100 || JSON.stringify(message).length > 2000) return;
      activeRequest = message.requestId;
      parent.postMessage({ type: message.type, company, requestId: activeRequest, input: message.input || {} }, '*');
      return;
    }
    if (event.source !== parent || !frame?.isConnected || message.type !== 'STOCK_CONTROL_READ_RESULT'
      || message.company !== company || !activeRequest || message.requestId !== activeRequest) return;
    activeRequest = '';
    frame.contentWindow.postMessage(message, targetOrigin);
  });
})();
