import { getPurchaseWorkspace } from 'backend/purchaseWorkspace.web';
const UI_ORIGIN = 'https://fmcgmalaysia.github.io';
$w.onReady(() => {
  const room = $w('#html1');
  room.onMessage(async event => {
    if (event.origin && event.origin !== UI_ORIGIN) return;
    const message = event.data || {};
    if (message.type !== 'PURCHASE_WORKSPACE_REQUEST' || !['NCT', 'GHR'].includes(message.company) ||
        typeof message.requestId !== 'string' || message.requestId.length > 100) return;
    try {
      const workspace = await getPurchaseWorkspace(message.company);
      room.postMessage({ type: 'PURCHASE_WORKSPACE_RESULT', requestId: message.requestId, company: message.company, ok: true, workspace });
    } catch (error) {
      room.postMessage({ type: 'PURCHASE_WORKSPACE_RESULT', requestId: message.requestId, company: message.company,
        ok: false, error: error?.message || 'Purchase data could not be loaded.' });
    }
  });
  room.src = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/purchase-live/?v=20261010-cms-v1';
});
