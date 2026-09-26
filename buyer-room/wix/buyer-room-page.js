import { getBuyerWorkspace, getBuyerSelectionExport, uploadBuyerSelectionExcel, getBuyerOrderPage, getBuyerOrderDetail, saveBuyerQuantity, removeBuyerItem, recoverBuyerItem, submitBuyerOrder, requestBuyerCustomerUser, setBuyerPrimaryUser, markBuyerAccountNotificationsRead } from 'backend/catalogueAuth.web';
import wixLocationFrontend from 'wix-location-frontend';
import wixWindowFrontend from 'wix-window-frontend';
import { session } from 'wix-storage-frontend';

let assistCustomerId = '';
let accessMode = '';
function getAssistCustomerId() {
  // Assisted access must be explicit in the URL. Catalogue already preserves
  // the `assist` query when staff return to Buyer Room, while ignoring an old
  // session value prevents a later customer login from inheriting staff mode.
  return String(wixLocationFrontend.query?.assist || '').trim();
}
function getAccessMode() {
  return String(wixLocationFrontend.query?.adminTest || '').trim() === '1' ? 'ADMIN_TEST' : '';
}

$w.onReady(async function () {
  if (wixWindowFrontend.rendering.env !== 'browser') return;
  const frame = $w('#html1');
  frame.src = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/buyer-room.html?v=20260927-admin-test-v26';
  assistCustomerId = getAssistCustomerId();
  accessMode = getAccessMode();
  let frameReady = false;
  let exportRequestNumber = 0;
  let activeExportRequestId = '';
  let activeCustomerId = '';
  let activeDownloadUrl = '';

  async function prepareSelectionDownload() {
    if (!activeCustomerId) {
      frame.postMessage({ type: 'BUYER_ROOM_EXPORT_RESULT', ok: false, message: 'Buyer account is still loading.' });
      return;
    }
    const requestId = `${activeCustomerId}-${++exportRequestNumber}`;
    activeExportRequestId = requestId;
    activeDownloadUrl = '';
    try {
      const result = await getBuyerSelectionExport(assistCustomerId);
      if (requestId !== activeExportRequestId) return;
      if (!result?.rows?.length) {
        frame.postMessage({ type: 'BUYER_ROOM_EXPORT_RESULT', ok: false, message: 'There are no products to export.' });
        return;
      }
      const siteBaseUrl = String(wixLocationFrontend.baseUrl || '').replace(/\/+$/, '');
      frame.postMessage({ type: 'BUYER_ROOM_EXPORT_PREPARE', ...result, buyerRoomUrl: siteBaseUrl + '/buyer-room', requestId });
    } catch (error) {
      console.error('Buyer Room Excel preparation failed', error);
      frame.postMessage({ type: 'BUYER_ROOM_EXPORT_RESULT', ok: false, message: error?.message || 'Excel export could not be prepared.' });
    }
  }

  async function loadWorkspace(refreshExport = true) {
    let result;
    try { result = await getBuyerWorkspace(assistCustomerId, accessMode); }
    catch (error) {
      if (assistCustomerId) {
        frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', ok: false, message: 'Assisted Access Error: ' + (error?.message || String(error)) });
        throw error;
      }
      throw error;
    }
    if (!result?.ok || !result?.context?.customerId || result.context.status !== 'ACTIVE') {
      if (assistCustomerId) {
        frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', ok: false, message: 'Assisted Access Could Not Be Verified.' });
      } else wixLocationFrontend.to('/buyer-room-login');
      return;
    }
    if (assistCustomerId) session.setItem('catalogueAssistCustomerId', result.context.customerId);
    activeCustomerId = result.context.customerId;
    const siteBaseUrl = String(wixLocationFrontend.baseUrl || '').replace(/\/+$/, '');
    frame.postMessage({ type: 'BUYER_ROOM_DATA', data: {
      customerId: result.context.customerId,
      catalogueUrl: siteBaseUrl ? siteBaseUrl + '/catalogue' + (assistCustomerId ? '?assist=' + encodeURIComponent(assistCustomerId) : '') : '',
      companyName: result.context.companyName,
      memberName: result.context.actorName || result.context.email,
      currency: result.context.currency || 'USD',
      selectionLimit: result.context.selectionLimit,
      assisted: result.context.actorType === 'STAFF',
      adminTest: result.context.actorType === 'ADMIN_TEST',
      account: result.account || null,
      myList: result.myList || [],
      removed: result.removed || [],
      orders: result.orders || [],
      ordersNextCursor: result.ordersNextCursor || ''
    }});
    if (frameReady && refreshExport) await prepareSelectionDownload();
  }

  async function runAction(action, successMessage, actionName, itemId = '') {
    try {
      const result = await action();
      frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', ...result, itemId: result?.itemId || itemId, action: actionName, ok: true, message: successMessage });
      await loadWorkspace(actionName !== 'quantity');
    } catch (error) {
      frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', action: actionName, itemId, ok: false, message: error?.message || 'The action could not be completed.' });
    }
  }

  frame.onMessage(async (event) => {
    const message = event.data || {};
    if (message.type === 'BUYER_ROOM_READY' || message.type === 'BUYER_ROOM_REQUEST_DATA') {
      frameReady = true;
      try { await loadWorkspace(); }
      catch (error) { console.error('Buyer Room data failed', error); if (!assistCustomerId) wixLocationFrontend.to('/buyer-room-login'); }
      return;
    }
    if (message.type === 'BUYER_ROOM_BROWSE_CATALOGUE') {
      wixLocationFrontend.to(assistCustomerId ? '/catalogue?assist=' + encodeURIComponent(assistCustomerId) : '/catalogue');
      return;
    }
    if (message.type === 'BUYER_ROOM_USER_REQUEST') {
      try {
        const result = await requestBuyerCustomerUser(message.payload || {}, message.requestId || '', assistCustomerId, accessMode);
        frame.postMessage({ type: 'BUYER_ROOM_USER_RESULT', ...result, action: 'request' });
        await loadWorkspace();
      } catch (error) {
        frame.postMessage({ type: 'BUYER_ROOM_USER_RESULT', ok: false, action: 'request', message: error?.message || 'The user request could not be submitted.' });
      }
      return;
    }
    if (message.type === 'BUYER_ROOM_SET_PRIMARY') {
      try {
        const result = await setBuyerPrimaryUser(message.userId || '', message.requestId || '', assistCustomerId, accessMode);
        frame.postMessage({ type: 'BUYER_ROOM_USER_RESULT', ...result, action: 'primary' });
        await loadWorkspace();
      } catch (error) {
        frame.postMessage({ type: 'BUYER_ROOM_USER_RESULT', ok: false, action: 'primary', message: error?.message || 'Primary User could not be changed.' });
      }
      return;
    }
    if (message.type === 'BUYER_ROOM_NOTIFICATIONS_READ') {
      try { await markBuyerAccountNotificationsRead(message.eventIds || [], assistCustomerId, accessMode); await loadWorkspace(false); }
      catch (error) { console.error('Buyer Room notification update failed', error); }
      return;
    }
    if (message.type === 'BUYER_ROOM_EXPORT_REQUEST') {
      await prepareSelectionDownload();
      return;
    }
    if (message.type === 'BUYER_ROOM_EXPORT_DOWNLOAD') {
      if (message.requestId && message.requestId === activeExportRequestId && /^https:\/\//i.test(activeDownloadUrl)) {
        wixLocationFrontend.to(activeDownloadUrl);
      }
      return;
    }
    if (message.type === 'BUYER_ROOM_SAVE_QTY') {
      await runAction(() => saveBuyerQuantity(message.itemId || '', message.quantityCtn, assistCustomerId), 'Quantity saved.', 'quantity', message.itemId || '');
      return;
    }
    if (message.type === 'BUYER_ROOM_REMOVE') {
      await runAction(() => removeBuyerItem(message.itemId || '', assistCustomerId), 'Product moved to Removed History.', 'remove', message.itemId || '');
      return;
    }
    if (message.type === 'BUYER_ROOM_RECOVER') {
      await runAction(() => recoverBuyerItem(message.itemId || '', assistCustomerId), 'Restored to My Selection. A new quote has been requested.', 'recover', message.itemId || '');
      return;
    }
    if (message.type === 'BUYER_ROOM_EXPORT_FILE') {
      try {
        if (!message.requestId || message.requestId !== activeExportRequestId) return;
        const result = await uploadBuyerSelectionExcel(message.customerId || '', message.base64 || '', assistCustomerId);
        if (!result?.ok) {
          const stage = result?.stage ? `[${result.stage}] ` : '';
          const code = result?.code ? ` (${result.code})` : '';
          throw new Error(`${stage}${result?.message || 'Excel upload failed.'}${code}`);
        }
        if (!String(result.downloadUrl || '').startsWith('https://')) throw new Error('[DOWNLOAD_URL] Excel download link is unavailable.');
        if (message.requestId !== activeExportRequestId) return;
        activeDownloadUrl = result.downloadUrl;
        frame.postMessage({ type: 'BUYER_ROOM_EXPORT_READY', ok: true, requestId: message.requestId, fileName: result.fileName || '' });
      } catch (error) {
        console.error('Buyer Room Excel upload failed', error);
        frame.postMessage({ type: 'BUYER_ROOM_EXPORT_RESULT', ok: false, message: error?.message || 'Excel download could not be started.' });
      }
      return;
    }
    if (message.type === 'BUYER_ROOM_EXPORT_FILE_ERROR') {
      console.error('Buyer Room Excel file generation failed', message.message || 'Unknown error');
      if (message.requestId === activeExportRequestId) frame.postMessage({ type: 'BUYER_ROOM_EXPORT_RESULT', ok: false, message: message.message || 'Excel export could not be prepared.' });
      return;
    }
    if (message.type === 'BUYER_ROOM_ORDER_PAGE') {
      try {
        const result = await getBuyerOrderPage(message.cursor || '', assistCustomerId);
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_PAGE_RESULT', ...result });
      } catch (error) { frame.postMessage({ type: 'BUYER_ROOM_ORDER_PAGE_RESULT', ok: false, message: error?.message || 'Order history could not be loaded.' }); }
      return;
    }
    if (message.type === 'BUYER_ROOM_ORDER_DETAIL') {
      try {
        const result = await getBuyerOrderDetail(message.orderId || '', assistCustomerId);
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_DETAIL_RESULT', ...result });
      } catch (error) { frame.postMessage({ type: 'BUYER_ROOM_ORDER_DETAIL_RESULT', ok: false, orderId: message.orderId || '', message: error?.message || 'Order detail could not be loaded.' }); }
      return;
    }
    if (message.type === 'BUYER_ROOM_SUBMIT_ORDER') {
      try {
        const result = await submitBuyerOrder(message.lines || [], assistCustomerId, message.requestId || '');
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_RESULT', ...result, message: result.warning || 'Order confirmed and sent to Sales Room.' });
        await loadWorkspace();
      } catch (error) {
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_RESULT', ok: false, message: error?.message || 'Order could not be confirmed.' });
      }
    }
  });

  try { await loadWorkspace(); }
  catch (error) { console.error('Buyer Room authorization failed', error); if (!assistCustomerId) wixLocationFrontend.to('/buyer-room-login'); }
  setInterval(() => { if (frameReady && wixWindowFrontend.rendering.env === 'browser') loadWorkspace(false).catch(() => { if (!assistCustomerId) wixLocationFrontend.to('/buyer-room-login'); }); }, 15000);
});

