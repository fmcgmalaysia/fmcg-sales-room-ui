export function createAccountButton() {
  const trigger = document.createElement('button');
  trigger.className = 'account-menu-trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-label', 'Account menu');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.append(Object.assign(document.createElement('span'), { className: 'account-menu-avatar' }));
  trigger.firstElementChild.setAttribute('aria-hidden', 'true');
  return trigger;
}

export function mountAccountMenu(mount, { getProfile, signOut, signIn, onOpenChange, primaryAction, panelHost = document.body }) {
  const trigger = mount ? createAccountButton() : null;
  const panel = document.createElement('dialog');
  panel.className = 'account-menu-panel';
  panel.setAttribute('aria-label', 'Account');
  panel.innerHTML = `
    <strong class="account-menu-name"></strong>
    <button type="button" class="account-menu-profile" aria-expanded="false">My Profile</button>
    <div class="account-menu-profile-details" hidden></div>
    <button type="button" class="account-menu-logout">Log Out</button>
    <button type="button" class="account-menu-signin" hidden>Sign In</button>
    <p class="account-menu-message" role="status"></p>`;
  const name = panel.querySelector('.account-menu-name');
  const profile = panel.querySelector('.account-menu-profile');
  const details = panel.querySelector('.account-menu-profile-details');
  const logout = panel.querySelector('.account-menu-logout');
  const login = panel.querySelector('.account-menu-signin');
  const message = panel.querySelector('.account-menu-message');
  if (primaryAction) {
    profile.textContent = primaryAction.label;
    profile.removeAttribute('aria-expanded');
  }
  let pending = false;

  function positionPanel() {
    if (!panel.open) return;
    const viewportWidth = document.documentElement.clientWidth;
    const anchor = trigger?.getBoundingClientRect() || { bottom: 0, right: viewportWidth - 8 };
    panel.style.top = `${Math.max(8, anchor.bottom + 6)}px`;
    panel.style.left = `${Math.max(8, Math.min(anchor.right - panel.offsetWidth, viewportWidth - panel.offsetWidth - 8))}px`;
  }

  function open() {
    const identity = getProfile();
    if (!identity || panel.open || pending) return;
    const guest = identity.guest === true;
    name.textContent = guest ? 'Account' : identity.name;
    name.hidden = Boolean(primaryAction) && !guest;
    details.textContent = identity.context || identity.name || '';
    profile.hidden = guest;
    logout.hidden = guest;
    login.hidden = !guest;
    details.hidden = true;
    if (!primaryAction) profile.setAttribute('aria-expanded', 'false');
    message.textContent = '';
    panel.showModal();
    trigger?.setAttribute('aria-expanded', 'true');
    positionPanel();
    onOpenChange?.(true);
    (guest ? login : profile).focus();
  }
  trigger?.addEventListener('click', open);
  login.addEventListener('click', () => { if (signIn) signIn(); });
  profile.addEventListener('click', () => {
    if (primaryAction) {
      panel.close();
      primaryAction.run();
      return;
    }
    details.hidden = !details.hidden;
    profile.setAttribute('aria-expanded', String(!details.hidden));
  });
  logout.addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    logout.disabled = true;
    message.textContent = 'Signing out…';
    try {
      await signOut();
      if (trigger) trigger.hidden = true;
      name.textContent = '';
      details.textContent = '';
      panel.close();
    } catch {
      message.textContent = 'Could not sign out. Try again.';
    } finally {
      logout.disabled = false;
      pending = false;
    }
  });
  panel.addEventListener('cancel', event => {
    if (pending) event.preventDefault();
  });
  panel.addEventListener('click', event => {
    if (event.target !== panel || pending) return;
    const bounds = panel.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX >= bounds.right ||
        event.clientY < bounds.top || event.clientY >= bounds.bottom) panel.close();
  });
  panel.addEventListener('close', () => {
    trigger?.setAttribute('aria-expanded', 'false');
    name.textContent = '';
    details.textContent = '';
    message.textContent = '';
    onOpenChange?.(false);
    if (trigger && !trigger.hidden) trigger.focus();
  });
  window.addEventListener('resize', positionPanel);
  if (trigger) mount.append(trigger);
  panelHost.append(panel);
  return { open, trigger, close: () => { if (panel.open && !pending) panel.close(); } };
}
