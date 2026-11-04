const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'../..'),escape=value=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:900,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:8951/',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto('http://127.0.0.1:8951/');
 const runtime=fs.readFileSync(path.join(root,'sales-room/order-adjustment.js'),'utf8'),css=fs.readFileSync(path.join(root,'sales-room/order-adjustment.css'),'utf8');
 const child='<style>'+css+'</style><button id="open">Adjust sample quantity</button><script>window.customerShipmentBatches={notify:()=>{}};'+runtime+';document.getElementById("open").onclick=()=>window.salesOrderAdjustment.open({company:"NCT",customerId:"C",orderId:"O",lineId:"L",batchId:"P|1",name:"SAMPLE PRODUCT",barcode:"SAMPLE",quantity:500});</script>';
 const result={adjustmentVersion:'V',lines:[{taskId:'T',orderId:'O',sourceLineId:'L',requested:500,originalRequested:500}],plans:[{id:'P',orderId:'O',batches:[{sequence:1,lines:[{taskId:'T',quantity:300}]},{sequence:2,lines:[{taskId:'T',quantity:200}]}]}]};
 await page.setContent('<script>window.requests=[];window.addEventListener("message",event=>{const m=event.data;if(m?.type!=="SALES_ROOM_SHIPMENT_REQUEST")return;window.requests.push(m);event.source.postMessage({type:"SALES_ROOM_SHIPMENT_RESULT",company:m.company,requestId:m.requestId,ok:true,result:m.action==="READ"?'+JSON.stringify(result)+':{ok:true}},"*");});</script><iframe style="border:0;width:100%;height:620px" srcdoc="'+escape(child)+'"></iframe>');
 const frame=page.frameLocator('iframe');
 for(const [mode,qty,expected] of [['INCREASE','50','350'],['SPLIT','200','100'],['REDUCE','50','250']]){
  await frame.locator('#open').click();await frame.locator('[data-mode="'+mode+'"]').click();assert.equal(await frame.locator('.adjustment-row strong').first().innerText(),'300');
  const input=frame.locator('[data-first]'),save=frame.locator('[data-save]');for(const n of ['0','-1','1.5']){await input.fill(n);assert.ok(await save.isDisabled());}
  if(mode!=='INCREASE'){await input.fill('300');assert.ok(await save.isDisabled());}
  await input.fill(qty);assert.equal(await frame.locator('[data-next]').innerText(),expected);assert.ok(await save.isEnabled());
  assert.ok((await frame.locator('dialog').boundingBox()).width<=382);await frame.locator('dialog').screenshot({path:path.join(__dirname,'candidate-'+mode.toLowerCase()+'.png')});
  await save.click();await frame.locator('dialog').waitFor({state:'hidden'});const messages=await page.evaluate(()=>window.requests.filter(m=>m.action==='ADJUST'));const message=messages.at(-1);assert.equal(message.input.mode,mode);assert.equal(message.input.batchId,'P|1');assert.equal(message.input.quantity,Number(qty));
 }
 await frame.locator('#open').click();await frame.locator('[data-mode="INCREASE"]').click();await frame.locator('[data-back]').click();assert.equal(await frame.locator('[data-mode]').count(),3);await frame.locator('dialog').screenshot({path:path.join(__dirname,'candidate-home.png')});
 await page.setViewportSize({width:360,height:700});assert.ok(await frame.locator('body').evaluate(el=>el.scrollWidth<=el.clientWidth));assert.deepEqual(errors,[]);await browser.close();console.log('PASS actual runtime dialog: two pages, three actions, chosen batch, invalid inputs, exact save payload, back, 380px and mobile layout. Synthetic messages only; no CMS.');
})().catch(error=>{console.error(error);process.exit(1)});
