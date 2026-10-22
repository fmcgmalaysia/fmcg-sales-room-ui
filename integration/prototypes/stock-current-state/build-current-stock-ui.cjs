'use strict';
// Mechanical candidate overlays only. Protected production files are read, never changed.
const fs = require('node:fs'), path = require('node:path'), root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const replace = (source, from, to) => { if (source.split(from).length !== 2) throw Error('Exact stock UI anchor changed: ' + from.slice(0, 60)); return source.replace(from, to); };
const marker = '20261022-current-stock-v1', out = path.join(__dirname, 'warehouse-ui');
const files = {};
let app = read('warehouse-room/stock-control-app.js'), start = app.indexOf('  function showSources(row) {'), end = app.indexOf("  $('stock-rows').onclick", start);
if (start < 0 || end < start) throw Error('Exact source modal anchor required');
app = app.slice(0, start) + read('integration/prototypes/stock-current-state/stock-control-detail-ui.js') + '\n' + app.slice(end);
app = replace(app, "if (result?.company !== company || !Array.isArray(result.items)", "if (result?.schema !== 'CURRENT_STOCK_V1' || result?.company !== company || !Array.isArray(result.items)");
files['stock-control-app.js'] = app;
let html = read('warehouse-room/stock-control.html');
html = replace(html, '<table class="sources"><thead><tr>', '<table class="sources"><thead><tr id="source-columns">');
html = replace(html, '<footer><button id="done-source">', '<footer><div class="source-pager"><button id="source-back" hidden>Sources 来源</button><span id="source-page"></span><button id="source-previous" disabled>Previous 上一页</button><button id="source-next" disabled>Next 下一页</button></div><button id="done-source">');
files['stock-control.html'] = html.replaceAll('2026-10-21-stock-tab-v1', marker).replaceAll('20261021-stock-tab-v1', marker);
files['stock-control.css'] = read('warehouse-room/stock-control.css') + '\n.source-pager{display:flex;gap:8px;align-items:center;float:left}.source-pager span{color:#60788f}.review-notes.reading{color:#60788f}\n';
files['stock-control-embedded.css'] = read('warehouse-room/stock-control-embedded.css');
let link = read('warehouse-room/stock-control-link.js');
link = replace(link, "activeRequest = '', busy = false", "activeRequest = '', activeType = '', busy = false");
link = replace(link, "activeRequest = ''; busy = false;", "activeRequest = ''; activeType = ''; busy = false;");
link = replace(link, "message.type !== 'STOCK_CONTROL_READ_REQUEST'", "!['STOCK_CONTROL_READ_REQUEST','STOCK_CONTROL_SOURCE_READ_REQUEST'].includes(message.type)");
link = replace(link, 'JSON.stringify(message).length > 2000', 'JSON.stringify(message).length > 6000');
link = replace(link, 'activeRequest = message.requestId;', "activeRequest = message.requestId; activeType = message.type === 'STOCK_CONTROL_READ_REQUEST' ? 'STOCK_CONTROL_READ_RESULT' : 'STOCK_CONTROL_SOURCE_READ_RESULT';");
link = replace(link, "message.type !== 'STOCK_CONTROL_READ_RESULT'", 'message.type !== activeType');
files['stock-control-link.js'] = link.replaceAll('20261021-stock-tab-v1', marker);
let wix = read('integration/wix/warehouse-department-page.js');
wix = replace(wix, "import { getWarehouseStockControl } from 'backend/stockControl.web';", "import { getWarehouseStockControlCurrent, getWarehouseStockSourcesCurrent } from 'backend/stockCurrentRead.web';");
const a = wix.indexOf("    if(message.type==='STOCK_CONTROL_READ_REQUEST'){"), b = wix.indexOf("    if(['TASK_CHAT_LIST_REQUEST'", a);
if (a < 0 || b < a) throw Error('Exact Warehouse stock bridge anchor required');
wix = wix.slice(0, a) + [
  "    if(['STOCK_CONTROL_READ_REQUEST','STOCK_CONTROL_SOURCE_READ_REQUEST'].includes(message.type)){",
  "      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||!message.requestId||message.requestId.length>100||JSON.stringify(message).length>6000)return;",
  "      const detail=message.type==='STOCK_CONTROL_SOURCE_READ_REQUEST', type=detail?'STOCK_CONTROL_SOURCE_READ_RESULT':'STOCK_CONTROL_READ_RESULT';",
  "      try{const result=await (detail?getWarehouseStockSourcesCurrent:getWarehouseStockControlCurrent)(message.company,message.input||{});room.postMessage({type,company:message.company,requestId:message.requestId,ok:result?.ok===true,...(result?.ok===true?{result}:{error:result?.error||'Stock unavailable 库存暂不可读取'})});}",
  "      catch(_){room.postMessage({type,company:message.company,requestId:message.requestId,ok:false,error:'Stock unavailable 库存暂不可读取'});}return;",
  '    }', ''
].join('\n') + wix.slice(b);
wix = replace(wix, '20261021-packing-company-v1', marker);
wix = "import { getWarehouseResumeContextCurrent } from 'backend/stockCurrentWarehouse.web';\n"+wix;
wix = replace(wix,"    if(!['WAREHOUSE_ORDERS_REQUEST','WAREHOUSE_RECEIPT_REQUEST'].includes(message.type)",[
  "    if(message.type==='WAREHOUSE_RESUME_CONTEXT_REQUEST'){",
  "      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||!message.requestId||message.requestId.length>100||JSON.stringify(message).length>1000)return;",
  "      try{const result=await getWarehouseResumeContextCurrent(message.company);room.postMessage({type:'WAREHOUSE_RESUME_CONTEXT_RESULT',company:message.company,requestId:message.requestId,ok:result?.ok===true,result});}",
  "      catch(_){room.postMessage({type:'WAREHOUSE_RESUME_CONTEXT_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Original Warehouse identity unconfirmed.'});}return;",
  "    }",
  "    if(!['WAREHOUSE_ORDERS_REQUEST','WAREHOUSE_RECEIPT_REQUEST'].includes(message.type)"
].join('\n'));
wix = replace(wix,"||JSON.stringify(message).length>200000)return;\n    const type=message.type==='WAREHOUSE_ORDERS_REQUEST'",
  "||JSON.stringify(message).length>(message.type==='WAREHOUSE_RECEIPT_REQUEST'?1000000:200000))return;\n    const type=message.type==='WAREHOUSE_ORDERS_REQUEST'");
