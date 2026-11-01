/**
PropertiesService * WIX SALES ROOM -> CUSTOMER MASTER TEST -> QUOTATION DESK
 * This module is isolated from legacy CUSTOMER MASTER / CUSTOMER ACCESS / BUYER ROOM.
 */
const WIX_ONBOARDING_CFG = Object.freeze({
  SYSTEM_CONTROL_CENTRE_ID: '17K28pcLG4TtInGYlQv0c67xmPTOp3l2dsxClu_nMVs4',
  MASTER_SHEET: 'WIX CUSTOMER MASTER TEST',
  STAFF_SHEET: 'STAFF MASTER',
  QD_TEMPLATE_SHEET: 'GR ROAD',
  QD_DATA_RANGE_TO_CLEAR: 'A3:AE2999',
  SHARED_SECRET_PROPERTY: 'WIX_ONBOARDING_SHARED_SECRET'
});

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    assertSharedSecret_(payload.sharedSecret);
    delete payload.sharedSecret;
    const action = String(payload.action || 'CREATE_QD').trim().toUpperCase();
    const result = action === 'ADD_SELECTION'
      ? WIX_addCatalogueSelection(payload)
      : action === 'REMOVE_SELECTION'
        ? WIX_removeCatalogueSelection(payload)
        : action === 'VERIFY_QD'
          ? WIX_verifyCustomerQuotationDesk(payload)
          : action === 'GET_QUOTE_RISK_COUNTS'
            ? WIX_getQuoteRiskCounts(payload)
            : action === 'SYNC_FX_RATES'
        ? WIX_syncFxRates(payload)
        : action === 'PUBLISH_QUOTATIONS'
              ? WIX_publishCustomerQuotations(payload)
              : WIX_createCustomerQuotationDesk(payload);
    return jsonOutput_({ ok: true, result: result });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err && err.message || err) });
  }
}

function createWixCustomer(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const p = validateAndNormalise_(payload || {});
    const control = SpreadsheetApp.openById(WIX_ONBOARDING_CFG.SYSTEM_CONTROL_CENTRE_ID);
    const master = requireSheet_(control, WIX_ONBOARDING_CFG.MASTER_SHEET);
    const staff = findStaff_(control, p.assignedStaffId);

    const existing = findExistingCustomer_(master, p.wixCustomerRecordId);
    if (existing && String(existing.values[18]).toUpperCase() === 'READY') {
      return resultFromRow_(existing.values, existing.row, true);
    }

    const customerId = existing ? String(existing.values[0]) : newCustomerId_();
    const qdSheetName = safeSheetName_(p.companyName);
    let row = existing ? existing.row : master.getLastRow() + 1;
    const now = new Date();

    const pendingRow = [
      customerId, 'REGISTERING', existing ? existing.values[2] : now,
      p.companyName, p.country, p.natureOfBusiness, p.picTitle, p.picName,
      p.picEmail, p.picMobile, p.whatsapp, p.preferredCurrency, p.destinationPort,
      staff.staffId, staff.staffName, staff.qdFileId, staff.qdFileName,
      qdSheetName, 'PENDING', p.wixCustomerRecordId, now, '',
      p.createdBy || staff.staffName, p.testRecord ? 'YES' : 'NO'
    ];
    master.getRange(row, 1, 1, pendingRow.length).setValues([pendingRow]);
    SpreadsheetApp.flush();

    try {
      const qd = SpreadsheetApp.openById(staff.qdFileId);
      let qdSheet = qd.getSheetByName(qdSheetName);
      if (!qdSheet) {
        const template = qd.getSheetByName(WIX_ONBOARDING_CFG.QD_TEMPLATE_SHEET);
        if (!template) throw new Error('QD template not found: ' + WIX_ONBOARDING_CFG.QD_TEMPLATE_SHEET);
        qdSheet = template.copyTo(qd).setName(qdSheetName);
        qdSheet.getRange(WIX_ONBOARDING_CFG.QD_DATA_RANGE_TO_CLEAR).clearContent();
        qdSheet.setTabColor('#22a06b');
      }
      qdSheet.showSheet();
      const readyAt = new Date();
      master.getRange(row, 2).setValue('REGISTERED');
      master.getRange(row, 19).setValue('READY');
      master.getRange(row, 21).setValue(readyAt);
      master.getRange(row, 22).clearContent();
      SpreadsheetApp.flush();
      return {
        customerId: customerId,
        customerStatus: 'REGISTERED',
        qdStatus: 'READY',
        qdFileId: staff.qdFileId,
        qdFileName: staff.qdFileName,
        qdSheetName: qdSheetName,
        registryRow: row,
        idempotent: !!existing,
        accessCreated: false
      };
    } catch (err) {
      master.getRange(row, 2).setValue('ERROR');
      master.getRange(row, 19).setValue('ERROR');
      master.getRange(row, 21).setValue(new Date());
      master.getRange(row, 22).setValue(String(err && err.message || err));
      throw err;
    }
  } finally {
    lock.releaseLock();
  }
}

