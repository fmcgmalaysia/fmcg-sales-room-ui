const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('node:path');

const customer = {
  customerId: 'CUS-TEST-DUDU',
  companyName: 'DUDU CORPORATION PTE. LTD.',
  customerShortName: 'DUDU',
  customerStatus: 'ACTIVE',
  lifecycleStatus: 'ACTIVE',
  accessStatus: 'ACTIVE',
  qdStatus: 'READY',
  country: 'SINGAPORE',
  preferredCurrency: 'USD',
  assignedStaffId: 'STF-RINN01',
  activeOrderLineCount: 12,
  accessUserCount: 1,
  selectionLimit: 300
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1680, height: 960 }, deviceScaleFactor: 1 });
  const source = path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(`file:///${source}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.postMessage({
    type: 'SALES_ROOM_STAFF',
    staff: { staffId: 'STF-ADMIN01', staffName: 'ADMIN', role: 'SUPER ADMIN', canViewAllCustomers: true }
  }, '*'));
  await page.evaluate((record) => window.postMessage({
    type: 'SALES_ROOM_CUSTOMERS',
    ok: true,
    customers: [record],
    summary: { confirmedOrderCount: 1, quoteCustomerCount: 0 }
  }, '*'), customer);

  await page.evaluate(() => showView('new'));
  const uppercaseSamples = {
    companyName: 'dudu corporation pte. ltd.',
    customerShortName: 'dudu',
    country: 'singapore',
    picName: 'dudu buyer',
    destinationPort: 'port of singapore'
  };
  for (const [name, value] of Object.entries(uppercaseSamples)) {
    const input = page.locator(`#customerForm [name="${name}"]`);
    await input.fill(value);
    if (await input.inputValue() !== value.toUpperCase()) throw new Error(`${name} did not normalize to uppercase while typing.`);
  }
  const emailInput = page.locator('#customerForm [name="picEmail"]');
  await emailInput.fill('buyer@dudu.test');
  if (await emailInput.inputValue() !== 'buyer@dudu.test') throw new Error('Email must preserve normal lowercase formatting.');

  await page.getByRole('button', { name: /Order Progress/ }).click();
  await page.locator('#progressCustomerTrigger').click();
  const menuLabel = await page.locator('[data-progress-customer="CUS-TEST-DUDU"]').innerText();
  if (!menuLabel.includes('DUDU') || !menuLabel.includes('12')) throw new Error(`Unexpected progress menu: ${menuLabel}`);
  await page.locator('[data-progress-customer="CUS-TEST-DUDU"]').click();
  await page.evaluate(() => window.postMessage({
    type: 'SALES_ROOM_ORDER_PROGRESS',
    ok: true,
    customerId: 'CUS-TEST-DUDU',
    companyName: 'DUDU CORPORATION PTE. LTD.',
    customerShortName: 'DUDU',
    currency: 'USD',
    orders: [{
      orderId: 'ORD-DUDU-001', confirmedAt: '2026-10-02T01:45:00.000Z', status: 'PROCESSING',
      lines: [{ lineId: 'L1', customerId: 'CUS-TEST-DUDU', barcode: '9556570311202', itemName: '100 PLUS ISOTONIC (PET) - LEMON LIME', packingSize: '500ML x 24', quantityCtn: 12, committedQtyCtn: 10, lockedUnitPrice: 12.24, cbmPerCtn: 0.035, poNumber: 'PO-0001', updatedAt: '2026-10-02T04:10:00.000Z' }]
    }]
  }, '*'));
  await page.locator('.sales-progress-overview').waitFor();
  await page.screenshot({ path: 'sales-room-progress-v48-local.png', fullPage: true });

  await page.getByRole('button', { name: /My Customers/ }).click();
  await page.locator('[data-customer="CUS-TEST-DUDU"]').click();
  await page.evaluate((record) => window.postMessage({
    type: 'SALES_ROOM_CUSTOMER_DETAIL',
    ok: true,
    customer: {
      ...record,
      qdFileLabel: 'QD - DUDU',
      qdLastVerifiedAt: '2026-10-02 10:00',
      picName: 'DUDU TEST',
      primaryEmail: 'dudu.test@example.com',
      mobileNo: '+65 8000 0000',
      destinationPortName: 'PORT OF SINGAPORE',
      users: [
        { userId: 'USR-CUS-TEST-DUDU-01', userName: 'DUDU PRIMARY', email: 'primary@dudu.test', mobileNo: '+65 8000 0001', status: 'ACTIVE', primaryUser: true },
        { userId: 'USR-CUS-TEST-DUDU-02', userName: 'DUDU BUYER', email: 'buyer@dudu.test', mobileNo: '+65 8000 0002', status: 'ACTIVE', primaryUser: false },
        { userId: 'USR-CUS-TEST-DUDU-03', userName: 'OLD USER', email: 'old@dudu.test', mobileNo: '+65 8000 0003', status: 'REVOKED', primaryUser: false }
      ],
      recentAudit: []
    }
  }, '*'), customer);
  await page.locator('.customer-profile-modal').waitFor();
  await page.setViewportSize({ width: 1680, height: 700 });
  const modal = await page.locator('.customer-profile-modal').boundingBox();
  const headings = await page.locator('.customer-profile-modal h3').allTextContents();
  const visibleActions = await page.locator('.customer-profile-modal button:visible').allTextContents();
  const summaryIconCount = await page.locator('.record-summary-icon svg').count();
  const scrollState = await page.locator('.customer-record-scroll').evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY }));
  if (!modal || modal.width < 1100 || !headings.includes('Company Information') || !headings.includes('Business Setup') || !headings.includes('Authorized Customer Users') || !headings.includes('Recent Change History')) {
    throw new Error(JSON.stringify({ modal, headings, visibleActions }));
  }
  if (summaryIconCount !== 4) throw new Error(`Expected four SVG summary icons, found ${summaryIconCount}.`);
  if (scrollState.overflowY !== 'auto' || scrollState.scrollHeight <= scrollState.clientHeight) throw new Error(`Modal content is not independently scrollable: ${JSON.stringify(scrollState)}`);
  for (const label of ['EDIT', 'MANAGE USERS', 'SUSPEND']) {
    if (!visibleActions.includes(label)) throw new Error(`Missing primary record action: ${label}`);
  }
  if (visibleActions.includes('ARCHIVE')) throw new Error('Archive must not appear for an active customer.');
  const primaryToggles = page.locator('.primary-toggle');
  if (await primaryToggles.count() !== 2) throw new Error('Expected Primary switches for the two active users.');
  if (await primaryToggles.nth(0).getAttribute('aria-pressed') !== 'true' || await primaryToggles.nth(1).getAttribute('aria-pressed') !== 'false') throw new Error('Primary switch state is incorrect.');
  if (!(await primaryToggles.nth(0).isDisabled())) throw new Error('The current Primary switch must be locked on.');
  await page.getByRole('button', { name: 'MANAGE USERS' }).click();
  if (!(await page.getByRole('button', { name: '+ ADD USER' }).isVisible())) throw new Error('Manage Users did not reveal user controls.');
  if (!(await page.getByRole('button', { name: 'REMOVE ACCESS' }).isVisible())) throw new Error('Manage Users did not reveal the secondary active-user action.');
  await primaryToggles.nth(1).click();
  if (!(await page.getByRole('heading', { name: 'Set Primary User' }).isVisible())) throw new Error('Primary switch did not open the confirmation workflow.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'DONE' }).click();
  await page.getByRole('button', { name: 'EDIT' }).click();
  if (!(await page.locator('#editableProfileSection').isVisible())) throw new Error('Edit did not reveal the customer profile form.');
  const shortNameInput = page.locator('#editableProfileSection input[name="customerShortName"]');
  if (await shortNameInput.isEditable()) throw new Error('Customer Short Name must be read-only after customer creation.');
  await page.evaluate(() => {
    window.__profileSavePayload = null;
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'SALES_ROOM_CUSTOMER_PROFILE_SAVE') window.__profileSavePayload = event.data.payload;
    }, { once: true });
  });
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.waitForFunction(() => window.__profileSavePayload !== null);
  const profileSavePayload = await page.evaluate(() => window.__profileSavePayload);
  if (Object.prototype.hasOwnProperty.call(profileSavePayload, 'customerShortName')) throw new Error('Profile save payload must not include Customer Short Name.');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.screenshot({ path: 'sales-room-customer-modal-v52-local.png', fullPage: true });
  await page.evaluate((record) => window.postMessage({
    type: 'SALES_ROOM_CUSTOMER_DETAIL', ok: true,
    customer: { ...record, accessStatus: 'SUSPENDED', lifecycleStatus: 'ACTIVE', users: [] }
  }, '*'), customer);
  if (!(await page.getByRole('button', { name: 'REACTIVATE', exact: true }).isVisible()) || !(await page.getByRole('button', { name: 'ARCHIVE', exact: true }).isVisible())) {
    throw new Error('Suspended customer controls are incomplete.');
  }
  console.log(JSON.stringify({ menuLabel, modalWidth: modal.width, headings, visibleActions, summaryIconCount, scrollState, uppercaseFields: Object.keys(uppercaseSamples), shortNameLocked: true, primarySwitches: 2, screenshots: ['sales-room-progress-v48-local.png', 'sales-room-customer-modal-v52-local.png'] }));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
