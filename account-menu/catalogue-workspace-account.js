import { mountAccountMenu } from './account-menu.js';
import { requestFrameLogout } from './frame-logout.js';

let profile;
const menu = mountAccountMenu(null, {
  getProfile: () => profile,
  panelHost: document.querySelector('.shell') || document.body,
  signIn: () => window.parent.postMessage({ type: 'catalogueAccountSignIn' }, '*'),
  signOut: () => requestFrameLogout(() => window.parent.postMessage({ type: 'catalogueAccount' }, '*'))
});
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.type !== 'catalogueAccountMenu') return;
  const { signedIn, name, company } = event.data;
  profile = signedIn === true ? { name: name || 'Account', context: company || '' } : { guest: true };
  menu.open();
});
window.parent.postMessage({ type: 'catalogueAccountMenuReady' }, '*');
