const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const manifest=require('./finance-inventory-outlook-pages-base.json');
const build='20261128-finance-inventory-outlook-v2';
const [original,target,relay]=process.argv.slice(2);
if(!original||!target) throw Error('Provide the verified Pages baseline and target, or stage-live and target.');
function verified(file,hash){
 const data=fs.readFileSync(file);
 assert.equal(crypto.createHash('sha256').update(data).digest('hex'),hash,file);
 return data.toString();
}
function once(text,old,next){assert.equal(text.split(old).length,2,old);return text.replace(old,()=>next);}
function stageRelay(relayFile, directory) {
let page=verified(relayFile,'dd34fec4b1111ca48362687939cc6001b0a11f27c06bb71ef9354436a06b2cec');
page=once(page,"import { getFinanceStockList }","import { readFinanceInventoryOutlook, readFinanceMonthEnd, previewFinanceMonthEnd, saveFinanceMonthEnd } from 'backend/financeInventoryOutlook.web';\nimport { getFinanceStockList }");
page=once(page,"    if(message.type==='FINANCE_STOCK_LIST_READ_REQUEST')",`    if(message.type==='FINANCE_INVENTORY_OUTLOOK_REQUEST'){
      const {company,requestId,asOf,month,kind,revision}=message;
      if(!['NCT','GHR'].includes(company)||!/^[a-f0-9-]{36}$/i.test(requestId||'')||JSON.stringify(message).length>500)return;
      const base={company,requestId,type:'FINANCE_INVENTORY_OUTLOOK_RESULT'};
      try {
        let result;
        switch(kind) {
          case 'READ': result=await readFinanceInventoryOutlook(company,asOf,month);break;
          case 'ORIGINAL': result=await readFinanceMonthEnd(company,asOf);break;
          case 'PREVIEW': result=await previewFinanceMonthEnd(company,asOf);break;
          case 'SAVE': result=await saveFinanceMonthEnd(company,asOf,revision);break;
          default:return;
        }
        room.postMessage({...base,ok:true,result});
      } catch(error) {
        room.postMessage({...base,ok:false,review:/requires review|requires reconciliation|reconcile stock|closing balance changed/i.test(error?.message||'')});
      }
      return;
    }
    if(message.type==='FINANCE_STOCK_LIST_READ_REQUEST')`);
page=once(page,'account-room/?v=20261117-mobile-menu-icon-v1','account-room/?v='+build);
fs.writeFileSync(path.join(directory,'finance-page-candidate.js'),page,{flag:'wx'});
}
function stagePages(pages){
for(const [file,hash] of Object.entries(manifest))verified(path.join(pages,file),hash);
const index=fs.readFileSync(path.join(pages,'account-room/index.html'),'utf8');
let html=once(index,'data-view="stock">Stock List','data-view="stock">Inventory');
html=once(html,'<main id="app">',`<div id="inventoryViews" aria-label="Inventory views" hidden><button data-pane="list">Stock List</button><button data-pane="outlook">Month-End Outlook</button></div>
<section id="inventoryReport" hidden><h1>Month-End Outlook</h1><div class="outlook-filters"><label>Stock as of<input type="date" required></label><label>Shipment month<input type="month" required></label><button type="button" data-read>Refresh</button><button type="button" data-original disabled>Open original</button><button type="button" data-review-close disabled>Review closing balance</button><button type="button" data-confirm-close hidden>Confirm month-end</button></div><p data-archive-status role="status"></p><div data-output aria-live="polite"></div></section><main id="app">`);
html=once(html,'</head>','<meta name="finance-inventory-build" content="'+build+'"><link rel="stylesheet" href="inventory-outlook.css?v='+build+'"></head>');
html=once(html,'</body>','<script src="inventory-outlook.js?v='+build+'"></script></body>');
fs.writeFileSync(path.join(pages,'account-room/index.html'),html);
for(const f of ['inventory-outlook.css','inventory-outlook.js'])fs.copyFileSync(path.join(__dirname,'../account-room',f),path.join(pages,'account-room',f),fs.constants.COPYFILE_EXCL);
console.log(build+' · one Finance asset patched, two added, '+(Object.keys(manifest).length-1)+' assets preserved.');
}
async function main(){
  if(original!=='stage-live'){
    fs.mkdirSync(target);
    const pages=path.join(target,'pages');
    fs.cpSync(original,pages,{recursive:true,errorOnExist:true,force:false});
    stagePages(pages);
    if(relay)stageRelay(relay,target);
    return;
  }
  fs.mkdirSync(target);
  const entries=Object.keys(manifest);
  for(let index=0;index<entries.length;index+=8)await Promise.all(entries.slice(index,index+8).map(async file=>{
    const response=await fetch('https://fmcgmalaysia.github.io/fmcg-sales-room-ui/'+file+'?verify='+Date.now(),{signal:AbortSignal.timeout(25000),redirect:'error'});
    assert.ok(response.ok,file+' HTTP '+response.status);
    const out=path.join(target,file);
    fs.mkdirSync(path.dirname(out),{recursive:true});
    fs.writeFileSync(out,Buffer.from(await response.arrayBuffer()),{flag:'wx'});
  }));
  stagePages(target);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
