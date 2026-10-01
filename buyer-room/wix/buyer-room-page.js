import { getBuyerWorkspace, createBuyerSelectionDownload, getBuyerOrderPage, getBuyerOrderDetail, saveBuyerQuantity, removeBuyerItem, recoverBuyerItem, submitBuyerOrder, requestBuyerCustomerUser, setBuyerPrimaryUser, markBuyerAccountNotificationsRead } from 'backend/catalogueAuth.web';
import wixLocationFrontend from 'wix-location-frontend';
import wixWindowFrontend from 'wix-window-frontend';
import { session } from 'wix-storage-frontend';

let assistCustomerId = '';
function getAssistCustomerId() {
  // Assisted access must be explicit in the URL. Catalogue already preserves
  // the `assist` query when staff return to Buyer Room, while ignoring an old
  // session value prevents a later customer login from inheriting staff mode.
  return String(wixLocationFrontend.query?.assist || '').trim();
}
$w.onReady(async function () {
  if (wixWindowFrontend.rendering.env !== 'browser') return;
  const frame = $w('#html1');
  const downloadButton = $w('#downloadExcelButton');
  assistCustomerId = getAssistCustomerId();
  let frameReady = false;
  let activeCustomerId = '';
  let activeDownloadUrl = '';
  let activeDownloadExpiresAt = 0;
  let downloadPreparation = null;

  downloadButton.disable();
  downloadButton.label = 'Preparing Excel…';
  downloadButton.target = '_self';

  async function prepareSelectionDownload(force = false) {
    if (!activeCustomerId) throw new Error('Buyer account is still loading.');
    if (!force && activeDownloadUrl && activeDownloadExpiresAt > Date.now() + 30000) return activeDownloadUrl;
    if (downloadPreparation) return downloadPreparation;
    downloadPreparation = (async () => {
      const result = await createBuyerSelectionDownload(assistCustomerId);
      if (!result?.ok || !result.token || !Number.isFinite(Number(result.expiresAt))) throw new Error('Excel download authorization is unavailable.');
      const siteBaseUrl = String(wixLocationFrontend.baseUrl || '').replace(/\/+$/, '');
      activeDownloadUrl = `${siteBaseUrl}/_functions/buyerSelectionExcel?token=${encodeURIComponent(result.token)}`;
      activeDownloadExpiresAt = Number(result.expiresAt);
      downloadButton.link = activeDownloadUrl;
      downloadButton.label = 'Export Excel';
      downloadButton.enable();
      return activeDownloadUrl;
    })();
    try { return await downloadPreparation; }
    finally { downloadPreparation = null; }
  }

  async function refreshSelectionDownload(force = false) {
    try { await prepareSelectionDownload(force); }
    catch (error) {
      downloadButton.link = '';
      downloadButton.label = 'Export unavailable';
      downloadButton.disable();
      console.error('Buyer Room Excel link preparation failed', error);
    }
  }

  async function loadWorkspace() {
    let result;
    try { result = await getBuyerWorkspace(assistCustomerId); }
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
    refreshSelectionDownload().catch(() => {});
    const siteBaseUrl = String(wixLocationFrontend.baseUrl || '').replace(/\/+$/, '');
    frame.postMessage({ type: 'BUYER_ROOM_DATA', data: {
      customerId: result.context.customerId,
      catalogueUrl: siteBaseUrl ? siteBaseUrl + '/catalogue' + (assistCustomerId ? '?assist=' + encodeURIComponent(assistCustomerId) : '') : '',
      companyName: result.context.companyName,
      memberName: result.context.actorName || result.context.email,
      currency: result.context.currency || 'USD',
      selectionLimit: result.context.selectionLimit,
      assisted: result.context.actorType === 'STAFF',
      adminAccess: result.context.actorType === 'ADMIN',
      account: result.account || null,
      myList: result.myList || [],
      removed: result.removed || [],
      orders: result.orders || [],
      ordersNextCursor: result.ordersNextCursor || ''
    }});
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
        const result = await requestBuyerCustomerUser(message.payload || {}, message.requestId || '', assistCustomerId);
        frame.postMessage({ type: 'BUYER_ROOM_USER_RESULT', ...result, action: 'request' });
        await loadWorkspace();
      } catch (error) {
        frame.postMessage({ type: 'BUYER_ROOM_USER_RESULT', ok: false, action: 'request', message: error?.message || 'The user request could not be submitted.' });
      }
      return;
    }
    if (message.type === 'BUYER_ROOM_SET_PRIMARY') {
      try {
        const result = await setBuyerPrimaryUser(message.userId || '', message.requestId || '', assistCustomerId);
        frame.postMessage({ type: 'BUYER_ROOM_USER_RESULT', ...result, action: 'primary' });
        await loadWorkspace();
      } catch (error) {
        frame.postMessage({ type: 'BUYER_ROOM_USER_RESULT', ok: false, action: 'primary', message: error?.message || 'Primary User could not be changed.' });
      }
      return;
    }
    if (message.type === 'BUYER_ROOM_NOTIFICATIONS_READ') {
      try { await markBuyerAccountNotificationsRead(message.eventIds || [], assistCustomerId); await loadWorkspace(); }
      catch (error) { console.error('Buyer Room notification update failed', error); }
      return;
    }
    if (message.type === 'BUYER_ROOM_EXPORT' || message.type === 'BUYER_ROOM_EXPORT_REQUEST') {
      frame.postMessage({ type: 'BUYER_ROOM_EXPORT_RESULT', ok: false, message: 'Use the Export Excel button above the workspace.' });
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
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_RESULT', ...result, message: result.warning || 'Order request sent to Sales Room.' });
        await loadWorkspace();
      } catch (error) {
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_RESULT', ok: false, message: error?.message || 'Order could not be confirmed.' });
      }
    }
  });

    // Attach the message listener before loading the embed. A cached HTML frame
  // can otherwise send BUYER_ROOM_READY before Wix starts listening, leaving
  // the first visit on the loading state until the page is refreshed.
  frame.src = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/buyer-room.html?v=20261001-buyer-room-native-download-v65';
  try { await loadWorkspace(); }
  catch (error) { console.error('Buyer Room authorization failed', error); if (!assistCustomerId) wixLocationFrontend.to('/buyer-room-login'); }
  setInterval(() => { if (frameReady && wixWindowFrontend.rendering.env === 'browser') loadWorkspace().catch(() => { if (!assistCustomerId) wixLocationFrontend.to('/buyer-room-login'); }); }, 15000);
});

