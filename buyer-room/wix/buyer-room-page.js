import { getBuyerTransactionHistory, getBuyerWorkspace, createBuyerSelectionDownload, getBuyerOrderPage, getBuyerOrderDetail, saveBuyerQuantity, reduceBuyerOrderLine, removeBuyerItem, recoverBuyerItem, submitBuyerOrder, requestBuyerCustomerUser, setBuyerPrimaryUser, markBuyerAccountNotificationsRead } from 'backend/catalogueAuth.web';
import wixLocationFrontend from 'wix-location-frontend';
import wixWindowFrontend from 'wix-window-frontend';
import { local, session } from 'wix-storage-frontend';
import { authentication } from 'wix-members-frontend';
import wixRealtimeFrontend from 'wix-realtime-frontend';
import { getBuyerCompanies, getCurrentBuyerContext } from 'backend/catalogueAuth.web';
import { loadBuyerCompanyAccess, buyerCompanyPath, selectedBuyerCompanyId } from 'public/buyerCompanyNavigation.js';

let assistCustomerId = '';
function getAssistCustomerId() {
  // Assisted access must be explicit in the URL. Catalogue already preserves
  // the `assist` query when staff return to Buyer Room, while ignoring an old
  // session value prevents a later customer login from inheriting staff mode.
  const assist = String(wixLocationFrontend.query?.assist || '').trim();
  if (assist) return assist;
  try {
    return (new URL(wixLocationFrontend.url).searchParams.get('assist') || '').trim();
  } catch (error) {
    return '';
  }
}
function goToBuyerRoomStaffLogin(customerId) {
  const next = '/buyer-room?assist=' + encodeURIComponent(customerId);
  wixLocationFrontend.to('/sales-room-login?next=' + encodeURIComponent(next));
}

