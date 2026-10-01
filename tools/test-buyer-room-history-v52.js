const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const source = path.resolve(__dirname, '..', 'buyer-room.html').replace(/\\/g, '/');
  await page.goto(`file:///${source}`);
  const orderId = 'ORD-CUS-260921-D3B367-0D55E3C630004A88814273654945BDC8';
  await page.evaluate(({ orderId }) => window.postMessage({ type: 'BUYER_ROOM_DATA', data: {
    customerId: 'TEST-001', companyName: 'Test Buyer', memberName: 'LAW', currency: 'USD', selectionLimit: 700,
    myList: [{ id: 'item-1', barcode: '9556570012598', itemName: 'ZERO SUGAR', packingSize: '325ML x 24', ea: 24 }], removed: [],
    orders: [
      { orderId, confirmedAt: '2026-09-30T12:04:00.000Z', confirmedBy: 'LAW', lineCount: 1, totalCartons: 50, estimatedTotal: 492, currency: 'USD', status: 'CONFIRMED', isComplete: true },
      { orderId: 'ORD-CUS-260921-D3B367-A08C0D541A2E40378DF4C83EBB2638F0', confirmedAt: '2026-09-28T00:31:00.000Z', confirmedBy: 'BUYER USER', lineCount: 3, totalCartons: 210, estimatedTotal: 1848, currency: 'USD', status: 'PROFORMA REQUESTED', isComplete: true }
    ]
  }}, '*'), { orderId });
  await page.locator('#myRows .row').first().waitFor();
  await page.locator('[data-view="history"]').click();
  await page.locator('.history-card').first().waitFor();

  if (await page.locator('.history-card').count() !== 2) throw new Error('Two compact history rows were not rendered.');
  const firstText = await page.locator('.history-trigger').first().innerText();
  if (!firstText.includes('ORDER #0D55E3C6') || !firstText.includes('Submitted 30-09-26 08:04pm · By LAW')) throw new Error(`Outer order summary is incomplete: ${firstText}`);
  if ((await page.locator('#historyView').innerText()).includes('View Details')) throw new Error('Legacy View Details button remains.');
  const triggerHeight = await page.locator('.history-trigger').first().evaluate(node => node.getBoundingClientRect().height);
  if (triggerHeight > 60) throw new Error(`Order summary row is not compact: ${triggerHeight}px`);

  await page.locator('.history-trigger').first().click();
  await page.evaluate(({ orderId }) => window.postMessage({ type: 'BUYER_ROOM_ORDER_DETAIL_RESULT', ok: true, customerId: 'TEST-001', order: {
    orderId, currency: 'USD', lines: [{ lineId: 'L001', itemId: 'item-1', barcode: '9556570012598', itemName: '100 PLUS ISOTONIC - ZERO SUGAR', packingSize: '325ML x 24', currency: 'USD', lockedUnitPrice: 9.84, quantityCtn: 50, lineAmount: 492 }]
  }}, '*'), { orderId });
  await page.locator('.history-line').waitFor();
  const headings = (await page.locator('.history-line-head').innerText()).replace(/\s+/g, ' ').trim();
  for (const expected of ['Barcode', 'Descriptions', 'Packing Size', 'USD / PC', 'USD / CTN', 'Qty CTN', 'Line Amount / USD']) if (!headings.includes(expected)) throw new Error(`Missing history column ${expected}: ${headings}`);
  const lineText = (await page.locator('.history-line').innerText()).replace(/\s+/g, ' ').trim();
  for (const expected of ['9556570012598', '100 PLUS ISOTONIC - ZERO SUGAR', '325ML x 24', '0.41', '9.84', '50', '492.00']) if (!lineText.includes(expected)) throw new Error(`Missing history line value ${expected}: ${lineText}`);
  const lineStyle = await page.locator('.history-line').evaluate(node => { const head=document.querySelector('.history-line-head'),meta=document.querySelector('.history-detail-meta'); return { height: node.getBoundingClientRect().height, headHeight:head.getBoundingClientRect().height, metaHeight:meta.getBoundingClientRect().height, borderTop: getComputedStyle(node).borderTopWidth, borderBottom: getComputedStyle(node).borderBottomWidth, size: getComputedStyle(node).fontSize, color: getComputedStyle(node).color, weights: [...node.children].map(cell => getComputedStyle(cell).fontWeight), priceColor: getComputedStyle(node.querySelector('.history-price')).color }; });
  if (lineStyle.height > 29 || lineStyle.headHeight > 27 || lineStyle.metaHeight > 25 || lineStyle.borderTop !== '0px' || lineStyle.borderBottom !== '0px' || lineStyle.size !== '11px' || lineStyle.weights.some(weight => weight !== '400')) throw new Error(`History detail is not dense, borderless and regular weight: ${JSON.stringify(lineStyle)}`);
  if (lineStyle.color !== 'rgb(36, 59, 87)') throw new Error(`History detail text is still too light: ${lineStyle.color}`);
  const priceRgb=(lineStyle.priceColor.match(/\d+/g)||[]).map(Number);if (!(priceRgb[0]>priceRgb[1]&&priceRgb[1]>priceRgb[2])) throw new Error(`History prices are not orange-red: ${lineStyle.priceColor}`);
  const alignment = await page.evaluate(() => { const head=[...document.querySelector('.history-line-head').children],row=[...document.querySelector('.history-line').children];return head.map((cell,index)=>Math.abs(cell.getBoundingClientRect().left-row[index].getBoundingClientRect().left)); });
  if (alignment.some(delta => delta > 1)) throw new Error(`History headers and entries are misaligned: ${alignment.join(', ')}`);
  if (await page.locator('.history-copy').count()) throw new Error('Copy Order ID control still exists.');
  if (await page.locator('#historySearch, #historyStatus, .history-toolbar').count()) throw new Error('Removed Order History search/status controls still exist.');
  const hierarchy = await page.evaluate(() => { const trigger=document.querySelector('.history-trigger'),capsule=document.querySelector('.history-status'),head=document.querySelector('.history-line-head');return {triggerBg:getComputedStyle(trigger).backgroundColor,capsuleBg:getComputedStyle(capsule).backgroundColor,headBg:getComputedStyle(head).backgroundColor,headTransform:getComputedStyle(head).textTransform,headSize:getComputedStyle(head).fontSize}; });
  const triggerRgb=(hierarchy.triggerBg.match(/\d+/g)||[]).map(Number);if (!(triggerRgb[0]<40&&triggerRgb[1]<80&&triggerRgb[2]<120)) throw new Error(`Outer order button is not dark: ${hierarchy.triggerBg}`);
  const capsuleRgb=(hierarchy.capsuleBg.match(/\d+/g)||[]).map(Number);if (!(capsuleRgb[0]>220&&capsuleRgb[1]>220&&capsuleRgb[2]>220)) throw new Error(`Confirmed capsule is not light: ${hierarchy.capsuleBg}`);
  if (hierarchy.headBg === 'rgba(0, 0, 0, 0)' || hierarchy.headTransform !== 'none' || hierarchy.headSize !== '11px') throw new Error(`History header layer is incorrect: ${JSON.stringify(hierarchy)}`);
  const arrow = await page.locator('.history-chevron').first().evaluate(node => ({ text: node.textContent.trim(), width: node.getBoundingClientRect().width, color: getComputedStyle(node).color }));
  if (arrow.text !== '›' || arrow.width < 24) throw new Error(`Order expand arrow is not clear: ${JSON.stringify(arrow)}`);

  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  if (process.env.BUYER_ROOM_HISTORY_SCREENSHOT) await page.screenshot({ path: process.env.BUYER_ROOM_HISTORY_SCREENSHOT, fullPage: true });
  console.log('Buyer Room Order History v55 checks passed.');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
