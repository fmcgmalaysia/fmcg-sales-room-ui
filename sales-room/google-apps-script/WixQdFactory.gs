/**
 * FMCG Malaysia — independent Quotation Desk factory.
 *
 * One Wix customer owns one copied Google Sheet file. The copy is made from
 * the complete QD template so formulas, formatting, validation, protections,
 * hidden rows/columns and the bound Apps Script travel with the workbook.
 *
 * New copies use a one-time QD SETUP sheet to authorize IMPORTRANGE against
 * Point Base. Wix keeps the customer in ACTIVATION_REQUIRED until verification.
 */
const WIX_QD_FACTORY_CFG = Object.freeze({
  TEMPLATE_FILE_ID: '1f2pT-KYlNTYT62ZAvHEqy0uVvV6rrnnmI_bmbVynpLU',
  DESTINATION_FOLDER_ID: '1frEBQD7vwPW6X_dqQSoItbFQDUQs3THL',
  POINT_BASE_FILE_ID: '12tyTIrmjF6JxMY-JW8K3JLuz5TcCkEjQUFXsauberLg',
  TEMPLATE_VERSION: 'QD-2026.09.20-V1',
  QUOTATION_SHEET: 'WIX QUOTATION',
  DRAFT_SHEET: 'DRAFT 草稿区',
  SETUP_SHEET: 'QD SETUP',
  SETUP_CHECK_CELL: 'B9',
  SETUP_EXPECTED_VALUE: 'STATUS',
  CUSTOMER_ID_METADATA: 'WIX_CUSTOMER_ID',
  STAFF_ID_METADATA: 'WIX_ASSIGNED_STAFF_ID',
  BUILD_STATUS_METADATA: 'WIX_QD_STATUS',
  TEMPLATE_VERSION_METADATA: 'WIX_QD_TEMPLATE_VERSION'
});

function WIX_createCustomerQuotationDesk(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const p = WIX_validateFactoryPayload_(payload || {});
    const existing = WIX_findExistingQd_(p.customerId);
    if (existing) return WIX_describeQd_(existing, p, true);

    const template = DriveApp.getFileById(WIX_QD_FACTORY_CFG.TEMPLATE_FILE_ID);
    const folder = DriveApp.getFolderById(WIX_QD_FACTORY_CFG.DESTINATION_FOLDER_ID);
    const fileName = WIX_qdFileName_(p.companyName, p.customerId);
    const copiedFile = template.makeCopy(fileName, folder);

    try {
      const spreadsheet = SpreadsheetApp.openById(copiedFile.getId());
      WIX_prepareCopiedQd_(spreadsheet, p);
      const verification = WIX_verifyCopiedQd_(spreadsheet);
      if (!verification.ok) {
        WIX_setSpreadsheetMetadata_(spreadsheet, WIX_QD_FACTORY_CFG.BUILD_STATUS_METADATA, 'ERROR');
        throw new Error('QD copy verification failed: ' + verification.errors.join(' | '));
      }
      SpreadsheetApp.flush();
      return WIX_describeQd_(copiedFile, p, false);
    } catch (error) {
      copiedFile.setDescription('WIX_QD_BUILD_ERROR | ' + p.customerId + ' | ' + String(error.message || error));
      throw error;
    }
  } finally {
    lock.releaseLock();
  }
}

function WIX_verifyCustomerQuotationDesk(payload) {
  const p = WIX_validateVerifyPayload_(payload || {});
  if (!p.qdFileId) throw new Error('QD File ID is required.');
  const file = DriveApp.getFileById(p.qdFileId);
  const spreadsheet = SpreadsheetApp.openById(p.qdFileId);
  const storedCustomerId = WIX_spreadsheetMetadataValue_(
    spreadsheet,
    WIX_QD_FACTORY_CFG.CUSTOMER_ID_METADATA
  );
  if (storedCustomerId !== p.customerId) {
    throw new Error('QD Customer ID does not match the Wix customer record.');
  }

  const setup = spreadsheet.getSheetByName(WIX_QD_FACTORY_CFG.SETUP_SHEET);
  if (!setup) throw new Error('QD SETUP sheet is missing.');
  const check = String(setup.getRange(WIX_QD_FACTORY_CFG.SETUP_CHECK_CELL).getDisplayValue() || '')
    .trim()
    .toUpperCase();

  if (check !== WIX_QD_FACTORY_CFG.SETUP_EXPECTED_VALUE) {
    WIX_setSpreadsheetMetadata_(spreadsheet, WIX_QD_FACTORY_CFG.BUILD_STATUS_METADATA, 'ACTIVATION_REQUIRED');
    return WIX_describeQd_(file, p, true, 'ACTIVATION_REQUIRED');
  }

  const verification = WIX_verifyCopiedQd_(spreadsheet);
  if (!verification.ok) {
    WIX_setSpreadsheetMetadata_(spreadsheet, WIX_QD_FACTORY_CFG.BUILD_STATUS_METADATA, 'ERROR');
    throw new Error('QD verification failed: ' + verification.errors.join(' | '));
  }

  setup.hideSheet();
  const quotation = spreadsheet.getSheetByName(WIX_QD_FACTORY_CFG.QUOTATION_SHEET);
  quotation.showSheet();
  spreadsheet.setActiveSheet(quotation);
  WIX_setSpreadsheetMetadata_(spreadsheet, WIX_QD_FACTORY_CFG.BUILD_STATUS_METADATA, 'READY');
  SpreadsheetApp.flush();
  return WIX_describeQd_(file, p, true, 'READY');
}

