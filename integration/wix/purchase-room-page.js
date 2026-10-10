import { getPurchaseWorkspace } from 'backend/purchaseWorkspace.web';
import { retryPurchaseTaskCost } from 'backend/purchaseCostRetry.web';
import { authentication, currentMember } from 'wix-members-frontend';
const UI_ORIGIN = 'https://fmcgmalaysia.github.io';
$w.onReady(() => {
  const room = $w('#html1');
  room.onMessage(async event => {
    const message = event.data || {};
    if (message.type === 'PURCHASE_COST_RETRY_REQUEST' && ['NCT','GHR'].includes(message.company)) {
      try {
        const result = await retryPurchaseTaskCost(message.company, message.taskId, message.requestId);
        room.postMessage({ type: 'PURCHASE_COST_RETRY_RESULT', ...result });
      } catch (error) {
        room.postMessage({ type: 'PURCHASE_COST_RETRY_RESULT', ok: false, company: message.company, taskId: message.taskId,
          requestId: message.requestId, error: error?.message || 'Cost retry could not be confirmed.' });
      }
      return;
    }
    if (message.type === 'PURCHASE_LOGIN_REQUEST') {
      authentication.promptLogin({ mode: 'login', modal: true })
        .then(() => room.postMessage({ type: 'PURCHASE_LOGIN_RESULT', ok: true }))
        .catch(() => room.postMessage({ type: 'PURCHASE_LOGIN_RESULT', ok: false, error: 'Login was not completed.' }));
      return;
    }
    if (message.type !== 'PURCHASE_WORKSPACE_REQUEST' || !['NCT', 'GHR'].includes(message.company) ||
        typeof message.requestId !== 'string' || message.requestId.length > 100) return;
    try {
      if (!authentication.loggedIn()) {
        room.postMessage({ type: 'PURCHASE_WORKSPACE_RESULT', requestId: message.requestId, company: message.company,
          ok: false, canLogin: true, error: 'Please sign in to Master with your staff account.' });
        return;
      }
      const workspace = await getPurchaseWorkspace(message.company);
      room.postMessage({ type: 'PURCHASE_WORKSPACE_RESULT', requestId: message.requestId, company: message.company, ok: true, workspace });
    } catch (error) {
      let identity;
      try { const member = await currentMember.getMember({ fieldsets: ['FULL'] }); if (member?._id) identity = { memberId: member._id, email: member.loginEmail }; } catch {}
      room.postMessage({ type: 'PURCHASE_WORKSPACE_RESULT', requestId: message.requestId, company: message.company,
        ok: false, identity, error: error?.message || 'Purchase data could not be loaded.' });
    }
  });
  room.src = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/purchase-live/?v=20261010-cms-v1';
});
