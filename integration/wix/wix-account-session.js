import { authentication } from 'wix-members-frontend';
import { local } from 'wix-storage-frontend';
import wixLocation from 'wix-location-frontend';
import wixWindow from 'wix-window-frontend';
import { observeAccountExit, recordAccountExit } from 'public/account-exit-signal.js';

export function connectAccountSession(frames, loginPath, onExit) {
  const currentRoute = () => wixLocation.path.join('/');
  const route = currentRoute();
  const login = () => wixLocation.to(typeof loginPath === 'function' ? loginPath() : loginPath);
  let busy = false;
  let leave = () => {};

  async function leaveWorkroom() {
    leave();
    if (onExit) {
      await onExit();
      return;
    }
    const shownFrames = typeof frames === 'function' ? frames() : frames;
    await Promise.allSettled(shownFrames.map(frame => frame.hide()));
    login();
  }

  if (wixWindow.rendering.env === 'browser' && authentication.loggedIn()) {
    leave = observeAccountExit(local, () => currentRoute() === route, () => {
      if (!busy) void leaveWorkroom();
    });
  }

  return {
    async signOut(beforeLogout) {
      if (busy) return;
      busy = true;
      try {
        if (typeof beforeLogout === 'function') beforeLogout();
        if (authentication.loggedIn()) {
          // The native logout can reload the page. Write the signal first so the
          // other tabs can hide their old data even if this page is unloaded.
          try { recordAccountExit(local); } catch { /* local storage is optional */ }
          await authentication.logout();
        }
        await leaveWorkroom();
      } finally {
        busy = false;
      }
    }
  };
}