function WIX_prepareCopiedQd_(spreadsheet, p) {
  const quotation = spreadsheet.getSheetByName(WIX_QD_FACTORY_CFG.QUOTATION_SHEET);
  const draft = spreadsheet.getSheetByName(WIX_QD_FACTORY_CFG.DRAFT_SHEET);
  if (!quotation || !draft) {
    throw new Error('The copied template is missing WIX QUOTATION or DRAFT 草稿区.');
  }

  quotation.getRange('D1').setValue(p.companyName);
  quotation.getRange('D2').setValue(p.customerId);
  quotation.getRange('D3').setValue(p.currency);

  let setup = spreadsheet.getSheetByName(WIX_QD_FACTORY_CFG.SETUP_SHEET);
  if (!setup) setup = WIX_createSetupSheet_(spreadsheet);
  setup.showSheet();
  spreadsheet.setActiveSheet(setup);

  WIX_setSpreadsheetMetadata_(spreadsheet, WIX_QD_FACTORY_CFG.CUSTOMER_ID_METADATA, p.customerId);
  WIX_setSpreadsheetMetadata_(spreadsheet, WIX_QD_FACTORY_CFG.STAFF_ID_METADATA, p.assignedStaffId);
  WIX_setSpreadsheetMetadata_(spreadsheet, WIX_QD_FACTORY_CFG.BUILD_STATUS_METADATA, 'ACTIVATION_REQUIRED');
  WIX_setSpreadsheetMetadata_(spreadsheet, WIX_QD_FACTORY_CFG.TEMPLATE_VERSION_METADATA, WIX_QD_FACTORY_CFG.TEMPLATE_VERSION);
}

function WIX_createSetupSheet_(spreadsheet) {
  const sheet = spreadsheet.insertSheet(WIX_QD_FACTORY_CFG.SETUP_SHEET, 0);
  sheet.setHiddenGridlines(true);
  sheet.setColumnWidth(1, 44);
  sheet.setColumnWidth(2, 560);
  sheet.setRowHeights(1, 12, 34);
  sheet.getRange('B2').setValue('QUOTATION DESK ACTIVATION').setFontSize(18).setFontWeight('bold').setFontColor('#071A33');
  sheet.getRange('B3').setValue('One-time connection required').setFontSize(11).setFontColor('#66768B');
  sheet.getRange('B5').setValue('1  Select cell B9 below.').setFontWeight('bold');
  sheet.getRange('B6').setValue('2  Click ALLOW ACCESS when Google displays the connection prompt.');
  sheet.getRange('B7').setValue('3  Return to Sales Room and click VERIFY & ACTIVATE.');
  sheet.getRange('B9').setFormula(
    '=IMPORTRANGE("' + WIX_QD_FACTORY_CFG.POINT_BASE_FILE_ID + '","FOOD!A1")'
  );
  sheet.getRange('B9').setBackground('#FFF1D9').setFontColor('#916000').setFontWeight('bold');
  sheet.getRange('B11').setValue('This connection is required only once for this customer QD.').setFontSize(10).setFontColor('#66768B');
  sheet.getRange('B2:B11').setFontFamily('Arial');
  sheet.setTabColor('#E9A23B');
  return sheet;
}

function WIX_verifyCopiedQd_(spreadsheet) {
  const errors = [];
  const templateBook = SpreadsheetApp.openById(WIX_QD_FACTORY_CFG.TEMPLATE_FILE_ID);
  [WIX_QD_FACTORY_CFG.QUOTATION_SHEET, WIX_QD_FACTORY_CFG.DRAFT_SHEET].forEach(function (name) {
    const copied = spreadsheet.getSheetByName(name);
    const template = templateBook.getSheetByName(name);
    if (!copied || !template) {
      errors.push('Missing sheet: ' + name);
      return;
    }
    if (copied.getMaxRows() !== template.getMaxRows()) errors.push(name + ' row count changed');
    if (copied.getMaxColumns() !== template.getMaxColumns()) errors.push(name + ' column count changed');
    if (WIX_formulaCount_(copied) !== WIX_formulaCount_(template)) errors.push(name + ' formula count changed');
    if (copied.getConditionalFormatRules().length !== template.getConditionalFormatRules().length) errors.push(name + ' conditional formatting changed');
    if (WIX_validationCount_(copied) !== WIX_validationCount_(template)) errors.push(name + ' data validation changed');
    if (WIX_protectionCount_(copied) !== WIX_protectionCount_(template)) errors.push(name + ' protected ranges changed');
    if (copied.getFrozenRows() !== template.getFrozenRows()) errors.push(name + ' frozen rows changed');
    if (copied.getFrozenColumns() !== template.getFrozenColumns()) errors.push(name + ' frozen columns changed');
  });
  return { ok: errors.length === 0, errors: errors };
}

