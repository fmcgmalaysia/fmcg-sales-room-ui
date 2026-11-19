const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
const {patchStaffDomain}=require('./patch.cjs');
const baseline=fs.readFileSync(path.join(__dirname,'baseline.html'),'utf8');
const candidate=patchStaffDomain(baseline);
const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const staff=Array.from({length:8},(_,i)=>({staffId:'STAFF-'+i,name:'Fake employee '+i,email:'employee'+i+'@example.invalid',status:'ACTIVE',role:i===0?'SUPER ADMIN':'STAFF',linked:true,revision:'r0',access:{departmentAccess:{},companyIds:[],customerAccess:{},salesRoom:'',salesFunction:'',supportViewAll:false}}));
async function fixture({origin='https://www.ltpos.ai',html=candidate,referrer=true,denied=false}={}){
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const app='https://staff-fixture.invalid';
 await page.route('**/*',route=>{const url=new URL(route.request().url());
  if(url.origin===origin)return route.fulfill({contentType:'text/html',body:`<style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="${app}/index.html" ${referrer?'':'referrerpolicy="no-referrer"'}></iframe><script>
   window.calls=[];const rows=${JSON.stringify(staff)};
   addEventListener('message',e=>{if(e.origin!=='${app}')return;const m=e.data;calls.push(m);
    if(!['LIST_STAFF','LIST_CUSTOMERS'].includes(m.action))throw Error('Unexpected write '+m.action);
    e.source.postMessage({type:'MASTER_STAFF_RESULT',requestId:m.requestId,ok:${!denied},${denied?"error:'Super Admin access is required.'":"rows,customers:[{id:'FAKE-CUSTOMER',name:'Fake customer'}],saveStatus:{state:'CLEAR'}"}},e.origin);
   });</script>`});
  if(url.origin===app&&url.pathname==='/index.html')return route.fulfill({contentType:'text/html',body:html});
  return route.abort();
 });
 await page.goto(origin+'/staff-management');
 return {page,browser,frame:page.frameLocator('iframe')};
}

test('the old production origin reproduces the empty directory on ltpos.ai without any backend request',async()=>{
 const f=await fixture({html:baseline.replace('}, 15000);','}, 60);')});
 try{await f.frame.locator('#status').getByText('MASTER did not confirm the request.',{exact:true}).waitFor();assert.equal(await f.page.evaluate(()=>calls.length),0);assert.equal(await f.frame.locator('.employee-link').count(),0);}
 finally{await f.browser.close();}
});
for(const origin of ['https://www.ltpos.ai','https://ltpos.ai','https://fmcg999.wixstudio.com'])test(`${origin}: eight records render; unchanged/reverted Save stays disabled and recovery does not replay edits`,async()=>{
 const f=await fixture({origin});
 try{
  await f.frame.locator('#status').getByText('8 employees',{exact:true}).waitFor();
  assert.equal(await f.frame.locator('.employee-link').count(),8);
  await f.frame.locator('.employee-link').nth(1).click();
  const name=f.frame.getByRole('textbox',{name:'Employee name',exact:true});
  const save=f.frame.locator('#save');assert(await save.isDisabled());
  await name.fill('Changed fake name');assert(await save.isEnabled());
  await f.page.evaluate(()=>window.dispatchEvent(new Event('online')));
  assert.equal(await name.inputValue(),'Changed fake name');
  await name.fill('Fake employee 1');assert(await save.isDisabled());
  assert.equal(await f.page.evaluate(()=>calls.filter(m=>/REGISTER|UPDATE/.test(m.action)).length),0);
  assert.equal(await f.page.evaluate(()=>calls.filter(m=>m.action==='LIST_STAFF').length),1);
 }finally{await f.browser.close();}
});
for(const options of [{origin:'https://ltpos.ai.evil.invalid'},{origin:'https://www.ltpos.ai',referrer:false}])test(`untrusted or missing referrer fails closed (${JSON.stringify(options)})`,async()=>{
 const f=await fixture(options);
 try{await f.frame.locator('#status').getByText('Open this page from the MASTER website.',{exact:true}).waitFor();assert.equal(await f.page.evaluate(()=>calls.length),0);assert.equal(await f.frame.locator('.employee-link').count(),0);}
 finally{await f.browser.close();}
});
test('a valid domain cannot turn an unauthorized staff reply into a directory grant',async()=>{
 const f=await fixture({denied:true});
 try{await f.frame.locator('#status').getByText('Super Admin access is required.',{exact:true}).waitFor();assert.equal(await f.frame.locator('.employee-link').count(),0);assert(await f.frame.locator('#add').isDisabled());}
 finally{await f.browser.close();}
});
