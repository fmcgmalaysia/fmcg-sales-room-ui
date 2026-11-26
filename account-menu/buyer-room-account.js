import { mountAccountMenu } from './account-menu.js';
import { requestFrameLogout } from './frame-logout.js';

const header = document.querySelector('.global-header .account-chip');
if (header) {
  let profile = null;
  const menu = mountAccountMenu(header, {
    getProfile: () => profile,
    onOpenChange: open => window.parent.postMessage({ type: 'BUYER_ROOM_ACCOUNT_MENU_STATE', open }, '*'),
    signOut: () => requestFrameLogout(() => window.parent.postMessage({ type: 'BUYER_ROOM_LOGOUT' }, '*'))
  });
  menu.trigger.hidden = true;
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window.parent || message?.type !== 'BUYER_ROOM_DATA') return;
    const company = String(message.data?.companyName || '').trim();
    const name = String(message.data?.memberName || '').trim();
    profile = message.data?.headerAccountMenuEnabled === true && message.data?.customerId && company
      ? { name: name || 'Buyer account', context: company } : null;
    menu.trigger.hidden = !profile;
  });
}
