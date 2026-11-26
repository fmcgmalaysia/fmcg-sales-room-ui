const exitKey = 'siteAccountExit-v1';

export function recordAccountExit(storage, now = Date.now, random = Math.random) {
  storage.setItem(exitKey, String(now()) + ':' + String(random()));
}

// Local storage only synchronizes the display. Wix still owns the actual session.
export function observeAccountExit(storage, active, onExit, schedule = setInterval, cancel = clearInterval) {
  let start;
  try { start = storage.getItem(exitKey); } catch { return () => {}; }
  const timer = schedule(() => {
    if (!active()) {
      cancel(timer);
      return;
    }
    let value;
    try { value = storage.getItem(exitKey); } catch { return; }
    if (!value || value === start) return;
    cancel(timer);
    onExit();
  }, 500);
  return () => cancel(timer);
}
