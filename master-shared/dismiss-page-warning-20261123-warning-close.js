(() => {
  'use strict';
  const marker = '[data-page-warning]';
  const dismissed = new Map();
  const styles = document.createElement('style');
  styles.textContent = `
    [data-page-warning].page-warning-actionable { display: flow-root; position: relative; padding-inline-end: 48px; min-block-size: 28px; }
    [data-page-warning][hidden], [data-page-warning].page-warning-dismissed { display: none !important; }
    .page-warning-close { position: absolute; inset-inline-end: 4px; inset-block-start: 50%; transform: translateY(-50%);
      display: grid; place-items: center; width: 36px; height: 32px; padding: 0; border: 1px solid transparent;
      border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 1.2rem; }
    .page-warning-close::before { content: '×'; }
    .page-warning-close:is(:hover, :focus-visible) { border-color: currentColor; }
  `;
  document.head.append(styles);

  function refresh(area) {
    const current = new Map();
    for (const notice of area.querySelectorAll(marker)) {
      const key = notice.dataset.pageWarning;
      const message = notice.textContent.trim();
      if (!message || (notice.hasAttribute('data-page-warning-message') && notice.dataset.pageWarningMessage !== message)) {
        notice.querySelector('.page-warning-close')?.remove();
        notice.classList.remove('page-warning-dismissed', 'page-warning-actionable');
        continue;
      }
      current.set(key, message);
      if (dismissed.get(key) === message) {
        notice.classList.add('page-warning-dismissed');
        continue;
      }
      notice.classList.remove('page-warning-dismissed');
      if (notice.querySelector('.page-warning-close')) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'page-warning-close';
      button.setAttribute('aria-label', 'Dismiss warning');
      button.addEventListener('click', () => {
        dismissed.set(key, notice.textContent.trim());
        notice.classList.add('page-warning-dismissed');
      });
      notice.append(button);
      notice.classList.add('page-warning-actionable');
    }
    for (const [key, message] of dismissed) {
      if (current.get(key) !== message) dismissed.delete(key);
    }
  }

  // Notice markers explicitly opt in. Dialog validation and task indicators never register.
  const area = document.body;
  if (!area) return;
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === 'attributes' || record.target.matches?.(marker) ||
      [...record.addedNodes, ...record.removedNodes].some(node => node.matches?.(marker) || node.querySelector?.(marker)))) {
      refresh(area);
    }
  });
  observer.observe(area, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-page-warning', 'data-page-warning-message']});
  refresh(area);
})();