function testCreateWixCustomerForLaw() {
  const result = createWixCustomer({
    companyName: 'TEST AUTO LAW 001',
    country: 'malaysia',
    natureOfBusiness: 'WHOLESALE',
    picTitle: 'MR',
    picName: 'TEST BUYER LAW',
    picEmail: 'buyer.test+law001@example.com',
    picMobile: '+60120000001',
    whatsapp: 'YES',
    preferredCurrency: 'USD',
    destinationPort: 'PORT KLANG',
    assignedStaffId: 'STF-LAW01',
    wixCustomerRecordId: 'TEST-WIX-LAW-001',
    createdBy: 'LAW',
    testRecord: true
  });
  console.log(JSON.stringify(result));
  return result;
}

function validateAndNormalise_(p) {
  const required = [
    'companyName','country','natureOfBusiness','picTitle','picName','picEmail',
    'picMobile','whatsapp','preferredCurrency','destinationPort',
    'assignedStaffId','wixCustomerRecordId'
  ];
  required.forEach(function(k) {
    if (p[k] === undefined || p[k] === null || String(p[k]).trim() === '') {
      throw new Error('Required field missing: ' + k);
    }
  });

  const out = {
    companyName: upper_(p.companyName),
    country: upper_(p.country),
    natureOfBusiness: upper_(p.natureOfBusiness),
    picTitle: upper_(p.picTitle),
    picName: upper_(p.picName),
    picEmail: String(p.picEmail).trim().toLowerCase(),
    picMobile: String(p.picMobile).trim(),
    whatsapp: upper_(p.whatsapp),
    preferredCurrency: upper_(p.preferredCurrency),
    destinationPort: upper_(p.destinationPort),
    assignedStaffId: upper_(p.assignedStaffId),
    wixCustomerRecordId: String(p.wixCustomerRecordId).trim(),
    createdBy: String(p.createdBy || '').trim(),
    testRecord: p.testRecord === true || upper_(p.testRecord) === 'YES'
  };

  assertAllowed_(out.natureOfBusiness, ['WHOLESALE','RETAIL','E-COMMERCE','SOURCING AGENT','OTHERS'], 'natureOfBusiness');
  assertAllowed_(out.picTitle, ['MR','MS'], 'picTitle');
  assertAllowed_(out.whatsapp, ['YES','NO'], 'whatsapp');
  assertAllowed_(out.preferredCurrency, ['USD','MYR','SGD','RMB','JPY'], 'preferredCurrency');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.picEmail)) throw new Error('Invalid PIC email');
  return out;
}

function findStaff_(control, staffId) {
  const sh = requireSheet_(control, WIX_ONBOARDING_CFG.STAFF_SHEET);
  const values = sh.getDataRange().getDisplayValues();
  for (let i = 1; i < values.length; i++) {
    if (upper_(values[i][0]) === staffId) {
      if (upper_(values[i][1]) !== 'ACTIVE') throw new Error('Assigned staff is not ACTIVE: ' + staffId);
      if (!values[i][5]) throw new Error('Assigned staff has no QD file: ' + staffId);
      return {
        staffId: values[i][0],
        staffName: values[i][2],
        qdFileId: values[i][5],
        qdFileName: values[i][6]
      };
    }
  }
  throw new Error('Assigned staff not found: ' + staffId);
}

function findExistingCustomer_(master, wixCustomerRecordId) {
  const last = master.getLastRow();
  if (last < 2) return null;
  const rows = master.getRange(2, 1, last - 1, 24).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][19]).trim() === wixCustomerRecordId) {
      return { row: i + 2, values: rows[i] };
    }
  }
  return null;
}

