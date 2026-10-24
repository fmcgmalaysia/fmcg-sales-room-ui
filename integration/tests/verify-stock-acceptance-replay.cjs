'use strict';
// Headless-only local layout/interaction QA. Never attaches to the user's browser,
// starts a localhost server, reads browser profiles or visits Wix/remote pages.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function verify(){
 const [fragmentPath,outputDirectory,playwrightPath,executablePath]=process.argv.slice(2);
 if(!fragmentPath||!outputDirectory||!playwrightPath)throw Error('Explicit local fragment, evidence directory and Playwright path required');
 const {chromium}=require(playwrightPath),browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1024,height:850}}),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  await page.setContent(fs.readFileSync(fragmentPath,'utf8'));
  await page.screenshot({path:path.join(outputDirectory,'stock-replay-initial.png'),fullPage:true});
  await page.locator('#sr-next').click();await page.locator('#sr-next').click();
  assert.equal(await page.locator('#sr-debt').textContent(),'30');
  assert.equal(await page.locator('.sr-person ellipse').count(),2);
  await page.locator('.sr-person').first().click();assert.match(await page.locator('#sr-detail').textContent(),/待补 30/);
  await page.screenshot({path:path.join(outputDirectory,'stock-replay-borrowed.png'),fullPage:true});
  await page.locator('#sr-next').click();await page.locator('#sr-next').click();
  assert.equal(await page.locator('#sr-debt').textContent(),'30');
  assert.match(await page.locator('#sr-note').textContent(),/Loaded/);
  await page.locator('#sr-next').click();assert.equal(await page.locator('#sr-debt').textContent(),'10');
  await page.locator('#sr-next').click();assert.equal(await page.locator('#sr-onhand').textContent(),'200');
  assert.equal(await page.locator('.sr-person ellipse').count(),0);assert.equal(await page.locator('#sr-next').isDisabled(),true);
  await page.screenshot({path:path.join(outputDirectory,'stock-replay-repaid.png'),fullPage:true});
  for(const choice of ['NCT-same-po','NCT-different-po','GHR-same-po','GHR-different-po']){
   await page.locator('#sr-case').selectOption(choice);assert.equal(await page.locator('#sr-onhand').textContent(),'0');
   for(let i=0;i<6;i++)await page.locator('#sr-next').click();assert.equal(await page.locator('#sr-debt').textContent(),'0');
  }
  await page.setViewportSize({width:320,height:780});
  await page.screenshot({path:path.join(outputDirectory,'stock-replay-mobile.png'),fullPage:true});
  const layout=await page.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,root:document.getElementById('stock-acceptance-replay').getBoundingClientRect().width}));
  assert.ok(layout.body<=layout.width,'mobile body has no horizontal overflow');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  process.stdout.write(JSON.stringify({passed:true,cases:4,stepsPerCase:7,errors,networkRequests:requests.length,layout})+'\n');
 }finally{await browser.close();}
}
verify().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
