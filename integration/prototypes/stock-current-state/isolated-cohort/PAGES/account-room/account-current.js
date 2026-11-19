/* Candidate only. One original Account pending command, not a business-record
   mirror or payment queue. Server original Account auth remains the authority. */
(() => {
  const actions = new Set(['CLOSE_ACCOUNT','REOPEN_ACCOUNT','DOCUMENT_ISSUE_REPORT','DOCUMENT_ISSUE_REVIEW','AMOUNTS','CN_NOT_APPLICABLE','CHECK','PLAN','RECOGNIZE_CREDIT','SHORTAGE_CLAIM','PAYMENT_REVIEW','REVIEW_LEGACY','TAKE_OWNERSHIP','RETURN_PROCUREMENT','PAYMENT_PROCESSING','PAYMENT_UNKNOWN','PAYMENT_RESOLVED','APPLY_CREDIT','INVOICE_CHECK','DOCUMENT_UPLOAD','PAYMENT_FILE_DELETE']);
  const pdf = value => typeof value === 'string' && value.length <= 4194304 && /^JVBERi[0-3][A-Za-z0-9+/]*={0,2}$/.test(value);
  const fileInput = input => input.action === 'DOCUMENT_UPLOAD' ? ['DO','PAYMENT'].includes(input.type) && pdf(input.base64)
    && (input.attachments === undefined || input.type === 'PAYMENT' && Array.isArray(input.attachments) && input.attachments.length <= 5 && input.attachments.every(file => pdf(file?.base64)))
    : input.action !== 'PAYMENT_FILE_DELETE' || ['paymentId','fileId'].every(field => typeof input[field] === 'string' && input[field] && input[field].length <= 200);
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b), copy = value => JSON.parse(JSON.stringify(value));
  let context = null, knownLegacy = false, state = null, auth = null, blocked = '', panel = null;
  const company = () => document.querySelector('#company')?.value;
  const identity = value => value && Object.keys(value).length === 2 && ['staffId','memberId'].every(key => typeof value[key] === 'string' && value[key] && value[key].length <= 200);
  const key = (selected,staff) => 'fmcg-account-current-v1/'+selected+'/'+encodeURIComponent(staff.staffId)+'/'+encodeURIComponent(staff.memberId);
  function valid(request) {
    return request && ['ACCOUNT_SETTLEMENT_REQUEST','ACCOUNT_CHECK_REQUEST'].includes(request.type) && ['NCT','GHR'].includes(request.company)
      && /^[a-f0-9-]{36}$/i.test(request.requestId || '') && request.input && !Array.isArray(request.input) && typeof request.input === 'object'
      && actions.has(request.input.action) && fileInput(request.input) && (request.type === 'ACCOUNT_CHECK_REQUEST' ? request.input.action === 'INVOICE_CHECK' : request.input.action !== 'INVOICE_CHECK')
      && ['id','version'].every(field => typeof request.input[field] === 'string' && request.input[field] && request.input[field].length <= 200)
      && request.stockProtocol === 1 && typeof request.stockBuild === 'string' && request.stockBuild && Number.isSafeInteger(request.stockGeneration) && request.stockGeneration >= 0
      && identity(request.stockIdentity) && Object.keys(request).every(field => ['type','company','requestId','input','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(field))
      && JSON.stringify(request).length <= (request.input.action === 'DOCUMENT_UPLOAD' ? 4400000 : 200000);
  }
  function lock() { if (state || blocked) { const select = document.querySelector('#company'); if (select) select.disabled = true; } }
  function mount() {
    if (panel) { panel.remove(); panel = null; }
    if (!state?.recovered && !blocked) return;
    const host = document.querySelector('#app'); if (!host) return;
    panel = document.createElement('section'); panel.className = 'notice';
    panel.innerHTML = '<h3>Resume original save</h3><p data-current-summary></p><p role="status"></p><button class="primary" data-current-retry>Retry same save</button>';
    panel.querySelector('[data-current-summary]').textContent = state ? state.request.input.action+' · '+state.request.requestId : 'Original cache requires review';
    panel.querySelector('[role="status"]').textContent = blocked || state?.text || 'Original request retained. No save has been retried.';
    const button = panel.querySelector('[data-current-retry]'); button.disabled = Boolean(blocked || state?.inFlight || state?.verifyId);
    button.onclick = () => { if (state && !blocked) send(state.request); }; host.appendChild(panel); lock();
  }
  function status(busy,text) {
    if (!state) return; state.text = text; state.callbacks?.status?.(busy,text); lock(); mount();
  }
  function unknown(text = 'Save not confirmed. Original request retained; retry only this save.') {
    if (!state) return; state.inFlight = false; state.verifyId = null; status(false,text);
  }
  function retained(request, cacheKey, create) {
    const raw = sessionStorage.getItem(cacheKey), cached = raw === null ? null : JSON.parse(raw);
    if (cached !== null) { if (cached.schema !== 1 || !same(cached.request,request)) throw Error('Original pending request changed'); return; }
    if (!create) throw Error('Original pending request missing');
    const record = { schema:1,request:copy(request) }; sessionStorage.setItem(cacheKey,JSON.stringify(record));
    if (!same(JSON.parse(sessionStorage.getItem(cacheKey) || 'null'),record)) throw Error('Original request not retained');
  }
  function observe(result) {
    if (!result || result.company !== company() || !result.staff?.staffId) return;
    if (!result.stockCurrent) { knownLegacy = true; return; }
    const meta = result.stockCurrent;
    if (meta.stockProtocol !== 1 || !identity(meta.stockIdentity) || meta.stockIdentity.staffId !== result.staff.staffId
      || !Number.isSafeInteger(meta.stockGeneration) || meta.stockGeneration < 0 || typeof meta.stockBuild !== 'string' || !meta.stockBuild) return;
    context = { company:result.company,staff:copy(meta.stockIdentity),meta:copy(meta) }; knownLegacy = false;
  }
  function decorate(request) {
    if (state || blocked) throw Error('Resolve the original pending save first.');
    if (!context?.meta) { if (knownLegacy) return request; throw Error('Refresh the original Account records before saving.'); }
    if (request.company !== context.company || request.company !== company()) throw Error('Original Account company changed.');
    const result = copy({ ...request,stockProtocol:1,stockBuild:context.meta.stockBuild,stockGeneration:context.meta.stockGeneration,stockIdentity:context.staff });
    if (!valid(result)) throw Error('Original current action unavailable. Refresh and review the original request.');
    const raw = sessionStorage.getItem(key(result.company,result.stockIdentity)); if (raw !== null) throw Error('Original saved request requires review before another save.');
    return result;
  }
  function send(request, callbacks) {
    if (!valid(request) || request.company !== company() || blocked) throw Error('Original current Account request required.');
    if (state && !same(state.request,request)) throw Error('Another original save is pending.');
    if (!context || context.company !== request.company || !same(context.staff,request.stockIdentity)) throw Error('Original Account identity changed.');
    if (!state) state = { request:copy(request),cacheKey:key(request.company,request.stockIdentity),serial:0,continuations:0,recovered:false };
    if (callbacks) state.callbacks = callbacks;
    if (state.inFlight || state.verifyId) return;
    try { retained(request,state.cacheKey,true); } catch (_) { unknown('Save not sent. Check browser storage and retry this original request.'); return; }
    const current = state, serial = ++current.serial; current.inFlight = true; status(true,'Saving original request…');
    try { window.parent.postMessage({ ...copy(current.request),stockSegment:serial },'*'); } catch (_) { unknown(); return; }
    setTimeout(() => { if (state === current && current.serial === serial && current.inFlight) unknown(); },30000);
  }
  function verify(result) {
    const current = state, request = current.request; current.inFlight = false; current.result = copy(result);
    current.verifyId = crypto.randomUUID(); const id = current.verifyId;
    status(true,'Save recorded. Verifying original Account state…');
    window.parent.postMessage({ type:'ACCOUNT_QUERY_REQUEST',company:request.company,requestId:id,input:{view:'SUPPLIER_ACTIVE',limit:1} },'*');
    setTimeout(() => { if (state === current && current.verifyId === id) unknown('Save recorded; fresh state unconfirmed. Retain and retry the same request.'); },30000);
  }
  function verifiedRead(message) {
    const current = state, request = current.request, result = message.result, meta = result?.stockCurrent;
    if (!message.ok || result?.company !== request.company || result.view !== 'SUPPLIER_ACTIVE' || !Array.isArray(result.items)
      || result.staff?.staffId !== request.stockIdentity.staffId || meta?.stockProtocol !== 1 || meta.stockBuild !== request.stockBuild
      || !same(meta.stockIdentity,request.stockIdentity) || !Number.isSafeInteger(meta.stockGeneration) || meta.stockGeneration < current.result.stockGeneration) { unknown('Save recorded; original identity/state unconfirmed. Request retained.'); return; }
    try {
      retained(request,current.cacheKey,false); sessionStorage.removeItem(current.cacheKey);
      if (sessionStorage.getItem(current.cacheKey) !== null) throw Error('Cleanup unconfirmed');
    } catch (_) { unknown('Save recorded; cache cleanup unconfirmed. Retain and retry the same request.'); return; }
    const done = current.callbacks?.done, receipt = current.result; state = null; observe(result); mount();
    const select = document.querySelector('#company'); if (select) select.disabled = false;
    if (done) done(receipt); else document.querySelector('#accountRefresh')?.click();
  }
  function readContext(selected = company()) {
    if (!['NCT','GHR'].includes(selected) || state || blocked) return;
    const current = auth = { company:selected,requestId:crypto.randomUUID() };
    window.parent.postMessage({ type:'ACCOUNT_CURRENT_CONTEXT_REQUEST',...current },'*');
    setTimeout(() => { if (auth === current) auth = null; },30000);
  }
  window.addEventListener('message',event => {
    if (event.source !== window.parent) return; const message = event.data || {};
    if (message.type === 'ACCOUNT_CURRENT_CONTEXT_RESULT' && auth && message.company === auth.company && message.requestId === auth.requestId) {
      const expected = auth; auth = null; const result = message.result, staff = result?.staff;
      if (!message.ok || company() !== expected.company || result?.ok !== true || result.schema !== 'ACCOUNT_ORIGINAL_CONTEXT_V1' || result.company !== expected.company
        || !staff?.staffName || !identity({ staffId:staff.staffId,memberId:staff.memberId })) return;
      if (context?.meta && !same(context.staff,{staffId:staff.staffId,memberId:staff.memberId})) return;
      context = { ...(context || {}),company:expected.company,staff:{staffId:staff.staffId,memberId:staff.memberId} };
      try { const raw = sessionStorage.getItem(key(expected.company,context.staff)); if (raw === null) return; const cached = JSON.parse(raw);
        if (cached.schema !== 1 || !valid(cached.request) || cached.request.company !== expected.company || !same(cached.request.stockIdentity,context.staff)) throw Error('Original cache invalid');
        if (state) return; state = { request:copy(cached.request),cacheKey:key(expected.company,context.staff),serial:0,continuations:0,recovered:true }; mount();
      } catch (_) { blocked = 'Original cache requires review. No new save was started.'; mount(); } return;
    }
    if (!state || message.company !== state.request.company) return;
    if (message.type === 'ACCOUNT_QUERY_RESULT' && state.verifyId && message.requestId === state.verifyId) { verifiedRead(message); return; }
    const expected = state.request.type === 'ACCOUNT_CHECK_REQUEST' ? 'ACCOUNT_CHECK_RESULT' : 'ACCOUNT_SETTLEMENT_RESULT';
    if (message.type !== expected || message.requestId !== state.request.requestId || message.stockSegment !== state.serial) return;
    const result = message.result, current = state;
    if (message.ok && result?.ok === true && result.pending !== true && result.company === current.request.company && result.poId === current.request.input.id
      && result.requestId === current.request.requestId && Number.isSafeInteger(result.stockGeneration) && result.stockGeneration > current.request.stockGeneration) { if (!current.verifyId) verify(result); return; }
    if (!current.inFlight || current.verifyId) return;
    if (message.ok && result?.ok === false && result.pending === true && result.requestId === current.request.requestId && ['BEFORE','APPLY','VERIFY'].includes(result.phase)
      && Number.isSafeInteger(result.completedCount) && Number.isSafeInteger(result.totalRecords) && result.totalRecords > 0 && result.completedCount >= 0 && result.completedCount <= result.totalRecords) {
      current.inFlight = false; if (++current.continuations > 64) { unknown('Automatic progress paused. Retry only this original request.'); return; }
      status(true,'Saving… '+result.completedCount+' / '+result.totalRecords); const serial = current.serial;
      setTimeout(() => { if (state === current && current.serial === serial && !current.inFlight && !current.verifyId) send(current.request); },250); return;
    }
    unknown(message.error || result?.error || 'Save not confirmed. Original request retained.');
  });
  document.querySelector('#company')?.addEventListener('change',event => {
    if (state || blocked) { event.target.value = state?.request.company || context?.company; event.stopImmediatePropagation?.(); return; }
    context = null; knownLegacy = false; auth = null; readContext(event.target.value);
  });
  window.addEventListener('beforeunload',event => { if (state || blocked) { event.preventDefault(); event.returnValue = ''; } });
  window.accountCurrent = { observe,decorate,send,mount,readContext,busy:() => Boolean(state || blocked),valid };
  readContext();
})();
