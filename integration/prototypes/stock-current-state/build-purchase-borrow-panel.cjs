'use strict';
const fs = require('node:fs'), path = require('node:path');
const {patchStockExceptionDialog,patchStockExceptionParent,patchStockExceptionIndex}=require('./stock-exception-ui-overlay.cjs');
function once(source, before, after) { if (source.split(before).length !== 2) throw Error('Original Purchase relation route anchor changed'); return source.replace(before, () => after); }
const root = path.join(__dirname, '../../..');
let index = fs.readFileSync(path.join(root, 'purchase-live/index.html'), 'utf8').replace(/\r\n/g, '\n');
index = once(index, '</head>', '<link rel="stylesheet" href="borrow-relations.css?v=20261022-stock-current-candidate-v2"><link rel="stylesheet" href="borrow-approval.css?v=20261022-stock-current-candidate-v2"><link rel="stylesheet" href="borrow-outstanding.css?v=20261022-stock-current-candidate-v2"></head>');
index = once(index, '<script src="supplier-allocation.js', '<script src="borrow-relations.js?v=20261022-stock-current-candidate-v2"></script><script src="borrow-approval.js?v=20261022-stock-current-candidate-v2"></script><script src="borrow-return.js?v=20261022-stock-current-candidate-v2"></script><script src="borrow-outstanding.js?v=20261022-stock-current-candidate-v2"></script><script src="supplier-allocation.js');
index = once(index, '<script src="app.js', '<script src="purchase-resume.js?v=20261022-stock-current-candidate-v2"></script><script src="app.js');
index = once(index, '<button data-view="payments">', '<button data-view="borrowing" hidden>Outstanding Borrowing 未结调货</button><button data-view="payments">');
index = once(index, 'content="2026-10-20-split-controls-v1"', 'content="2026-10-22-stock-current-candidate-v2"');
for (const file of ['task-grid.js', 'supplier-allocation.js', 'app.js']) {
  const pattern = new RegExp('(<script src="' + file.replace('.', '\\.') + '\\?v=)[^"]+');
  if ((index.match(new RegExp(pattern.source, 'g')) || []).length !== 1) throw Error('Original Purchase script marker changed');
  index = index.replace(pattern, (_, prefix) => prefix + '20261022-stock-current-candidate-v2');
}
let bridge = fs.readFileSync(path.join(root, 'integration/wix/purchase-room-page.js'), 'utf8').replace(/\r\n/g, '\n');
bridge = "import { getPurchaseStockTransfersCurrent } from 'backend/stockCurrentRead.web';\n" + bridge;
bridge = "import { getPurchaseBorrowOptionsCurrent, getPurchaseBorrowReturnOptionsCurrent, savePurchaseBorrowingCurrent, savePurchaseTasksCurrent, getPurchaseResumeContextCurrent } from 'backend/stockCurrentBorrow.web';\n" + bridge;
bridge = once(bridge, '    const message = event.data || {};', `    const message = event.data || {};
    if(message.type==='PURCHASE_RESUME_CONTEXT_REQUEST'){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||JSON.stringify(message).length>1000)throw Error('Invalid Purchase resume context request.');
        const result=await getPurchaseResumeContextCurrent(message.company);room.postMessage({type:'PURCHASE_RESUME_CONTEXT_RESULT',company:message.company,requestId:message.requestId,ok:true,result});
      }catch(error){room.postMessage({type:'PURCHASE_RESUME_CONTEXT_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Original Purchase identity unconfirmed. 原采购员工身份尚未确认。'});}return;
    }
    if(message.type==='PURCHASE_BORROW_RETURN_OPTIONS_REQUEST'){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||JSON.stringify(message.input||{}).length>6000)throw Error('Invalid unused return request.');
        const result=await getPurchaseBorrowReturnOptionsCurrent(message.company,message.input);room.postMessage({type:'PURCHASE_BORROW_RETURN_OPTIONS_RESULT',company:message.company,requestId:message.requestId,ok:true,result});
      }catch(error){room.postMessage({type:'PURCHASE_BORROW_RETURN_OPTIONS_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Unused borrowing return unconfirmed. 未使用借货归还尚未确认。'});}return;
    }
    if(message.type==='PURCHASE_BORROW_OPTIONS_REQUEST'){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||JSON.stringify(message.input||{}).length>6000)throw Error('Invalid borrowing options request.');
        const result=await getPurchaseBorrowOptionsCurrent(message.company,message.input);room.postMessage({type:'PURCHASE_BORROW_OPTIONS_RESULT',company:message.company,requestId:message.requestId,ok:true,result});
      }catch(error){room.postMessage({type:'PURCHASE_BORROW_OPTIONS_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Borrowing options unconfirmed. 可借货资料尚未确认。'});}return;
    }
    if(message.type==='PURCHASE_SAVE_REQUEST'&&['BORROW_APPROVE','BORROW_RETURN'].includes(message.operation)){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||JSON.stringify(message).length>6000)throw Error('Invalid borrowing save request.');
        const result=await savePurchaseBorrowingCurrent(message.company,{requestId:message.requestId,operation:message.operation,input:message.input,stockProtocol:message.stockProtocol,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration});room.postMessage({type:'PURCHASE_SAVE_RESULT',company:message.company,requestId:message.requestId,ok:true,result});
      }catch(error){room.postMessage({type:'PURCHASE_SAVE_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Borrowing save unconfirmed; retain original request. 借货保存尚未确认，请保留原请求。'});}return;
    }
    if(message.type==='PURCHASE_SAVE_REQUEST'&&message.operation==='COST_REFERENCE'){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||message.stockProtocol!==1||JSON.stringify(message).length>6000||!message.input||Object.keys(message.input).some(key=>key!=='taskId')||!/^[a-f0-9]{32}$/.test(message.input.taskId||''))throw Error('Invalid current reference task save.');
        const result=await retryPurchaseTaskCost(message.company,message.input.taskId,message.requestId,{stockProtocol:message.stockProtocol,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration,stockIdentity:message.stockIdentity});room.postMessage({type:'PURCHASE_SAVE_RESULT',company:message.company,requestId:message.requestId,ok:true,result});
      }catch(error){room.postMessage({type:'PURCHASE_SAVE_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Reference save unconfirmed; retain original request. 参考成本保存尚未确认，请保留原请求。'});}return;
    }
    if(message.type==='PURCHASE_ORDER_SAVE_REQUEST'&&message.stockProtocol!==undefined){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||message.stockProtocol!==1||JSON.stringify(message).length>(message.input?.action==='DOCUMENT'?4400000:200000))throw Error('Invalid current original PO request.');
        const result=await savePurchaseOrder(message.company,message.requestId,message.input,{stockProtocol:message.stockProtocol,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration,stockIdentity:message.stockIdentity});room.postMessage({type:'PURCHASE_SAVE_RESULT',company:message.company,requestId:message.requestId,ok:true,result});
      }catch(error){room.postMessage({type:'PURCHASE_SAVE_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Original purchase order save unconfirmed; retain original request. 原采购单保存尚未确认，请保留原请求。'});}return;
    }
    if(message.type==='PURCHASE_SAVE_REQUEST'&&message.stockProtocol!==undefined){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||JSON.stringify(message).length>200000)throw Error('Invalid current Purchase task save.');
        const result=await savePurchaseTasksCurrent(message.company,{requestId:message.requestId,operation:message.operation,input:message.input,stockProtocol:message.stockProtocol,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration});room.postMessage({type:'PURCHASE_SAVE_RESULT',company:message.company,requestId:message.requestId,ok:true,result});
      }catch(error){room.postMessage({type:'PURCHASE_SAVE_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Purchase save unconfirmed; retain original request. 采购保存尚未确认，请保留原请求。'});}return;
    }
    if(message.type==='PURCHASE_BORROW_RELATIONS_REQUEST'){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||JSON.stringify(message.input||{}).length>6000)throw Error('Invalid borrowing detail request.');
        const result=await getPurchaseStockTransfersCurrent(message.company,message.input);room.postMessage({type:'PURCHASE_BORROW_RELATIONS_RESULT',company:message.company,requestId:message.requestId,ok:true,result});
      }catch(error){room.postMessage({type:'PURCHASE_BORROW_RELATIONS_RESULT',company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Borrowing links unconfirmed. 调货关系尚未确认。'});}return;
    }`);
bridge=patchStockExceptionParent(bridge);index=patchStockExceptionIndex(index);
new Function(bridge.replace(/^import[^\n]+\n/gm, ''));
for (const [file, source] of [['purchase-ui/index.html', index], ['purchase-room-page.candidate.js', bridge],['purchase-ui/stock-exceptions.js',patchStockExceptionDialog(fs.readFileSync(path.join(root,'master-shared/stock-exceptions.js'),'utf8').replace(/\r\n/g,'\n'))]]) {
  const target = path.join(__dirname, file);
  if (process.argv.includes('--check')) { if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Purchase borrowing panel candidate differs'); }
  else fs.writeFileSync(target, source);
}
process.stdout.write('Purchase borrowing panel index and bounded relay ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; candidate only\n');
