'use strict';
const fs = require('node:fs'), path = require('node:path');
function once(source, before, after) { if (source.split(before).length !== 2) throw Error('Original Purchase relation route anchor changed'); return source.replace(before, () => after); }
const root = path.join(__dirname, '../../..');
let index = fs.readFileSync(path.join(root, 'purchase-live/index.html'), 'utf8').replace(/\r\n/g, '\n');
index = once(index, '</head>', '<link rel="stylesheet" href="borrow-relations.css?v=20261022-stock-current-candidate-v2"></head>');
index = once(index, '<script src="supplier-allocation.js', '<script src="borrow-relations.js?v=20261022-stock-current-candidate-v2"></script><script src="supplier-allocation.js');
index = once(index, 'content="2026-10-20-split-controls-v1"', 'content="2026-10-22-stock-current-candidate-v2"');
for (const file of ['task-grid.js', 'supplier-allocation.js', 'app.js']) {
  const pattern = new RegExp('(<script src="' + file.replace('.', '\\.') + '\\?v=)[^"]+');
  if ((index.match(new RegExp(pattern.source, 'g')) || []).length !== 1) throw Error('Original Purchase script marker changed');
  index = index.replace(pattern, (_, prefix) => prefix + '20261022-stock-current-candidate-v2');
}
let bridge = fs.readFileSync(path.join(root, 'integration/wix/purchase-room-page.js'), 'utf8').replace(/\r\n/g, '\n');
bridge = "import { getPurchaseStockTransfersCurrent } from 'backend/stockCurrentRead.web';\n" + bridge;
bridge = once(bridge, '    const message = event.data || {};', `    const message = event.data || {};
    if(message.type==='PURCHASE_BORROW_RELATIONS_REQUEST'){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||JSON.stringify(message.input||{}).length>6000)throw Error('Invalid borrowing detail request.');
        const result=await getPurchaseStockTransfersCurrent(message.company,message.input);room.postMessage({type:'PURCHASE_BORROW_RELATIONS_RESULT',company:message.company,requestId:message.requestId,ok:true,result});
      }catch(error){room.postMessage({type:'PURCHASE_BORROW_RELATIONS_RESULT',company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Borrowing links unconfirmed. 调货关系尚未确认。'});}return;
    }`);
new Function(bridge.replace(/^import[^\n]+\n/gm, ''));
for (const [file, source] of [['purchase-ui/index.html', index], ['purchase-room-page.candidate.js', bridge]]) {
  const target = path.join(__dirname, file);
  if (process.argv.includes('--check')) { if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Purchase borrowing panel candidate differs'); }
  else fs.writeFileSync(target, source);
}
process.stdout.write('Purchase borrowing relation panel index and read-only relay ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; candidate only\n');
