const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict'), {test}=require('node:test');
const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {patchPublishSwitch}=require('../quotation-publish-switch-20261119/patch.cjs');
const {patchCostRead}=require('./patch.cjs');
const app=patchCostRead(patchPublishSwitch(fs.readFileSync(path.join(__dirname,'../../releases/quote-buyer-sales-catalogue/master-quotations/app.js'),'utf8').replace(/\r\n/g,'\n')));
const baseline='C:/FMCG-WIX-LOCAL/handoff/quote-date-feedback-20261119/rehearsal/master-quotations';

for(const width of [1024,1440]) test(`${width}px / 1000 selections: cost recovery retains the table, focus, local prices and publication dates`,async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width,height:900}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const rows=Array.from({length:1000},(_,i)=>({id:'SEL-'+i,barcode:String(9000000000000+i),name:'Product '+i,packing:'24 EA',ea:24,revision:3,
    sortId:String(i+1).padStart(4,'0'),costMyr:48,costAt:'2026-11-18T00:00:00Z',costDetails:{lpEa:2,lpCtn:48,disc1:0,disc2:0,disc3:0,remark:'Original'},
    ...(i===0?{published:{enabled:true,priceEa:1,priceCtn:24,currency:'USD',version:2,publishedAt:'2026-11-19T04:30:00Z'}}:{})}));
  const workspace={staffId:'FAKE',canEdit:true,canPublish:true,customer:{customerId:'FAKE-CUSTOMER',preferredCurrency:'USD',rateToMyr:4,fullName:'Fake QA Customer'},rows};
  const parent=`<iframe src="https://cost-fixture.invalid/index.html" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe><script>
   const workspace=${JSON.stringify(workspace)}; window.calls=[];
   addEventListener('message',e=>{const m=e.data;if(m?.type!=='MASTER_QUOTATION_REQUEST')return;calls.push(m);
    let result;
    if(m.action==='customers')result={staffId:'FAKE',staffName:'QA SALES',customers:[{customerId:'FAKE-CUSTOMER',name:'FAKE'}]};
    else if(m.action==='quotes')result=workspace;
    else if(m.action==='cost')result={pending:true};
    else if(m.action==='cost-status') {
     window.releaseCost=()=>{for(const row of workspace.rows){row.costMyr=60;row.costAt='2026-11-19T06:00:00Z';row.costDetails={...row.costDetails,lpEa:2.5,lpCtn:60,remark:'Fresh'};}
      e.source.postMessage({...m,type:'MASTER_QUOTATION_RESULT',ok:true,result:{pending:false,updated:999,unchanged:0,failed:1}},e.origin);};return;
    } else throw Error('Unexpected write '+m.action);
    e.source.postMessage({...m,type:'MASTER_QUOTATION_RESULT',ok:true,result},e.origin);
   });</script>`;
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='www.ltpos.ai')return route.fulfill({contentType:'text/html',body:parent});
   if(url.hostname==='cost-fixture.invalid') {
    if(url.pathname==='/app.js')return route.fulfill({contentType:'text/javascript',body:app});
    return route.fulfill({path:path.join(baseline,path.basename(url.pathname))});
   }
   return route.abort();
  });
  await page.goto('https://www.ltpos.ai/fixture');
  const frame=page.frameLocator('iframe'), first=frame.locator('tr[data-row="SEL-0"]');
  await first.waitFor();
  assert(await frame.locator('tr[data-row]').count()<100,'Virtual rows stay bounded');
  await frame.locator('.quote-grid table').evaluate(e=>e.dataset.retained='yes');
  await frame.locator('#catch-cost').click();
  const edit=frame.locator('tr[data-row="SEL-1"] [data-mode=EA]');
  await edit.fill('5.2'); await edit.press('Enter');
  assert.equal(await edit.inputValue(),'5.20');
  await edit.click();
  await page.waitForFunction(()=>typeof window.releaseCost==='function');
  await page.evaluate(()=>window.releaseCost());
  await frame.locator('#notice').filter({hasText:'999 updated'}).waitFor();
  assert.equal(await frame.locator('.quote-grid table').getAttribute('data-retained'),'yes');
  assert.equal(await edit.inputValue(),'5.20');
  assert(await edit.evaluate(e=>e===document.activeElement));
  assert.equal(await first.locator('[data-action=toggle]').getAttribute('aria-checked'),'true');
  assert.match(await first.locator('.quote-label').innerText(),/19-11-26/);
  assert.match(await frame.locator('tr[data-row="SEL-1"] [data-profit]').innerText(),/87.98%/);
  assert.match(await frame.locator('tr[data-row="SEL-1"] .remark-cell').innerText(),/Fresh/);
  assert(await frame.locator('#catch-cost').isEnabled());
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='cost').length),1);
  assert.equal(await page.evaluate(()=>calls.filter(c=>['draft','publish'].includes(c.action)).length),0);
  assert.deepEqual(errors,[]);
  fs.mkdirSync(path.join(__dirname,'evidence'),{recursive:true});
  await page.screenshot({path:path.join(__dirname,'evidence',`cost-recovered-${width}.png`)});
 } finally {await browser.close();}
});
