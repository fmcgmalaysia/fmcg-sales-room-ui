import { mountAccountMenu } from './account-menu.js?v=20261128-catalogue-primary-action';
import { requestFrameLogout } from './frame-logout.js';

let profile;
const menu = mountAccountMenu(null, {
  getProfile: () => profile,
  panelHost: document.querySelector('.shell') || document.body,
  primaryAction: {
    label: 'View My Selection',
    run: () => {
      const filter = document.getElementById('selectionFilter');
      if (filter && !filter.classList.contains('active')) filter.click();
      filter?.focus({ preventScroll: true });
    }
  },
  signIn: () => window.parent.postMessage({ type: 'catalogueAccountSignIn' }, '*'),
  signOut: () => requestFrameLogout(() => window.parent.postMessage({ type: 'catalogueAccount' }, '*'))
});
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.type !== 'catalogueAccountMenu') return;
  const { signedIn, name, company } = event.data;
  profile = signedIn === true ? { name: name || 'Account', context: company || '' } : { guest: true };
  menu.open();
});
// The Catalogue masthead is a separate frame from the account dialog.
window.addEventListener('blur', () => menu.close());
window.parent.postMessage({ type: 'catalogueAccountMenuReady' }, '*');
