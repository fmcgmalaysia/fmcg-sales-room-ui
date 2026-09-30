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
    activeSelectedProductIds: ['food-1', 'nonfood-1'],
    selectionLimit: 700,
    selectionTotal: 2,
    selectionFoodCount: 1,
    selectionNonFoodCount: 1,
    selectionProducts: [
      { id: 'food-1', name: 'Food product', description: '100G x 12', barcode: '1001', mainCategory: 'FOOD', principle: 'BRAND A' },
      { id: 'nonfood-1', name: 'Non-food product', description: '1 PC x 24', barcode: '2001', mainCategory: 'HOUSEHOLD & CLEANING', principle: 'BRAND C' }
    ],
    products: [
      { id: 'food-1', name: 'Food product', description: '100G x 12', barcode: '1001', mainCategory: 'FOOD', principle: 'BRAND A' },
      { id: 'food-2', name: 'Second food product', description: '200G x 6', barcode: '1002', mainCategory: 'FOOD & BEVERAGES', principle: 'BRAND B' },
      { id: 'nonfood-1', name: 'Non-food product', description: '1 PC x 24', barcode: '2001', mainCategory: 'HOUSEHOLD & CLEANING', principle: 'BRAND C' }
    ]
  }, '*'));
  await page.locator('.row').first().waitFor();
  if ((await page.locator('#selectionCount').innerText()) !== '2') throw new Error('My Selection count is incorrect.');
  if ((await page.locator('#selectionLimit').innerText()) !== '700') throw new Error('Account selection limit is incorrect.');
  if (!(await page.locator('#selectionFilter').innerText()).includes('of')) throw new Error('Selection capacity is not expressed as “of”.');
  if ((await page.locator('#selectionAllowance').innerText()) !== 'Your account allows up to 700 selected SKUs.') throw new Error('Account allowance copy is incorrect.');
  if ((await page.locator('#foodSelectionCount').innerText()) !== '1') throw new Error('Food selection count is incorrect.');
  if ((await page.locator('#nonFoodSelectionCount').innerText()) !== '1') throw new Error('Non-food selection count is incorrect.');
  await page.evaluate(() => window.postMessage({
    type: 'catalogueWorkspaceData',
    selectedProductIds: ['food-1', 'removed-food-1'],
    activeSelectedProductIds: ['food-1'],
    selectionLimit: 700,
    selectionTotal: 1,
    selectionFoodCount: 1,
    selectionNonFoodCount: 0,
    selectionProducts: [{ id: 'food-1', name: 'Food product', description: '100G x 12', barcode: '1001', mainCategory: 'FOOD', principle: 'BRAND A' }],
    products: [{ id: 'nonfood-1', name: 'Filtered non-food product', description: '1 PC x 24', barcode: '2001', mainCategory: 'NON-FOOD', principle: 'BRAND C' }]
  }, '*'));
  if ((await page.locator('#selectionCount').innerText()) !== '1') throw new Error('Active selection total was contaminated by historical IDs.');
  if ((await page.locator('#foodSelectionCount').innerText()) !== '1') throw new Error('Food count changed with the visible product query.');
  if ((await page.locator('#nonFoodSelectionCount').innerText()) !== '0') throw new Error('Non-food count included a historical or filtered product.');
  await page.evaluate(() => window.postMessage({
    type: 'catalogueWorkspaceData',
    selectedProductIds: ['food-1', 'nonfood-1'],
    activeSelectedProductIds: ['food-1', 'nonfood-1'],
    selectionLimit: 700,
    selectionTotal: 2,
    selectionFoodCount: 1,
    selectionNonFoodCount: 1,
    selectionProducts: [
      { id: 'food-1', name: 'Food product', description: '100G x 12', barcode: '1001', mainCategory: 'FOOD', principle: 'BRAND A' },
      { id: 'nonfood-1', name: 'Non-food product', description: '1 PC x 24', barcode: '2001', mainCategory: 'HOUSEHOLD & CLEANING', principle: 'BRAND C' }
    ],
    products: [
      { id: 'food-1', name: 'Food product', description: '100G x 12', barcode: '1001', mainCategory: 'FOOD', principle: 'BRAND A' },
      { id: 'food-2', name: 'Second food product', description: '200G x 6', barcode: '1002', mainCategory: 'FOOD & BEVERAGES', principle: 'BRAND B' },
      { id: 'nonfood-1', name: 'Non-food product', description: '1 PC x 24', barcode: '2001', mainCategory: 'HOUSEHOLD & CLEANING', principle: 'BRAND C' }
    ]
  }, '*'));
  if (await page.getByText('Product Catalogue', { exact: true }).count()) throw new Error('Removed Product Catalogue title is still visible.');
  if (await page.getByText('BANNER', { exact: true }).count()) throw new Error('Removed banner is still visible.');
  const firstRowBox = await page.locator('.row').first().boundingBox();
  const firstThumbBox = await page.locator('.thumb').first().boundingBox();
  if (!firstRowBox || Math.abs(firstRowBox.height - 64) > 1) throw new Error('Desktop row spacing changed.');
  if (!firstThumbBox || firstThumbBox.width < 56 || firstThumbBox.height < 56) throw new Error('Desktop thumbnail was not enlarged inside the existing row.');
  const detailHeaderSize = Number.parseFloat(await page.locator('#detailName').evaluate(element => getComputedStyle(element).fontSize));
  if (Math.abs(detailHeaderSize - 21) > 0.5) throw new Error('Product name size changed unexpectedly.');
  const factHeaderSize = Number.parseFloat(await page.locator('.fact label').first().evaluate(element => getComputedStyle(element).fontSize));
  if (factHeaderSize < 11) throw new Error('Product information headers remain too small.');
  const factHeaderWeight = await page.locator('.fact label').first().evaluate(element => getComputedStyle(element).fontWeight);
  if (Number(factHeaderWeight) > 500) throw new Error('Product information headers remain bold.');
  if (!(await page.locator('.media-wrap > #selectButton').count())) throw new Error('Primary selection action is not positioned below the product image.');
  if ((await page.locator('#selectButton').innerText()) !== '✓ Selected') throw new Error('Selected product action label is incorrect.');
  if ((await page.locator('.promo-slide').count()) !== 3) throw new Error('Member benefit carousel does not contain three slides.');
  if (await page.locator('.promo-slide.action').count()) throw new Error('Advertisement slides are still clickable links.');
  if (await page.locator('.promo-slide:is(button,a)').count()) throw new Error('Advertisement slides still use interactive elements.');
  await page.locator('[data-promo-dot="1"]').click();
  if (!(await page.locator('[data-promo="1"]').evaluate(element => element.classList.contains('active')))) throw new Error('Member benefit carousel dots do not change slides.');
  if (await page.getByText('Browse products', { exact: true }).count()) throw new Error('Removed keyboard browsing hint is still visible.');
  const availablePill = page.locator('.pill:not(.selected)').first();
  if ((await availablePill.evaluate(element => getComputedStyle(element).borderRadius)) !== '999px') throw new Error('Status pill styling is missing.');
  const selectedPill = page.locator('.pill.selected').first();
  const statusColors = await Promise.all([
    availablePill.evaluate(element => getComputedStyle(element).backgroundColor),
    selectedPill.evaluate(element => getComputedStyle(element).backgroundColor)
  ]);
  if (statusColors[0] === statusColors[1]) throw new Error('Available and Selected states are not visually distinct.');
  await page.locator('.row', { hasText: 'Second food product' }).click();
  await page.locator('#selectButton').click();
  if ((await page.locator('#selectButton').innerText()) !== '✓ Selected') throw new Error('Select for Quote does not switch to Selected immediately.');
  if ((await page.locator('#selectionCount').innerText()) !== '3') throw new Error('Optimistic selection count did not update immediately.');
  await page.evaluate(() => window.postMessage({ type: 'catalogueWorkspaceSelection', ok: false, productId: 'food-2' }, '*'));
  if ((await page.locator('#selectionCount').innerText()) !== '2') throw new Error('Failed optimistic selection did not roll back its count.');
  if ((await page.locator('#selectButton').innerText()) !== 'Try Select for Quote Again') throw new Error('Failed optimistic selection does not offer a clear retry.');
  const pageCode = fs.readFileSync(path.resolve(__dirname, '..', 'buyer-room', 'catalogue', 'wix', 'catalogue-page-v3.js'), 'utf8');
  const workspaceCode = fs.readFileSync(path.resolve(__dirname, '..', 'buyer-room', 'catalogue', 'wix', 'catalogue-workspace-v1.html'), 'utf8');
  const headerCode = fs.readFileSync(path.resolve(__dirname, '..', 'buyer-room', 'catalogue', 'wix', 'catalogue-header-v2.html'), 'utf8');
  if (!headerCode.includes("post('catalogueMain'")) throw new Error('Catalogue header does not trigger the Mega Menu.');
  if (!headerCode.includes("post('catalogueBuyerRoom')")) throw new Error('Catalogue header does not trigger Buyer Room navigation.');
  if (!headerCode.includes('<span class="label">Buyer Room</span>')) throw new Error('Desktop Buyer Room label is missing.');
  if (!headerCode.trim().endsWith('</html>')) throw new Error('Catalogue header HTML is truncated.');
  if (workspaceCode.includes('scrollIntoView')) throw new Error('Keyboard navigation can still scroll the outer Wix page.');
  if (!workspaceCode.includes('rows.scrollTop+=rowBox.bottom-listBox.bottom')) throw new Error('Keyboard navigation is not isolated to the product list.');
  if (!workspaceCode.includes("post('catalogueWorkspaceNavigate')")) throw new Error('Keyboard navigation does not request outer viewport preservation.');
  if (!pageCode.includes("message.type === 'catalogueWorkspaceNavigate'")) throw new Error('Page code does not handle outer viewport preservation.');
  if (!pageCode.includes('await wixWindowFrontend.scrollTo(0, 0)')) throw new Error('Page code does not keep the outer Wix viewport at the top.');
  if (!pageCode.includes('catalogueSubCategoryMainMap.get')) throw new Error('Subcategory-to-main-category counting fallback is missing.');
  if (!pageCode.includes("hasSome('subCategories', foodSubCategoryIds)")) throw new Error('Food category membership query is missing.');
  if (!pageCode.includes('catalogueFoodPrinciples.has(product.principle.toUpperCase())')) throw new Error('Food principle fallback is missing.');
  if (pageCode.includes("ascending('name')")) throw new Error('Catalogue is still sorted by product name.');
  if (!pageCode.includes('sortCatalogueProducts') || !pageCode.includes('item?.sortNo')) throw new Error('Catalogue SORT NO ordering is missing.');
  const activeFilters = pageCode.match(/eq\('pointBaseStatus', 'ACTIVE'\)/g) || [];
  if (activeFilters.length < 4) throw new Error('ACTIVE-only filtering is not applied to every Catalogue product query path.');
  const imageBox = await page.locator('.product-image').boundingBox();
  if (!imageBox || Math.abs(imageBox.width - imageBox.height) > 1 || imageBox.width < 345) throw new Error('Desktop product image container is not a square at the required minimum size.');
  await page.locator('.row').first().click();
  const first = await page.locator('.row.active .name').innerText();
  await page.keyboard.press('ArrowDown');
  const second = await page.locator('.row.active .name').innerText();
  if (first === second) throw new Error('ArrowDown did not advance the active product.');
  if ((await page.locator('#detailName').innerText()) !== second) throw new Error('Detail panel did not follow the active product.');
  await page.locator('#selectionFilter').click();
  if ((await page.locator('.row').count()) !== 2) throw new Error('My Selection filter did not return the two selected products.');
  await page.locator('#foodSelectionFilter').click();
  if ((await page.locator('.row').count()) !== 1 || (await page.locator('.row .name').innerText()) !== 'Food product') throw new Error('Food selected-product filter is incorrect.');
  await page.locator('#nonFoodSelectionFilter').click();
  if ((await page.locator('.row').count()) !== 1 || (await page.locator('.row .name').innerText()) !== 'Non-food product') throw new Error('Non-food selected-product filter is incorrect.');
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  console.log('Catalogue workspace interaction test passed.');
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
