(() => {
  const container = document.querySelector('[data-buyer-company-switch]');
  if (!container) return;
  container.dataset.build = '20261125-buyer-company-icon-v3';

  const style = document.createElement('style');
  style.textContent = `
    .buyer-company-switch { position:relative; display:flex; justify-content:flex-end; padding:6px 18px; }
    .buyer-company-switch[hidden] { display:none; }
    .global-header .buyer-company-switch { padding:0; }
    .buyer-company-switch button, .buyer-company-dialog button {
      font:600 14px system-ui; color:#153453; background:#fff; border:1px solid #aabed1;
      border-radius:8px; padding:10px 14px; cursor:pointer;
    }
    .buyer-company-switch button {
      display:grid; place-items:center; width:38px; height:38px; padding:0;
    }
    .buyer-company-switch button:hover, .buyer-company-switch button:focus-visible {
      background:#edf4fb; border-color:#52799f;
    }
    .buyer-company-switch-icon { display:block; width:20px; height:20px; }
    .buyer-company-switch-tip {
      position:absolute; inset-inline-end:0; inset-block-start:100%; z-index:5; pointer-events:none;
      background:#153453; color:#fff; white-space:nowrap; padding:6px 9px; border-radius:5px;
      font:600 12px/1.4 system-ui; visibility:hidden;
    }
    .buyer-company-switch button:hover + .buyer-company-switch-tip,
    .buyer-company-switch button:focus-visible + .buyer-company-switch-tip { visibility:visible; }
    .buyer-company-dialog { color:#153453; background:#fff; border:0; border-radius:14px;
      width:min(420px, calc(100% - 28px)); max-height:calc(100% - 28px); padding:22px;
      margin:auto; box-shadow:0 20px 70px #142b4940; box-sizing:border-box; }
    .buyer-company-dialog::backdrop { background:#0d2239b8; }
    .buyer-company-dialog h2 { margin:0 0 8px; font:700 22px system-ui; }
    #buyerCompanyDialogTitle:focus { outline:0; }
    .buyer-company-dialog p { margin:0 0 14px; font:14px/1.45 system-ui; }
    .buyer-company-choices { display:grid; gap:8px; }
    .buyer-company-choices button {
      display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:48px;
      text-align:left; overflow-wrap:anywhere;
    }
    .buyer-company-choices button::after { content:""; flex:0 0 7px; height:7px;
      border:solid currentColor; border-width:1.5px 1.5px 0 0; transform:rotate(45deg); margin-inline-end:3px; }
    .buyer-company-choices button:is(:hover,:focus-visible) { background:#edf4fb; border-color:#52799f; }
    .buyer-company-choices button:disabled { opacity:.65; cursor:wait; }
    .buyer-company-status { margin-top:14px !important; color:#24557e; }
    .buyer-company-status[data-error] { color:#a12323; }
    .buyer-company-cancel { display:block; margin:14px 0 0 auto; }
    .buyer-company-cancel[hidden] { display:none; }
    @media (min-width:701px) {
      .buyer-company-dialog[data-anchored] {
        position:fixed; inset:var(--company-top) auto auto var(--company-left);
        margin:0; width:min(350px,calc(100% - 16px)); padding:14px;
        max-height:calc(100% - var(--company-top) - 8px);
      }
      .buyer-company-dialog[data-anchored]::backdrop { background:transparent; }
      .buyer-company-dialog[data-anchored] h2 { font-size:17px; }
    }
    @media (max-width:700px), (max-width:880px) and (pointer:coarse) {
      .buyer-company-switch button {
        width:44px; height:44px;
      }
      .buyer-company-switch-tip { display:none; }
      .toolbar>.buyer-company-switch { padding-inline-end:12px; }
      .buyer-company-dialog {
        position:fixed; inset:auto 0 0; margin:0; width:100%; max-width:none;
        max-height:calc(100% - 20px); max-height:min(82dvh,calc(100% - 20px));
        padding:16px 16px max(20px,env(safe-area-inset-bottom)); border-radius:18px 18px 0 0;
        overflow-y:auto; overscroll-behavior:contain;
      }
      .buyer-company-dialog::before {
        content:""; display:block; width:32px; height:4px; margin:0 auto 15px; border-radius:5px;
        background:#cbd6e1;
      }
      .buyer-company-dialog h2 { font-size:20px; }
      .buyer-company-dialog:has(.buyer-company-cancel:not([hidden])) h2 { padding-inline-end:82px; }
      .buyer-company-choices button { min-height:52px; font-size:16px; }
      .buyer-company-cancel {
        position:absolute; inset-block-start:24px; inset-inline-end:16px;
        min-height:44px; margin:0; padding:0 10px;
      }
    }
  `;
  document.head.append(style);
  container.className = 'buyer-company-switch';
  container.hidden = true;
  const change = document.createElement('button');
  change.type = 'button';
  change.setAttribute('aria-label', 'Switch Company');
  change.setAttribute('aria-haspopup', 'dialog');
  change.setAttribute('aria-controls', 'buyerCompanyDialog');
  change.setAttribute('aria-expanded', 'false');
  change.innerHTML = '<svg class="buyer-company-switch-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h15m-4-4 4 4-4 4m5 4H5m4-4-4 4 4 4"/></svg>';
  const tip = document.createElement('span');
  tip.className = 'buyer-company-switch-tip';
  tip.setAttribute('aria-hidden', 'true');
  tip.textContent = 'Switch company';
  container.append(change, tip);

  const dialog = document.createElement('dialog');
  dialog.className = 'buyer-company-dialog';
  dialog.id = 'buyerCompanyDialog';
  dialog.setAttribute('aria-labelledby', 'buyerCompanyDialogTitle');
  dialog.setAttribute('aria-describedby', 'buyerCompanyDialogPrompt');
  dialog.innerHTML = '<h2 id="buyerCompanyDialogTitle" tabindex="-1">Choose a company</h2><p id="buyerCompanyDialogPrompt"></p><div class="buyer-company-choices"></div><p class="buyer-company-status" role="status" hidden></p><button type="button" class="buyer-company-cancel">Cancel</button>';
  (container.closest('.shell') || document.body).append(dialog);
  const title = dialog.querySelector('h2');
  const prompt = dialog.querySelector('p');
  const choices = dialog.querySelector('.buyer-company-choices');
  const cancel = dialog.querySelector('.buyer-company-cancel');
  const status = dialog.querySelector('.buyer-company-status');
  const path = container.closest('.global-header') ? '/buyer-room' : '/catalogue';
  const compact = matchMedia('(max-width:700px), (max-width:880px) and (pointer:coarse)');
  let access;
  let siteOrigin = '';
  let openingId = '';
  let recoveryTimer;

  const destinations = () => access.companies.filter(company => access.blocked || company.customerId !== access.currentId);

  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => {
    if (access?.blocked || openingId) event.preventDefault();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog || !dialog.hasAttribute('data-anchored') || openingId) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => change.setAttribute('aria-expanded', 'false'));

  function positionDialog() {
    const anchored = !compact.matches && !access?.blocked && !container.hidden;
    dialog.toggleAttribute('data-anchored', anchored);
    if (!anchored) return;
    const anchor = change.getBoundingClientRect();
    const width = Math.min(350, document.documentElement.clientWidth - 16);
    dialog.style.setProperty('--company-left', `${Math.max(8, Math.min(anchor.right - width, document.documentElement.clientWidth - width - 8))}px`);
    dialog.style.setProperty('--company-top', `${anchor.bottom + 6}px`);
  }
  window.addEventListener('resize', () => { if (dialog.open) positionDialog(); });

  function showStatus(message, failed = false) {
    status.textContent = message;
    status.hidden = !message;
    status.toggleAttribute('data-error', failed);
  }

  function clearTransition() {
    clearTimeout(recoveryTimer);
    openingId = '';
    cancel.disabled = false;
    for (const choice of choices.children) choice.disabled = false;
  }

  function retryCompany(company, message, failed = false) {
    clearTransition();
    if (!dialog.open) present();
    showStatus(message, failed);
    choices.querySelector('[data-company-id="' + CSS.escape(company.customerId) + '"]')?.focus();
  }

  function openCompany(company) {
    if (openingId || !destinations().some(option => option.customerId === company.customerId)) return;
    if (!dialog.open) present();
    if (siteOrigin && navigator.userActivation?.isActive === false) {
      retryCompany(company, 'Select ' + company.companyName + ' to continue.');
      return;
    }

    openingId = company.customerId;
    cancel.disabled = true;
    for (const choice of choices.children) choice.disabled = true;
    showStatus('Opening ' + company.companyName + '…');
    recoveryTimer = setTimeout(() => {
      retryCompany(company, 'The company did not open. Select it again to retry.', true);
    }, 12000);

    try {
      if (siteOrigin) {
        const destination = new URL(path, siteOrigin);
        destination.searchParams.set('company', company.customerId);
        // Use the member's click to request a fresh document from the same site.
        window.top.location.href = destination.href;
      } else {
        parent.postMessage({ type: 'BUYER_COMPANY_SWITCH', customerId: company.customerId }, '*');
      }
    } catch (_) {
      retryCompany(company, 'The company did not open. Select it again to retry.', true);
    }
  }

  function present() {
    if (openingId) return;
    const companies = destinations();
    if (!access.blocked && !companies.length) { if (dialog.open) dialog.close(); return; }
    showStatus('');
    title.textContent = access.blocked ? 'Choose a company' : 'Switch company';
    prompt.textContent = access.denied
      ? companies.length ? 'Access to this company has ended. Choose an available company.'
        : 'Access to this company is unavailable. Contact your account manager.'
      : access.blocked ? 'Select the company you want to buy for.'
        : 'Select a company to open its ' + (path === '/buyer-room' ? 'Buyer Room.' : 'Catalogue.');
    cancel.hidden = access.blocked;
    choices.replaceChildren(...companies.map(company => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = company.companyName;
      button.dataset.companyId = company.customerId;
      button.onclick = () => {
        const proceed = () => openCompany(company);
        if (access.blocked || document.dispatchEvent(new CustomEvent('buyer-company-switch-request', {
          cancelable: true, detail: { proceed, close: () => dialog.close() }
        }))) proceed();
      };
      return button;
    }));
    positionDialog();
    if (!dialog.open) {
      dialog.showModal();
      change.setAttribute('aria-expanded', 'true');
      title.focus();
    }
  }
  change.onclick = present;
  window.addEventListener('pageshow', event => {
    if (!event.persisted || !openingId) return;
    clearTransition();
    showStatus('');
  });
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    if (event.data?.type !== 'BUYER_COMPANY_ACCESS' || !Array.isArray(event.data.companies)) return;
    access = event.data;
    siteOrigin = ['https://www.fmcgmalaysia.com', 'https://fmcgmalaysia.com'].includes(event.origin) ? event.origin : '';
    container.hidden = access.blocked || !destinations().length;
    if (openingId && !destinations().some(option => option.customerId === openingId)) clearTransition();
    if (access.blocked || dialog.open) present();
  });
})();
