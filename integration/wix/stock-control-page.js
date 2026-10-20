// Dedicated Stock Control page, using the site's existing html1 embed convention.
import { getWarehouseStockControl } from 'backend/stockControl.web';
import { authentication } from 'wix-members-frontend';
import wixLocationFrontend from 'wix-location-frontend';

$w.onReady(() => {
  const room = $w('#html1');
  room.onMessage(async event => {
    const message = event.data || {};
    if (message.type === 'WAREHOUSE_LOGIN_REQUEST') {
      try { await authentication.promptLogin({ mode: 'login', modal: true }); room.postMessage({ type: 'WAREHOUSE_LOGIN_RESULT', ok: true }); }
      catch (_) { room.postMessage({ type: 'WAREHOUSE_LOGIN_RESULT', ok: false }); }
      return;
    }
    if (message.type !== 'STOCK_CONTROL_READ_REQUEST' || !['NCT', 'GHR'].includes(message.company)
      || typeof message.requestId !== 'string' || message.requestId.length > 100 || JSON.stringify(message).length > 2000) return;
    try {
      const result = await getWarehouseStockControl(message.company, message.input || {});
      room.postMessage({ type: 'STOCK_CONTROL_READ_RESULT', company: message.company, requestId: message.requestId, ok: true, result });
    } catch (error) {
      room.postMessage({ type: 'STOCK_CONTROL_READ_RESULT', company: message.company, requestId: message.requestId,
        ok: false, error: error?.message || 'Stock could not be read. Please retry. 库存读取未完成，请重试。' });
    }
  });
  const company = ['NCT', 'GHR'].includes(wixLocationFrontend.query.company) ? wixLocationFrontend.query.company : 'NCT';
  room.src = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/warehouse-room/stock-control.html?v=20261021-stock-control-v1&company=' + company;
});