function resultFromRow_(v, row, idempotent) {
  return {
    customerId: v[0],
    customerStatus: v[1],
    qdStatus: v[18],
    qdFileId: v[15],
    qdFileName: v[16],
    qdSheetName: v[17],
    registryRow: row,
    idempotent: idempotent,
    accessCreated: false
  };
}

function newCustomerId_() {
  const stamp = Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyMMdd');
  const suffix = Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
  return 'CUS-' + stamp + '-' + suffix;
}

function safeSheetName_(name) {
  const cleaned = upper_(name).replace(/[\\\/\?\*\[\]\:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error('Company name cannot produce a valid QD sheet name');
  return cleaned.slice(0, 100);
}

function requireSheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}

function assertAllowed_(value, allowed, field) {
  if (allowed.indexOf(value) === -1) throw new Error('Invalid ' + field + ': ' + value);
}

function assertSharedSecret_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty(WIX_ONBOARDING_CFG.SHARED_SECRET_PROPERTY);
  if (!expected) throw new Error('Wix onboarding endpoint is not configured');
  if (String(provided || '') !== expected) throw new Error('Unauthorized request');
}

function upper_(value) {
  return String(value === undefined || value === null ? '' : value).trim().toUpperCase();
}

function WIX_syncFxRates(payload) {
  const APPROVED_QD_FOLDER_ID = '1frEBQD7vwPW6X_dqQSoItbFQDUQs3THL';
  const FX_RATES_PROPERTY = 'WIX_QD_FX_RATES_JSON';
  const rates = Array.isArray(payload && payload.rates) ? payload.rates : [];
  const rateByCurrency = {};
  rates.forEach((item) => {
    const currency = String(item && item.currency || '').trim().toUpperCase();
    const rate = Number(item && item.rateToMyr);
    if (/^[A-Z]{3}$/.test(currency) && isFinite(rate) && rate > 0) rateByCurrency[currency] = rate;
  });
  if (!Object.keys(rateByCurrency).length) throw new Error('No valid FX rates were supplied.');
  PropertiesService.getScriptProperties().setProperty(FX_RATES_PROPERTY, JSON.stringify(rateByCurrency));

  const result = { scanned: 0, updated: 0, skipped: 0, failed: 0, details: [] };
  const files = DriveApp.getFolderById(APPROVED_QD_FOLDER_ID).getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const fileId = file.getId();
    const fileName = file.getName();
    result.scanned++;
    try {
      if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) {
        result.skipped++;
        result.details.push({ fileId, fileName, status: 'SKIPPED', reason: 'File is not a Google Sheet.' });
        continue;
      }
      const spreadsheet = SpreadsheetApp.openById(fileId);
      const sheet = spreadsheet.getSheetByName('WIX QUOTATION');
      const draft = spreadsheet.getSheetByName('DRAFT 草稿区');
      if (!sheet || !draft) {
        result.skipped++;
        result.details.push({ fileId, fileName, status: 'SKIPPED', reason: 'WIX QUOTATION or DRAFT 草稿区 sheet is missing.' });
        continue;
      }
      const currency = String(sheet.getRange('D3').getDisplayValue() || sheet.getRange('D3').getValue() || '').trim().toUpperCase();
      const rate = Number(rateByCurrency[currency]);
      if (!/^[A-Z]{3}$/.test(currency) || !isFinite(rate) || rate <= 0) {
        result.skipped++;
        result.details.push({ fileId, fileName, status: 'SKIPPED', currency, reason: 'D3 currency has no saved FX rate.' });
        continue;
      }
      sheet.getRange('D4').setValue(rate).setNumberFormat('0.00');
      draft.getRange('L3').setValue(rate).setNumberFormat('0.00');
      result.updated++;
      result.details.push({ fileId, fileName, status: 'UPDATED', currency, rateToMyr: rate });
    } catch (error) {
      result.failed++;
      result.details.push({ fileId, fileName, status: 'FAILED', reason: String(error && error.message || error) });
    }
  }
  SpreadsheetApp.flush();
  return result;
}

function jsonOutput_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
function myFunction() {
  
}