async function resolveEntryCustomerId(onExpiredStaffEntry) {
  const explicitCustomerId = getAssistCustomerId();
  let entry;
  try {
    const saved = session.getItem('staffBuyerEntryV1');
    if (saved) session.removeItem('staffBuyerEntryV1');
    if (!explicitCustomerId && saved) entry = JSON.parse(saved);
  } catch (error) { return explicitCustomerId; }
  if (!entry?.staffId || !/^CUS-[A-Za-z0-9-]+$/.test(entry.customerId || '') || !(entry.expiresAt > Date.now())) return explicitCustomerId;
  let signInRequired = false;
  try {
    const access = await getCurrentBuyerContext(entry.customerId);
    const buyer = access?.buyer;
    if (access?.ok && buyer?.status === 'ACTIVE' && ['ADMIN', 'STAFF'].includes(buyer.actorType) &&
        buyer.actorStaffId === entry.staffId && buyer.customerId === entry.customerId) return buyer.customerId;
    signInRequired = access?.reason === 'Sign in is required.';
  } catch (error) { signInRequired = error?.message === 'Sign in is required.'; }
  if (onExpiredStaffEntry && (signInRequired || !authentication.loggedIn())) onExpiredStaffEntry(entry.customerId);
  return '';
}
$w.onReady(async function () {
  if (wixWindowFrontend.rendering.env !== 'browser') return;
  let redirectingToStaffLogin = false;
  assistCustomerId = await resolveEntryCustomerId(customerId => {
    redirectingToStaffLogin = true;
    goToBuyerRoomStaffLogin(customerId);
  });
  if (redirectingToStaffLogin) return;
  const frame = $w('#html1');
  const downloadButton = $w('#downloadExcelButton');
  const requestedCompanyId = assistCustomerId ? '' : selectedBuyerCompanyId(wixLocationFrontend);
  let scopedCompanyId = requestedCompanyId;
  let companyAccess;
  const companyAccessReady = assistCustomerId || !authentication.loggedIn() ? null :
    loadBuyerCompanyAccess(getBuyerCompanies, requestedCompanyId).then(access => {
      companyAccess = access;
      if (companyAccess.scoped) scopedCompanyId = companyAccess.currentId;
    });
  const buyerScope = () => assistCustomerId || (scopedCompanyId ? { buyerCompanyId: scopedCompanyId } : '');
  const cataloguePath = () => assistCustomerId ? '/catalogue?assist=' + encodeURIComponent(assistCustomerId) :
    buyerCompanyPath('/catalogue', companyAccess?.scoped ? companyAccess.currentId : '');
  function sendCompanies() {
    if (companyAccess) frame.postMessage({ type: 'BUYER_COMPANY_ACCESS', ...companyAccess });
  }
  async function denyCompanyAccess() {
    companyAccess = { companies: [], blocked: true, denied: true };
    buyerOrderStorageKey = '';
    workspaceReadEpoch++;
    historyFiles.clear();
    downloadButton.disable();
    downloadButton.hide();
    downloadButton.link = '';
    try { companyAccess.companies = (await getBuyerCompanies()).companies; } catch (_) { /* Keep the workspace blocked. */ }
    sendCompanies();
  }
  // Only files returned by the authorized history read may leave the embed.
  const historyFiles = new Map();
  async function openHistoryFile(message) {
    if (scopedCompanyId && !(await getCurrentBuyerContext(buyerScope()))?.ok) {
      await denyCompanyAccess();
      return;
    }
    const saved = historyFiles.get(message.company);
    if (!saved || saved.requestId !== message.requestId || saved.customerId !== message.customerId) return;
    const file = saved.documents?.find(file => file.fileId === message.fileId && file.ready === true);
    if (!file || !/^[A-Za-z0-9_-]{10,200}$/.test(file.fileId) || file.url !== 'https://drive.google.com/file/d/' + file.fileId + '/view') return;
    wixLocationFrontend.to(file.url);
  }
  let historyCustomerId = '';
  let frameReady = false;
  let buyerOrderStorageKey = '';
  let orderSubmissionInFlight = false;
  let confirmedOrderRequest = null;
  const orderRequestId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  function readOrderRequest(key) {
    if (!key) return null;
    try {
      const request = JSON.parse(session.getItem(key));
      return orderRequestId.test(request?.requestId) && Array.isArray(request.lines) ? request : null;
    } catch (_) { return null; }
  }
  function forgetOrderRequest(key, requestId) {
    if (readOrderRequest(key)?.requestId !== requestId) return;
    try { session.removeItem(key); } catch (_) { /* A later retry uses the original request ID. */ }
  }
  const campaignStorageKey = 'buyerWaitingCampaignLastV1';
  let waitingCampaignIndex;
  let activeBuyerRoomView = 'my';
  let selectionImageOpen = false;
  let selectionDownloadUrl = '';
  let activeDownloadExpiresAt = 0;
  let downloadPreparation = null;
  let selectionDataKey = '';

  downloadButton.disable();
  downloadButton.hide();
  downloadButton.link = '';

  function updateDownloadButtonVisibility() {
    if (activeBuyerRoomView === 'my' && selectionDownloadUrl && !selectionImageOpen) {
      downloadButton.enable();
      downloadButton.show();
    } else downloadButton.hide();
  }

  async function prepareSelectionDownload(force = false) {
    if (!force && selectionDownloadUrl && activeDownloadExpiresAt > Date.now() + 30000) {
      updateDownloadButtonVisibility();
      return;
    }
    if (downloadPreparation) return downloadPreparation;
    const preparingKey = selectionDataKey;
    downloadPreparation = (async () => {
      const result = await createBuyerSelectionDownload(buyerScope());
      if (!result?.ok || !result.url || !Number.isFinite(Number(result.expiresAt))) throw new Error('Excel download could not be prepared.');
      if (preparingKey !== selectionDataKey || companyAccess?.blocked) return;
      selectionDownloadUrl = result.url;
      activeDownloadExpiresAt = Number(result.expiresAt);
      downloadButton.link = selectionDownloadUrl;
      downloadButton.target = '_self';
      updateDownloadButtonVisibility();
    })();
    try { await downloadPreparation; }
    catch (error) {
      selectionDownloadUrl = '';
      downloadButton.hide();
      console.error('Buyer Room Excel link preparation failed', error);
    } finally { downloadPreparation = null; if (preparingKey !== selectionDataKey) prepareSelectionDownload(); }
  }

  downloadButton.onClick(() => {
    if (!selectionDownloadUrl || activeDownloadExpiresAt <= Date.now()) {
      console.warn('Excel link expired. Please click again after it is prepared.');
      prepareSelectionDownload(true);
      return;
    }
    // The native button follows its prebound link. Refresh only the short-lived URL.
    setTimeout(() => prepareSelectionDownload(true), 1500);
  });

  let workspaceRefreshPromise = null, workspaceReadEpoch = 0, workspaceRefreshQueued = false;
  function refreshWorkspace(afterWrite = false) {
    if (afterWrite) { workspaceRefreshQueued = true; workspaceReadEpoch++; }
    if (!workspaceRefreshPromise) workspaceRefreshPromise = (async () => {
      do { workspaceRefreshQueued = false; await loadWorkspace(); } while (workspaceRefreshQueued);
    })().finally(() => { workspaceRefreshPromise = null; if (workspaceRefreshQueued) return refreshWorkspace(); });
    return workspaceRefreshPromise;
  }
  async function loadWorkspace() {
    if (companyAccessReady) await companyAccessReady;
    sendCompanies();
    if (companyAccess?.blocked) return;
    const readEpoch = ++workspaceReadEpoch;
    let result;
    try { result = await getBuyerWorkspace(buyerScope()); }
    catch (error) {
      if (readEpoch !== workspaceReadEpoch) return;
      if (assistCustomerId) {
        if (!authentication.loggedIn() || error?.message === 'Sign in is required.') { goToBuyerRoomStaffLogin(assistCustomerId); return; }
        frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', ok: false, message: 'Staff Management could not authorize this Buyer Room. ' + (error?.message || String(error)) });
        throw error;
      }
      if (companyAccess?.scoped && /no longer available|not linked/.test(error?.message || '')) {
        await denyCompanyAccess();
        return;
      }
      throw error;
    }
    if (readEpoch !== workspaceReadEpoch) return;
    if (!result?.ok || !result?.context?.customerId || result.context.status !== 'ACTIVE') {
      if (assistCustomerId) {
        if (!authentication.loggedIn()) { goToBuyerRoomStaffLogin(assistCustomerId); return; }
        frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', ok: false, message: 'Assisted Access Could Not Be Verified.' });
      } else wixLocationFrontend.to('/buyer-room-login');
      return;
    }
    if (historyCustomerId !== result.context.customerId) { historyFiles.clear(); historyCustomerId = result.context.customerId; }
    const { customerId, actorType, actorUserId } = result.context;
    buyerOrderStorageKey = actorType === 'CUSTOMER_USER' && actorUserId
      ? 'buyerOrderRequestV1:' + JSON.stringify([customerId, actorUserId]) : '';
    if (assistCustomerId) session.setItem('catalogueAssistCustomerId', result.context.customerId);
    // Quantity and its audit fields do not appear in the My Selection Excel.
    const currentSelectionKey = JSON.stringify((result.myList || []).map(({ orderQtyCtn, qtyEditedAt, qtyEditedBy, updatedAt, lastEditedBy, ...selection }) => selection));
    if (currentSelectionKey !== selectionDataKey) {
      selectionDataKey = currentSelectionKey;
      selectionDownloadUrl = '';
      activeDownloadExpiresAt = 0;
      downloadButton.disable();
      downloadButton.link = '';
    }
    const siteBaseUrl = String(wixLocationFrontend.baseUrl || '').replace(/\/+$/, '');
    frame.postMessage({ type: 'BUYER_ROOM_DATA', data: {
      customerId: result.context.customerId,
      catalogueUrl: siteBaseUrl ? siteBaseUrl + cataloguePath() : '',
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
      pendingOrderRequestId: readOrderRequest(buyerOrderStorageKey)?.requestId || '',
      ordersNextCursor: result.ordersNextCursor || ''
    }});
    prepareSelectionDownload();
  }

  let quantitySavesInFlight = 0, quantityRefreshNeeded = false;
  async function runAction(action, successMessage, actionName, itemId = '') {
    const quantityAction = actionName === 'quantity';
    if (quantityAction) quantitySavesInFlight++;
    try {
      const result = await action();
      frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', ...result, itemId: result?.itemId || itemId, action: actionName, ok: true, message: successMessage });
      if (quantityAction) quantityRefreshNeeded = true;
      else await loadWorkspace();
    } catch (error) {
      frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', action: actionName, itemId, ok: false, message: error?.message || 'The action could not be completed.' });
      if (companyAccess?.scoped && /no longer available|not linked/.test(error?.message || '')) await denyCompanyAccess();
    } finally {
      if (quantityAction && --quantitySavesInFlight === 0 && quantityRefreshNeeded) {
        quantityRefreshNeeded = false;
        try { await refreshWorkspace(true); }
        catch (error) { console.error('Buyer quantity saved; workspace readback failed', error); }
      }
    }
  }

  frame.onMessage(async (event) => {
    const message = event.data || {};
    if (companyAccessReady) await companyAccessReady;
    if (message.type === 'BUYER_COMPANY_SWITCH') {
      if (companyAccess?.companies.some(company => company.customerId === message.customerId)) {
        wixLocationFrontend.to(buyerCompanyPath('/buyer-room', message.customerId));
      }
      return;
    }
    if (companyAccess?.blocked && !['BUYER_ROOM_READY', 'BUYER_ROOM_REQUEST_DATA', 'BUYER_ROOM_LOADING_CAMPAIGN_SHOWN'].includes(message.type)) return;
    if (message.type === 'BUYER_ROOM_ORDER_ACK') {
      if (message.requestId && message.requestId === confirmedOrderRequest?.requestId) {
        forgetOrderRequest(confirmedOrderRequest.key, confirmedOrderRequest.requestId);
        confirmedOrderRequest = null;
      }
      return;
    }
    if (message.type === 'BUYER_ROOM_SELECTION_IMAGE_STATE' && typeof message.open === 'boolean') {
      selectionImageOpen = message.open;
      updateDownloadButtonVisibility();
      return;
    }
    if (message.type === 'CUSTOMER_HISTORY_FILE_OPEN') { await openHistoryFile(message); return; }
    if (message.type === 'BUYER_TRANSACTION_HISTORY_REQUEST') {
      if (!['NCT','GHR'].includes(message.company) || typeof message.requestId !== 'string' || message.requestId.length > 100) return;
      const pending = {requestId:message.requestId, customerId:historyCustomerId};
      historyFiles.set(message.company, pending);
      try { const result = await getBuyerTransactionHistory(message.company, buyerScope());
        if (historyFiles.get(message.company) === pending && result.company === message.company && result.customerId === historyCustomerId && result.customerId === pending.customerId) pending.documents = result.documents;
        frame.postMessage({type:'BUYER_TRANSACTION_HISTORY_RESULT', ok:true, company:message.company, requestId:message.requestId, result}); }
      catch (error) { frame.postMessage({type:'BUYER_TRANSACTION_HISTORY_RESULT', ok:false, company:message.company, requestId:message.requestId, error:error?.message || 'Transaction history could not be loaded.'}); }
      return;
    }
    if (message.type === 'BUYER_ROOM_VIEW_CHANGED') {
      activeBuyerRoomView = message.view;
      updateDownloadButtonVisibility();
      return;
    }
    if (message.type === 'BUYER_ROOM_LOADING_CAMPAIGN_SHOWN' && waitingCampaignIndex !== undefined && message.index === waitingCampaignIndex) {
      try { local.setItem(campaignStorageKey, String(waitingCampaignIndex)); }
      catch { /* The rotation is optional when storage is unavailable. */ }
      return;
    }
    if (message.type === 'BUYER_ROOM_READY' || message.type === 'BUYER_ROOM_REQUEST_DATA') {
      if (!frameReady) {
        waitingCampaignIndex = 0;
        try {
          const previous = local.getItem(campaignStorageKey);
          if (['0', '1', '2'].includes(previous)) waitingCampaignIndex = (Number(previous) + 1) % 3;
        } catch { waitingCampaignIndex = Math.floor(Math.random() * 3); }
      }
      if (!frameReady || message.type === 'BUYER_ROOM_READY') {
        frame.postMessage({ type: 'BUYER_ROOM_LOADING_CAMPAIGN', index: waitingCampaignIndex });
      }
      frameReady = true;
      try { await refreshWorkspace(); }
      catch (error) { console.error('Buyer Room data failed', error); if (!assistCustomerId) wixLocationFrontend.to('/buyer-room-login'); }
      return;
    }
    if (message.type === 'BUYER_ROOM_BROWSE_CATALOGUE') {
      wixLocationFrontend.to(cataloguePath());
      return;
    }
    if (message.type === 'BUYER_ROOM_USER_REQUEST') {
      try {
        const result = await requestBuyerCustomerUser(message.payload || {}, message.requestId || '', buyerScope());
        frame.postMessage({ type: 'BUYER_ROOM_USER_RESULT', ...result, action: 'request' });
        await loadWorkspace();
      } catch (error) {
        frame.postMessage({ type: 'BUYER_ROOM_USER_RESULT', ok: false, action: 'request', message: error?.message || 'The user request could not be submitted.' });
      }
      return;
    }
    if (message.type === 'BUYER_ROOM_SET_PRIMARY') {
      try {
        const result = await setBuyerPrimaryUser(message.userId || '', message.requestId || '', buyerScope());
        frame.postMessage({ type: 'BUYER_ROOM_USER_RESULT', ...result, action: 'primary' });
        await loadWorkspace();
      } catch (error) {
        frame.postMessage({ type: 'BUYER_ROOM_USER_RESULT', ok: false, action: 'primary', message: error?.message || 'Primary User could not be changed.' });
      }
      return;
    }
    if (message.type === 'BUYER_ROOM_NOTIFICATIONS_READ') {
      try { await markBuyerAccountNotificationsRead(message.eventIds || [], buyerScope()); await loadWorkspace(); }
      catch (error) { console.error('Buyer Room notification update failed', error); }
      return;
    }
    if (message.type === 'BUYER_ROOM_SAVE_QTY') {
      await runAction(() => saveBuyerQuantity(message.itemId || '', message.quantityCtn, buyerScope()), 'Quantity saved.', 'quantity', message.itemId || '');
      return;
    }
    if (message.type === 'BUYER_ROOM_REMOVE') {
      await runAction(() => removeBuyerItem(message.itemId || '', buyerScope()), 'Product moved to Removed History.', 'remove', message.itemId || '');
      return;
    }
    if (message.type === 'BUYER_ROOM_RECOVER') {
      await runAction(() => recoverBuyerItem(message.itemId || '', buyerScope()), 'Restored to My Selection. A new quote has been requested.', 'recover', message.itemId || '');
      return;
    }
    if (message.type === 'BUYER_ROOM_ORDER_PAGE') {
      try {
        const result = await getBuyerOrderPage(message.cursor || '', buyerScope());
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_PAGE_RESULT', ...result });
      } catch (error) { frame.postMessage({ type: 'BUYER_ROOM_ORDER_PAGE_RESULT', ok: false, message: error?.message || 'Order history could not be loaded.' }); }
      return;
    }
    if (message.type === 'BUYER_ROOM_ORDER_DETAIL') {
      try {
        const result = await getBuyerOrderDetail(message.orderId || '', buyerScope());
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_DETAIL_RESULT', ...result });
      } catch (error) { frame.postMessage({ type: 'BUYER_ROOM_ORDER_DETAIL_RESULT', ok: false, orderId: message.orderId || '', message: error?.message || 'Order detail could not be loaded.' }); }
      return;
    }
    if (message.type === 'BUYER_ROOM_REDUCE_ORDER') {
      try {
        const result = await reduceBuyerOrderLine(message.orderId || '', message.lineId || '', message.newQuantityCtn, message.requestId || '', buyerScope());
        const detail = await getBuyerOrderDetail(message.orderId || '', buyerScope());
        frame.postMessage({ type: 'BUYER_ROOM_REDUCTION_RESULT', ...result, order: detail.order });
        await loadWorkspace();
      } catch (error) {
        frame.postMessage({ type: 'BUYER_ROOM_REDUCTION_RESULT', ok: false, message: error?.message || 'Reduction request could not be submitted.' });
      }
      return;
    }
    if (message.type === 'BUYER_ROOM_SUBMIT_ORDER' || message.type === 'BUYER_ROOM_RESUME_ORDER') {
      if (orderSubmissionInFlight) return;
      const resuming = message.type === 'BUYER_ROOM_RESUME_ORDER';
      const key = buyerOrderStorageKey;
      const saved = readOrderRequest(key);
      const requestId = message.requestId || '';
      if (resuming && saved?.requestId !== requestId) {
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_RESULT', requestId, ok: false, recoveryUnavailable: true, message: 'The saved request is no longer available. Check Track Orders.' });
        return;
      }
      if (saved && saved.requestId !== requestId) {
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_RESULT', requestId, ok: false, pendingOrderRequestId: saved.requestId });
        return;
      }
      const request = saved || {
        requestId, lines: message.lines || [], customerPoNumber: message.customerPoNumber || ''
      };
      if (key && !saved && orderRequestId.test(requestId)) {
        try { session.setItem(key, JSON.stringify(request)); } catch (_) { /* Retry remains available while the page is open. */ }
      }
      orderSubmissionInFlight = true;
      let result;
      try {
        result = await submitBuyerOrder(request.lines, buyerScope(), requestId, request.customerPoNumber);
        if (!result?.ok || !result.orderId) throw new Error(result?.message || 'Order could not be confirmed.');
      } catch (error) {
        const detail = error?.message || 'Order could not be confirmed.';
        if (/^(Enter a P\.O\. number of up to 100 characters\.|Enter at least one order quantity\.|Order lines are invalid\. Please refresh the order form\.|Invalid order line\.|All ordered products must have a released V\.I\.P price\.|All ordered products require EA and unit price data before submission\.)$/.test(detail)) {
          forgetOrderRequest(key, requestId);
        }
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_RESULT', requestId, ok: false, pendingOrderRequestId: readOrderRequest(key)?.requestId || '', message: detail });
        if (companyAccess?.scoped && /no longer available|not linked/.test(detail)) await denyCompanyAccess();
        return;
      } finally {
        orderSubmissionInFlight = false;
      }
      confirmedOrderRequest = { key, requestId };
      frame.postMessage({ type: 'BUYER_ROOM_ORDER_RESULT', ...result, requestId, message: result.warning || 'Order request sent to Sales Room.' });
      try { await refreshWorkspace(true); }
      catch (error) { console.error('Buyer order confirmed; workspace readback failed', error); }
    }
  });
  wixRealtimeFrontend.subscribe({ name: 'sales-room-signals' }, (message) => {
    if (!frameReady || message?.payload?.type !== 'ORDER_QUANTITY_CHANGED') return;
    frame.postMessage({ type: 'BUYER_ROOM_ORDER_REFRESH' });
    refreshWorkspace().catch(error => console.error('Buyer order realtime refresh failed', error));
  }).catch(error => console.error('Buyer order realtime subscription failed', error));

  // When Wix has already started the fixed HTML embed, keep that frame and request a fresh handshake.
  // If the embed was not configured with its website address, retain the existing dynamic load.
  const buyerRoomEmbedUrl = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/buyer-room-20261125-company-entry.html';
  if (frame.src !== buyerRoomEmbedUrl) frame.src = buyerRoomEmbedUrl;
  else frame.postMessage({ type: 'BUYER_ROOM_HOST_READY' });
  // The shell can render while the authorized data request is in flight.
  void refreshWorkspace().catch(error => {
    console.error('Buyer Room authorization failed', error);
    if (!assistCustomerId) wixLocationFrontend.to('/buyer-room-login');
  });
  // Visible-frame polling is the only periodic workspace refresh authority.
  setInterval(() => { if (activeDownloadExpiresAt && activeDownloadExpiresAt < Date.now() + 60000) { downloadButton.disable(); downloadButton.link = ''; prepareSelectionDownload(true); } }, 30000);
});
