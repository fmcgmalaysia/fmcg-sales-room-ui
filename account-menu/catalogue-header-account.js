import { createAccountButton } from './account-menu.js';

const navActions = document.querySelector('.nav-actions');
if (navActions) {
  const trigger = createAccountButton();
  navActions.append(trigger);
  trigger.addEventListener('click', () =>
    window.parent.postMessage({ type: 'catalogueOpenAccountMenu' }, '*'));
}
