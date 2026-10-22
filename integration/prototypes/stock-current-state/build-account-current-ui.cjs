'use strict';
// Narrow original UI/panel overlays, not a standalone publication bundle.
const fs = require('node:fs'), path = require('node:path'), root = path.resolve(__dirname, '../../..'), out = path.join(__dirname, 'account-ui');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
function once(source, before, after) { if (source.split(before).length !== 2) throw Error('Exact original Account client anchor changed: ' + before.slice(0, 100)); return source.replace(before, () => after); }
let settlement = read('account-room/settlement.js');
settlement = once(settlement, "  if(pending||kind==='plan')return;", "  if(pending||window.accountCurrent?.busy()||kind==='plan')return;");
settlement = once(settlement, ' function send(){if(!pending||saving)return;', ` function send(){if(!pending||saving)return;
  if(pending.stockProtocol===1){try{return window.accountCurrent.send(pending,{status:(busy,text)=>{saving=busy;lock(busy);document.querySelector('#company').disabled=true;document.querySelector('#settlementSubmit').textContent=busy?'Saving…':'Retry same save';document.querySelector('#settlementError').textContent=text;},done:()=>{pending=null;saving=false;lock(false);dialog.close();document.querySelector('#accountRefresh')?.click();}});}catch(error){saving=false;lock(false);document.querySelector('#company').disabled=true;document.querySelector('#settlementError').textContent=error.message;return;}}
`);
settlement = once(settlement, "  pending={type:'ACCOUNT_SETTLEMENT_REQUEST',company:row.company,requestId:crypto.randomUUID(),input};send();",
  "  const original={type:'ACCOUNT_SETTLEMENT_REQUEST',company:row.company,requestId:crypto.randomUUID(),input};\n  try{pending=window.accountCurrent?window.accountCurrent.decorate(original):original;}catch(error){lock(false);document.querySelector('#settlementError').textContent=error.message;return;}send();");
settlement = once(settlement, 'busy:()=>Boolean(pending)', 'busy:()=>Boolean(pending||window.accountCurrent?.busy())');
settlement = once(settlement, 'm.requestId!==pending.requestId)return;saving=false;', 'm.requestId!==pending.requestId)return;if(pending.stockProtocol===1)return;saving=false;');
let payments = read('account-room/purchase-payments.js');
payments = once(payments, " function render(){if(!['dashboard','payments','history','creditor','bank','activity'].includes(view))return;", " function render(){if(!['dashboard','payments','history','creditor','bank','activity'].includes(view))return;window.accountCurrent?.observe(data);");
payments = once(payments, 'purchaseNote,error});', 'purchaseNote,error});window.accountCurrent?.mount();');
payments = once(payments, ' function check(row){if(save||!row.canCheck)return;', ' function check(row){if(save||window.accountCurrent?.busy()||!row.canCheck)return;');
payments = once(payments, ' function sendSave(){if(!save||saving)return;', ` function sendSave(){if(!save||saving)return;
  if(save.stockProtocol===1){try{return window.accountCurrent.send(save,{status:(busy,text)=>{saving=busy;document.querySelector('#company').disabled=true;dialog.querySelectorAll('button,textarea').forEach(el=>el.disabled=busy);document.querySelector('#accountSaveError').textContent=text;const button=dialog.querySelector('[data-account-confirm]');if(button)button.textContent=busy?'Saving…':'Retry';},done:()=>{save=null;saving=false;document.querySelector('#company').disabled=false;dialog.close();request();}});}catch(error){saving=false;document.querySelector('#accountSaveError').textContent=error.message;return;}}
`);
payments = once(payments, "message.requestId===save.requestId){saving=false;", "message.requestId===save.requestId){if(save.stockProtocol===1)return;saving=false;");
payments = once(payments, "save={type:'ACCOUNT_CHECK_REQUEST',company,requestId:crypto.randomUUID(),input:{id:row.id,version:row.version,action:'INVOICE_CHECK',enabled:!row.invoiceChecked,reason}};sendSave();",
  "const original={type:'ACCOUNT_CHECK_REQUEST',company,requestId:crypto.randomUUID(),input:{id:row.id,version:row.version,action:'INVOICE_CHECK',enabled:!row.invoiceChecked,reason}};try{save=window.accountCurrent?window.accountCurrent.decorate(original):original;}catch(error){document.querySelector('#accountSaveError').textContent=error.message;return;}sendSave();");
let panel = read('integration/wix/account-department-page.js');
panel = once(panel, '    const message=event.data||{};', `    const message=event.data||{};
    if(message.type==='ACCOUNT_CURRENT_CONTEXT_REQUEST'){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||JSON.stringify(message).length>1000)throw Error('Invalid original Account context request');
        const result=await getAccountPurchaseOrders(message.company,{contextOnly:true});room.postMessage({type:'ACCOUNT_CURRENT_CONTEXT_RESULT',company:message.company,requestId:message.requestId,ok:true,result});
      }catch(_){room.postMessage({type:'ACCOUNT_CURRENT_CONTEXT_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Original Account identity unconfirmed.'});}return;
    }
    if(['ACCOUNT_SETTLEMENT_REQUEST','ACCOUNT_CHECK_REQUEST'].includes(message.type)&&message.stockProtocol!==undefined){
      const type=message.type==='ACCOUNT_CHECK_REQUEST'?'ACCOUNT_CHECK_RESULT':'ACCOUNT_SETTLEMENT_RESULT';
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||message.stockProtocol!==1||!Number.isSafeInteger(message.stockSegment)||message.stockSegment<1||message.stockSegment>1000000||JSON.stringify(message).length>(message.input?.action==='DOCUMENT_UPLOAD'?4400000:200000))throw Error('Invalid original current Account request');
        const metadata={stockProtocol:message.stockProtocol,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration,stockIdentity:message.stockIdentity};
        const result=await(message.type==='ACCOUNT_CHECK_REQUEST'?saveAccountInvoiceCheck:saveAccountSettlement)(message.company,message.requestId,message.input,metadata);room.postMessage({type,company:message.company,requestId:message.requestId,stockSegment:message.stockSegment,ok:true,result});
      }catch(_){room.postMessage({type,company:message.company,requestId:message.requestId,stockSegment:message.stockSegment,ok:false,error:'Original save unconfirmed; retain and retry the same request.'});}return;
    }`);
let index = read('account-room/index.html');
index = once(index, '<script src="settlement.js', '<script src="account-current.js?v=20261022-current-v1"></script><script src="settlement.js');
index = once(index, 'content="2026-10-20-split-controls-v1"', 'content="2026-10-22-stock-current-candidate-v2"');
for (const file of ['settlement.js','purchase-payments.js']) index = once(index, file + '?v=20261019-finance-' + (file === 'settlement.js' ? 'audit-v15' : 'account-query-v1'), file + '?v=20261022-current-v1');
const files = { 'account-ui/account-current.js':read('integration/prototypes/stock-current-state/account-current-client.js'),'account-ui/settlement.js':settlement,'account-ui/purchase-payments.js':payments,'account-ui/index.html':index,'account-department-page.candidate.js':panel };
for (const [file, text] of Object.entries(files)) {
  if (file.endsWith('.js')) new Function(text.replace(/^import[^\n]+\n/gm, ''));
  const target = path.join(__dirname, file);
  if (process.argv.includes('--check')) { if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== text) throw Error('Original current Account client differs: ' + file); }
  else { fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target, text); }
}
process.stdout.write('Original Account durable request/dialog/panel overlays ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; not published\n');
