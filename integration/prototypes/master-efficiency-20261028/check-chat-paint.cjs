'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'../../..');
const baseline=process.env.MASTER_BASELINE_DIR;
if(!baseline)throw Error('MASTER_BASELINE_DIR must name the captured current public resources');
const configs=[
 {department:'PURCHASE',title:'Purchase Department',kind:'PO',peer:'ACCOUNT'},
 {department:'ACCOUNT',title:'Account Department',nav:'Account navigation',kind:'PO',peer:'PURCHASE'},
 {department:'WAREHOUSE',title:'Warehouse Department',nav:'Warehouse navigation',kind:'DELIVERY',peer:'SUPPORT'},
 {department:'SUPPORT',title:'Support Department',kind:'DELIVERY',peer:'WAREHOUSE',sources:true},
 {department:'SUPPORT',title:'Support Packing Lists',kind:'DELIVERY',peer:'WAREHOUSE',sources:true,packing:true}
];
const peerCode={ACCOUNT:'ACC',PURCHASE:'P',WAREHOUSE:'W',SUPPORT:'S'};
async function inspect(browser,source,config,count){
 const page=await browser.newPage(),errors=[];page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
 let externalRequests=0;
 const html='<!doctype html><title>'+config.title+'</title>'+(config.nav?'<nav aria-label="'+config.nav+'"></nav>':'')+'<select id="company"><option>NCT</option><option>GHR</option></select><main></main>';
 await page.route('**/*',route=>{if(route.request().url()==='https://master-fixture.example/')return route.fulfill({contentType:'text/html',body:html});externalRequests++;return route.abort();});
 await page.goto('https://master-fixture.example/');
 await page.evaluate(({config,count})=>{
  const originalQuery=document.querySelectorAll.bind(document),descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  window.paintProbe={scans:0,writes:0,calls:[]};
  document.querySelectorAll=function(selector){if(selector==='[data-tc-cell]')window.paintProbe.scans++;return originalQuery(selector);};
  Object.defineProperty(Element.prototype,'innerHTML',{...descriptor,set(value){if(this.matches('[data-tc-cell]'))window.paintProbe.writes++;descriptor.set.call(this,value);}});
  const thread=(index,company='NCT')=>({kind:config.kind,taskId:'T'+index,sourceTaskId:'S'+index,sourceTaskIds:['S'+index],peer:config.peer,number:'TEST-'+index,title:'Sample '+index,unread:1,sequence:1,updatedAt:'2026-10-28T00:00:00Z',lastIncoming:{body:company+' sample <'+index+'> & checked',from:config.peer,at:'2026-10-28T00:00:00Z'}});
  window.addEventListener('message',event=>{
   const m=event.data;if(event.source!==window||!m?.type?.endsWith('_REQUEST'))return;
   window.paintProbe.calls.push({type:m.type,company:m.company,action:m.input?.action});
   let result;
   if(m.type==='TASK_CHAT_LIST_REQUEST')result={company:m.company,department:config.department,staff:{staffId:'FIXTURE'},threads:Array.from({length:count},(_,i)=>thread(i,m.company)),legacyArchive:[],nextHistory:null};
   else if(m.type==='TASK_CHAT_PAGE_REQUEST')result={messages:[],before:null,readOnly:false,summary:thread(Number(m.input.taskId.slice(1)),m.company),updates:[]};
   else if(m.type==='TASK_CHAT_SAVE_REQUEST')throw Error('Unexpected write in read-only repaint test');
   else return;
   window.postMessage({type:m.type.replace('_REQUEST','_RESULT'),company:m.company,department:m.department,requestId:m.requestId,ok:true,result},'*');
  });
 },{config,count});
 await page.addScriptTag({content:source});
 await page.waitForFunction(()=>window.paintProbe.calls.some(call=>call.type==='TASK_CHAT_LIST_REQUEST'));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.evaluate(({config,count})=>{
  window.paintProbe.scans=0;window.paintProbe.writes=0;
  document.querySelector('main').innerHTML=Array.from({length:count},(_,i)=>config.sources?window.departmentMessages.sourceCell(['S'+i]):window.departmentMessages.cell({id:'T'+i},'',config.peer,config.kind)).join('');
 },{config,count});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const painted=await page.evaluate(()=>({scans:window.paintProbe.scans,writes:window.paintProbe.writes,html:[...document.querySelectorAll('[data-tc-cell]')].map(el=>el.innerHTML),listRequests:window.paintProbe.calls.filter(c=>c.type==='TASK_CHAT_LIST_REQUEST').length}));
 assert.equal(painted.html.length,count);assert.equal(painted.listRequests,1);
 assert.ok(painted.html.every(html=>html.includes('&lt;')&&html.includes('&amp;')&&html.includes('tc-badge')));
 await page.evaluate(()=>{window.paintProbe.scans=0;window.paintProbe.writes=0;});
 await page.evaluate(()=>window.departmentMessages.refresh());
 const unchanged=await page.evaluate(()=>({scans:window.paintProbe.scans,writes:window.paintProbe.writes}));
 assert.deepEqual(await page.locator('[data-tc-cell]').evaluateAll(cells=>cells.map(el=>el.innerHTML)),painted.html);
 await page.getByRole('button',{name:new RegExp('^Message(?: 留言)? '+peerCode[config.peer]+'$')}).first().click();
 await page.getByText('No messages yet.',{exact:config.department==='ACCOUNT'}).waitFor().catch(async()=>{
  await page.locator('.tc-empty').filter({hasText:'No messages yet.'}).waitFor();
 });
 assert.equal(await page.locator('.tc-dialog').evaluate(el=>el.open),true);
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.locator('#company').selectOption('GHR');
 await page.waitForFunction(()=>window.paintProbe.calls.some(call=>call.type==='TASK_CHAT_LIST_REQUEST'&&call.company==='GHR'));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const companyText=await page.locator('[data-tc-cell]').first().innerText();
 assert.match(companyText,/GHR sample/);assert.doesNotMatch(companyText,/NCT sample/);
 assert.deepEqual(errors,[]);assert.equal(externalRequests,0);
 const calls=await page.evaluate(()=>window.paintProbe.calls);
 assert.equal(calls.filter(call=>call.type==='TASK_CHAT_SAVE_REQUEST').length,0);
 await page.close();return {...painted,unchangedRefreshWrites:unchanged.writes,companySwitch:true,openClose:true,externalRequests,pageErrors:errors.length};
}
(async()=>{
 const before=fs.readFileSync(path.join(baseline,'master-shared/task-chat.js'),'utf8'),after=fs.readFileSync(path.join(repo,'master-shared/task-chat.js'),'utf8');
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const results=[];
 try{for(const config of configs){const count=100,a=await inspect(browser,before,config,count),b=await inspect(browser,after,config,count);
  assert.deepEqual(b.html,a.html,'Visible cell markup must remain exact: '+config.title);
  if(process.env.EXPECT_OPTIMIZED==='1'){assert.ok(b.scans<=2,'At most two scans including the one inbox host mutation');assert.ok(a.scans>=count,'The public baseline must reproduce per-cell scans');assert.equal(b.unchangedRefreshWrites,0);}
  results.push({consumer:config.title,cells:count,baselineScans:a.scans,candidateScans:b.scans,baselineWrites:a.writes,candidateWrites:b.writes,baselineUnchangedRefreshWrites:a.unchangedRefreshWrites,candidateUnchangedRefreshWrites:b.unchangedRefreshWrites,cellMarkupExact:true,companySwitch:true,openClose:true,realExternalRequests:0,pageErrors:0});
 }}finally{await browser.close();}
 const output={results,totalCases:results.length,optimized:process.env.EXPECT_OPTIMIZED==='1'};
 if(process.env.MASTER_EFFICIENCY_RESULT)fs.writeFileSync(process.env.MASTER_EFFICIENCY_RESULT,JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify(output));
})().catch(error=>{console.error(error);process.exitCode=1;});
