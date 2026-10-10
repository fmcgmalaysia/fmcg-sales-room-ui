import { getPurchaseWorkspace } from 'backend/purchaseWorkspace.web';
import { authentication, currentMember } from 'wix-members-frontend';
const UI_ORIGIN = 'https://fmcgmalaysia.github.io';
$w.onReady(() => {
  const room = $w('#html1');
  room.onMessage(async event => {
    if (event.origin && event.origin !== UI_ORIGIN) return;
    const message = event.data || {};
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
      try { const member = await currentMember.getMember(); if (member?._id) identity = { memberId: member._id, email: member.loginEmail }; } catch {}
      room.postMessage({ type: 'PURCHASE_WORKSPACE_RESULT', requestId: message.requestId, company: message.company,
        ok: false, identity, error: error?.message || 'Purchase data could not be loaded.' });
    }
  });
  room.src = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/purchase-live/?v=20261010-cms-v1';
});
