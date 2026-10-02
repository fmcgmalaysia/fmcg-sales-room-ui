const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.25 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const source = path.resolve(__dirname, '..', 'buyer-room.html').replace(/\\/g, '/');
  await page.goto(`file:///${source}`);

  const activeOrder = 'ORD-CUS-TEST-ACTIVE';
  const completedOrder = 'ORD-CUS-TEST-COMPLETE';
  await page.evaluate(({ activeOrder, completedOrder }) => window.postMessage({ type: 'BUYER_ROOM_DATA', data: {
    customerId: 'TEST-001', companyName: 'OPOPO TRADING', memberName: 'LAW', currency: 'USD', selectionLimit: 700,
    myList: [], removed: [], orders: [
      { orderId: activeOrder, confirmedAt: '2026-10-02T01:18:00.000Z', lineCount: 1, currency: 'USD', status: 'CONFIRMED', isComplete: true },
      { orderId: completedOrder, confirmedAt: '2026-10-01T08:42:00.000Z', completedAt: '2026-10-02T03:20:00.000Z', invoiceNo: 'NC-INV-00001', lineCount: 1, currency: 'USD', status: 'COMPLETED', isComplete: true }
    ]
  }}, '*'), { activeOrder, completedOrder });

  await page.evaluate(({ activeOrder, completedOrder }) => {
    window.postMessage({ type: 'BUYER_ROOM_ORDER_DETAIL_RESULT', ok: true, customerId: 'TEST-001', order: {
      orderId: activeOrder, confirmedAt: '2026-10-02T01:18:00.000Z', currency: 'USD', status: 'CONFIRMED',
      lines: [{ lineId: 'L001', barcode: '9556570012598', itemName: '100 PLUS ISOTONIC - ZERO SUGAR', packingSize: '325ML x 24', lockedUnitPrice: 9.84, quantityCtn: 100, committedQtyCtn: 80, cbmPerCtn: 0.0059, processingAt: '2026-10-02T02:40:00.000Z', progressUpdatedAt: '2026-10-02T02:40:00.000Z' }]
    }}, '*');
    window.postMessage({ type: 'BUYER_ROOM_ORDER_DETAIL_RESULT', ok: true, customerId: 'TEST-001', order: {
      orderId: completedOrder, confirmedAt: '2026-10-01T08:42:00.000Z', completedAt: '2026-10-02T03:20:00.000Z', invoiceNo: 'NC-INV-00001', currency: 'USD', status: 'COMPLETED',
      lines: [{ lineId: 'L001', barcode: '8935001710622', itemName: 'MENTOS PURE FRESH - FRESH MINT', packingSize: '57G x 12 x 6', lockedUnitPrice: 8.40, quantityCtn: 50, committedQtyCtn: 49, completedQtyCtn: 49, cbmPerCtn: 0.0059, invoiceNo: 'NC-INV-00001', completedAt: '2026-10-02T03:20:00.000Z', fullPaymentAt: '2026-10-02T03:18:00.000Z' }]
    }}, '*');
  }, { activeOrder, completedOrder });

  await page.locator('[data-view="track"]').click();
  await page.locator('#trackRows .tracking-row').waitFor();
  if (await page.locator('.tracking-stage').count() !== 6) throw new Error('Overall progress does not contain six stages.');
  if ((await page.locator('#trackCommittedValue').innerText()).trim() !== 'USD 787.20') throw new Error('Committed transaction value is incorrect.');
  if ((await page.locator('#trackCommittedCbm').innerText()).trim() !== '0.4720 m³') throw new Error('Committed CBM total is incorrect.');
  const trackText = (await page.locator('#trackView').innerText()).replace(/\s+/g, ' ');
  for (const value of ['Descriptions', 'Packing Size', 'CBM', '02-10-26 09:18am', 'Requested Qty', 'Committed Qty', '3/6']) if (!trackText.includes(value)) throw new Error(`Track Orders is missing ${value}`);
  const rowHeight = await page.locator('#trackRows .tracking-row').first().evaluate(node => node.getBoundingClientRect().height);
  if (rowHeight > 38) throw new Error(`Track row is not compact: ${rowHeight}px`);
  if (await page.locator('#trackRows .tracking-edit').count() !== 1) throw new Error('Eligible Track row does not expose one pencil reduction action.');
  await page.locator('#trackRows .tracking-row').first().hover();
  await page.waitForTimeout(220);
  const hoverStyle = await page.locator('#trackRows .tracking-row').first().evaluate((node) => ({ background: getComputedStyle(node).backgroundColor, shadow: getComputedStyle(node).boxShadow }));
  const hoverPencil = await page.locator('#trackRows .tracking-edit').first().evaluate((node) => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color }));
  if (hoverStyle.background !== 'rgb(234, 246, 241)' || !hoverStyle.shadow.includes('rgb(20, 131, 95)')) throw new Error(`Track row hover is not visible enough: ${JSON.stringify(hoverStyle)}`);
  if (hoverPencil.background !== 'rgb(20, 131, 95)' || hoverPencil.color !== 'rgb(255, 255, 255)') throw new Error(`Track pencil is not highlighted with its row: ${JSON.stringify(hoverPencil)}`);
  if (process.env.TRACK_SCREENSHOT) await page.screenshot({ path: process.env.TRACK_SCREENSHOT, fullPage: true });

  await page.locator('[data-view="completed"]').click();
  await page.locator('.completed-invoice').waitFor();
  const completedText = (await page.locator('#completedView').innerText()).replace(/\s+/g, ' ');
  for (const value of ['NC-INV-00001', 'TOTAL CBM', '0.2891', 'Completed Qty', '411.60']) if (!completedText.includes(value)) throw new Error(`Completed Orders is missing ${value}`);
  if (process.env.COMPLETED_SCREENSHOT) await page.screenshot({ path: process.env.COMPLETED_SCREENSHOT, fullPage: true });
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  console.log('Buyer Room Track and Completed Orders V85 checks passed.');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
