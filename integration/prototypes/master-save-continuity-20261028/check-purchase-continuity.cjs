'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),repo=path.resolve(__dirname,'../../..'),baseline=process.env.MASTER_BASELINE_DIR;
if(!baseline)throw Error('MASTER_BASELINE_DIR required');
async function check(browser,candidate){
 const page=await browser.newPage(),errors=[];let external=0;page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
 let fixture=fs.readFileSync(path.join(repo,'integration/tests/fixtures/purchase-save-navigation-preview.html'),'utf8');
 fixture=fixture.replace("const frame=document.querySelector('#room');let original=null,submits=0;","const frame=document.querySelector('#room');let original=null,submits=0;window.savedRead=[];");
 const begin="if(m.type==='PURCHASE_WORKSPACE_REQUEST')frame.contentWindow.postMessage(",end="workspace:{...workspace,company:m.company}},'*');";
 assert(fixture.includes(begin)&&fixture.includes(end));fixture=fixture.replace(begin,"if(m.type==='PURCHASE_WORKSPACE_REQUEST'){if(original){window.savedRead.push(m);return;}frame.contentWindow.postMessage(").replace(end,end+'}');
 fixture=fixture.replace("send('PURCHASE_SAVE_RESULT',m,{ok:false,pending:true,requestId:m.requestId,errorCode:'WDE0118',error:'Sample CMS connection WDE0118; result pending.'});",'');
 fixture=fixture.replace('</script>',"window.releaseRead=()=>{for(const m of window.savedRead.splice(0))frame.contentWindow.postMessage({type:'PURCHASE_WORKSPACE_RESULT',requestId:m.requestId,company:m.company,ok:true,workspace},'*');};</script>");
 const prefix='https://purchase-fixture.example/';
 await page.route('**/*',route=>{const url=route.request().url();if(url===prefix+'fixture')return route.fulfill({contentType:'text/html',body:fixture});
  const rel=new URL(url).pathname.replace(/^\//,'');const file=path.join(baseline,rel);if(url.startsWith(prefix)&&fs.existsSync(file)&&fs.statSync(file).isFile()){
   let body=fs.readFileSync(candidate&&rel==='purchase-live/app.js'?path.join(repo,'integration/prototypes/receipt-feedback-20261026/purchase-live/app.js'):file);
   if(rel.endsWith('.css'))body=Buffer.from(body.toString().replace(/@font-face\s*\{[^}]*\}/g,''));
   if(rel==='purchase-live/app.js'){let source=body.toString(),pos=source.lastIndexOf('})();');assert(pos>0);body=Buffer.from(source.slice(0,pos)+'window.fixtureMutate=mutate;window.fixtureForm=formDialog;'+source.slice(pos));}
   return route.fulfill({body,contentType:rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':'text/html'});
  }external++;console.error('Blocked fixture request: '+url);return route.abort();});
 await page.goto(prefix+'fixture');const frame=page.frameLocator('iframe');await frame.getByText('SAMPLE CUSTOMER',{exact:true}).waitFor();
 await frame.locator('html').evaluate(e=>e.ownerDocument.defaultView.fixtureMutate('PURCHASE_SAVE_REQUEST',{operation:'EDIT',input:{edits:[]}}));
 await page.getByText(/Submit count 1/).waitFor();await page.locator('#receipt').click();await page.waitForFunction(()=>window.savedRead.length===1);
 const blank=(await frame.locator('#app').innerText()).includes('Loading Master CMS…');assert.equal(blank,!candidate);
 if(candidate){
  await frame.locator('nav [data-view="active"]').click();assert((await frame.locator('#app').innerText()).includes('Active Orders'));
  await frame.locator('html').evaluate(e=>e.ownerDocument.defaultView.fixtureForm('Next independent work','', '<input id="continuityDraft" aria-label="New draft">'));
  await frame.locator('#continuityDraft').fill('Keep typing while CMS updates');await page.evaluate(()=>window.releaseRead());
  for(let n=0;n<3;n++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  assert.equal(await frame.locator('#continuityDraft').inputValue(),'Keep typing while CMS updates');
 }
 assert.deepEqual(errors,[]);assert.equal(external,0);await page.close();return {variant:candidate?'candidate':'baseline',workspaceClearedAfterReceipt:blank,backgroundReadStillRuns:true,nextNavigationAndDraftPreserved:candidate||undefined,pageErrors:0,realExternalRequests:0};
}
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});try{console.log(JSON.stringify({results:[await check(browser,false),await check(browser,true)]}));}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
