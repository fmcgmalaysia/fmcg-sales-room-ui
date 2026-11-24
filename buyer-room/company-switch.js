(() => {
  const container = document.querySelector('[data-buyer-company-switch]');
  if (!container) return;
  container.dataset.build = '20261124-buyer-company-v1';

  const style = document.createElement('style');
  style.textContent = `
    .buyer-company-switch { display:flex; justify-content:flex-end; padding:6px 18px; }
    .buyer-company-switch[hidden] { display:none; }
    .global-header .buyer-company-switch { padding:0; }
    .buyer-company-switch-icon { display:none; }
    .buyer-company-switch button, .buyer-company-dialog button {
      font:600 14px system-ui; color:#153453; background:#fff; border:1px solid #aabed1;
      border-radius:8px; padding:10px 14px; cursor:pointer;
    }
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
    @media(max-width:600px) {
      .global-header .buyer-company-switch button { width:34px; height:34px; padding:0; }
      .global-header .buyer-company-switch-icon { display:inline; font-size:19px; }
      .global-header .buyer-company-switch-label { display:none; }
    }
  `;
  document.head.append(style);
  container.className = 'buyer-company-switch';
  container.hidden = true;
  const change = document.createElement('button');
  change.type = 'button';
  change.setAttribute('aria-label', 'Switch Company');
  change.title = 'Switch Company';
  change.innerHTML = '<span class="buyer-company-switch-icon" aria-hidden="true">⇄</span><span class="buyer-company-switch-label">Switch Company</span>';
  container.append(change);

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
        parent.postMessage({ type: 'BUYER_COMPANY_SWITCH', customerId: company.customerId }, '*');
        Array.from(choices.children).forEach(choice => { choice.disabled = true; });
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
