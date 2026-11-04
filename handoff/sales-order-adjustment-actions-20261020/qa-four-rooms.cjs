// Actual four frontend runtimes, synthetic messages only. Never connects to Wix or CMS.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'../..');
(async()=>{
 let fixture=fs.readFileSync(path.join(root,'handoff/sales-split-rows-20261019/preview.html'),'utf8');
 fixture=fixture.replace("planVersion:plan?'P2':'P1'","originalRequested:line.quantityCtn,adjustmentVersion:'ADJ',planVersion:plan?'P2':'P1'");
 // READ carries Original Qty on the line, not on the result envelope.
 fixture=fixture.replace("requested:500}],plans:","requested:line.quantityCtn,originalRequested:line.quantityCtn}],plans:");
 const start=fixture.indexOf("else if(m.action==='PLAN')"),end=fixture.indexOf("\n }\n if(['BUYER_ROOM",start);assert.ok(start>0&&end>start);
 fixture=fixture.slice(0,start)+`else if(m.action==='ADJUST'){
  if(!replies.has(m.requestId)){
   if(!plan)plan={id:'PLAN',customerId:customer.customerId,orderId:order.orderId,batches:[{sequence:1,label:'This shipment',lines:[{taskId:'TASK',quantity:500}]}]};
   const batch=plan.batches.find(b=>'PLAN|'+b.sequence===m.input.batchId)||plan.batches[0],before=batch.lines[0].quantity,n=m.input.quantity;
   if(m.input.mode==='SPLIT'){batch.lines[0].quantity=n;plan.batches.push({sequence:2,label:'Next shipment',lines:[{taskId:'TASK',quantity:before-n}]});}
   else batch.lines[0].quantity+=m.input.mode==='INCREASE'?n:-n;
   line.quantityCtn=plan.batches.reduce((sum,b)=>sum+b.lines[0].quantity,0);task.ord=line.quantityCtn;line.requestedQtyCtn=line.quantityCtn;
   plan.at=new Date().toISOString();plan.by='LAW';line.shipmentBatches=plan.batches.map(b=>({id:'PLAN|'+b.sequence,label:b.label,quantity:b.lines[0].quantity,metrics:{committed:Math.min(b.lines[0].quantity,b.sequence===1?300:200),received:0},at:plan.at,by:plan.by}));replies.set(m.requestId,true);
  }reply(event.source,'SALES_ROOM_SHIPMENT_RESULT',m,{result:{ok:true}});
 }`+fixture.slice(end);
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1540,height:940}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!=='http://127.0.0.1:8952')return route.abort();const pathname=decodeURIComponent(url.pathname);if(pathname==='/preview.html')return route.fulfill({contentType:'text/html',body:fixture.replaceAll('src="../../','src="/')});const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});const ext=path.extname(file);return route.fulfill({contentType:ext==='.js'?'application/javascript':ext==='.css'?'text/css':ext==='.html'?'text/html':'application/octet-stream',body:fs.readFileSync(file)});});
 await page.goto('http://127.0.0.1:8952/preview.html');const sales=page.frameLocator('#sales');await sales.locator('[data-view="order-progress"]').click();await sales.locator('#progressCustomerTrigger').click();await sales.locator('[data-progress-customer="SPLIT-DEMO"]').click();
 await sales.locator('.sales-requested-capsule').click();await sales.locator('[data-mode="SPLIT"]').click();await sales.locator('[data-first]').fill('300');await sales.locator('[data-save]').click();await sales.locator('.sales-requested-capsule').filter({hasText:'300'}).waitFor();assert.equal(await sales.locator('.sales-requested-capsule').count(),2);
 await sales.locator('.sales-requested-capsule').filter({hasText:'300'}).click();await sales.locator('[data-mode="INCREASE"]').click();await sales.locator('[data-first]').fill('50');await sales.locator('[data-save]').click();await sales.locator('.sales-requested-capsule').filter({hasText:'350'}).waitFor();assert.equal(await sales.locator('.sales-requested-capsule').filter({hasText:'200'}).count(),1);
 await sales.locator('.sales-requested-capsule').filter({hasText:'350'}).click();await sales.locator('[data-mode="REDUCE"]').click();await sales.locator('[data-first]').fill('20');await sales.locator('[data-save]').click();await sales.locator('.sales-requested-capsule').filter({hasText:'330'}).waitFor();await page.screenshot({path:path.join(__dirname,'four-rooms-sales.png')});
 await page.locator('[data-room="purchase"]').click();const purchase=page.frameLocator('#purchase');await purchase.locator('[data-view="active"]').click();await purchase.locator('#refresh').click();await purchase.locator('.split-demand-row').first().waitFor();assert.equal(await purchase.locator('.split-demand-row').count(),2);assert.equal(await purchase.locator('.split-origin-link').count(),1);await page.screenshot({path:path.join(__dirname,'four-rooms-purchase.png')});
 await page.locator('[data-room="warehouse"]').click();const warehouse=page.frameLocator('#warehouse');await warehouse.locator('[data-view="customers"]').click();await warehouse.locator('#refresh').click();await warehouse.locator('.wh-delivery tbody tr').filter({hasText:'330'}).waitFor();assert.equal(await warehouse.locator('.wh-delivery tbody tr').count(),2);await page.screenshot({path:path.join(__dirname,'four-rooms-warehouse.png')});
 await page.locator('[data-room="buyer"]').click();const buyer=page.frameLocator('#buyer');await buyer.locator('[data-view="track"]').click();await buyer.locator('.tracking-row').filter({hasText:'This shipment'}).waitFor();assert.equal(await buyer.locator('#trackRows .tracking-row').count(),2);await page.screenshot({path:path.join(__dirname,'four-rooms-buyer.png')});assert.deepEqual(errors,[]);await browser.close();console.log('PASS actual four-room frontends: split500=300+200, first increase350+200, first cancel330+200; all views two rows. Synthetic transport only.');
})().catch(error=>{console.error(error);process.exit(1)});
