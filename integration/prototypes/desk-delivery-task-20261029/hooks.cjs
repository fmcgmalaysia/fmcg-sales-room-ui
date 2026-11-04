'use strict';
// Isolated additions applied to both repository sources and the frozen static package.
const assert=require('node:assert/strict');
const hooks=[
 ['support-room/workroom-model.js','return {company:fulfilment.company,','return {delivery:packing,company:fulfilment.company,'],
 ['support-room/workroom-model.js',"loadedQty:loadedRecords.length?sum(loadedRecords,'loaded'):finite(ready?.loadedQty)","loadedQty:finite(packing?.deskSummaries?.find(row=>row.taskId===source.taskId)?.loadedQty)??(loadedRecords.length?sum(loadedRecords,'loaded'):finite(ready?.loadedQty))"],
 ['support-room/workroom.js',"if(message.ok!==true||message.result?.ok===false)request.reject(Error(message.error||message.result?.error||'Could not load current orders.'));","if(message.ok!==true||message.result?.ok===false){const error=Error(message.error||message.result?.error||'Could not load current orders.');error.retryable=message.result?.retryable;request.reject(error);}"],
 ['support-room/workroom.js',"$('content').innerHTML=orderContent(order);",`$('content').innerHTML=orderContent(order);
    const deliveryCompany=company;
    window.DeskDelivery?.mountSupport({company,model:data,root:$('content'),customerId:selectedCustomer,desk:activeDesk,lines:viewLines(order),canSend:activeDesk>0&&!busy&&!deskBusy&&!deskPending()&&!invoiceBusy&&!deskLock(),send,
      applyReceipt(result){if(company!==deliveryCompany||!data)return;deskReceiptEpoch++;if(result.deskState){data.desks=data.desks.filter(row=>row.customerId!==result.deskState.customerId).concat(result.deskState);if(readCache?.company===company&&readCache.results[2].status==='fulfilled')readCache.results[2].value.desks=data.desks;}data.delivery.pendingAuthorizations=(data.delivery.pendingAuthorizations||[]).filter(row=>row.requestId!==result.requestId);data.delivery.lists=data.delivery.lists.filter(row=>row.id!==result.list.id).concat(result.list);if(readCache?.company===company&&readCache.results[1].status==='fulfilled')readCache.results[1].value=data.delivery;$('notice').textContent=result.status==='CANCELLED'?'Warehouse task recalled.':'Desk authorized to Warehouse.';render();},invalidate(){if(company===deliveryCompany)load([0,1,2,3]);}});`],
 ['support-room/workroom.js',"if(epoch!==deskReceiptEpoch&&readCache?.company===company)results[2]=readCache.results[2];","if(epoch!==deskReceiptEpoch&&readCache?.company===company){results[2]=readCache.results[2];results[1]=readCache.results[1];}"],
 ['support-room/workroom.js',"$('company').onchange=()=>{", "$('company').onchange=()=>{if(window.DeskDelivery?.supportPending()){$('company').value=company;$('notice').textContent='Confirm the pending Warehouse authorization before changing company.';return;}"],
 ['purchase-live/app.js','render();allocationUi()?.receivedWorkspace();','render();window.DeskDelivery?.setPurchase(data);allocationUi()?.receivedWorkspace();']
];
function retirePackingNavigation(text){const href=/\$\('packing'\)\.href='[^']+'\+company;/g,handler=/^  \$\('packing'\)\.onclick=event=>[^\n]+\r?\n/m;assert.equal((text.match(href)||[]).length,2);assert(handler.test(text));return text.replace(href,'').replace(handler,'');}
function apply(file,text){for(const [name,before,after] of hooks.filter(row=>row[0]===file)){assert.equal(text.split(before).length-1,1,file+' exact hook');text=text.replace(before,after);}return file==='support-room/workroom.js'?retirePackingNavigation(text):text;}
if(require.main===module){const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../../..');for(const file of new Set(hooks.map(row=>row[0])))fs.writeFileSync(path.join(root,file),apply(file,fs.readFileSync(path.join(root,file),'utf8')));}
module.exports={apply,hooks,retirePackingNavigation};
