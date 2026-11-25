(() => {
  const source = document.querySelector('body > header select:is(#company, #companySelect)');
  if (!source || !window.HTMLDialogElement?.prototype.showModal) return;

  const compact = matchMedia('(max-width: 700px), (max-width: 880px) and (pointer: coarse)');
  const original = source.closest('label') || source;
  const widget = document.createElement('div');
  widget.className = 'workroom-company-switch';
  widget.dataset.build = '20261125-company-switch-icon-v1';
  widget.innerHTML = `<span class="workroom-company-name" aria-live="polite"></span>
    <button type="button" class="workroom-company-trigger" title="Switch company" aria-label="Switch company" aria-haspopup="dialog" aria-controls="workroomCompanyChoices" aria-expanded="false">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h15m-4-4 4 4-4 4m5 4H5m4-4-4 4 4 4"/></svg>
    </button>`;
  const name = widget.querySelector('span');
  const trigger = widget.querySelector('button');
  const menu = document.createElement('dialog');
  menu.className = 'workroom-company-menu';
  menu.id = 'workroomCompanyChoices';
  menu.setAttribute('aria-labelledby', 'workroomCompanyTitle');
  menu.innerHTML = `<div class="workroom-company-menu-heading">
    <h2 id="workroomCompanyTitle">Switch company</h2><button type="button" aria-label="Close company choices">Close</button>
  </div><div class="workroom-company-options"></div>`;
  const choices = menu.querySelector('.workroom-company-options');
  const close = menu.querySelector('button');
  original.before(widget);
  original.classList.add('workroom-company-source');
  document.body.append(menu);

  function destinations() {
    return Array.from(source.options).filter(option => option.value && option.value !== source.value &&
      !option.hidden && !option.disabled && !option.closest('optgroup:is([hidden], [disabled])'));
  }

  function sync() {
    const current = source.selectedOptions[0]?.textContent.trim() || '';
    if (name.textContent !== current) name.textContent = current;
    trigger.hidden = !destinations().length;
    trigger.disabled = source.matches(':disabled');
    widget.hidden = source.hidden || original.hidden;
    if (menu.open && (trigger.hidden || trigger.disabled || widget.hidden)) menu.close();
  }

  function positionMenu() {
    if (!menu.open || compact.matches) return;
    const anchor = trigger.getBoundingClientRect();
    const width = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(anchor.right - width, document.documentElement.clientWidth - width - 8))}px`;
    menu.style.top = `${anchor.bottom + 6}px`;
  }

  trigger.addEventListener('click', () => {
    sync();
    if (trigger.hidden || trigger.disabled || menu.open) return;
    choices.replaceChildren(...destinations().map(option => {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = option.textContent.trim();
      item.addEventListener('click', () => {
        if (source.matches(':disabled') || !destinations().includes(option)) return;
        menu.close();
        source.value = option.value;
        source.dispatchEvent(new Event('change', { bubbles: true }));
        // The workroom's existing handler may restore the prior value if edits are pending.
        sync();
      });
      return item;
    }));
    menu.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    positionMenu();
    choices.firstElementChild?.focus();
  });

  close.addEventListener('click', () => menu.close());
  menu.addEventListener('click', event => {
    if (event.target !== menu) return;
    const bounds = menu.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom) menu.close();
  });
  menu.addEventListener('close', () => trigger.setAttribute('aria-expanded', 'false'));
  compact.addEventListener('change', () => { if (menu.open) menu.close(); });
  window.addEventListener('resize', positionMenu);
  source.addEventListener('change', () => queueMicrotask(sync));
  window.addEventListener('pageshow', sync);
  new MutationObserver(sync).observe(original, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'selected'] });
  sync();
})();
