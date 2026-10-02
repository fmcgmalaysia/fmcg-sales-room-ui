const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1680, height: 960 }, deviceScaleFactor: 1 });
  const source = path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(`file:///${source}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.postMessage({
    type: 'SALES_ROOM_CUSTOMERS',
    ok: true,
    customers: [{ customerId: 'TEST-001', companyName: 'Demo Malaysia Trading', customerStatus: 'ACTIVE', accessStatus: 'ACTIVE', qdStatus: 'READY' }],
    summary: { confirmedOrderCount: 1, quoteCustomerCount: 0 }
  }, '*'));
  await page.getByRole('button', { name: /Order Progress/ }).click();
  await page.locator('#progressCustomerSelect').selectOption('TEST-001');
  await page.evaluate(() => window.postMessage({
    type: 'SALES_ROOM_ORDER_PROGRESS',
    ok: true,
    customerId: 'TEST-001',
    companyName: 'Demo Malaysia Trading',
    currency: 'USD',
    orders: [{
      orderId: 'ORD-TEST-001', confirmedAt: '2026-10-02T01:45:00.000Z', status: 'PROCESSING',
      lines: [
        { lineId: 'L1', barcode: '9556570311202', itemName: '100 PLUS ISOTONIC (PET) - LEMON LIME', packingSize: '500ML x 24', quantityCtn: 10, committedQtyCtn: 8, lockedUnitPrice: 12.24, cbmPerCtn: 0.035, poNumber: 'PO-0001', updatedAt: '2026-10-02T04:10:00.000Z' },
        { lineId: 'L2', barcode: '9556570012598', itemName: '100 PLUS ISOTONIC - ZERO SUGAR', packingSize: '325ML x 24', quantityCtn: 6, committedQtyCtn: 6, lockedUnitPrice: 9.84, cbmPerCtn: 0.026, goodsReceivedAt: '2026-10-02T05:00:00.000Z', updatedAt: '2026-10-02T05:00:00.000Z' },
        { lineId: 'L3', barcode: '9556001122334', itemName: 'MILO ACTIV-GO CHOCOLATE MALT', packingSize: '200ML x 24', quantityCtn: 4, lockedUnitPrice: 15.40, cbmPerCtn: 0.021, updatedAt: '2026-10-02T02:00:00.000Z' }
      ]
    }]
  }, '*'));
  await page.locator('.sales-progress-overview').waitFor();
  const visible = await page.locator('#order-progress').isVisible();
  const stages = await page.locator('.sales-progress-stage').count();
  const rows = await page.locator('.sales-progress-grid > .sales-progress-row:not(.sales-progress-head)').count();
  const editable = await page.locator('#order-progress input, #order-progress [data-reduce-order], #order-progress .tracking-edit').count();
  if (!visible || stages !== 6 || rows !== 3 || editable !== 0) throw new Error(JSON.stringify({ visible, stages, rows, editable }));
  await page.screenshot({ path: 'sales-room-order-progress-v45-local.png', fullPage: true });
  console.log(JSON.stringify({ visible, stages, rows, editable, screenshot: 'sales-room-order-progress-v45-local.png' }));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
