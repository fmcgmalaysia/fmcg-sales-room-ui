/* Candidate-only original-request recovery and durable internal GP staging.
   No fake workspace, inventory reads, cache scans, legacy receipts or unlock. */
(() => {
  const operations = new Set(['EDIT','PLAN','PO','ADD_SOURCE','AVERAGE_COST','QTY','REORDER','ALLOCATE','SHORTAGE','QUANTITY_CASE','MARGIN_REFRESH','BORROW_APPROVE','BORROW_RETURN']);
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  function validRequest(request, company) {
    return request && request.type === 'PURCHASE_SAVE_REQUEST' && request.company === company
      && /^[a-f0-9-]{36}$/i.test(request.requestId || '') && operations.has(request.operation)
      && request.input && typeof request.input === 'object' && !Array.isArray(request.input)
      && request.stockProtocol === 1 && typeof request.stockBuild === 'string' && request.stockBuild.length > 0
      && Number.isSafeInteger(request.stockGeneration) && request.stockGeneration >= 0
      && Object.keys(request).every(key => ['type','company','requestId','operation','input','stockProtocol','stockBuild','stockGeneration'].includes(key))
      && JSON.stringify(request).length <= (request.operation.startsWith('BORROW_') ? 6000 : 200000);
  }
  function mount({ company, host, read, send, receipt, lockCompany, esc, autoRequest = null, expectedStaff = null }) {
    let disposed = false, request = null, staff = null, retry = null, state = null, serial = 0, inFlight = false, completed = false;
    const alive = () => !disposed && host?.isConnected !== false;
    function text(message) { if (alive() && state) state.textContent = message; }
    function unknown() {
      if (!alive() || completed) return;
      inFlight = false; if (retry) retry.disabled = false;
      text('Result unconfirmed. Original request retained. Retry only this save. 结果尚未确认，原请求保留，只重试此保存。');
    }
    function submit() {
      if (!alive() || !request || completed || inFlight) return;
      // Only the exact cache key returned by original server Purchase auth. A
      // second tab/edit/member change must not substitute a new command here.
      try {
        const cached = JSON.parse(sessionStorage.getItem('fmcg-purchase-draft-v1/'+company+'/'+staff.staffId+'/'+staff.memberId) || 'null');
        if (!same(cached?.savePending, request)) {
          text('Original cache changed. Refresh and review. 原请求缓存已变更，请刷新核对。');
          retry.disabled = true; return;
        }
      } catch (_) { unknown(); return; }
      const attempt = ++serial; inFlight = true; retry.disabled = true;
      text('Resuming original save 正在继续原保存…');
      try { send(JSON.parse(JSON.stringify(request))); } catch (_) { unknown(); return; }
      setTimeout(() => { if (attempt === serial && inFlight) unknown(); }, 30000);
    }
    function reply(event) {
      if (!alive() || completed || !request || event.source !== window.parent) return;
      const message = event.data || {}, result = message.result;
      if (message.type !== 'PURCHASE_SAVE_RESULT' || message.company !== company || message.requestId !== request.requestId) return;
      if (message.ok && result?.ok === true && result.requestId === request.requestId
        && Number.isSafeInteger(result.stockGeneration) && result.stockGeneration > request.stockGeneration) {
        completed = true; inFlight = false; retry.disabled = true;
        text('Save confirmed. Reloading original workspace. 保存已确认，正在重新读取原工作台。');
        // Do not clear/rewrite session cache here. Original app completion will
        // reconcile its price/sort/allocation drafts AFTER an authorized workspace.
        receipt({ request: JSON.parse(JSON.stringify(request)), result, staff }); return;
      }
      if (!inFlight) return;
      if (message.ok && result?.ok === false && result.pending === true && result.requestId === request.requestId
        && ['BEFORE','APPLY','VERIFY'].includes(result.phase) && Number.isSafeInteger(result.completedCount)
        && Number.isSafeInteger(result.totalRecords) && result.totalRecords > 0 && result.completedCount >= 0
        && result.completedCount <= result.totalRecords) {
        inFlight = false; const attempt = serial;
        text('Saving 保存中… '+result.completedCount+' / '+result.totalRecords);
        setTimeout(() => { if (attempt === serial && !inFlight) submit(); }, 250); return;
      }
      unknown();
    }
    window.addEventListener('message', reply);
    Promise.resolve().then(() => alive()?read('PURCHASE_RESUME_CONTEXT_REQUEST'):null).then(context => {
      if (!alive() || context?.ok !== true || context.schema !== 'PURCHASE_RESUME_CONTEXT_V1' || context.company !== company
        || ['staffId','staffName','memberId'].some(key => typeof context.staff?.[key] !== 'string' || !context.staff[key])) return;
      staff = context.staff;
      const cached = JSON.parse(sessionStorage.getItem('fmcg-purchase-draft-v1/'+company+'/'+staff.staffId+'/'+staff.memberId) || 'null');
      if (!validRequest(cached?.savePending, company)) return;
      request = JSON.parse(JSON.stringify(cached.savePending));
      const section = document.createElement('section'); section.className = 'notice';
      section.innerHTML = '<h3>Resume original save 继续原保存</h3><p>'+esc(staff.staffName)+' · '+esc(request.operation)
        +'</p><p>Ref 操作编号: '+esc(request.requestId)+'</p><p role="status"></p><button class="btn primary" type="button">Retry same save 重试原保存</button>';
      state = section.querySelector('[role="status"]'); retry = section.querySelector('button');
      retry.addEventListener('click', submit); host.appendChild(section); lockCompany();
      text('Workspace unavailable. Original request retained; no save has been retried. 工作台尚未载入，原请求已保留，尚未重试保存。');
      if(autoRequest&&same(request,autoRequest)&&staff.staffId===expectedStaff?.staffId&&staff.memberId===expectedStaff?.memberId)submit();
    }).catch(() => { /* Keep original load/login error; never inspect another key. */ });
    return () => { disposed = true; serial++; window.removeEventListener('message', reply); };
  }
  function stageMargin({packet,priorReceipt=null,...args}){
    try{
      const meta=packet?.stockCurrent,staff=packet?.staff;
      if(packet?.schema!=='PURCHASE_MARGIN_REFRESH_REQUIRED_V1'||packet.company!==args.company
        ||typeof packet.taskId!=='string'||!packet.taskId||packet.taskId.length>128
        ||['staffId','memberId','staffName'].some(key=>typeof staff?.[key]!=='string'||!staff[key])
        ||meta?.stockProtocol!==1||typeof meta.stockBuild!=='string'||!meta.stockBuild||!Number.isSafeInteger(meta.stockGeneration)
        ||meta.stockGeneration<0||meta.generation!==meta.stockGeneration)throw Error('Current refresh suggestion unconfirmed');
      const key='fmcg-purchase-draft-v1/'+args.company+'/'+staff.staffId+'/'+staff.memberId;
      const cached=JSON.parse(sessionStorage.getItem(key)||'{}');
      if(!cached||typeof cached!=='object'||Array.isArray(cached))throw Error('Original cache requires review');
      if(cached.savePending){
        const old=priorReceipt?.request,result=priorReceipt?.result;
        const completed=old?.operation==='MARGIN_REFRESH'&&validRequest(old,args.company)&&same(old,cached.savePending)
          &&priorReceipt.staff?.staffId===staff.staffId&&priorReceipt.staff?.memberId===staff.memberId
          &&result?.ok===true&&result.requestId===old.requestId&&Number.isSafeInteger(result.stockGeneration)
          &&result.stockGeneration>old.stockGeneration&&result.stockGeneration<=meta.stockGeneration&&old.stockBuild===meta.stockBuild;
        if(!completed)return mount(args); // Never overwrite another/unknown original save.
      }
      const request={type:'PURCHASE_SAVE_REQUEST',company:args.company,requestId:crypto.randomUUID(),operation:'MARGIN_REFRESH',input:{taskId:packet.taskId},
        stockProtocol:1,stockBuild:meta.stockBuild,stockGeneration:meta.stockGeneration};
      if(!validRequest(request,args.company))throw Error('Original refresh identity unavailable');
      const next={...cached,savePending:request,saveAttemptCount:0,saveIssue:'',
        saveOrigin:{view:cached.customerId?'room':'dashboard',customerId:cached.customerId||'',activeCustomer:''}};
      // Atomic replacement retains unrelated price/sort/allocation drafts. First
      // network save is impossible unless this exact full request was read back.
      sessionStorage.setItem(key,JSON.stringify(next));
      if(!same(JSON.parse(sessionStorage.getItem(key)||'null'),next))throw Error('Original request not durably retained');
      return mount({...args,autoRequest:request,expectedStaff:staff});
    }catch(_){
      const notice=document.createElement('p');notice.className='notice';
      notice.textContent='Refresh save not started. Original cache retained; check browser storage and refresh. 更新保存尚未开始，原缓存保留，请检查浏览器暂存并刷新。';
      args.host.appendChild(notice);return()=>{};
    }
  }
  window.purchaseCurrentResume = { mount, validRequest, stageMargin };
})();
