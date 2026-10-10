/* Master CMS only. No fixture data and no browser business-record persistence. */
(() => {
  const app = document.querySelector('#app'), status = document.querySelector('#liveStatus'), modal = document.querySelector('#modal');
  let company = 'NCT', view = 'dashboard', customerId = '', data = null, pending = null, query = '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const num = (value, places = 2) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-MY', { minimumFractionDigits: places, maximumFractionDigits: places }) : '—';
  const time = value => value ? new Date(value).toLocaleString('en-MY', { timeZone:'Asia/Kuala_Lumpur', hour12:false }) : '—';
  const bubble = (value, risk = false) => value ? `<b class="${risk ? 'risk-count' : 'task-total'}">${value}</b>` : '<span class="zero-risk">—</span>';
  const button = (label, attrs = '') => `<button class="btn" ${attrs}>${label}</button>`;
  const supplierName = id => data.suppliers.find(row => row.id === id)?.shortName || data.suppliers.find(row => row.id === id)?.name || id || '—';
  function showStatus(message, error = false) { status.classList.toggle('error', error); status.textContent = message; }
  function request() {
    const requestId = crypto.randomUUID(); pending = { requestId, company }; data = null; query = '';
    showStatus('正在读取 ' + company + ' 的真实采购资料…'); app.innerHTML = '<div class="live-empty">Loading Master CMS…</div>';
    window.parent.postMessage({ type:'PURCHASE_WORKSPACE_REQUEST', company, requestId }, '*');
    setTimeout(() => { if (pending?.requestId !== requestId) return; pending = null;
      showStatus('读取超时，尚未取得资料。请点击 Refresh 重试；此页面不会显示示例数据。', true); }, 30000);
  }
  window.addEventListener('message', event => {
    const message = event.data || {};
    if (event.source !== window.parent || message.type !== 'PURCHASE_WORKSPACE_RESULT' || !pending ||
      message.requestId !== pending.requestId || message.company !== pending.company) return;
    pending = null;
    if (!message.ok) { showStatus(message.error || 'Master data could not be loaded.', true); app.innerHTML = '<div class="live-empty">资料未载入。请核对员工登录及 Purchase Access。'+
      (message.canLogin?'<p><button class="btn primary" id="masterLogin">Sign in to Master</button></p>':'')+
      (message.identity?'<p>Master Member ID: <b>'+esc(message.identity.memberId)+'</b></p><p>'+esc(message.identity.email)+'</p>':'')+'</div>'; return; }
    const result = message.workspace;
    if (result?.company !== company || !Array.isArray(result.tasks) || !Array.isArray(result.customers) || !Array.isArray(result.suppliers)) {
      showStatus('Master 回执格式不完整，未显示任何资料。', true); return;
    }
    data = result; document.querySelector('#session').textContent = result.staff.staffName + ' / Purchase';
    showStatus('Master CMS · Last read ' + time(result.fetchedAt)); render();
  });
  window.addEventListener('message', event => { if(event.source !== window.parent || event.data?.type !== 'PURCHASE_LOGIN_RESULT') return;
    if(event.data.ok) request(); else showStatus(event.data.error || 'Login was not completed.', true); });
  function summary() {
    const rows = data.tasks.filter(row => row.stage !== 'SHIPPED'), items = [
      ['Active Orders', new Set(rows.map(row => row.orderId)).size, false], ['Purchase Tasks', rows.length, false],
      ['Payment Requests', null, false], ['At Risk', rows.filter(row => row.risk).length, true]
    ];
    return `<section class="dashboard-summary">${items.map(([label,count,risk]) => `<div class="summary-item ${risk?'summary-risk':''}"><div><span class="summary-label">${label}</span>${count===null?'<span class="summary-zero">—</span>':count===0?'<span class="summary-zero">—</span>':`<b>${count}</b>`}</div></div>`).join('')}</section>`;
  }
  function dashboard() {
    const rows = data.tasks.filter(row => row.stage !== 'SHIPPED');
    return `<div class="dashboard-title"><h1>Purchase Dashboard</h1><span>${company}</span></div>${summary()}<div class="dashboard-grid">
      <section class="panel"><div class="panelhead"><h2>Customers</h2></div><div class="directory-scroll"><table class="directory"><colgroup><col style="width:34%"><col style="width:30%"><col style="width:12%"><col style="width:12%"><col style="width:12%"></colgroup><thead><tr><th>Customer</th><th>Est. Shipment Date</th><th>Tasks</th><th>Risk</th><th>Entry</th></tr></thead><tbody>${data.customers.map(customer => {
        const tasks = rows.filter(row => row.customerId === customer.id), dates = [...new Set(tasks.map(row => row.estimatedShipmentDate).filter(Boolean))];
        return `<tr><td><b>${esc(customer.name)}</b></td><td>${dates.length?dates.map(esc).join('<br>'):'—'}</td><td>${bubble(tasks.length)}</td><td>${bubble(tasks.filter(row => row.risk).length,true)}</td><td>${button('↪',`data-customer="${esc(customer.id)}" aria-label="Open ${esc(customer.name)}"`)}</td></tr>`;
      }).join('')}</tbody></table>${data.customers.length?'':'<div class="live-empty">尚无已完成接收的订单。</div>'}</div></section>
      <section class="panel"><div class="panelhead"><h2>Suppliers</h2><span>Shared</span></div><div class="directory-scroll"><table class="directory"><colgroup><col style="width:66%"><col style="width:17%"><col style="width:17%"></colgroup><thead><tr><th>Supplier</th><th>Tasks</th><th>Risk</th></tr></thead><tbody>${data.suppliers.map(supplier => {
        const tasks = rows.filter(row => row.supplierId === supplier.id); return `<tr><td><b>${esc(supplier.name)}</b></td><td>${bubble(tasks.length)}</td><td>${bubble(tasks.filter(row=>row.risk).length,true)}</td></tr>`;
      }).join('')}</tbody></table>${data.suppliers.length?'':'<div class="live-empty">尚无供应商资料。</div>'}</div></section></div>`;
  }
  function room() {
    const customer = data.customers.find(row => row.id === customerId), rows = data.tasks.filter(row => row.customerId === customerId && row.stage !== 'SHIPPED');
    const shown = rows.filter(row => [row.barcode,row.name,row.orderId,row.po].join(' ').toLowerCase().includes(query.toLowerCase()));
    return `<div class="dashboard-title"><h1>${esc(customer?.name || '')} · Purchase Room</h1>${button('← Dashboard','data-view="dashboard"')}</div><div class="live-toolbar"><input id="taskSearch" aria-label="Search product / order / P.O." placeholder="Search product / order / P.O." value="${esc(query)}"><span>${shown.length} / ${rows.length} tasks · MYR costs</span></div><section class="panel"><div class="tablewrap"><table class="live-task-table"><colgroup>${[3,10,9,27,9,6,6,6,5,5,5,6,7,6].map(width=>`<col style="width:${width}%">`).join('')}</colgroup><thead><tr>${['Row','Order Received','Waiting','Description','Supplier','Qty','LP/Pc','LP/Ctn','Disc.1','Disc.2','Disc.3','Net Cost','Our P.O.','Path'].map(label=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${shown.map((row,index)=>`<tr><td>${index+1}</td><td>${esc(time(row.masterReceivedAt))}<small>${esc(row.submittedByName)}</small></td><td>${esc(row.stage.replaceAll('_',' '))}</td><td class="live-product"><span>${esc(row.barcode)}${row.specialPurchase?'<span class="live-special">Special Purchase</span>':''}${row.costStatus==='ERROR'?`<button class="cost-error" data-cost="${esc(row.id)}">Cost Error</button>`:''}</span><b>${esc(row.name)}</b><small>${esc(row.packing)}</small></td><td>${esc(supplierName(row.supplierId))}</td><td class="live-number">${num(row.ord,0)}<small>inc ${num(row.inc,0)}</small></td><td class="live-number">${num(row.lpPc)}</td><td class="live-number">${num(row.lpCtn)}</td><td class="live-number">${row.disc1===null?'—':num(row.disc1*100)+'%'}</td><td class="live-number">${row.disc2===null?'—':num(row.disc2*100)+'%'}</td><td class="live-number">${num(row.disc3)}</td><td class="live-number"><b>${num(row.netCostCtn)}</b></td><td>${esc(row.po||'—')}</td><td>${button('Path',`data-path="${esc(row.id)}"`)}</td></tr>`).join('')}</tbody></table>${shown.length?'':'<div class="live-empty">没有符合条件的采购任务。</div>'}</div></section>`;
  }
  function history() {
    const events = new Map(); for (const task of data.tasks) for (const event of task.history) events.set(event.id,{ ...event, taskId:task.id, orderId:task.orderId });
    return `<h1>Activity History</h1><section class="panel"><table class="directory"><thead><tr><th>Order</th><th>Action</th><th>Time / Actor</th><th>Result</th><th>Detail</th></tr></thead><tbody>${[...events.values()].sort((a,b)=>String(b.time).localeCompare(String(a.time))).map(event=>`<tr><td>${esc(event.orderId)}</td><td>${esc(event.action)}</td><td>${esc(time(event.time))}<br>${esc(event.actor)}</td><td>${esc(event.result)}</td><td>${esc(event.message)}</td></tr>`).join('')}</tbody></table></section>`;
  }
  function render() {
    if (!data) return;
    document.querySelectorAll('nav [data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view || view==='room'&&button.dataset.view==='dashboard'));
    if(view==='dashboard') app.innerHTML=dashboard(); else if(view==='room') app.innerHTML=room(); else if(view==='history') app.innerHTML=history();
    else if(view==='payments') app.innerHTML='<h1>Payment Follow-up</h1><div class="live-empty">付款申请流程尚未连接；此处不会用示例记录代替。</div>';
    else {
      const groups=new Map(); for(const row of data.tasks.filter(row=>row.po)) { const key=row.customerId+'|'+row.supplierId+'|'+row.po; if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row); }
      app.innerHTML='<h1>Purchase Order</h1><section class="panel"><table class="directory"><thead><tr><th>P.O.</th><th>Customer</th><th>Supplier</th><th>Tasks</th></tr></thead><tbody>'+[...groups.values()].map(rows=>`<tr><td>${esc(rows[0].po)}</td><td>${esc(data.customers.find(customer=>customer.id===rows[0].customerId)?.name)}</td><td>${esc(supplierName(rows[0].supplierId))}</td><td>${bubble(rows.length)}</td></tr>`).join('')+'</tbody></table></section>';
    }
  }
  document.addEventListener('click',event=>{
    const control=event.target.closest('button');if(!control)return;
    if(control.id==='refresh')return request();
    if(control.id==='masterLogin'){window.parent.postMessage({type:'PURCHASE_LOGIN_REQUEST'},'*');return;}
    if(control.dataset.customer){customerId=control.dataset.customer;view='room';query='';return render();}
    if(control.dataset.view){view=control.dataset.view;return render();}
    const id=control.dataset.cost||control.dataset.path;if(!id||!data)return;
    const row=data.tasks.find(task=>task.id===id);if(!row)return;
    const detail=control.dataset.cost?`<p>${esc(row.costErrorReason)}</p><p>请联系交单销售员：<b>${esc(row.submittedByName)}</b></p><p>Catch Cost：${esc(time(row.costCapturedAt))}</p><p>Task ID：${esc(row.id)}</p>`:
      `<p>Order：${esc(row.orderId)}</p><p>Sales submitted：${esc(time(row.submittedAt))} · ${esc(row.submittedByName)}</p><p>Master received：${esc(time(row.masterReceivedAt))}</p>${row.history.map(item=>`<p class="live-path"><b>${esc(item.action)}</b><br>${esc(time(item.time))} · ${esc(item.actor)} · ${esc(item.result)}<br>${esc(item.message)}</p>`).join('')}`;
    document.querySelector('#dialogContent').innerHTML=`<h2>${control.dataset.cost?'Cost Error':'Task Path'}</h2>${detail}<footer>${button('Close','id="closeModal"')}</footer>`;modal.showModal();
  });
  // A separate close listener avoids treating a modal close as a task operation.
  document.addEventListener('click',event=>{if(event.target.closest('#closeModal'))modal.close();});
  document.addEventListener('input',event=>{if(event.target.id!=='taskSearch')return;const caret=event.target.selectionStart;query=event.target.value;render();const input=document.querySelector('#taskSearch');input.focus();input.setSelectionRange(caret,caret);});
  document.querySelector('#companySelect').addEventListener('change',event=>{company=event.target.value;view='dashboard';customerId='';document.querySelector('#workspaceCompany').textContent=company;modal.close();request();});
  request();
})();
