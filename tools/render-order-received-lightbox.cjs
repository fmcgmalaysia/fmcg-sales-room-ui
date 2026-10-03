const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('path');

(async () => {
  const version = process.argv[2] === 'v2' ? 'v2' : 'v1';
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 });
  const source = path.resolve(__dirname, '..', 'assets', `order-received-lightbox-${version}.html`).replace(/\\/g, '/');
  await page.goto(`file:///${source}`);
  await page.screenshot({ path: path.resolve(__dirname, '..', 'assets', `order-received-lightbox-${version}.png`), omitBackground: true });
  await browser.close();
  console.log(`Rendered assets/order-received-lightbox-${version}.png`);
})().catch(error => { console.error(error); process.exit(1); });
