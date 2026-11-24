(() => {
  const container = document.querySelector('[data-buyer-company-switch]');
  if (!container) return;
  container.dataset.build = '20261125-buyer-company-v3';

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
    .buyer-company-dialog p { margin:0 0 14px; font:14px/1.45 system-ui; }
    .buyer-company-choices { display:grid; gap:8px; }
    .buyer-company-choices button { text-align:left; }
    .buyer-company-cancel { display:block; margin:14px 0 0 auto; }
    .buyer-company-cancel[hidden] { display:none; }
  `;
  document.head.append(style);
  container.className = 'buyer-company-switch';
  container.hidden = true;
  const change = document.createElement('button');
  change.type = 'button';
  change.setAttribute('aria-label', 'Switch Company');
  change.innerHTML = '<svg class="buyer-company-switch-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h15m-4-4 4 4-4 4m5 4H5m4-4-4 4 4 4"/></svg>';
  const tip = document.createElement('span');
  tip.className = 'buyer-company-switch-tip';
  tip.setAttribute('aria-hidden', 'true');
  tip.textContent = 'Switch company';
  container.append(change, tip);

  const dialog = document.createElement('dialog');
  dialog.className = 'buyer-company-dialog';
  dialog.setAttribute('aria-labelledby', 'buyerCompanyDialogTitle');
  dialog.innerHTML = '<h2 id="buyerCompanyDialogTitle">Choose a company</h2><p></p><div class="buyer-company-choices"></div><button type="button" class="buyer-company-cancel">Cancel</button>';
  (container.closest('.shell') || document.body).append(dialog);
  const prompt = dialog.querySelector('p');
  const choices = dialog.querySelector('.buyer-company-choices');
  const cancel = dialog.querySelector('.buyer-company-cancel');
  let access;
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (access?.blocked) event.preventDefault(); });

  function present() {
    prompt.textContent = access.denied
      ? access.companies.length ? 'Access to this company has ended. Choose an available company.'
        : 'Access to this company is unavailable. Contact your account manager.'
      : 'Select the company you want to buy for.';
    cancel.hidden = access.blocked;
    choices.replaceChildren(...access.companies.map(company => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = company.companyName;
      if (company.customerId === access.currentId) button.setAttribute('aria-current', 'true');
      button.onclick = () => {
        if (company.customerId === access.currentId) { dialog.close(); return; }
        const proceed = () => {
          if (!access.companies.some(option => option.customerId === company.customerId)) return;
          parent.postMessage({ type: 'BUYER_COMPANY_SWITCH', customerId: company.customerId }, '*');
          Array.from(choices.children).forEach(choice => { choice.disabled = true; });
        };
        if (access.blocked || document.dispatchEvent(new CustomEvent('buyer-company-switch-request', {
          cancelable: true, detail: { proceed, close: () => dialog.close() }
        }))) proceed();
      };
      return button;
    }));
    if (!dialog.open) dialog.showModal();
  }
  change.onclick = present;
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    if (event.data?.type !== 'BUYER_COMPANY_ACCESS' || !Array.isArray(event.data.companies)) return;
    access = event.data;
    container.hidden = access.companies.length < 2 || access.blocked;
    if (access.blocked || dialog.open) present();
  });
})();
