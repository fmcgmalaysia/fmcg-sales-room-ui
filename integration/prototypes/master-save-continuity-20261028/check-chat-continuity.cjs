'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),repo=path.resolve(__dirname,'../../..');
const baseline=process.env.MASTER_BASELINE_DIR&&fs.readFileSync(path.join(process.env.MASTER_BASELINE_DIR,'master-shared/task-chat.js'),'utf8'),candidate=fs.readFileSync(path.join(repo,'master-shared/task-chat.js'),'utf8');
const configs=[{department:'PURCHASE',title:'Purchase Department',peer:'ACCOUNT'},{department:'ACCOUNT',title:'Account Department',nav:'Account navigation',peer:'PURCHASE'},{department:'WAREHOUSE',title:'Warehouse Department',nav:'Warehouse navigation',peer:'SUPPORT'},{department:'SUPPORT',title:'Support Department',peer:'WAREHOUSE'},{department:'SUPPORT_PACKING',title:'Support Packing',peer:'WAREHOUSE'}];
async function check(browser,source,config,isBaseline){
 const page=await browser.newPage(),errors=[],calls=[],waiting=[];let sequence=0,failNext=false,holdSaves=false,heldSave,external=0;const messages=[],taskId='a'.repeat(32),dept=config.department==='SUPPORT_PACKING'?'SUPPORT':config.department;
 const summary=()=>({kind:'PO',taskId,peer:config.peer,number:'FIXTURE',title:'Synthetic',sequence,unread:0});
 await page.route('**/*',route=>{if(route.request().url()==='https://chat-fixture.example/')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>'+config.title+'</title>'+(config.nav?'<nav aria-label="'+config.nav+'"></nav>':'')+'<select id="company"><option>NCT</option></select><main></main>'});external++;return route.abort();});
 await page.exposeFunction('continuityBridge',async m=>{calls.push(m);let result;
  if(m.type==='TASK_CHAT_LIST_REQUEST')result={company:'NCT',department:dept,staff:{staffId:'SELF'},threads:[summary()],legacyArchive:[]};
  else if(m.type==='TASK_CHAT_PAGE_REQUEST'){result={messages:structuredClone(messages),before:null,summary:summary(),updates:[]};if(sequence)await new Promise(resolve=>waiting.push(resolve));}
  else if(m.type==='TASK_CHAT_SAVE_REQUEST'){
   if(failNext){failNext=false;return {ok:false,error:'Synthetic unconfirmed save'};}
   if(holdSaves)await new Promise(resolve=>heldSave=resolve);
   if(m.input.action==='SEND'){sequence++;messages.push({id:'M'+sequence,from:dept,to:[config.peer],body:m.input.body,by:'Self',byStaffId:'SELF',sequence,at:'2026-10-28T00:00:0'+sequence+'Z',receipts:[]});}
   result={taskId,peer:config.peer,summary:summary()};
  }else throw Error('Unexpected request');return {ok:true,result};
 });
 await page.goto('https://chat-fixture.example/');page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(5000);
 await page.evaluate(()=>{window.IntersectionObserver=class{observe(){}disconnect(){}};window.addEventListener('message',async e=>{const m=e.data;if(e.source!==window||!m?.type?.endsWith('_REQUEST'))return;window.postMessage({type:m.type.replace('_REQUEST','_RESULT'),company:m.company,department:m.department,requestId:m.requestId,...await window.continuityBridge(m)},'*');});});
 await page.addScriptTag({content:source});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 await page.evaluate(({id,peer})=>{document.querySelector('main').innerHTML=window.departmentMessages.cell({id},'',peer);},{id:taskId,peer:config.peer});
 await page.locator('[data-tc-key]').click();await page.getByText('No messages yet. 暂无留言。',{exact:true}).or(page.getByText('No messages yet.',{exact:true})).waitFor();
 await page.locator('textarea').fill('First');await page.locator('[data-tc-send]').click();
 for(let n=0;n<4;n++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 assert.equal(waiting.length,1);const blocked=!(await page.locator('textarea').isEnabled());assert.equal(blocked,isBaseline);
 if(isBaseline){waiting.shift()();await page.close();return {consumer:config.department,blockedWhileHistoryPending:true};}
 await page.locator('textarea').fill('Second');await page.locator('[data-tc-send]').click();
 for(let n=0;n<4;n++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 assert.equal(waiting.length,2);assert.equal(await page.locator('textarea').isEnabled(),true);await page.locator('textarea').fill('Third unsent draft');
 waiting.pop()();await page.getByText('Second',{exact:true}).waitFor();waiting.shift()();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 assert.equal(await page.locator('textarea').inputValue(),'Third unsent draft');assert.equal(await page.getByText('First',{exact:true}).count(),1);assert.equal(await page.getByText('Second',{exact:true}).count(),1);
 failNext=true;await page.locator('[data-tc-send]').click();await page.locator('[data-tc-retry]').waitFor();assert.equal(await page.locator('textarea').isEnabled(),false);const uncertain=calls.at(-1);
 await page.locator('[data-tc-close]').click();assert.equal(await page.locator('dialog').evaluate(e=>e.open),true,'Unconfirmed save remains protected');
 await page.locator('[data-tc-retry]').click();for(let n=0;n<4;n++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 assert.equal(await page.locator('textarea').isEnabled(),true);const retry=calls.filter(m=>m.type==='TASK_CHAT_SAVE_REQUEST').at(-1);assert.equal(retry.requestId,uncertain.requestId);assert.deepEqual(retry.input,uncertain.input);
 await page.locator('textarea').fill('Draft retained while closing');await page.locator('[data-tc-close]').click();assert.equal(await page.locator('dialog').evaluate(e=>e.open),false);
 waiting.shift()();await page.locator('[data-tc-key]').click();for(let n=0;n<3;n++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));waiting.shift()();
 await page.getByText('Third unsent draft',{exact:true}).waitFor();assert.equal(await page.locator('textarea').inputValue(),'Draft retained while closing');assert.deepEqual(errors,[]);assert.equal(external,0);
 await page.close();return {consumer:config.department,blockedWhileHistoryPending:false,lateReadIgnored:true,nextDraftPreserved:true,retryIdentityExact:true,unconfirmedCloseBlocked:true,confirmedCloseAllowed:true,reopenDraftPreserved:true,pageErrors:0,realExternalRequests:0};
}
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})}),results=[];try{for(const config of configs){const before=baseline?await check(browser,baseline,config,true):null,after=await check(browser,candidate,config,false);results.push({before,after});}}finally{await browser.close();}console.log(JSON.stringify({cases:results.length,results}));})().catch(error=>{console.error(error);process.exitCode=1;});
