import { getBuyerWorkspace, saveBuyerQuantity, removeBuyerItem, recoverBuyerItem, submitBuyerOrder } from 'backend/catalogueAuth.web';
import wixLocationFrontend from 'wix-location-frontend';
import wixWindowFrontend from 'wix-window-frontend';
import { session } from 'wix-storage-frontend';

let assistCustomerId = '';
function getAssistCustomerId() {
  return String(wixLocationFrontend.query?.assist || session.getItem('catalogueAssistCustomerId') || '').trim();
}

$w.onReady(async function () {
  if (wixWindowFrontend.rendering.env !== 'browser') return;
  const frame = $w('#html1');
  assistCustomerId = getAssistCustomerId();

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
    frame.postMessage({ type: 'BUYER_ROOM_DATA', data: {
      companyName: result.context.companyName,
      memberName: result.context.actorName || result.context.email,
      currency: result.context.currency || 'USD',
      assisted: result.context.actorType === 'STAFF',
      myList: result.myList || [],
      removed: result.removed || [],
      orders: result.orders || []
    }});
  }

  async function runAction(action, successMessage, actionName) {
    try {
      const result = await action();
      frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', ...result, action: actionName, ok: true, message: successMessage });
      await loadWorkspace();
    } catch (error) {
      frame.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', ok: false, message: error?.message || 'The action could not be completed.' });
    }
  }

  frame.onMessage(async (event) => {
    const message = event.data || {};
    if (message.type === 'BUYER_ROOM_READY' || message.type === 'BUYER_ROOM_REQUEST_DATA') {
      try { await loadWorkspace(); }
      catch (error) { console.error('Buyer Room data failed', error); if (!assistCustomerId) wixLocationFrontend.to('/buyer-room-login'); }
      return;
    }
    if (message.type === 'BUYER_ROOM_BROWSE_CATALOGUE') {
      wixLocationFrontend.to(assistCustomerId ? '/catalogue?assist=' + encodeURIComponent(assistCustomerId) : '/catalogue');
      return;
    }
    if (message.type === 'BUYER_ROOM_SAVE_QTY') {
      await runAction(() => saveBuyerQuantity(message.itemId || '', message.quantityCtn, assistCustomerId), 'Quantity saved.', 'quantity');
      return;
    }
    if (message.type === 'BUYER_ROOM_REMOVE') {
      await runAction(() => removeBuyerItem(message.itemId || '', assistCustomerId), 'Product moved to Removed History.', 'remove');
      return;
    }
    if (message.type === 'BUYER_ROOM_RECOVER') {
      await runAction(() => recoverBuyerItem(message.itemId || '', assistCustomerId), 'Product recovered to My Selection.', 'recover');
      return;
    }
    if (message.type === 'BUYER_ROOM_SUBMIT_ORDER') {
      try {
        const result = await submitBuyerOrder(message.lines || [], assistCustomerId);
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_RESULT', ...result, message: 'Order confirmed and sent to Sales Room.' });
        await loadWorkspace();
      } catch (error) {
        frame.postMessage({ type: 'BUYER_ROOM_ORDER_RESULT', ok: false, message: error?.message || 'Order could not be confirmed.' });
      }
    }
  });

  try { await loadWorkspace(); }
  catch (error) { console.error('Buyer Room authorization failed', error); if (!assistCustomerId) wixLocationFrontend.to('/buyer-room-login'); }
});
