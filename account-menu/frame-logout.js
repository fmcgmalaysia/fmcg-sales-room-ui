export function requestFrameLogout(send) {
  if (window.parent === window) return Promise.reject(new Error('Open the workroom to sign out.'));
  // Wix owns the session and replaces the current frame on successful logout.
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('pagehide', finished);
      reject(new Error('The sign-out redirect has not arrived.'));
    }, 10000);
    function finished() {
      window.clearTimeout(timeout);
      resolve();
    }
    window.addEventListener('pagehide', finished, { once: true });
    send();
  });
}
