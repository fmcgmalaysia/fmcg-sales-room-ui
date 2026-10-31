// Read-only Finance pane. Cost authorization remains exclusively on the server.
(() => {
 let frame = null, company = '', activeRequest = '', busy = false;
 const origin = location.origin, targetOrigin = origin === 'null' ? '*' : origin;
 window.accountStockList = {
  render({company: selectedCompany, view}) {
   if (view !== 'stock') return false;
   if (!['NCT','GHR'].includes(selectedCompany)) return true;
   if (frame?.isConnected && company === selectedCompany) return true;
   company = selectedCompany; activeRequest = ''; busy = false;
   frame = document.createElement('iframe'); frame.title = 'Finance Stock List';
   frame.src = 'stock-list.html?v=20261031-company-stock-list-v1&embedded=account&company=' + company;
   frame.style.cssText = 'display:block;width:100%;height:560px;border:0;background:transparent';
   document.getElementById('app').replaceChildren(frame); return true;
  },
  refresh() { if (frame?.isConnected && !busy) frame.contentWindow.postMessage({type:'STOCK_CONTROL_REFRESH',company},targetOrigin); }
 };
 window.addEventListener('message', event => {
  const message = event.data || {};
  if (frame?.isConnected && event.source === frame.contentWindow && event.origin === origin) {
   if (message.company !== company) return;
   if (message.type === 'STOCK_CONTROL_LAYOUT') {
    if (Number.isFinite(message.height)) frame.style.height = Math.max(560,Math.min(20000,Math.ceil(message.height)))+'px';
    if (typeof message.busy === 'boolean') busy = message.busy; return;
   }
   if (message.type === 'ACCOUNT_LOGIN_REQUEST') { parent.postMessage({type:message.type},'*'); return; }
   if (message.type !== 'FINANCE_STOCK_LIST_READ_REQUEST' || typeof message.requestId !== 'string' || !message.requestId || message.requestId.length > 100 || JSON.stringify(message).length > 2000) return;
   activeRequest = message.requestId; parent.postMessage({type:message.type,company,requestId:activeRequest,input:message.input || {}},'*'); return;
  }
  if (event.source !== parent || !frame?.isConnected) return;
  if (message.type === 'ACCOUNT_LOGIN_RESULT') { frame.contentWindow.postMessage(message,targetOrigin); return; }
  if (message.type !== 'FINANCE_STOCK_LIST_READ_RESULT' || message.company !== company || !activeRequest || message.requestId !== activeRequest) return;
  activeRequest=''; frame.contentWindow.postMessage(message,targetOrigin);
 });
})();
