/** Read-only identity recovery. The existing ADD_SELECTION remains the only QD writer. */
function WIX_resolveSelectionProductReference(payload) {
  const p = payload || {};
  const customerId = String(p.customerId || '').trim().toUpperCase();
  const qdFileId = String(p.qdFileId || '').trim();
  const selectionId = String(p.wixMyListId || '').trim();
  if (!/^CUS-\d{6}-[A-Z0-9]{6}$/.test(customerId) || !/^[A-Za-z0-9_-]{20,}$/.test(qdFileId)
      || !/^ml_[0-9a-f]{8}_[0-9a-f]{8}$/.test(selectionId)) throw new Error('Invalid selection reference.');
  const ref = p.reference || {};
  const imageKey = SPR_imageKey_(ref.imageUrl);
  const packing = SPR_text_(ref.packingSize);
  if (!imageKey || !packing) throw new Error('Product identity reference is incomplete. Internal review required.');
  const qd = SpreadsheetApp.openById(qdFileId);
  if (WIX_spreadsheetMetadataValue_(qd, WIX_SELECTION_CFG.CUSTOMER_ID_METADATA) !== customerId
      || WIX_spreadsheetMetadataValue_(qd, WIX_SELECTION_CFG.BUILD_STATUS_METADATA) !== 'READY') {
    throw new Error('QD does not belong to this ready customer.');
  }
  const pointbase = SpreadsheetApp.openById(WIX_QD_FACTORY_CFG.POINT_BASE_FILE_ID);
  const matches = [];
  ['FOOD', 'NONFOOD', 'OTHERS'].forEach(function (name) {
    const sheet = pointbase.getSheetByName(name);
    if (!sheet) throw new Error('POINTBASE product sheet is missing.');
    const lastRow = sheet.getLastRow();
    if (lastRow < 3) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    const columns = {};
    ['STATUS', 'PRINCIPLE', 'UNIT BARCODE', 'ITEM NAME', 'PACKING SIZE', 'EA', 'WIX IMAGE URL'].forEach(function (header) {
      const found = [];
      headers.forEach(function (value, i) { if (SPR_text_(value) === header) found.push(i + 1); });
      if (found.length !== 1) throw new Error('POINTBASE identity header missing or duplicated: ' + header);
      columns[header] = found[0];
    });
    const images = sheet.getRange(3, columns['WIX IMAGE URL'], lastRow - 2, 1).getDisplayValues();
    const imageRows = [];
    images.forEach(function (row, i) { if (SPR_imageKey_(row[0]) === imageKey) imageRows.push(i + 3); });
    if (imageRows.length > 20) throw new Error('Product image reference is ambiguous. Internal review required.');
    imageRows.forEach(function (row) {
      // Read public identity fields only; never cost columns or a whole data row.
      const value = function (key) { return sheet.getRange(row, columns[key]).getDisplayValue(); };
      if (SPR_text_(value('STATUS')) !== 'ACTIVE' || SPR_text_(value('PACKING SIZE')) !== packing) return;
      const principle = String(value('PRINCIPLE') || '').trim();
      const ea = Number(value('EA'));
      if (SPR_text_(ref.principle) && SPR_text_(principle) !== SPR_text_(ref.principle)) return;
      if (Number(ref.eaPerCtn) > 0 && ea !== Number(ref.eaPerCtn)) return;
      if (!Number.isSafeInteger(ea) || ea <= 0) throw new Error('Source product carton quantity is invalid.');
      const rawBarcode = sheet.getRange(row, columns['UNIT BARCODE']).getValue();
      const barcode = String(value('UNIT BARCODE') || '').trim();
      matches.push({ unitBarcode: typeof rawBarcode === 'string' || (Number.isSafeInteger(rawBarcode) && Number(barcode) === rawBarcode) ? barcode : '',
        itemName: String(value('ITEM NAME') || '').trim(), packingSize: String(value('PACKING SIZE') || '').trim(),
        principle: principle, eaPerCtn: ea, imageKey: imageKey });
    });
  });
  if (matches.length !== 1) throw new Error(matches.length ? 'Source product identity is ambiguous. Internal review required.' : 'Source product identity was not found. Internal review required.');
  const product = matches[0];
  if (!/^\d{6,18}$/.test(product.unitBarcode)) throw new Error('Source product barcode still needs correction.');
  if (!product.itemName) throw new Error('Source product name is missing.');
  const quotation = qd.getSheetByName(WIX_SELECTION_CFG.QD_SHEET);
  if (!quotation) throw new Error('WIX QUOTATION sheet is missing.');
  const headers = WIX_selectionHeaderMap_(quotation);
  if (!headers['WIX MY LIST ID'] || !headers['UNIT BARCODE']) throw new Error('QD identity header is missing.');
  const last = Math.max(quotation.getLastRow(), WIX_SELECTION_CFG.QD_DATA_START_ROW);
  const ids = quotation.getRange(WIX_SELECTION_CFG.QD_DATA_START_ROW, headers['WIX MY LIST ID'], last - WIX_SELECTION_CFG.QD_DATA_START_ROW + 1, 1).getDisplayValues();
  ids.forEach(function (row, i) {
    if (String(row[0] || '').trim() !== selectionId) return;
    const barcode = String(quotation.getRange(i + WIX_SELECTION_CFG.QD_DATA_START_ROW, headers['UNIT BARCODE']).getDisplayValue() || '').trim();
    if (barcode !== product.unitBarcode) throw new Error('Existing QD row uses another barcode. Internal review required.');
  });
  return Object.assign({ kind: 'SELECTION_PRODUCT_REFERENCE_V1', customerId: customerId, wixMyListId: selectionId }, product);
}

function SPR_text_(value) { return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toUpperCase(); }
function SPR_imageKey_(value) {
  const match = /^(?:https?:\/\/static\.wixstatic\.com\/media\/|(?:wix:)?image:\/\/v1\/)([^/?#]+)/i.exec(String(value || '').trim());
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch (_) { return ''; }
}
