'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),repo=path.resolve(__dirname,'../../..'),baseline=process.env.MASTER_BASELINE_DIR;
if(!baseline)throw Error('MASTER_BASELINE_DIR required');
async function check(browser,actor,candidate){
 const page=await browser.newPage({viewport:{width:1500,height:1600}}),errors=[],reads=[],saves=[],layout=[];let saveRelease,readRelease,saved=false,external=0;
 let list={id:'PL-1',company:'NCT',customerId:'C1',customerName:'SYNTHETIC CUSTOMER',currency:'USD',status:actor==='SUPPORT'?'DRAFT':'SENT',revision:'R1',lines:[{taskId:'T1',barcode:'123',name:'SYNTHETIC PRODUCT',packing:'24 x 1',quantity:20,packed:0,loaded:0,reason:''}],photos:[],change:null};
 const tasks=[{taskId:'T1',company:'NCT',customerId:'C1',customerName:'SYNTHETIC CUSTOMER',currency:'USD',barcode:'123',name:'SYNTHETIC PRODUCT',packing:'24 x 1',remaining:100,ready:100,cbm:.02,weight:8}],prefix='https://fmcgmalaysia.github.io/fmcg-sales-room-ui/';
 const parentUrl=actor==='SUPPORT'?'https://fmcg999.wixstudio.com/packing-fixture':prefix+'warehouse-fixture';
 await page.exposeFunction('packingContinuity',async m=>{
  if(m.type==='PACKING_LAYOUT'){layout.push(m);return null;}
  if(m.type==='PACKING_READ_REQUEST'){reads.push(m);if(saved)await new Promise(resolve=>readRelease=resolve);return {company:'NCT',department:actor,tasks,lists:[list],version:saved?'V2':'V1',staff:{staffName:'Fixture'}};}
  if(m.type==='PACKING_SAVE_REQUEST'){saves.push(m);await new Promise(resolve=>saveRelease=resolve);saved=true;list={...list,status:actor==='SUPPORT'?'SENT':'PROCESSING',revision:'R2'};return {ok:true,company:'NCT',requestId:m.requestId,id:'PL-1',revision:'R2',status:list.status};}
  return null;
 });
 await page.route('**/*',route=>{const url=route.request().url();if(url===parentUrl)return route.fulfill({contentType:'text/html',body:'<!doctype html><script>window.addEventListener("message",async e=>{const m=e.data;if(!m?.type)return;const result=await window.packingContinuity(m);if(result)e.source.postMessage({type:m.type.replace("_REQUEST","_RESULT"),company:m.company,requestId:m.requestId,ok:true,result},e.origin);});</script><iframe style="width:1400px;height:1200px" src="'+prefix+'support-room/packing-workbench.html?live=1&department='+actor+(actor==='WAREHOUSE'?'&embedded=warehouse':'')+'"></iframe>'});
  if(url.startsWith(prefix)){const rel=new URL(url).pathname.slice('/fmcg-sales-room-ui/'.length),file=path.join(candidate?repo:baseline,rel);if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({body:rel.endsWith('.css')?fs.readFileSync(file,'utf8').replace(/@font-face\s*\{[^}]*\}/g,''):fs.readFileSync(file),contentType:rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':'text/html'});}
  external++;console.error('Blocked fixture request: '+url);return route.abort();});
 page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));await page.goto(parentUrl);const frame=page.frameLocator('iframe');
 if(actor==='SUPPORT')await frame.locator('#lists-tab').click();await frame.locator('[data-open="PL-1"]').waitFor();await frame.locator('[data-open="PL-1"]').click();
 await frame.locator('[data-action="'+(actor==='SUPPORT'?'SEND':'START')+'"]').click();for(let n=0;n<4;n++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 assert.equal(saves.length,1);await frame.locator('#detail [data-close]').first().click();assert.equal(await frame.locator('#detail').evaluate(e=>e.open),true,'Close remains blocked before the save receipt');
 saveRelease();for(let n=0;n<5;n++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));assert.equal(reads.length,2);assert(readRelease);
 await frame.locator('#detail [data-close]').first().click();const blocked=await frame.locator('#detail').evaluate(e=>e.open);assert.equal(blocked,!candidate);
 if(candidate&&actor==='WAREHOUSE')assert.equal(layout.at(-1).busy,false,'A background read cannot hold the parent workroom after close');
 readRelease();for(let n=0;n<4;n++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 if(candidate)assert.equal(await frame.locator('#detail').evaluate(e=>e.open),false,'Late read cannot reopen a closed dialog');
 assert.equal(saves.length,1);assert.deepEqual(errors,[]);assert.equal(external,0);await page.close();return {actor,variant:candidate?'candidate':'baseline',blockedBeforeReceipt:true,blockedOnlyForPostSaveRead:blocked,lateReadDoesNotReopen:candidate||undefined,parentReleased:candidate&&actor==='WAREHOUSE'||undefined,saveCount:1,pageErrors:0,realExternalRequests:0};
}
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})}),results=[];try{for(const actor of ['SUPPORT','WAREHOUSE'])for(const candidate of [false,true])results.push(await check(browser,actor,candidate));}finally{await browser.close();}console.log(JSON.stringify({results}));})().catch(e=>{console.error(e);process.exitCode=1;});
