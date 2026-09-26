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

/** Returns one compact risk count per customer for the Sales Room workspace. */
function WIX_getQuoteRiskCounts(payload) {
  const customers = Array.isArray(payload && payload.customers) ? payload.customers : [];
  const counts = customers.slice(0, 100).map(function (raw) {
    const customerId = String(raw && raw.customerId || '').trim().toUpperCase();
    const qdFileId = String(raw && raw.qdFileId || '').trim();
    if (!/^CUS-\d{6}-[A-Z0-9]{6}$/.test(customerId) || !/^[A-Za-z0-9_-]{20,}$/.test(qdFileId)) {
      return { customerId: customerId, quoteRiskCount: 0, redSignalCount: 0, lowGpCount: 0, error: 'Invalid QD reference.' };
    }
    try {
      const cache = CacheService.getScriptCache();
      const cacheKey = 'QD_RISK_' + qdFileId;
      const cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
      const qd = SpreadsheetApp.openById(qdFileId);
      if (WIX_spreadsheetMetadataValue_(qd, WIX_SELECTION_CFG.CUSTOMER_ID_METADATA) !== customerId) {
        throw new Error('QD Customer ID mismatch.');
      }
      const sheet = qd.getSheetByName(WIX_SELECTION_CFG.QD_SHEET);
      if (!sheet) throw new Error('WIX QUOTATION sheet is missing.');
      const lastRow = sheet.getLastRow();
      if (lastRow < WIX_SELECTION_CFG.QD_DATA_START_ROW) {
        return { customerId: customerId, quoteRiskCount: 0, redSignalCount: 0, lowGpCount: 0 };
      }
      const headers = WIX_selectionHeaderMap_(sheet);
      const barcodeColumn = headers['UNIT BARCODE'] || 2;
      const idColumn = headers['WIX MY LIST ID'] || 0;
      const rowCount = lastRow - WIX_SELECTION_CFG.QD_DATA_START_ROW + 1;
      const signals = sheet.getRange(WIX_SELECTION_CFG.QD_DATA_START_ROW, 1, rowCount, 1);
      const gp = sheet.getRange(WIX_SELECTION_CFG.QD_DATA_START_ROW, 16, rowCount, 1);
      const barcodes = sheet.getRange(WIX_SELECTION_CFG.QD_DATA_START_ROW, barcodeColumn, rowCount, 1).getDisplayValues();
      const ids = idColumn ? sheet.getRange(WIX_SELECTION_CFG.QD_DATA_START_ROW, idColumn, rowCount, 1).getDisplayValues() : [];
      const signalText = signals.getDisplayValues();
      const signalBackgrounds = signals.getBackgrounds();
      const signalFonts = signals.getFontColors();
      const gpValues = gp.getValues();
      const gpDisplay = gp.getDisplayValues();
      let quoteRiskCount = 0;
      let redSignalCount = 0;
      let lowGpCount = 0;
      for (let index = 0; index < rowCount; index++) {
        const activeRow = String(barcodes[index] && barcodes[index][0] || '').trim() || String(ids[index] && ids[index][0] || '').trim();
        if (!activeRow) continue;
        const redSignal = WIX_hasRedQuoteSignal_(signalText[index][0], signalBackgrounds[index][0], signalFonts[index][0]);
        const lowGp = WIX_isLowGp_(gpValues[index][0], gpDisplay[index][0]);
        if (redSignal) redSignalCount += 1;
        if (lowGp) lowGpCount += 1;
        if (redSignal || lowGp) quoteRiskCount += 1;
      }
      const result = { customerId: customerId, quoteRiskCount: quoteRiskCount, redSignalCount: redSignalCount, lowGpCount: lowGpCount };
      cache.put(cacheKey, JSON.stringify(result), 45);
      return result;
    } catch (error) {
      return { customerId: customerId, quoteRiskCount: 0, redSignalCount: 0, lowGpCount: 0, error: String(error && error.message || error) };
    }
  });
  return { counts: counts };
}

function WIX_hasRedQuoteSignal_(value, background, fontColor) {
  const text = String(value || '').trim().toUpperCase();
  return text.indexOf('🔴') >= 0 || text.indexOf('RED') >= 0 || text.indexOf('RISK') >= 0 || text.indexOf('DANGER') >= 0 || text.indexOf('WARNING') >= 0 || WIX_isRedColor_(background) || WIX_isRedColor_(fontColor);
}

function WIX_isRedColor_(value) {
  const color = String(value || '').trim().toLowerCase();
  const match = /^#([0-9a-f]{6})$/.exec(color);
  if (!match) return false;
  const red = parseInt(match[1].slice(0, 2), 16);
  const green = parseInt(match[1].slice(2, 4), 16);
  const blue = parseInt(match[1].slice(4, 6), 16);
  return red >= 150 && red > green * 1.25 && red > blue * 1.25;
}

function WIX_isLowGp_(rawValue, displayValue) {
  if (rawValue === '' || rawValue === null || typeof rawValue === 'undefined') return false;
  let value = Number(rawValue);
  if (!isFinite(value)) {
    const display = String(displayValue || '').replace(/,/g, '').trim();
    value = Number(display.replace('%', ''));
    if (!isFinite(value)) return false;
    if (display.indexOf('%') >= 0) value /= 100;
  }
  if (value > 1) value /= 100;
  return value < 0.06;
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
