'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),{fixture}=require('./check-current.cjs'),load=require('../../tests/load-master-module.cjs');
const {projectPackingWorkroom}=load('packingListOperations.js'),prefix='https://fmcgmalaysia.github.io/fmcg-sales-room-ui/',outer='https://fmcg999.wixstudio.com/fixture-support-roundtrip';
(async()=>{const {assets}=require(process.env.SUPPORT_RELEASE_RECIPE||'./stage.cjs').plan(),f=fixture(),context=await f.context(),reads=[],errors=[],blocked=[];
 const source=assets.get('support-room/workroom.js').toString(),line=source.split('\n').find(row=>row.includes('try{const ref=new URL('));
 const origin=(ancestor,referrer)=>vm.runInNewContext("let parentOrigin='';"+line+';parentOrigin',{URL,location:{ancestorOrigins:ancestor?[ancestor]:[]},document:{referrer}});
 assert.equal(origin('https://fmcg999.wixstudio.com','https://fmcgmalaysia.github.io/previous'),'https://fmcg999.wixstudio.com');
 assert.equal(origin('https://evil.example','https://fmcg999.wixstudio.com'),'');
 assert.equal(origin(null,'https://fmcg999.wixstudio.com/master'),'https://fmcg999.wixstudio.com');
 assert.equal(origin(null,'https://evil.example'),'');assert(source.includes('event.source!==parent||event.origin!==parentOrigin'));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
 try{const page=await browser.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('readFixture',async message=>{
   if(!message.type.endsWith('_REQUEST'))return null;
   if(message.type==='TASK_CHAT_LIST_REQUEST')return {type:'TASK_CHAT_LIST_RESULT',company:message.company,department:message.department,requestId:message.requestId,ok:true,result:{company:message.company,department:message.department,threads:[],staffId:'S'}};
   assert(message.type.endsWith('_READ_REQUEST'),'Only read messages allowed: '+message.type);reads.push(message.type);
   const company=message.company;let result={company,version:'V'};
   if(message.type==='FULFILMENT_READ_REQUEST')result={...result,staff:{staffName:'Synthetic'},customers:context.customers,lines:context.tasks.map(t=>({taskId:t.id,customerId:t.customerId,orderId:t.orderId,currency:'USD',requested:100,originalRequested:100,allocated:t.inc,sellingPriceCtn:24})),shipments:[],customerAccount:{entries:[]}};
   if(message.type==='PACKING_READ_REQUEST')result={...projectPackingWorkroom(await f.packingContext(company),'SUPPORT'),department:'SUPPORT',staff:{staffName:'Synthetic'}};
   if(message.type==='SUPPORT_BOOKING_READ_REQUEST')result={...result,bookings:[],desks:[]};
   if(message.type==='SUPPORT_INVOICE_READ_REQUEST')result={...result,lines:[]};
   if(message.type==='SUPPORT_DOCUMENT_READ_REQUEST')result={...result,documents:[]};
   if(message.type==='SUPPORT_CUSTOMER_READ_REQUEST')result={...result,customers:context.customers};
   return {type:message.type.replace('_REQUEST','_RESULT'),company,requestId:message.requestId,ok:true,result};
  });
  await page.route('**/*',route=>{const url=route.request().url();
   if(url===outer)return route.fulfill({contentType:'text/html',body:'<!doctype html><script>addEventListener("message",async e=>{if(e.origin!=="https://fmcgmalaysia.github.io")return;const response=await window.readFixture(e.data);if(response)e.source.postMessage(response,e.origin);});</script><iframe style="width:1200px;height:900px" src="'+prefix+'support-room/'+(process.env.SUPPORT_INITIAL_PAGE||'workroom.html')+'?live=1&department=SUPPORT&company=NCT"></iframe>'});
   if(url.startsWith(prefix)){const name=new URL(url).pathname.slice('/fmcg-sales-room-ui/'.length),bytes=assets.get(name);if(bytes)return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html',body:name.endsWith('.css')?bytes.toString().replace(/@font-face\s*\{[^}]*\}/g,''):bytes});}
   blocked.push(url);return route.abort();
  });
  await page.goto(outer);const frame=page.frameLocator('iframe');await frame.locator('#count').filter({hasText:'2 customers'}).waitFor();
  await frame.locator('#packing').click();await frame.locator('#count').filter({hasText:'2 rows'}).waitFor();
  await frame.locator('#support-return').click();await frame.locator('#count').filter({hasText:'2 customers'}).waitFor();
  assert.equal(await frame.locator('#notice').innerText(),'');assert.equal(reads.filter(type=>type==='FULFILMENT_READ_REQUEST').length,2);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  const report={at:new Date().toISOString(),environment:'ISOLATED_ACTUAL_STAGED_BROWSER_PAGES',entry:process.env.SUPPORT_INITIAL_PAGE||'workroom.html',roundtrip:'Real Support workroom → real Packing → real Support workroom',customersBefore:2,customersAfter:2,fulfilmentReads:2,originGuardCases:4,eventSourceGuardPreserved:true,browserErrors:errors,externalRequests:0,productionWrites:0};
  if(process.argv[2])fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
