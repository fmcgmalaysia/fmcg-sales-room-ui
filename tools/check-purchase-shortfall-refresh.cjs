const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const [assetRoot, candidate, playwrightModule] = process.argv.slice(2);
const { chromium } = require(playwrightModule || 'playwright');
const origin = 'http://localhost:45971';
const fixtureFile = path.resolve(__dirname, '../integration/tests/purchase-support-shortfall.test.cjs');
const setup = fs.readFileSync(fixtureFile, 'utf8').split('\ntest(')[0]
  .replaceAll('50', '100').replaceAll('55', '100').replace('expectedExtra:5', 'expectedExtra:0');
const fixture = new Function('require', setup + '; return fixture;')(createRequire(fixtureFile));
const staff = { staffId: 'TEST', staffName: 'Test', memberId: 'MEMBER', canDecideQuantityCase: true };
const shell = `<!doctype html><meta charset="utf-8"><style>iframe{width:100%;height:97vh;border:0}</style>
<iframe src="/purchase-live/index-20261124-split-surplus.html"></iframe><script>
addEventListener('message', async event => {
  const frame = document.querySelector('iframe');
  if (event.source !== frame.contentWindow) return;
  const response = await fixtureReply(event.data);
  if (response) frame.contentWindow.postMessage(response, location.origin);
});
</script>`;
const mime = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml' };

async function start(browser, state, seen) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  await page.clock.install();
  await page.exposeFunction('fixtureReply', async message => {
    const { type, company, requestId, input } = message;
    const reply = { type: type.replace('_REQUEST','_RESULT'), company, requestId, ok:true };
    if (type === 'PURCHASE_WORKSPACE_REQUEST') {
      return { ...reply, workspace:{ ...state.workspace(), purchaseOrders:{ company, orders:[] } } };
    }
    if (type === 'PURCHASE_ORDERS_REQUEST') return { ...reply, result:{ company, orders:[] } };
    if (type === 'PURCHASE_SAVE_REQUEST' && message.operation === 'QUANTITY_CASE') {
      seen.push({ ...input });
      try { return { ...reply, result:await state.decide({ company, requestId, input, staff }) }; }
      catch (error) { return { ...reply, ok:false, error:error.message }; }
    }
    return null;
  });
  await page.route('**/*', async route => {
    const address = new URL(route.request().url());
    if (address.origin !== origin) return route.abort();
    if (address.pathname === '/') return route.fulfill({ body:shell, contentType:'text/html' });
    const file = address.pathname === '/purchase-live/app.js' ? candidate : path.join(assetRoot, address.pathname);
    if (!fs.existsSync(file)) return route.fulfill({ status:404 });
    return route.fulfill({ path:file, contentType:mime[path.extname(file)] });
  });
  await page.goto(origin);
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', {name:'Active Orders',exact:true}).click();
  return { page, frame };
}

const coverage = frame => frame.locator('.receipt-feedback-summary').nth(1).locator('strong').allTextContents();
const supplier = frame => frame.locator('.receipt-feedback-summary').first().locator('strong').allTextContents();
const openCase = (frame, quantity) => frame.locator('[data-quantity-case]')
  .filter({ hasText:new RegExp('^−'+quantity+'$') }).click();

