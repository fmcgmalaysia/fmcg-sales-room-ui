const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {source,wrapper}=require('./ui-fixture.cjs');
const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const evidence='C:/FMCG-WIX-LOCAL/handoff/staff-workspace-permissions-20261119';
async function fixture(width=1440){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin==='https://www.ltpos.ai')return route.fulfill({contentType:'text/html',body:wrapper(url.origin,'https://staff-fixture.invalid')});
    if(url.origin==='https://staff-fixture.invalid')return route.fulfill({contentType:'text/html',body:source});
    return route.abort();
  });
  await page.goto('https://www.ltpos.ai/staff-management');
  const frame=page.frameLocator('iframe');
  await frame.getByRole('status').getByText('8 employees',{exact:true}).waitFor();
  return {browser,page,frame};
}
test('performance includes quotations; quote-only stays separate; unchanged and reverted Save stay gray',async()=>{
  const f=await fixture();
  try{
    await f.frame.getByRole('button',{name:/LIM · Test/}).click();
    await f.frame.locator('#save[data-unchanged=true]').waitFor();
    const save=f.frame.locator('#save'),performance=f.frame.locator('[name=performanceAccess]'),quote=f.frame.locator('[name=quotationAccess]');
    assert(await performance.isChecked());assert(await quote.isChecked());assert(await quote.isDisabled());assert(await save.isDisabled());
    await performance.uncheck();assert(!(await quote.isChecked()));assert(await quote.isEnabled());assert(await save.isEnabled());
    await performance.check();assert(await save.isDisabled());
    await f.page.screenshot({path:evidence+'/staff-permissions-desktop.jpg',type:'jpeg'});
    await f.frame.getByRole('button',{name:/YEOYO · Test/}).click();
    await f.frame.getByRole('heading',{name:'YEOYO · Test',exact:true}).waitFor();
    await f.frame.locator('#save[data-unchanged=true]').waitFor();
    assert(!(await performance.isChecked()));assert(await quote.isChecked());assert(await quote.isEnabled());assert(await save.isDisabled());
    assert.equal(await f.page.evaluate(()=>fixtureWrites.length),0);
  }finally{await f.browser.close();}
});
test('KAVI can be revoked with one switch and Warehouse shows no customer permission list',async()=>{
  const f=await fixture(390);
  try{
    await f.frame.getByRole('button',{name:/KAVI · Test/}).click();
    await f.frame.locator('#save[data-unchanged=true]').waitFor();
    const save=f.frame.locator('#save');assert(await save.isDisabled());
    assert.equal(await f.frame.locator('[name=customerWorkScope]').inputValue(),'ALL');
    assert.equal(await f.frame.locator('[name=catalogueAccess]').inputValue(),'SELECT');
    assert(!(await f.frame.locator('[name=createCustomers]').isChecked()));
    assert(!(await f.frame.locator('[name=quotationAccess]').isChecked()));
    await f.frame.locator('[name=customerWorkEnabled]').uncheck();assert(await save.isEnabled());
    await save.click();await f.frame.getByText('Saved successfully 已保存',{exact:true}).waitFor();
    assert(await save.isDisabled());assert.equal(await f.page.evaluate(()=>fixtureWrites.length),1);
    assert.equal(await f.page.evaluate(()=>fixtureWrites[0].access.customerWork.enabled),false);
    await f.frame.getByRole('button',{name:/SAM · Test/}).click();
    await f.frame.getByRole('heading',{name:'SAM · Test',exact:true}).waitFor();
    await f.frame.locator('#save[data-unchanged=true]').waitFor();
    assert(!(await f.frame.locator('#customer-scope-options').isVisible()));
    assert(!(await f.frame.locator('[name=customerWorkEnabled]').isChecked()));
    assert.equal(await f.frame.locator('[name=WAREHOUSE]').inputValue(),'EDIT');
    assert(await save.isDisabled());
    assert(await f.frame.locator('body').evaluate(body=>body.scrollWidth<=390));
    await f.page.screenshot({path:evidence+'/staff-permissions-mobile.jpg',type:'jpeg'});
  }finally{await f.browser.close();}
});

test('a rejected save cannot turn an implied quotation permission into an independent grant',async()=>{
  const f=await fixture();
  try{
    await f.frame.getByRole('button',{name:/LIM · Test/}).click();
    await f.frame.locator('#save[data-unchanged=true]').waitFor();
    await f.frame.locator('[name=catalogueAccess]').selectOption('VIEW');
    await f.page.evaluate(()=>{window.fixtureRejectNext=true;});
    await f.frame.locator('#save').click();
    await f.frame.getByText('Another employee change is being confirmed.',{exact:true}).waitFor();
    await f.frame.locator('[name=performanceAccess]').uncheck();
    assert(!(await f.frame.locator('[name=quotationAccess]').isChecked()));
    assert(await f.frame.locator('[name=quotationAccess]').isEnabled());
    assert.equal(await f.page.evaluate(()=>fixtureWrites.length),0);
  }finally{await f.browser.close();}
});
