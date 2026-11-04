import { getBuyerWorkspace, createBuyerSelectionDownload, createBuyerOrderDownload, getBuyerOrderPage, getBuyerOrderDetail, saveBuyerQuantity, reduceBuyerOrderLine, removeBuyerItem, recoverBuyerItem, submitBuyerOrder, requestBuyerCustomerUser, setBuyerPrimaryUser, markBuyerAccountNotificationsRead } from 'backend/catalogueAuth.web';
import { getTestXlsxDownloadUrl } from 'backend/xlsxTest.web';
import wixLocationFrontend from 'wix-location-frontend';
import wixWindowFrontend from 'wix-window-frontend';
import { session } from 'wix-storage-frontend';
import wixRealtimeFrontend from 'wix-realtime-frontend';

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
  let activeBuyerRoomView = 'my';
  let selectionDownloadUrl = '';
  let activeDownloadExpiresAt = 0;
  let downloadPreparation = null;

  downloadButton.disable();
  downloadButton.hide();
  downloadButton.link = '';

  function updateDownloadButtonVisibility() {
    if (activeBuyerRoomView === 'my' && selectionDownloadUrl) {
      downloadButton.enable();
      downloadButton.show();
    } else downloadButton.hide();
  }

  async function prepareSelectionDownload(force = false) {
    if (assistCustomerId === 'CUS-261006-2034B6' && wixLocationFrontend.query?.excelProbe === 'xlsxTest') {
      if (selectionDownloadUrl) return;
      if (downloadPreparation) return downloadPreparation;
      downloadPreparation = (async () => {
        downloadButton.label = 'Preparing Excel test...';
        downloadButton.show();
        try {
          const result = await getTestXlsxDownloadUrl();
          if (!result?.ok) throw new Error((result?.step || 'response') + ': ' + (result?.message || 'No response'));
          selectionDownloadUrl = result.url;
          activeDownloadExpiresAt = Number(result.expiresAt);
          downloadButton.link = result.url;
          downloadButton.target = '_self';
          downloadButton.label = 'Download Excel Test';
          updateDownloadButtonVisibility();
          console.log('Excel fixed-file probe ready', { sizeInBytes: result.sizeInBytes, isPrivate: result.isPrivate });
        } catch (error) {
          downloadButton.label = 'Excel: ' + (error?.message || String(error));
          downloadButton.disable();
          console.error('Excel fixed-file probe failed', error);
          frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', ok: false, message: 'Excel test: ' + (error?.message || String(error)) });
        }
      })();
      return downloadPreparation;
    }
    if (!force && selectionDownloadUrl && activeDownloadExpiresAt > Date.now() + 30000) {
      updateDownloadButtonVisibility();
      return;
    }
    if (downloadPreparation) return downloadPreparation;
    downloadPreparation = (async () => {
      const result = await createBuyerSelectionDownload(assistCustomerId);
      if (!result?.ok || !result.token || !Number.isFinite(Number(result.expiresAt))) throw new Error('Excel download could not be prepared.');
      const siteBaseUrl = String(wixLocationFrontend.baseUrl || '').replace(/\/+$/, '');
      selectionDownloadUrl = `${siteBaseUrl}/_functions/buyerSelectionExcel?token=${encodeURIComponent(result.token)}`;
      activeDownloadExpiresAt = Number(result.expiresAt);
      updateDownloadButtonVisibility();
    })();
    try { await downloadPreparation; }
    catch (error) {
      selectionDownloadUrl = '';
      downloadButton.hide();
      console.error('Buyer Room Excel link preparation failed', error);
    } finally { downloadPreparation = null; }
  }

  downloadButton.onClick(() => {
    if (assistCustomerId === 'CUS-261006-2034B6' && wixLocationFrontend.query?.excelProbe === 'xlsxTest') return;
    if (!selectionDownloadUrl || activeDownloadExpiresAt <= Date.now()) {
      console.warn('Excel link expired. Please click again after it is prepared.');
      prepareSelectionDownload(true);
      return;
    }
    wixLocationFrontend.to(selectionDownloadUrl);
    setTimeout(() => prepareSelectionDownload(true), 1500);
  });

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
    prepareSelectionDownload();
  }

  async function runAction(action, successMessage, actionName, itemId = '') {
    try {
      const result = await action();
      frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', ...result, itemId: result?.itemId || itemId, action: actionName, ok: true, message: successMessage });
      await loadWorkspace();
    } catch (error) {
      frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', action: actionName, itemId, ok: false, message: error?.message || 'The action could not be completed.' });
    }
  }

  frame.onMessage(async (event) => {
    const message = event.data || {};
    if (message.type === 'BUYER_ROOM_VIEW_CHANGED') {
      activeBuyerRoomView = message.view;
      updateDownloadButtonVisibility();
      return;
    }
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
    if (message.type === 'BUYER_ROOM_REDUCE_ORDER') {
      try {
        const result = await reduceBuyerOrderLine(message.orderId || '', message.lineId || '', message.newQuantityCtn, message.requestId || '', assistCustomerId);
        const detail = await getBuyerOrderDetail(message.orderId || '', assistCustomerId);
        frame.postMessage({ type: 'BUYER_ROOM_REDUCTION_RESULT', ...result, order: detail.order });
        await loadWorkspace();
      } catch (error) {
        frame.postMessage({ type: 'BUYER_ROOM_REDUCTION_RESULT', ok: false, message: error?.message || 'Reduction request could not be submitted.' });
      }
      return;
    }
    if (message.type === 'BUYER_ROOM_SUBMIT_ORDER') {
      try {
        const result = await submitBuyerOrder(message.lines || [], assistCustomerId, message.requestId || '');
        let downloadFile = null;
        let downloadError = '';
        try {
          const siteBaseUrl = String(wixLocationFrontend.baseUrl || '').replace(/\/+$/, '');
          const download = await createBuyerOrderDownload(result.orderId, assistCustomerId, `${siteBaseUrl}/buyer-room`);
          downloadFile = { fileName: String(download.fileName || '').trim(), base64: String(download.base64 || '').trim() };
          if (!downloadFile.fileName || !downloadFile.base64) throw new Error('Order Excel response was incomplete.');
        } catch (error) {
          downloadError = error?.message || 'Order Excel could not be prepared.';
          console.error('Buyer order Excel preparation failed', error);
        }
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_RESULT', ...result, downloadReady: Boolean(downloadFile), downloadError, message: result.warning || 'Order request sent to Sales Room.' });
        wixWindowFrontend.openLightbox('Order Received', { orderId: result.orderId, downloadReady: Boolean(downloadFile), downloadError })
          .then(lightboxResult => {
            if (lightboxResult?.action === 'download' && downloadFile) {
              frame.postMessage({ type: 'BUYER_ROOM_DOWNLOAD_ORDER_EXCEL', ...downloadFile });
            }
          })
          .catch(error => console.error('Order Received lightbox could not be opened', error));
        await loadWorkspace();
      } catch (error) {
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_RESULT', ok: false, message: error?.message || 'Order could not be confirmed.' });
      }
    }
  });
  wixRealtimeFrontend.subscribe({ name: 'sales-room-signals' }, (message) => {
    if (!frameReady || message?.payload?.type !== 'ORDER_QUANTITY_CHANGED') return;
    frame.postMessage({ type: 'BUYER_ROOM_ORDER_REFRESH' });
    loadWorkspace().catch(error => console.error('Buyer order realtime refresh failed', error));
  }).catch(error => console.error('Buyer order realtime subscription failed', error));

    // Attach the message listener before loading the embed. A cached HTML frame
  // can otherwise send BUYER_ROOM_READY before Wix starts listening, leaving
  // the first visit on the loading state until the page is refreshed.
  frame.src = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/buyer-room.html?v=20261006-native-selection-download-room5-v1';
  try { await loadWorkspace(); }
  catch (error) { console.error('Buyer Room authorization failed', error); if (!assistCustomerId) wixLocationFrontend.to('/buyer-room-login'); }
  setInterval(() => { if (frameReady && wixWindowFrontend.rendering.env === 'browser') loadWorkspace().catch(() => { if (!assistCustomerId) wixLocationFrontend.to('/buyer-room-login'); }); }, 15000);
});