(async()=>{
  const browser = await chromium.launch({ channel:'chrome', headless:true });
  try {
    const arriving=fixture({shortReceipt:false});
    const cold=await start(browser,arriving,[]);
    await cold.frame.getByText('Fake product',{exact:true}).first().waitFor();
    await cold.frame.locator('#companySelect').focus();
    arriving.receive('FIRST-80',80,0,'',true);
    await cold.page.clock.fastForward(10000);
    await openCase(cold.frame,20);
    assert.deepEqual(await supplier(cold.frame),['100 CTN','80 CTN','20 CTN']);
    assert.deepEqual(await coverage(cold.frame),['100 CTN','80 CTN','20 CTN']);
    await cold.page.close();

    const initial = fixture({ shortReceipt:false });
    initial.receive('R60',60,0,'',true);
    const writes=[];
    const { page, frame }=await start(browser,initial,writes);
    await openCase(frame,40);
    assert.deepEqual(await supplier(frame),['100 CTN','60 CTN','40 CTN']);
    assert.deepEqual(await coverage(frame),['100 CTN','60 CTN','40 CTN']);
    await frame.locator('#receiptSolution').selectOption('STOP');
    await frame.locator('input[value="CN_PROMISED"]').check();
    await frame.locator('#shortfallRoute').selectOption('ALLOCATE');
    initial.receive('R80',80,60,'R60',true);
    await page.clock.fastForward(10000);
    const refresh=frame.locator('#refreshReceiptDecision');
    await refresh.waitFor({state:'visible'});
    assert.equal(await frame.locator('#saveReceiptDecision').isEnabled(),false);
    assert.deepEqual(await coverage(frame),['100 CTN','60 CTN','40 CTN']);
    assert.equal(writes.length,0);
    await refresh.click();
    await frame.getByText(/Review the current quantities and confirm again/).waitFor();
    assert.deepEqual(await supplier(frame),['100 CTN','80 CTN','20 CTN']);
    assert.deepEqual(await coverage(frame),['100 CTN','80 CTN','20 CTN']);
    assert.equal(await frame.locator('#receiptSolution').inputValue(),'STOP');
    assert.equal(await frame.locator('#shortfallRoute').inputValue(),'ALLOCATE');
    assert.equal(await frame.locator('input[value="CN_PROMISED"]').isChecked(),true);
    assert.equal(writes.length,0);
    const staleVersion=initial.workspace().quantityCasesVersion;
    initial.receive('R90',90,80,'R80',true);
    await frame.locator('#saveReceiptDecision').click();
    await frame.getByText(/This case changed while saving/).waitFor();
    assert.equal(writes.length,1);
    assert.equal(writes[0].version,staleVersion);
    assert.equal(initial.activity().filter(row=>row.action==='PURCHASE_QUANTITY_CASE_DECIDED').length,0);
    assert.equal(await frame.locator('#saveReceiptDecision').isEnabled(),false);
    assert.equal(await frame.locator('#liveStatus').innerText(),'');
    await refresh.click();
    await frame.getByText(/Review the current quantities and confirm again/).waitFor();
    assert.deepEqual(await coverage(frame),['100 CTN','90 CTN','10 CTN']);
    await frame.locator('#saveReceiptDecision').click();
    await frame.getByRole('heading',{name:'Receiving Shortfall 收货差额'}).waitFor({state:'hidden'});
    assert.equal(writes.length,2);
    assert.equal(writes[1].customerShortfallRoute,'ALLOCATE');
    assert.equal(initial.activity().filter(row=>row.action==='PURCHASE_QUANTITY_CASE_DECIDED').length,1);
    await page.close();

    const quarantined=fixture({shortReceipt:false});
    quarantined.receive('R80Q',80,0,'',true);
    await quarantined.store.insert('',{title:'Q80',imageAltText:'TASK',action:'STOCK_EXCEPTION_REPORTED',result:'SAVED',
      initiatedByStaffId:'TEST',activityTime:'2026-11-19T12:00:00Z',
      details:{company:'NCT',quantity:80,kind:'INTERNAL_DAMAGE',reason:'Fixture quarantine'}});
    const blocked=await start(browser,quarantined,[]);
    await openCase(blocked.frame,20);
    assert.deepEqual(await supplier(blocked.frame),['100 CTN','80 CTN','20 CTN']);
    assert.deepEqual(await coverage(blocked.frame),['100 CTN','0 CTN','100 CTN']);
    await blocked.frame.locator('#receiptSolution').selectOption('STOP');
    assert.equal(await blocked.frame.locator('#shortfallRoute option[value="SUPPORT_SPLIT"]').count(),0);
    await blocked.page.close();

    const handoff=fixture({shortReceipt:false});
    handoff.receive('R80S',80,0,'',true);
    const other=await start(browser,handoff,[]);
    await openCase(other.frame,20);
    await handoff.decide(handoff.request('SUPPORT_SPLIT'));
    await other.page.clock.fastForward(10000);
    await other.frame.locator('#refreshReceiptDecision').click();
    await other.frame.getByText(/Sent to Support for splitting/).waitFor();
    assert.equal(await other.frame.locator('#saveReceiptDecision').count(),0);
    assert.equal(await other.frame.locator('#shortfallRoute').isEnabled(),false);
    console.log('Passed: 0→80 first receipt, newer receipts with retained draft, server conflict, real zero coverage, and another employee’s Support handoff.');
  } finally {
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
