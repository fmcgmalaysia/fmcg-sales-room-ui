// Apply once to the isolated task checkout after its fresh live comparisons.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function replaceOnce(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw Error('Patch must match exactly once: ' + needle.slice(0, 80));
  return source.replace(needle, replacement);
}
function patch(relative, change) {
  const target = path.join(root, relative), old = fs.readFileSync(target, 'utf8');
  const nl = old.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(target, change(old, nl));
}
patch('sales-room/wix/onboarding.web.js', (old, nl) => {
  let value = replaceOnce(old, "import wixRealtimeBackend from 'wix-realtime-backend';",
    "import wixRealtimeBackend from 'wix-realtime-backend';" + nl + "import { submitNctSalesOrder } from 'backend/nctSalesIntake.js';");
  const needle = "    if (!['NCT', 'GHR'].includes(target)) throw new Error('Select a valid receiving company.');";
  return replaceOnce(value, needle, needle + nl + [
    "    if (target === 'NCT') {",
    "      const input = { orderId: normalize(orderId), staff,",
    "        authorizeCustomer: customerId => findAuthorizedCustomer(customerId, staff),",
    "        readPayloadRows: readAllPayloadRows, putPayload };",
    "      let receipt, entered = false;",
    "      try {",
    "        receipt = await withSalesOrderMutation(orderId, staff,",
    "          orderEntry => { entered = true; return submitNctSalesOrder({ ...input, lockedOrderEntry: orderEntry }); });",
    "      } catch (error) {",
    "        if (entered) throw error;",
    "        receipt = await submitNctSalesOrder({ ...input, initialError: error });",
    "      }",
    "      return Object.freeze({ ...receipt, status: 'SUBMITTED TO NCT' });",
    "    }"
  ].join(nl));
});
patch('sales-room/wix/sales-room-page.js', old => {
  let value = replaceOnce(old,
    "salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', ...(await submitSalesRoomOrder(message.orderId || '', message.destination || '')) });",
    "salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', requestId: message.requestId || '', action: message.destination === 'NCT' ? 'SUBMIT_NCT' : '', ...(await submitSalesRoomOrder(message.orderId || '', message.destination || '')) });");
  return replaceOnce(value,
    "salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', ok: false, error: error?.message || 'Order could not be submitted.' });",
    "salesRoom.postMessage({ type: 'SALES_ROOM_ORDER_ACTION_RESULT', requestId: message.requestId || '', orderId: message.orderId || '', action: message.destination === 'NCT' ? 'SUBMIT_NCT' : '', ok: false, error: error?.message || 'Order could not be submitted.' });");
});
const helpers = `let pendingNctSubmit=null;
function submitOrderToNct(order){
  if(pendingNctSubmit)return;
  const requestId=crypto.randomUUID();pendingNctSubmit={order,requestId};
  const status=document.getElementById('salesQtyStatus');if(status)status.textContent='Submitting to NCT and checking costs…';
  salesQtyBusy(true);document.querySelectorAll('.submit-menu').forEach(menu=>menu.classList.remove('show'));
  window.parent.postMessage({type:'SALES_ROOM_SUBMIT_ORDER',orderId:order.orderId,destination:'NCT',requestId},'*');
  setTimeout(()=>{if(pendingNctSubmit?.requestId!==requestId)return;pendingNctSubmit=null;
    if(document.getElementById('orderDetailArea')?.dataset.nctOrderId!==order.orderId)return;
    salesQtyBusy(false);const status=document.getElementById('salesQtyStatus');
    if(status)status.textContent='Receipt is not confirmed yet. Reopen this order to check, or retry Submit to NCT. Do not send a new order.';
  },45000);
}
window.addEventListener('message',event=>{
  const message=event.data||{};if(event.source!==window.parent||message.type!=='SALES_ROOM_ORDER_ACTION_RESULT'||message.action!=='SUBMIT_NCT')return;
  event.stopImmediatePropagation();
  if(!pendingNctSubmit||message.requestId!==pendingNctSubmit.requestId||message.orderId!==pendingNctSubmit.order.orderId)return;
  const order=pendingNctSubmit.order;pendingNctSubmit=null;
  if(document.getElementById('orderDetailArea')?.dataset.nctOrderId!==order.orderId)return;
  salesQtyBusy(false);const status=document.getElementById('salesQtyStatus');
  if(!message.ok||!message.receiptId||message.destination!=='NCT'){
    if(status)status.textContent=message.error||'Master receipt is not confirmed. Retry Submit to NCT for this same order.';return;
  }
  renderOrderDetail({...order,status:'SUBMITTED TO NCT',destination:'NCT'});
  document.querySelectorAll('#submitOrderToggle,#createProforma').forEach(button=>button.disabled=true);
  const done=document.getElementById('salesQtyStatus');if(done)done.textContent='Submitted to NCT. Master receipt confirmed.'+(message.costErrorTaskCount?' '+message.costErrorTaskCount+' product line(s) need cost review in Purchase Room.':'');
  window.parent.postMessage({type:'SALES_ROOM_CONFIRMED_ORDERS_REQUEST'},'*');
});
`;
patch('index.html', (old, nl) => {
  let value = replaceOnce(old, 'function renderOrderDetail(o){', helpers.replace(/\n/g, nl) +
    "function renderOrderDetail(o){document.getElementById('orderDetailArea').dataset.nctOrderId=o.orderId;");
  const needle = "document.querySelectorAll('[data-company-preview]').forEach(button=>button.onclick=()=>{status.textContent=";
  value = replaceOnce(value, needle,
    "document.querySelectorAll('[data-company-preview]').forEach(button=>button.onclick=()=>{if(button.dataset.companyPreview==='To North Cape'){if(guard()&&editable)submitOrderToNct(o);return}status.textContent=");
  const guard = "const status=document.getElementById('salesQtyStatus'),guard=()=>{if(pendingSalesQtyEdit||pendingSalesPoEdit?.dirty||pendingSalesPoEdit?.saving)";
  value = replaceOnce(value, guard, guard.replace('if(pendingSalesQtyEdit', 'if(pendingNctSubmit||pendingSalesQtyEdit'));
  return replaceOnce(value, 'Sales Room build: 2026-10-08-sales-progress-review-layout-room5-v2;',
    'Sales Room build: 2026-10-09-nct-submit-catch-cost-room6-v1;');
});
