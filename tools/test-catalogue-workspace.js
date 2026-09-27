const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const preview = path.resolve(__dirname, '..', 'buyer-room', 'catalogue', 'preview', 'catalogue-workspace-v1.html').replace(/\\/g, '/');
  await page.goto(`file:///${preview}`);
  await page.locator('.row').first().waitFor();
  const first = await page.locator('.row.active .name').innerText();
  await page.keyboard.press('ArrowDown');
  const second = await page.locator('.row.active .name').innerText();
  if (first === second) throw new Error('ArrowDown did not advance the active product.');
  if ((await page.locator('#detailName').innerText()) !== second) throw new Error('Detail panel did not follow the active product.');
  await page.locator('#selectionFilter').click();
  if ((await page.locator('.row').count()) !== 2) throw new Error('My Selection filter did not return the two selected products.');
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  console.log('Catalogue workspace interaction test passed.');
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
