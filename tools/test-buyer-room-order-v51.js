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
    customerId: 'TEST-ORDER-001', companyName: 'Test Buyer', memberName: 'Test User', currency: 'USD', selectionLimit: 700,
    myList: [
      { id: 'quoted-1', barcode: '1001', itemName: 'ALPHA DRINK', packingSize: '500ML x 24', category: 'FOOD & BEVERAGES', vipPriceEa: 0.5, vipPriceCtn: 12, vipCurrency: 'USD', quoteStatus: 'VIEW QUOTE', quoteActive: true, orderQtyCtn: 50, cbmPerCtn: 0.01, qtyEditedAt: '2026-09-30T12:52:00.000Z', qtyEditedBy: 'LAW' },
      { id: 'waiting-1', barcode: '2001', itemName: 'BETA WAITING ITEM', packingSize: '250G x 12', category: 'FOOD & BEVERAGES', quoteStatus: 'WAITING', quoteActive: false, orderQtyCtn: 0 },
      { id: 'quoted-2', barcode: '3001', itemName: 'GAMMA CLEANER', packingSize: '1L x 12', category: 'HOUSEHOLD & CLEANING', vipPriceEa: 1, vipPriceCtn: 20, vipCurrency: 'USD', quoteStatus: 'VIEW QUOTE', quoteActive: true, orderQtyCtn: 60, cbmPerCtn: 0, qtyEditedAt: '2026-09-30T12:54:00.000Z', qtyEditedBy: 'LAW' }
    ], removed: [], orders: []
  }}, '*'));
  await page.locator('#myRows .row').first().waitFor();
  await page.locator('[data-view="order"]').click();
  await page.locator('#orderRows .row').first().waitFor();

  const text = async selector => (await page.locator(selector).first().textContent()).replace(/\s+/g, ' ').trim();
  if (await text('#orderAllCount') !== '3' || await text('#orderQtyCount') !== '2') throw new Error('Order filter counts are incorrect.');
  if (await page.locator('#orderRows .row').count() !== 3) throw new Error('ALL ITEMS does not show all three products.');
  if (await text('.order-grid .row.head > div:nth-child(3)') !== 'Descriptions') throw new Error('Order table description header was not renamed.');
  if (await page.locator('#orderRows .order-waiting').count() !== 1) throw new Error('Waiting product is not visually identified.');
  if (await page.locator('#orderRows .cbm-zero-pill').count() !== 1 || await text('#orderRows .cbm-zero-pill') !== '0.0000') throw new Error('Ordered product with zero CBM is not highlighted.');
  const lineAmount = await page.evaluate(() => { const head=document.querySelector('.order-grid .row.head>div:nth-child(6)'),cell=document.querySelector('#orderRows .row>div:nth-child(6)'),value=cell.querySelector('strong'); return { text:cell.textContent.trim(), align:getComputedStyle(cell).textAlign, headAlign:getComputedStyle(head).justifyContent, fontSize:getComputedStyle(value).fontSize }; });
  if (lineAmount.text !== '600.00' || lineAmount.align !== 'right' || lineAmount.headAlign !== 'flex-end' || lineAmount.fontSize !== '11px') throw new Error(`Line Amount format is incorrect: ${JSON.stringify(lineAmount)}`);
  if (await page.locator('#orderShowing').isVisible()) throw new Error('Legacy Showing line is still visible.');

  const summaryBefore = await page.locator('.order-summary').innerText();
  await page.locator('[data-order-filter="qty"]').click();
  if (await page.locator('#orderRows .row').count() !== 2) throw new Error('WITH QTY does not show exactly two products.');
  if (await page.locator('.order-summary').innerText() !== summaryBefore) throw new Error('Summary totals changed when the list was filtered.');
  await page.locator('#orderSearch').fill('gamma');
  if (await page.locator('#orderRows .row').count() !== 1 || !(await page.locator('#orderRows').innerText()).includes('GAMMA CLEANER')) throw new Error('Search does not operate inside WITH QTY.');
  if (!(await page.locator('#hiddenOrdered').innerText()).includes('1 ordered item')) throw new Error('Hidden ordered item guidance is missing during filtered search.');
  await page.locator('#orderSearch').fill('');
  await page.locator('[data-order-filter="all"]').click();
  if (await page.locator('#orderRows .row').count() !== 3) throw new Error('ALL ITEMS did not restore every product.');
  if (await page.locator('#orderExportToggle').count()) throw new Error('Legacy Order Form Excel button is still present.');
  await page.locator('#submitOrder').click();
  if (!await page.locator('#submitModalBg').isVisible()) throw new Error('Review Order did not open.');
  if (await page.locator('#reviewRows .order-review-line').count() !== 2) throw new Error('Review Order does not contain exactly the ordered products.');
  if (await text('#reviewOrderTitle') !== 'Review Order' || await text('#confirmSubmit') !== 'Send Request') throw new Error('Review Order actions are incorrect.');
  if (!(await text('.order-assurance')).includes('Submit with confidence')) throw new Error('Order quantity reassurance is missing.');
  if (await page.locator('#reviewRows .cbm-zero-pill').count() !== 1 || await text('#reviewRows .cbm-zero-pill') !== '0.0000') throw new Error('Review Order does not highlight zero CBM.');
  const reviewMetrics = await page.evaluate(() => ({
    fontSize: getComputedStyle(document.querySelector('#reviewRows .order-review-line')).fontSize,
    rowHeight: document.querySelector('#reviewRows .order-review-line').getBoundingClientRect().height,
    overflow: getComputedStyle(document.querySelector('.order-review-table')).overflowY,
    modalWidth: document.querySelector('.order-review').getBoundingClientRect().width,
    closeLabel: document.querySelector('#cancelSubmit').getAttribute('aria-label'),
    hasBackToEdit: document.querySelector('.order-review-footer').textContent.includes('Back to Edit')
  }));
  if (reviewMetrics.fontSize !== '10px' || reviewMetrics.rowHeight > 30 || !['auto','scroll'].includes(reviewMetrics.overflow)) throw new Error(`Review Order is not compact: ${JSON.stringify(reviewMetrics)}`);
  if (reviewMetrics.modalWidth > 1100 || reviewMetrics.closeLabel !== 'Close order review' || reviewMetrics.hasBackToEdit) throw new Error(`Review Order close control or width is incorrect: ${JSON.stringify(reviewMetrics)}`);
  if (process.env.BUYER_ROOM_REVIEW_SCREENSHOT) await page.screenshot({ path: process.env.BUYER_ROOM_REVIEW_SCREENSHOT, fullPage: true });
  await page.locator('#cancelSubmit').click();

  const metrics = await page.evaluate(() => {
    const toolbar = document.querySelector('.order-action-bar');
    const summary = document.querySelector('.order-summary');
    const label = document.querySelector('.order-filter');
    const count = document.querySelector('.order-filter b');
    const waiting = document.querySelector('.order-waiting');
    return {
      toolbar: toolbar.getBoundingClientRect().height,
      summary: summary.getBoundingClientRect().height,
      labelSize: getComputedStyle(label).fontSize,
      countSize: getComputedStyle(count).fontSize,
      qtyWidth: document.querySelector('.order-grid .qty').getBoundingClientRect().width,
    waitingBackground: getComputedStyle(waiting).backgroundColor,
    rowHeight: document.querySelector('#orderRows .row').getBoundingClientRect().height,
    thumbWidth: document.querySelector('#orderRows .thumb-fallback').getBoundingClientRect().width,
    thumbHeight: document.querySelector('#orderRows .thumb-fallback').getBoundingClientRect().height
    };
  });
  if (metrics.toolbar > 54 || metrics.summary > 76 || metrics.labelSize !== '11px' || metrics.countSize !== '14px') throw new Error(`Order workspace is not compact: ${JSON.stringify(metrics)}`);
  if (metrics.qtyWidth > 64) throw new Error(`Order quantity input is too wide: ${metrics.qtyWidth}px`);
  if (metrics.rowHeight > 49 || metrics.thumbWidth !== 38 || metrics.thumbHeight !== 38) throw new Error(`Order image did not enlarge inside the existing row height: ${JSON.stringify(metrics)}`);
  if (metrics.waitingBackground === 'rgba(0, 0, 0, 0)' || metrics.waitingBackground === 'rgb(255, 255, 255)') throw new Error('Waiting row has no visual distinction.');
  await page.locator('#orderRows [data-qty]').first().fill('9999');
  if (await page.locator('#orderRows [data-qty]').first().inputValue() !== '9999') throw new Error('Compact quantity input does not accept four digits.');
  const edited = await text('#orderRows .row:first-child .qty-audit-time');
  if (!/^\d{2}-\d{2}-\d{2} \d{2}:\d{2}(am|pm)$/.test(edited)) throw new Error(`Edited Time is not compact: ${edited}`);
  await page.locator('#orderRows [data-qty]').first().blur();
  await page.evaluate(() => window.postMessage({ type: 'BUYER_ROOM_ACTION_RESULT', action: 'quantity', ok: true, itemId: 'quoted-1', quantityCtn: 9999, qtyEditedAt: '2026-10-01T08:00:00.000Z', qtyEditedBy: 'Test User' }, '*'));
  await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = function () { window.__orderDownloadHref = this.href; };
    window.postMessage({ type: 'BUYER_ROOM_ORDER_RESULT', ok: true, orderId: 'ORD-TEST-001', downloadUrl: 'https://example.com/_functions/buyerOrderExcel?token=test' }, '*');
  });
  if (!await page.locator('#successModalBg').isVisible()) throw new Error('Order success notice did not open.');
  if (await text('#orderSuccessTitle') !== 'Order Received' || !(await text('#orderDownloadStatus')).includes('started downloading')) throw new Error('Order success notice copy is incorrect.');
  if (!String(await page.evaluate(() => window.__orderDownloadHref || '')).includes('/_functions/buyerOrderExcel?token=test')) throw new Error('Order Excel download was not triggered.');
  if (await page.locator('#quoteDot').getAttribute('hidden') !== null || await text('#quoteDot') !== '1' || !((await page.locator('#quoteDot').getAttribute('class'))||'').includes('order-alert')) throw new Error('Successful order did not create a red notification badge.');
  if (process.env.BUYER_ROOM_SUCCESS_SCREENSHOT) await page.screenshot({ path: process.env.BUYER_ROOM_SUCCESS_SCREENSHOT, fullPage: true });
  await page.locator('#closeSuccess').click();
  await page.locator('#quoteBell').click();
  if (!(await text('[data-order-notification]')).includes('VIEW ORDER HISTORY')) throw new Error('Order notification does not guide the customer to Order History.');
  await page.locator('[data-order-notification]').click();
  if (!await page.locator('#historyView').evaluate(node=>node.classList.contains('active')) || !(await text('.history-card')).includes('ORDER #001')) throw new Error('Order notification did not open the submitted order in Order History.');
  await page.locator('[data-view="order"]').click();
  if (process.env.BUYER_ROOM_STRESS_200) {
    await page.evaluate(() => window.postMessage({ type: 'BUYER_ROOM_DATA', data: {
      customerId: 'TEST-ORDER-200', companyName: 'Stress Test Buyer', memberName: 'Test User', currency: 'USD', selectionLimit: 700,
      myList: Array.from({ length: 200 }, (_, index) => ({ id: `stress-${index + 1}`, barcode: String(9556000000000 + index), itemName: `STRESS TEST PRODUCT ${String(index + 1).padStart(3, '0')}`, packingSize: '500ML x 24', vipPriceEa: 0.5, vipPriceCtn: 12, vipCurrency: 'USD', quoteStatus: 'VIEW QUOTE', quoteActive: true, orderQtyCtn: 1, cbmPerCtn: 0.01 })),
      removed: [], orders: []
    }}, '*'));
    await page.locator('#submitOrder').click();
    await page.locator('#reviewRows .order-review-line').nth(199).waitFor({ state: 'attached' });
    const stress = await page.evaluate(() => { const table = document.querySelector('.order-review-table'), modal = document.querySelector('.order-review'); return { rows: document.querySelectorAll('#reviewRows .order-review-line').length, scrolls: table.scrollHeight > table.clientHeight, bottom: modal.getBoundingClientRect().bottom, viewport: innerHeight }; });
    if (stress.rows !== 200 || !stress.scrolls || stress.bottom > stress.viewport) throw new Error(`200-item review failed: ${JSON.stringify(stress)}`);
    if (process.env.BUYER_ROOM_STRESS_SCREENSHOT) await page.screenshot({ path: process.env.BUYER_ROOM_STRESS_SCREENSHOT, fullPage: true });
    await page.locator('#cancelSubmit').click();
  }
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  if (process.env.BUYER_ROOM_ORDER_SCREENSHOT) await page.screenshot({ path: process.env.BUYER_ROOM_ORDER_SCREENSHOT, fullPage: true });
  console.log('Buyer Room Order Form v51 checks passed.');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
