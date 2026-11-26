import { mountAccountMenu } from './account-menu.js';
import { requestFrameLogout } from './frame-logout.js';

const header = document.querySelector('header[data-master-workroom-header], body > header');
if (header && window.parent !== window) {
  let profile = null;
  const post = type => window.parent.postMessage({ type }, '*');
  const menu = mountAccountMenu(header.querySelector('.account') || header, {
    getProfile: () => profile,
    signIn: () => post('HEADER_ACCOUNT_SIGN_IN'),
    signOut: () => requestFrameLogout(() => post('HEADER_ACCOUNT_LOGOUT'))
  });
  menu.trigger.disabled = true;
  menu.trigger.hidden = true;
  header.classList.add('has-account-menu');
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (data?.type === 'HEADER_ACCOUNT_STATUS') {
      profile = data.signedIn && data.name ? { name: data.name, context: 'LTPOS' } : { guest: true };
    } else if (data?.type === 'LTPOS_SESSION') {
      profile = data.state === 'ready' && data.name ? { name: data.name, context: 'LTPOS' } : { guest: true };
    } else return;
    menu.trigger.disabled = false;
    menu.trigger.hidden = false;
  });
  const ready = () => post('HEADER_ACCOUNT_READY');
  ready();
  window.setTimeout(() => { if (!profile) ready(); }, 1500);
}
