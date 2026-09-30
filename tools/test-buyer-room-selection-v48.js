const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const source = path.resolve(__dirname, '..', 'buyer-room.html').replace(/\\/g, '/');
  await page.goto(`file:///${source}`);
  await page.evaluate(() => window.postMessage({ type: 'BUYER_ROOM_DATA', data: {
    customerId: 'TEST-001', companyName: 'Test Buyer', memberName: 'Test User', currency: 'USD', selectionLimit: 700,
    myList: [
      { id: 'food-1', barcode: '1001', itemName: 'FOOD PRODUCT', packingSize: '100G x 12', category: 'FOOD & BEVERAGES', normalPriceEa: 1.5, normalPriceCtn: 18, vipPriceEa: 1.2, vipPriceCtn: 14.4, vipCurrency: 'USD', quoteStatus: 'VIEW QUOTE', quoteActive: true, addedTime: '2026-09-30T06:15:00.000Z', quoteEffectiveAt: '2026-09-30T08:45:00.000Z', selectedByName: 'Test User' },
      { id: 'nonfood-1', barcode: '2001', itemName: 'NON FOOD PRODUCT', packingSize: '1 PC x 24', category: 'HOUSEHOLD & CLEANING', quoteStatus: 'WAITING', addedTime: '2026-09-29T09:05:00.000Z', selectedByName: 'Test User' }
    ], removed: [], orders: []
  }}, '*'));
  await page.locator('#myRows .row').first().waitFor();

  const expectText = async (selector, expected) => {
    const actual = (await page.locator(selector).first().textContent()).replace(/\s+/g, ' ').trim();
    if (actual !== expected) throw new Error(`${selector}: expected “${expected}”, received “${actual}”`);
  };
  await expectText('#foodCount', '1');
  await expectText('#nonFoodCount', '1');
  await expectText('#selectionSummaryCount', '2');
  await expectText('#selectionSummaryLimit', '700');
  await expectText('#currentPanel .row.head > div:nth-child(3)', 'Descriptions');
  if (await page.locator('.selection-guide').count()) throw new Error('The old standalone selection-guide block still exists.');
  if (await page.locator('#myView > .page-head > #browse').count() !== 1) throw new Error('Add More Items is not in the top My Selection row.');
  if (await page.locator('#currentPanel .showing-row > .selection-explainer').count() !== 1) throw new Error('Selection guidance is not aligned with the category summary row.');
  await expectText('#myRows .row:first-child > div:nth-child(4)', '- NIL -');
  await expectText('#myRows .row:first-child > div:nth-child(5)', 'USD 1.20 | 14.40');
  const rowText = await page.locator('#myRows .row:first-child').innerText();
  if (/\/ EA|\/ CTN/.test(rowText)) throw new Error('EA/CTN labels remain in My Selection pricing.');
  if (!/\d{2}-\d{2}-\d{2} \d{2}:\d{2}(am|pm)/.test(rowText)) throw new Error('Compact date format is missing.');

  const styles = await page.locator('#myRows .row:first-child').evaluate(row => {
    const read = selector => { const css = getComputedStyle(row.querySelector(selector)); return { size: css.fontSize, weight: css.fontWeight, whiteSpace: css.whiteSpace, color: css.color }; };
    return { name: read('.name'), packing: read('.packing-meta'), normal: read('.price-pair.normal'), vip: read('.price-pair.vip'), time: read('.time') };
  });
  for (const key of ['name', 'packing', 'normal', 'vip', 'time']) if (styles[key].size !== '11px') throw new Error(`${key} is ${styles[key].size}, expected 11px.`);
  if (styles.name.weight !== '700' || styles.packing.weight !== '400' || styles.normal.weight !== '400' || styles.vip.weight !== '700' || styles.time.weight !== '400') throw new Error(`Unexpected font weights: ${JSON.stringify(styles)}`);
  if (styles.time.whiteSpace !== 'nowrap') throw new Error('Time is not constrained to one line.');

  await page.locator('[data-selection-filter="food"]').click();
  if (await page.locator('#myRows .row').count() !== 1 || !(await page.locator('#myRows').innerText()).includes('FOOD PRODUCT')) throw new Error('FOOD filter did not isolate FOOD items.');
  await page.locator('[data-selection-filter="food"]').click();
  if (await page.locator('#myRows .row').count() !== 2) throw new Error('Second FOOD click did not restore all items.');
  const countStyle = await page.locator('#foodCount').evaluate(node => { const css = getComputedStyle(node); return { background: css.backgroundColor, radius: css.borderRadius, color: css.color }; });
  if (countStyle.radius !== '0px' || countStyle.background !== 'rgba(0, 0, 0, 0)') throw new Error(`Category count is still styled as a bubble: ${JSON.stringify(countStyle)}`);
  await page.locator('#limitInfoButton').click();
  if (await page.locator('#limitInfo').isHidden()) throw new Error('Selection-limit explanation did not open.');
  if (await page.locator('.remove-head svg').count() !== 1) throw new Error('Remove header trash icon is missing.');
  const browseBackground = await page.locator('#browse').evaluate(node => getComputedStyle(node).backgroundColor);
  if (browseBackground === 'rgb(255, 255, 255)' || browseBackground === 'rgba(0, 0, 0, 0)') throw new Error('Add More Items is not a solid button.');
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  console.log('Buyer Room My Selection v48 checks passed.');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
