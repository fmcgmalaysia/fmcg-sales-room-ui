'use strict';
// Fresh headless profile for OUR generated local file only. Does not attach to
// Work Chrome or inspect/control a real site. Requires an existing Playwright
// package and installed Chrome; no download/install/network server.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const { chromium } = require(process.argv[4] || 'playwright');
async function verify() {
  const file = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
  if (!fs.existsSync(file) || !fs.existsSync(output)) throw Error('Existing exercise and output folder required');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [], external = [], stages = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url())) external.push(r.url()); });
    await page.goto(pathToFileURL(file).href);
    const ui = page.frameLocator('#practiceFrame'), id = 'a'.repeat(32);
    await ui.locator('#taskRows').waitFor();
    await ui.locator('#taskRows').getByText('收齐示例', { exact: false }).first().waitFor();
    assert.equal(await ui.locator('[data-current-allocation]').filter({ hasText: 'ALERT' }).count(), 1);
    await page.screenshot({ path: path.join(output, 'practice-initial.png'), fullPage: true });
    await page.locator('#practiceSplit').click();
    await ui.locator('[data-plan-task="' + id + '"] [data-plan-select]').check();
    await ui.locator('[data-plan-task="' + id + '"] [data-first]').fill('40');
    await ui.locator('[data-plan-task="' + id + '"] [data-second]').fill('59');
    await ui.locator('[data-plan-reason]').fill('Two container test 两批装柜测试');
    await ui.locator('[data-plan-save]').click();
    await ui.locator('[data-status]').getByText('两批数量合计必须等于客户原始需求', { exact: false }).waitFor();
    await ui.locator('[data-plan-task="' + id + '"] [data-second]').fill('60');
    await ui.locator('[data-plan-save]').click();
    await ui.locator('.split-shipment-plan').getByText('Shipment 1: 40 CTN', { exact: false }).waitFor();
    await page.screenshot({ path: path.join(output, 'practice-split.png'), fullPage: true });
    await ui.locator('.master-shipment-dialog [data-close]').click();
    assert.equal(await ui.locator('#taskRows tr.split-demand-row').count(), 2); stages.push('Saved split40/60; invalid40/59 refused');
    await ui.locator('[data-current-allocation]').filter({ hasText: 'ALERT' }).first().click();
    await ui.locator('[data-alloc-borrow]').click();
    await ui.locator('[data-borrow-options]').click();
    await ui.locator('[data-borrow-pair]').selectOption('0');
    await ui.locator('[data-borrow-quantity]').fill('11');
    await ui.locator('[data-borrow-reason]').fill('Complete purchased90 补足采购90');
    await ui.locator('[data-borrow-consent]').check();
    await ui.locator('[data-borrow-approve]').click();
    await ui.locator('[data-borrow-error]').getByText('有效箱数', { exact: false }).waitFor();
    assert.match(await page.locator('#practiceFacts').innerText(), /ALLOC 80/);
    await ui.locator('[data-borrow-quantity]').fill('10');
    const field = await ui.locator('[data-borrow-reason]').boundingBox(), modal = await ui.locator('#modal').boundingBox();
    assert.ok(field.x >= modal.x && field.x + field.width <= modal.x + modal.width);
    await page.screenshot({ path: path.join(output, 'practice-borrow-form.png'), fullPage: true });
    await ui.locator('[data-borrow-approve]').click();
    await page.locator('#practiceFacts').getByText('RCV 80 · ALLOC 90 · 待补回 10', { exact: false }).waitFor();
    await ui.locator('#modal').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(output, 'practice-borrow-saved.png'), fullPage: true });
    stages.push('Borrow10 saved; borrow11 refused; RCV80 and split allocated40/50');
    await page.locator('#practiceMove').click();
    await ui.locator('[data-view=borrowing]').click();
    await ui.locator('#purchaseBorrowOutstanding table').getByText('待补回', { exact: false }).waitFor();
    await page.locator('#practiceArchive').click();
    await ui.locator('#purchaseBorrowOutstanding').getByText('Archived 已归档', { exact: false }).first().waitFor();
    await page.screenshot({ path: path.join(output, 'practice-archived-links.png'), fullPage: true });
    stages.push('Moved and archived borrower retained in Outstanding Borrowing');
    await page.locator('#practiceReceive').click(); await page.locator('#practiceAccepted').fill('85'); await page.locator('#practiceReceiptSave').click();
    await page.locator('#practiceFacts').getByText('RCV 85 · ALLOC 90 · 待补回 5', { exact: false }).waitFor();
    await page.screenshot({ path: path.join(output, 'practice-partial-repayment.png'), fullPage: true });
    await page.locator('#practiceReceive').click(); await page.locator('#practiceAccepted').fill('90'); await page.locator('#practiceReceiptSave').click();
    await page.locator('#practiceFacts').getByText('RCV 90 · ALLOC 90 · 待补回 0', { exact: false }).waitFor();
    await ui.locator('#purchaseBorrowOutstanding').getByText('0 outstanding relationships', { exact: false }).waitFor();
    await page.screenshot({ path: path.join(output, 'practice-repaid.png'), fullPage: true });
    stages.push('Receipt85/90 repaid5/10; ALLOC90 unchanged; outstanding list cleared');
    await page.locator('#practiceRestart').click();
    await page.locator('#practiceFacts').getByText('RCV 80 · ALLOC 80 · 待补回 0', { exact: false }).waitFor();
    await ui.locator('#taskRows').waitFor();
    stages.push('Fresh local session restart restores initial example');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    const result = { schema: 'LOCAL_OPERATION_PRACTICE_UI_QA_V1', passed: true, stages, pageErrors: errors, externalRequests: external,
      actualCandidateComponents: true, cmsWrites: false, nativeAcceptance: false, published: false };
    fs.writeFileSync(path.join(output, 'practice-ui-results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
}
if (require.main === module) verify().catch(e => { console.error(e); process.exitCode = 1; });
