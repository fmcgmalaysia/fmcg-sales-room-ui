const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const [original,target,relay]=process.argv.slice(2);
if(!original||!target||!relay) throw Error('Provide the verified Pages baseline, a new candidate directory and the verified Finance Wix page.');
function verified(file,hash){
 const data=fs.readFileSync(file);
 assert.equal(crypto.createHash('sha256').update(data).digest('hex'),hash,file);
 return data.toString();
}
function once(text,old,next){assert.equal(text.split(old).length,2,old);return text.replace(old,()=>next);}
const index=verified(path.join(original,'account-room/index.html'),'46ff3fb54d24e6a6213242efef9b2606f22bac6f333068200a19f1b641850649');
verified(path.join(original,'account-room/stock-list-link.js'),'592d87d7c85a2ebe34012bdd69f81bebb45bbdd79b5ae47205e1bf51d5be4aac');
verified(path.join(original,'master-shared/stock-exceptions.js'),'0e5b70f92ef821f3d245cfd90b61ca91447737fc2e888f3c37d9c0569e7e0aee');
let page=verified(relay,'dd34fec4b1111ca48362687939cc6001b0a11f27c06bb71ef9354436a06b2cec');
page=once(page,"import { getFinanceStockList }","import { readFinanceInventoryOutlook } from 'backend/financeInventoryOutlook.web';\nimport { getFinanceStockList }");
page=once(page,"    if(message.type==='FINANCE_STOCK_LIST_READ_REQUEST')",`    if(message.type==='FINANCE_INVENTORY_OUTLOOK_REQUEST'){
      const {company,requestId,asOf,month}=message;
      if(!['NCT','GHR'].includes(company)||typeof requestId!=='string'||requestId.length!==36||JSON.stringify(message).length>500)return;
      const base={company,requestId,type:'FINANCE_INVENTORY_OUTLOOK_RESULT'};
      try{room.postMessage({...base,ok:true,result:await readFinanceInventoryOutlook(company,asOf,month)});}
      catch(error){room.postMessage({...base,ok:false,review:/requires review|requires reconciliation/i.test(error?.message||'')});}return;
    }
    if(message.type==='FINANCE_STOCK_LIST_READ_REQUEST')`);
let html=once(index,'data-view="stock">Stock List','data-view="stock">Inventory');
html=once(html,'<main id="app">',`<div id="inventoryViews" aria-label="Inventory views" hidden><button data-pane="list">Stock List</button><button data-pane="outlook">Month-End Outlook</button></div>
<section id="inventoryReport" hidden><h1>Month-End Outlook</h1><div class="outlook-filters"><label>Stock as of<input type="date" required></label><label>Shipment month<input type="month" required></label><button type="button" data-read>Refresh</button></div><div data-output aria-live="polite"></div></section><main id="app">`);
html=once(html,'</head>','<link rel="stylesheet" href="inventory-outlook.css?v=20261128-outlook-v1"></head>');
html=once(html,'</body>','<script src="inventory-outlook.js?v=20261128-outlook-v1"></script></body>');
fs.mkdirSync(target);
const pages=path.join(target,'pages');
fs.cpSync(original,pages,{recursive:true,errorOnExist:true,force:false});
fs.writeFileSync(path.join(pages,'account-room/index.html'),html);
for(const f of ['inventory-outlook.css','inventory-outlook.js'])fs.copyFileSync(path.join(__dirname,'../account-room',f),path.join(pages,'account-room',f),fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(target,'finance-page-candidate.js'),page);
