const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const preview = path.resolve(__dirname, '..', 'buyer-room', 'catalogue', 'wix', 'catalogue-workspace-v1.html').replace(/\\/g, '/');
  await page.goto(`file:///${preview}`);
  await page.evaluate(() => window.postMessage({
    type: 'catalogueWorkspaceData',
    selectedProductIds: ['food-1', 'nonfood-1'],
    products: [
      { id: 'food-1', name: 'Food product', description: '100G x 12', barcode: '1001', mainCategory: 'FOOD', principle: 'BRAND A' },
      { id: 'food-2', name: 'Second food product', description: '200G x 6', barcode: '1002', mainCategory: 'FOOD & BEVERAGES', principle: 'BRAND B' },
      { id: 'nonfood-1', name: 'Non-food product', description: '1 PC x 24', barcode: '2001', mainCategory: 'HOUSEHOLD & CLEANING', principle: 'BRAND C' }
    ]
  }, '*'));
  await page.locator('.row').first().waitFor();
  if ((await page.locator('#selectionCount').innerText()) !== '2') throw new Error('My Selection count is incorrect.');
  if ((await page.locator('#foodSelectionCount').innerText()) !== '1') throw new Error('Food selection count is incorrect.');
  if ((await page.locator('#nonFoodSelectionCount').innerText()) !== '1') throw new Error('Non-food selection count is incorrect.');
  if (await page.getByText('Product Catalogue', { exact: true }).count()) throw new Error('Removed Product Catalogue title is still visible.');
  if (await page.getByText('BANNER', { exact: true }).count()) throw new Error('Removed banner is still visible.');
  const firstRowBox = await page.locator('.row').first().boundingBox();
  const firstThumbBox = await page.locator('.thumb').first().boundingBox();
  if (!firstRowBox || Math.abs(firstRowBox.height - 64) > 1) throw new Error('Desktop row spacing changed.');
  if (!firstThumbBox || firstThumbBox.width < 56 || firstThumbBox.height < 56) throw new Error('Desktop thumbnail was not enlarged inside the existing row.');
  const pageCode = fs.readFileSync(path.resolve(__dirname, '..', 'buyer-room', 'catalogue', 'wix', 'catalogue-page-v3.js'), 'utf8');
  if (!pageCode.includes('catalogueSubCategoryMainMap.get')) throw new Error('Subcategory-to-main-category counting fallback is missing.');
  if (!pageCode.includes("hasSome('subCategories', foodSubCategoryIds)")) throw new Error('Food category membership query is missing.');
  const imageBox = await page.locator('.product-image').boundingBox();
  if (!imageBox || Math.abs(imageBox.width - imageBox.height) > 1 || imageBox.width < 345) throw new Error('Desktop product image container is not a square at the required minimum size.');
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