function WIX_formulaCount_(sheet) {
  return sheet.getDataRange().getFormulas().reduce(function (total, row) {
    return total + row.filter(Boolean).length;
  }, 0);
}

function WIX_validationCount_(sheet) {
  return sheet.getDataRange().getDataValidations().reduce(function (total, row) {
    return total + row.filter(Boolean).length;
  }, 0);
}

function WIX_protectionCount_(sheet) {
  return sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length +
    sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).length;
}

function WIX_findExistingQd_(customerId) {
  const folder = DriveApp.getFolderById(WIX_QD_FACTORY_CFG.DESTINATION_FOLDER_ID);
  const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (files.hasNext()) {
    const file = files.next();
    if (file.getName().indexOf(customerId) === -1) continue;
    try {
      const spreadsheet = SpreadsheetApp.openById(file.getId());
      if (WIX_spreadsheetMetadataValue_(spreadsheet, WIX_QD_FACTORY_CFG.CUSTOMER_ID_METADATA) === customerId) {
        return file;
      }
    } catch (_) {}
  }
  return null;
}

function WIX_describeQd_(file, p, idempotent, forcedStatus) {
  const spreadsheet = SpreadsheetApp.openById(file.getId());
  const quotation = spreadsheet.getSheetByName(WIX_QD_FACTORY_CFG.QUOTATION_SHEET);
  const status = forcedStatus || WIX_spreadsheetMetadataValue_(
    spreadsheet,
    WIX_QD_FACTORY_CFG.BUILD_STATUS_METADATA
  ) || 'ACTIVATION_REQUIRED';
  return {
    customerId: p.customerId,
    customerStatus: status === 'READY' ? 'REGISTERED' : 'ACTIVATION REQUIRED',
    qdStatus: status,
    qdFileId: file.getId(),
    qdFileName: file.getName(),
    qdSheetId: quotation ? String(quotation.getSheetId()) : '',
    qdSheetName: WIX_QD_FACTORY_CFG.QUOTATION_SHEET,
    qdTemplateVersion: WIX_QD_FACTORY_CFG.TEMPLATE_VERSION,
    idempotent: Boolean(idempotent),
    accessCreated: status === 'READY'
  };
}

function WIX_setSpreadsheetMetadata_(spreadsheet, key, value) {
  spreadsheet.getDeveloperMetadata().forEach(function (metadata) {
    if (metadata.getKey() === key) metadata.remove();
  });
  spreadsheet.addDeveloperMetadata(key, String(value || ''));
}

function WIX_spreadsheetMetadataValue_(spreadsheet, key) {
  let value = '';
  spreadsheet.getDeveloperMetadata().forEach(function (metadata) {
    if (metadata.getKey() === key) value = String(metadata.getValue() || '').trim().toUpperCase();
  });
  return value;
}

function WIX_qdFileName_(companyName, customerId) {
  return ('QD - ' + companyName + ' - ' + customerId)
    .replace(/[\\:*?"<>|]/g, ' ')
    .replace(/\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function WIX_validateFactoryPayload_(raw) {
  const p = WIX_validateVerifyPayload_(raw);
  p.companyName = String(raw.companyName || '').trim().toUpperCase();
  p.currency = String(raw.currency || '').trim().toUpperCase();
  if (!p.companyName) throw new Error('Company name is required.');
  if (!/^(USD|MYR|SGD|RMB|JPY)$/.test(p.currency)) throw new Error('Invalid quotation currency.');
  return p;
}

function WIX_validateVerifyPayload_(raw) {
  const p = {
    customerId: String(raw.customerId || '').trim().toUpperCase(),
    assignedStaffId: String(raw.assignedStaffId || '').trim().toUpperCase(),
    qdFileId: String(raw.qdFileId || '').trim()
  };
  if (!/^CUS-\d{6}-[A-Z0-9]{6}$/.test(p.customerId)) throw new Error('Invalid Wix Customer ID.');
  if (p.assignedStaffId && !/^STF-[A-Z0-9]{5,20}$/.test(p.assignedStaffId)) throw new Error('Invalid assigned Staff ID.');
  if (p.qdFileId && !/^[A-Za-z0-9_-]{20,}$/.test(p.qdFileId)) throw new Error('Invalid QD File ID.');
  return p;
}