wix = replace(wix,'await saveWarehouseReceipt(message.company,message.requestId,message.input)',
  'await saveWarehouseReceipt(message.company,message.requestId,message.input,message.stockProtocol===1?{stockProtocol:1,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration,stockIdentity:message.stockIdentity}:undefined)');
wix = replace(wix,'await saveWarehousePreparation(message.company,message.requestId,message.input)',
  'await saveWarehousePreparation(message.company,message.requestId,message.input,message.stockProtocol===1?{stockProtocol:1,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration,stockIdentity:message.stockIdentity}:undefined)');
wix = replace(wix,"    if(['FULFILMENT_READ_REQUEST','FULFILMENT_SAVE_REQUEST'].includes(message.type)){",[
  "    if(message.type==='WAREHOUSE_DISPATCH_RESUME_REQUEST'){",
  "      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||!message.requestId||message.requestId.length>100||JSON.stringify(message).length>1000)return;",
  "      try{const result=await getCustomerFulfilment(message.company,{resume:'WAREHOUSE_DISPATCH_V1'});room.postMessage({type:'WAREHOUSE_DISPATCH_RESUME_RESULT',company:message.company,requestId:message.requestId,ok:result?.ok===true,result});}",
  "      catch(_){room.postMessage({type:'WAREHOUSE_DISPATCH_RESUME_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Original dispatch identity unconfirmed.'});}return;",
  "    }",
  "    if(['FULFILMENT_READ_REQUEST','FULFILMENT_SAVE_REQUEST'].includes(message.type)){"
].join('\n'));
wix = replace(wix,'await saveCustomerShipment(message.company,message.requestId,message.input)',
  'await saveCustomerShipment(message.company,message.requestId,message.input,message.stockProtocol===1?{stockProtocol:1,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration,stockIdentity:message.stockIdentity}:undefined)');
wix = replace(wix,'warehouse-room/?v='+marker,'warehouse-room/?v=20261022-current-warehouse-v2');
files['warehouse-department-page.js'] = wix;
if (process.argv.includes('--check')) {
  for (const [name, source] of Object.entries(files)) if (fs.readFileSync(path.join(out, name), 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Stock UI candidate differs: ' + name);
} else {
  fs.mkdirSync(out, { recursive: true }); for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(out, name), source);
}
process.stdout.write('Current stock UI/relay/Wix candidate overlays ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; production files unchanged\n');
