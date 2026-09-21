/** Central Wix My Selection -> independent customer QD writer. */
const WIX_SELECTION_CFG = Object.freeze({
  QD_SHEET: 'WIX QUOTATION',
  QD_HEADER_ROW: 5,
  QD_DATA_START_ROW: 7,
  CUSTOMER_ID_METADATA: 'WIX_CUSTOMER_ID',
  BUILD_STATUS_METADATA: 'WIX_QD_STATUS'
});

function WIX_addCatalogueSelection(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const p = WIX_validateSelectionPayload_(payload || {});
    const qd = SpreadsheetApp.openById(p.qdFileId);
    const storedCustomerId = WIX_spreadsheetMetadataValue_(qd, WIX_SELECTION_CFG.CUSTOMER_ID_METADATA);
    if (storedCustomerId !== p.customerId) throw new Error('QD Customer ID does not match the Wix customer record.');
    const buildStatus = WIX_spreadsheetMetadataValue_(qd, WIX_SELECTION_CFG.BUILD_STATUS_METADATA);
    if (buildStatus !== 'READY') throw new Error('Quotation Desk is not ready.');

    const sheet = qd.getSheetByName(WIX_SELECTION_CFG.QD_SHEET);
    if (!sheet) throw new Error('WIX QUOTATION sheet is missing.');
    const headers = WIX_selectionHeaderMap_(sheet);
    const required = ['QUOTE STATUS', 'UNIT BARCODE', 'WIX MY LIST ID'];
    required.forEach(function (name) { if (!headers[name]) throw new Error('QD header is missing: ' + name); });

    const idColumn = headers['WIX MY LIST ID'];
    const lastRow = Math.max(sheet.getLastRow(), WIX_SELECTION_CFG.QD_DATA_START_ROW);
    const existingIds = sheet.getRange(WIX_SELECTION_CFG.QD_DATA_START_ROW, idColumn, lastRow - WIX_SELECTION_CFG.QD_DATA_START_ROW + 1, 1).getDisplayValues();
    for (let index = 0; index < existingIds.length; index++) {
      if (String(existingIds[index][0] || '').trim() === p.wixMyListId) {
        return { customerId: p.customerId, wixMyListId: p.wixMyListId, qdRow: WIX_SELECTION_CFG.QD_DATA_START_ROW + index, idempotent: true };
      }
    }

    const row = WIX_firstEmptyQdRow_(sheet, headers['UNIT BARCODE'], idColumn);
    const values = {
      'QUOTE STATUS': 'RFQ',
      'UNIT BARCODE': p.unitBarcode,
      'WIX MY LIST ID': p.wixMyListId
    };
    Object.keys(values).forEach(function (name) { sheet.getRange(row, headers[name]).setValue(values[name]); });
    sheet.getRange(row, headers['UNIT BARCODE']).setNumberFormat('@');
    SpreadsheetApp.flush();
    return { customerId: p.customerId, wixMyListId: p.wixMyListId, qdRow: row, idempotent: false };
  } finally {
    lock.releaseLock();
  }
}

function WIX_removeCatalogueSelection(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const p = WIX_validateSelectionPayload_(payload || {});
    const qd = SpreadsheetApp.openById(p.qdFileId);
    const storedCustomerId = WIX_spreadsheetMetadataValue_(qd, WIX_SELECTION_CFG.CUSTOMER_ID_METADATA);
    if (storedCustomerId !== p.customerId) throw new Error('QD Customer ID does not match the Wix customer record.');
    if (WIX_spreadsheetMetadataValue_(qd, WIX_SELECTION_CFG.BUILD_STATUS_METADATA) !== 'READY') throw new Error('Quotation Desk is not ready.');
    const sheet = qd.getSheetByName(WIX_SELECTION_CFG.QD_SHEET);
    if (!sheet) throw new Error('WIX QUOTATION sheet is missing.');
    const headers = WIX_selectionHeaderMap_(sheet);
    if (!headers['WIX MY LIST ID']) throw new Error('QD header is missing: WIX MY LIST ID');
    const lastRow = Math.max(sheet.getLastRow(), WIX_SELECTION_CFG.QD_DATA_START_ROW);
    const ids = sheet.getRange(WIX_SELECTION_CFG.QD_DATA_START_ROW, headers['WIX MY LIST ID'], lastRow - WIX_SELECTION_CFG.QD_DATA_START_ROW + 1, 1).getDisplayValues();
    for (let index = 0; index < ids.length; index++) {
      if (String(ids[index][0] || '').trim() !== p.wixMyListId) continue;
      const row = WIX_SELECTION_CFG.QD_DATA_START_ROW + index;
      sheet.getRange(row, 1, 1, sheet.getLastColumn()).clearContent();
      SpreadsheetApp.flush();
      return { customerId: p.customerId, wixMyListId: p.wixMyListId, removedRow: row, idempotent: false };
    }
    return { customerId: p.customerId, wixMyListId: p.wixMyListId, removedRow: 0, idempotent: true };
  } finally {
    lock.releaseLock();
  }
}

function WIX_selectionHeaderMap_(sheet) {
  const values = sheet.getRange(WIX_SELECTION_CFG.QD_HEADER_ROW, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const map = {};
  values.forEach(function (value, index) { const key = String(value || '').trim().toUpperCase(); if (key) map[key] = index + 1; });
  return map;
}

function WIX_firstEmptyQdRow_(sheet, barcodeColumn, idColumn) {
  const count = sheet.getMaxRows() - WIX_SELECTION_CFG.QD_DATA_START_ROW + 1;
  const barcodes = sheet.getRange(WIX_SELECTION_CFG.QD_DATA_START_ROW, barcodeColumn, count, 1).getDisplayValues();
  const ids = sheet.getRange(WIX_SELECTION_CFG.QD_DATA_START_ROW, idColumn, count, 1).getDisplayValues();
  for (let index = 0; index < count; index++) {
    if (!String(barcodes[index][0] || '').trim() && !String(ids[index][0] || '').trim()) return WIX_SELECTION_CFG.QD_DATA_START_ROW + index;
  }
  throw new Error('Quotation Desk has no empty product rows.');
}

function WIX_validateSelectionPayload_(raw) {
  const p = {
    customerId: String(raw.customerId || '').trim().toUpperCase(),
    qdFileId: String(raw.qdFileId || '').trim(),
    wixMyListId: String(raw.wixMyListId || '').trim(),
    unitBarcode: WIX_normalizeBarcode_(raw.unitBarcode)
  };
  if (!/^CUS-\d{6}-[A-Z0-9]{6}$/.test(p.customerId)) throw new Error('Invalid Wix Customer ID.');
  if (!/^[A-Za-z0-9_-]{20,}$/.test(p.qdFileId)) throw new Error('Invalid QD File ID.');
  if (!/^ml_[0-9a-f]{8}_[0-9a-f]{8}$/.test(p.wixMyListId)) throw new Error('Invalid Wix My List ID.');
  if (!/^\d{6,18}$/.test(p.unitBarcode)) throw new Error('Invalid Unit Barcode.');
  return p;
}

function WIX_normalizeBarcode_(value) { return String(value || '').replace(/\.0$/, '').trim(); }
