'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),repo=path.resolve(__dirname,'../../..');
if(!process.env.MASTER_BASELINE_DIR)throw Error('MASTER_BASELINE_DIR required');
function state(config,failFirstRead){
 const context={};vm.runInNewContext(fs.readFileSync(path.join(repo,'integration/apps-script/purchase-documents/TaskChatState.gs'),'utf8'),context);
 const heads=new Map(),pages=new Map(),clone=value=>value?JSON.parse(JSON.stringify(value)):null;
 const store={head:key=>clone(heads.get(key)),putHead:(key,value)=>heads.set(key,clone(value)),page:(key,pair,n)=>clone(pages.get(key+pair+n)),putPage:(key,pair,n,value)=>pages.set(key+pair+n,clone(value)),findMessage:(key,pair,id)=>clone([...pages].filter(([k])=>k.startsWith(key+pair)).flatMap(([,p])=>p.messages).find(m=>m.id===id))};
 const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),taskId='a'.repeat(32),pair=[config.department,config.peer].sort().join(':'),self={department:config.department,staffId:'SELF',memberId:'SELF',staffName:'Self'},peer={department:config.peer,staffId:'PEER',memberId:'PEER',staffName:'Peer'};
 const run=(input={})=>clone(context.taskChatRun_(store,{company:'NCT',kind:config.kind,taskId,pair,actor:self,...input},hash,()=> '2026-10-28T00:00:00.000Z'));
 for(let i=1;i<=5;i++)run({operation:'SEND',requestId:'aaaaaaaa-aaaa-4aaa-8aaa-'+String(i).padStart(12,'0'),baseSequence:i-1,body:i<=3?'Incoming '+i:i===4?'Own outgoing':'Own cross department',requiresAck:true,actor:i<=3?peer:i===4?self:{...self,department:config.peer}});
 const legacy={id:'b'.repeat(32),legacy:true,from:config.peer,to:[config.department],by:'Legacy',byStaffId:'OLD',body:'Legacy incoming',at:'2026-10-27T00:00:00.000Z',requiresAck:true,receipts:[]};
 const update={id:'UPDATE',from:config.peer,by:'Peer',body:'System update',at:'2026-10-27T01:00:00.000Z',notify:true};
 const summary=()=>{const s=run({operation:'SUMMARY'}).summary;return {kind:config.kind,taskId,peer:config.peer,number:'FIXTURE',title:'Synthetic task',sequence:s.sequence,updatedAt:'2026-10-28T00:00:00.000Z',unread:s.unread+(s.legacyReadAt?0:1)+(s.systemReadAt?0:1),lastIncoming:s.lastIncoming};};
 const calls=[];let failed=false;
 async function bridge(m){calls.push({type:m.type,action:m.input?.action,sequence:m.input?.sequence});let result;
  if(m.type==='TASK_CHAT_LIST_REQUEST')result={company:'NCT',department:config.department,staff:{staffId:'SELF'},threads:[summary()],legacyArchive:[]};
  else if(m.type==='TASK_CHAT_PAGE_REQUEST')result={messages:[legacy,...run({operation:'PAGE'}).messages],before:null,summary:summary(),updates:[update]};
  else if(m.type==='TASK_CHAT_SAVE_REQUEST'){
   if(failFirstRead&&!failed&&m.input.action==='READ'){failed=true;return {ok:false,error:'Synthetic unconfirmed read'};}
   run({operation:m.input.action,sequence:m.input.sequence,requestId:m.requestId,...(m.input.action==='LEGACY_READ'?{at:legacy.at}:m.input.action==='SYSTEM_READ'?{at:update.at}:{})});result={taskId,peer:config.peer,summary:summary()};
  }else throw Error('Unexpected fixture request');return {ok:true,result};
 }
 return {taskId,calls,bridge,summary,normal:()=>run({operation:'PAGE'}).messages};
}
async function inspect(browser,source,config,scenario){
 const f=state(config,scenario==='failure'),page=await browser.newPage(),errors=[];page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));let external=0;
 const html='<!doctype html><title>'+config.title+'</title>'+(config.nav?'<nav aria-label="'+config.nav+'"></nav>':'')+'<select id="company"><option>NCT</option></select><main></main>';
 await page.route('**/*',route=>{if(route.request().url()==='https://master-fixture.example/')return route.fulfill({contentType:'text/html',body:html});external++;return route.abort();});await page.goto('https://master-fixture.example/');
 await page.exposeFunction('readFixtureBridge',f.bridge);
 await page.evaluate(()=>{
  window.fixtureObservers=[];
  window.IntersectionObserver=class{constructor(callback){this.callback=callback;this.targets=[];window.fixtureObservers.push(this);}observe(target){this.targets.push(target);}disconnect(){this.targets=[];}fire(mode){this.callback(this.targets.map(target=>{const visible=mode!=='partial'||target.textContent.includes('Incoming 1');return {target,isIntersecting:visible,intersectionRatio:visible?1:.5};}));}};
  window.addEventListener('message',async event=>{const m=event.data;if(event.source!==window||!m?.type?.endsWith('_REQUEST'))return;const result=await window.readFixtureBridge(m);window.postMessage({type:m.type.replace('_REQUEST','_RESULT'),company:m.company,department:m.department,requestId:m.requestId,...result},'*');});
 });
 await page.addScriptTag({content:source});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.evaluate(({config,taskId})=>{document.querySelector('main').innerHTML=window.departmentMessages.cell({id:taskId},'',config.peer,config.kind);},{config,taskId:f.taskId});
 await page.locator('[data-tc-key]').click();await page.getByText('Incoming 3',{exact:true}).waitFor();
 await page.evaluate(mode=>window.fixtureObservers.at(-1).fire(mode),scenario==='partial'?'partial':'all');
 // A browser-to-Node round trip lets each serial cursor write and its reply complete.
 for(let i=0;i<8;i++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 if(scenario==='failure'){await page.evaluate(()=>window.fixtureObservers.at(-1).fire('all'));for(let i=0;i<8;i++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));}
 const count=f.calls.filter(c=>c.type==='TASK_CHAT_SAVE_REQUEST').length;
 await page.evaluate(mode=>window.fixtureObservers.at(-1).fire(mode),scenario==='partial'?'partial':'all');for(let i=0;i<3;i++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 assert.equal(f.calls.filter(c=>c.type==='TASK_CHAT_SAVE_REQUEST').length,count,'Seen messages must not be submitted twice');
 assert.equal(f.calls.filter(c=>c.action==='ACK'||c.action==='LEGACY_ACK'||c.action==='SEND').length,0);
 assert.equal(await page.locator('[data-tc-ack]').count(),5,'Read never substitutes for the existing explicit ACK controls');
 assert.deepEqual(errors,[]);assert.equal(external,0);
 const result={saves:f.calls.filter(c=>c.type==='TASK_CHAT_SAVE_REQUEST'),summary:f.summary(),messages:f.normal(),probe:await page.evaluate(()=>({visible:document.visibilityState,open:document.querySelector('.tc-dialog').open,targets:window.fixtureObservers.at(-1).targets.map(e=>({...e.dataset}))}))};await page.close();return result;
}
(async()=>{
 const baseline=fs.readFileSync(path.join(process.env.MASTER_BASELINE_DIR,'master-shared/task-chat.js'),'utf8'),candidate=fs.readFileSync(path.join(repo,'master-shared/task-chat.js'),'utf8');
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})}),results=[];
 const configs=[{department:'PURCHASE',title:'Purchase Department',peer:'ACCOUNT',kind:'PO'},{department:'ACCOUNT',title:'Account Department',nav:'Account navigation',peer:'PURCHASE',kind:'PO'},{department:'WAREHOUSE',title:'Warehouse Department',nav:'Warehouse navigation',peer:'SUPPORT',kind:'DELIVERY'},{department:'SUPPORT',title:'Support Department',peer:'WAREHOUSE',kind:'DELIVERY'}];
 try{for(const config of configs)for(const scenario of ['visible','failure','partial']){const before=await inspect(browser,baseline,config,scenario),after=await inspect(browser,candidate,config,scenario);assert.deepEqual(after.summary,before.summary);assert.deepEqual(after.messages,before.messages);const normal=rows=>rows.filter(r=>r.action==='READ').length;assert.equal(normal(after.saves),scenario==='failure'?2:1,JSON.stringify({config,scenario,before:before.saves,after:after.saves,probe:after.probe}));assert.equal(after.saves.filter(r=>r.action==='LEGACY_READ').length,scenario==='partial'?0:1);assert.equal(after.saves.filter(r=>r.action==='SYSTEM_READ').length,scenario==='partial'?0:1);results.push({department:config.department,scenario,baselineNormalReadRequests:normal(before.saves),candidateNormalReadRequests:normal(after.saves),finalSummaryExact:true,finalMessagesAndReceiptsExact:true,explicitAckPreserved:true,realExternalRequests:0,pageErrors:0});}}finally{await browser.close();}
 const report={cases:results.length,results};if(process.env.MASTER_EFFICIENCY_RESULT)fs.writeFileSync(process.env.MASTER_EFFICIENCY_RESULT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});
