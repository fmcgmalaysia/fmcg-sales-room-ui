/**
 * FMCG MALAYSIA — INDEPENDENT QUOTATION DESK TOOLS V3
 *
 * Architecture:
 * - One Google Spreadsheet per customer.
 * - Header row: 5. Hidden formula row: 6. First product row: 7.
 * - WIX POINT BASE is the product and cost source of truth.
 * - Wix CMS is the workflow source of truth for selection, quote and order state.
 * - QD row statuses: RFQ, VIEW QUOTE, FAILED.
 *
 * Important:
 * - Replace the old QD script. Do not paste this below the old script.
 * - Configure WIX_QUOTE_SYNC_URL and WIX_QUOTE_SYNC_TOKEN in Script Properties
 *   before using SYNC QUOTATION TO WIX.
 */

const QD_CFG = Object.freeze({
  VERSION: "3.0.0",
  POINT_BASE_ID: "12tyTIrmjF6JxMY-JW8K3JLuz5TcCkEjQUFXsauberLg",
  POINT_BASE_SHEETS: ["FOOD", "NONFOOD", "OTHERS"],

  HEADER_ROW: 5,
  FORMULA_ROW: 6,
  DATA_START_ROW: 7,
  DATA_END_ROW: 3003,
  MAX_COST_ROWS_PER_RUN: 100,

  STATUS: Object.freeze({
    RFQ: "RFQ",
    VIEW: "VIEW QUOTE",
    FAILED: "FAILED"
  }),

  HEADERS: Object.freeze({
    COST_HEALTH: "COST HEALTH",
    QUOTE_STATUS: "QUOTE STATUS",
    BARCODE: "UNIT BARCODE",
    ITEM_NAME: "ITEM NAME",
    PACKING_SIZE: "PACKING SIZE",
    EA: "EA",
    LP_PC: "LP /PC",
    LP_CTN: "LP /CTN",
    DISC_1: "DISC 1",
    DISC_2: "DISC 2",
    DISC_3: "DISC 3",
    NET_COST_CTN: "NET COST /CTN",
    QUOTE_PC: "QUOTE $/PC",
    QUOTE_CTN: "QUOTE $/CTN",
    PROFIT: "PROFIT (MYR)",
    GP: "GP",
    TARGET_GP: "TARGET GP",
    REFERENCE_PC: "REFRE. $/PC",
    SORT_ID: "SORT NO.",
    WIX_MY_LIST_ID: "WIX MY LIST ID"
  }),

  REQUIRED_QD_HEADERS: Object.freeze([
    "COST HEALTH",
    "QUOTE STATUS",
    "UNIT BARCODE",
    "ITEM NAME",
    "PACKING SIZE",
    "EA",
    "LP /PC",
    "LP /CTN",
    "DISC 1",
    "DISC 2",
    "DISC 3",
    "NET COST /CTN",
    "QUOTE $/PC",
    "QUOTE $/CTN",
    "TARGET GP",
    "SORT NO.",
    "WIX MY LIST ID"
  ]),

  // Only these user/system values move when sorting. Formula columns remain in place.
  SORT_MOVABLE_HEADERS: Object.freeze([
    "QUOTE STATUS",
    "UNIT BARCODE",
    "ITEM NAME",
    "PACKING SIZE",
    "EA",
    "LP /PC",
    "LP /CTN",
    "DISC 1",
    "DISC 2",
    "DISC 3",
    "QUOTE $/PC",
    "TARGET GP",
    "WIX MY LIST ID"
  ]),

  SYNC_URL_PROPERTY: "WIX_QUOTE_SYNC_URL",
  SYNC_TOKEN_PROPERTY: "WIX_QUOTE_SYNC_TOKEN"
});


function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("QUOTATION DESK")
    .addItem("CATCH COST", "catchCostCurrentQuotationDesk")
    .addItem("SORT BY CATALOGUE ORDER", "sortQuotationByCatalogueOrder")
    .addSeparator()
    .addItem("SYNC QUOTATION TO WIX", "syncQuotationToWix")
    .addSeparator()
    .addItem("CHECK QD SETUP", "checkQuotationDeskSetup")
    .addToUi();
}


/**
 * Protects the three-state workflow at edit time.
 * VIEW QUOTE is only a salesperson's sync selection. It is not proof that Wix
 * already received the quote. The sync command makes that distinction explicit.
 */
function onEdit(e) {
  if (!e || !e.range) return;

  // COST HEALTH is recalculated independently and never changes QUOTE STATUS.
  ccHandleCostEdit_(e);

  const sheet = e.range.getSheet();
  const firstRow = Math.max(e.range.getRow(), QD_CFG.DATA_START_ROW);
  const lastRow = Math.min(e.range.getLastRow(), QD_CFG.DATA_END_ROW);
  if (lastRow < firstRow) return;

  let headers;
  try {
    headers = getHeaderMap_(sheet, QD_CFG.HEADER_ROW);
  } catch (error) {
    return;
  }

  if (!hasHeader_(headers, QD_CFG.HEADERS.QUOTE_STATUS) ||
      !hasHeader_(headers, QD_CFG.HEADERS.BARCODE)) return;

  const statusCol = getHeaderCol_(headers, QD_CFG.HEADERS.QUOTE_STATUS);
  const barcodeCol = getHeaderCol_(headers, QD_CFG.HEADERS.BARCODE);
  const touchesStatus = rangeTouchesColumn_(e.range, statusCol);
  const touchesBarcode = rangeTouchesColumn_(e.range, barcodeCol);
  if (!touchesStatus && !touchesBarcode) return;

  const rowCount = lastRow - firstRow + 1;
  const statuses = sheet.getRange(firstRow, statusCol, rowCount, 1).getDisplayValues();
  const barcodes = sheet.getRange(firstRow, barcodeCol, rowCount, 1).getDisplayValues();
  const output = [];
  const notes = [];
  let blockedCount = 0;

  for (let i = 0; i < rowCount; i++) {
    const barcode = normalizeBarcode_(barcodes[i][0]);
    const status = normalizeStatus_(statuses[i][0]);

    if (!barcode) {
      output.push([""]);
      notes.push([""]);
      continue;
    }

    if (!status) {
      output.push([QD_CFG.STATUS.RFQ]);
      notes.push([""]);
      continue;
    }

    if (status === QD_CFG.STATUS.RFQ || status === QD_CFG.STATUS.FAILED) {
      output.push([status]);
      notes.push([""]);
      continue;
    }

    if (status === QD_CFG.STATUS.VIEW) {
      const validation = validateQuoteRow_(sheet, headers, firstRow + i);
      if (validation.ok) {
        output.push([QD_CFG.STATUS.VIEW]);
        notes.push([""]);
      } else {
        blockedCount++;
        output.push([QD_CFG.STATUS.RFQ]);
        notes.push(["VIEW QUOTE blocked: " + validation.errors.join("; ")]);
      }
      continue;
    }

    blockedCount++;
    output.push([QD_CFG.STATUS.RFQ]);
    notes.push(["Unknown status was reset to RFQ."]);
  }

  const statusRange = sheet.getRange(firstRow, statusCol, rowCount, 1);
  statusRange.setValues(output).setNotes(notes);

  if (blockedCount) {
    SpreadsheetApp.getActive().toast(
      blockedCount + " row(s) were reset to RFQ. Check the note in QUOTE STATUS.",
      "VIEW QUOTE BLOCKED",
      8
    );
  }
}


function sortQuotationByCatalogueOrder() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    ui.alert("SORT", "Another QD task is running. Please try again.", ui.ButtonSet.OK);
    return;
  }

  try {
    const headers = getHeaderMap_(sheet, QD_CFG.HEADER_ROW);
    validateHeaders_(headers, [QD_CFG.HEADERS.BARCODE, QD_CFG.HEADERS.SORT_ID]);

    const barcodeCol = getHeaderCol_(headers, QD_CFG.HEADERS.BARCODE);
    const sortCol = getHeaderCol_(headers, QD_CFG.HEADERS.SORT_ID);
    const lastRow = findLastDataRow_(sheet, barcodeCol);
    if (lastRow < QD_CFG.DATA_START_ROW) {
      ui.alert("SORT", "There are no product rows to sort.", ui.ButtonSet.OK);
      return;
    }

    const rowCount = lastRow - QD_CFG.DATA_START_ROW + 1;
    const lastCol = sheet.getLastColumn();
    const values = sheet.getRange(QD_CFG.DATA_START_ROW, 1, rowCount, lastCol).getValues();
    const barcodeIndex = barcodeCol - 1;
    const sortIndex = sortCol - 1;

    const rows = values
      .map(row => ({
        row: row,
        barcode: normalizeBarcode_(row[barcodeIndex]),
        sort: normalizeSortId_(row[sortIndex])
      }))
      .filter(item => item.barcode)
      .sort((a, b) => {
        if (a.sort.rank !== b.sort.rank) return a.sort.rank - b.sort.rank;
        const bySort = a.sort.value.localeCompare(b.sort.value, undefined, { numeric: true });
        return bySort || a.barcode.localeCompare(b.barcode);
      });

    QD_CFG.SORT_MOVABLE_HEADERS.forEach(header => {
      if (!hasHeader_(headers, header)) return;
      const sourceIndex = getHeaderIndex_(headers, header);
      const targetCol = sourceIndex + 1;
      const destination = sheet.getRange(QD_CFG.DATA_START_ROW, targetCol, rowCount, 1);
      destination.clearContent().clearNote();
      if (rows.length) destination.offset(0, 0, rows.length, 1)
        .setValues(rows.map(item => [item.row[sourceIndex]]));
    });

    ui.alert("SORT DONE", rows.length + " product row(s) sorted by SORT NO.", ui.ButtonSet.OK);
  } catch (error) {
    ui.alert("SORT ERROR", error.message, ui.ButtonSet.OK);
    throw error;
  } finally {
    lock.releaseLock();
  }
}


/**
 * Sends only rows deliberately marked VIEW QUOTE.
 * Success remains VIEW QUOTE. A rejected/failed row becomes FAILED.
 * RFQ rows are untouched.
 */
function syncQuotationToWix() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    ui.alert("SYNC", "Another QD task is running. Please try again.", ui.ButtonSet.OK);
    return;
  }

  try {
    const headers = getHeaderMap_(sheet, QD_CFG.HEADER_ROW);
    validateHeaders_(headers, QD_CFG.REQUIRED_QD_HEADERS);

    const config = getSyncConfig_();
    const customerId = getMetadataValue_(sheet, "CUSTOMER ID");
    if (!customerId) throw new Error("CUSTOMER ID is missing from the QD header section.");

    const barcodeCol = getHeaderCol_(headers, QD_CFG.HEADERS.BARCODE);
    const lastRow = findLastDataRow_(sheet, barcodeCol);
    if (lastRow < QD_CFG.DATA_START_ROW) throw new Error("No quotation rows found.");

    const candidates = [];
    for (let row = QD_CFG.DATA_START_ROW; row <= lastRow; row++) {
      const status = normalizeStatus_(getCellByHeader_(sheet, headers, row, QD_CFG.HEADERS.QUOTE_STATUS));
      if (status !== QD_CFG.STATUS.VIEW) continue;

      const validation = validateQuoteRow_(sheet, headers, row);
      if (!validation.ok) {
        candidates.push({ row: row, invalid: true, errors: validation.errors });
        continue;
      }

      candidates.push({
        row: row,
        invalid: false,
        myListId: String(getCellByHeader_(sheet, headers, row, QD_CFG.HEADERS.WIX_MY_LIST_ID)).trim(),
        barcode: normalizeBarcode_(getCellByHeader_(sheet, headers, row, QD_CFG.HEADERS.BARCODE)),
        quotePerPc: Number(getCellByHeader_(sheet, headers, row, QD_CFG.HEADERS.QUOTE_PC)),
        quotePerCtn: Number(getCellByHeader_(sheet, headers, row, QD_CFG.HEADERS.QUOTE_CTN)),
        targetGp: numberOrNull_(getCellByHeader_(sheet, headers, row, QD_CFG.HEADERS.TARGET_GP))
      });
    }

    if (!candidates.length) {
      ui.alert("SYNC", "No rows are marked VIEW QUOTE.", ui.ButtonSet.OK);
      return;
    }

    const invalid = candidates.filter(item => item.invalid);
    markSyncFailures_(sheet, headers, invalid.map(item => ({
      row: item.row,
      error: item.errors.join("; ")
    })));

    const ready = candidates.filter(item => !item.invalid);
    if (!ready.length) throw new Error("All VIEW QUOTE rows failed validation.");

    const requestId = Utilities.getUuid();
    const payload = {
      schemaVersion: 1,
      requestId: requestId,
      customerId: String(customerId).trim(),
      quotationDeskFileId: SpreadsheetApp.getActive().getId(),
      quotationDeskFileUrl: SpreadsheetApp.getActive().getUrl(),
      actorEmail: Session.getActiveUser().getEmail() || "",
      sentAt: new Date().toISOString(),
      quotations: ready.map(item => ({
        wixMyListId: item.myListId,
        unitBarcode: item.barcode,
        quotePerPc: item.quotePerPc,
        quotePerCtn: item.quotePerCtn,
        targetGp: item.targetGp
      }))
    };

    const response = UrlFetchApp.fetch(config.url, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + config.token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const httpCode = response.getResponseCode();
    let body;
    try {
      body = JSON.parse(response.getContentText() || "{}");
    } catch (error) {
      body = {};
    }

    if (httpCode < 200 || httpCode >= 300 || body.ok === false) {
      const message = body.error || body.message || ("HTTP " + httpCode);
      markSyncFailures_(sheet, headers, ready.map(item => ({ row: item.row, error: message })));
      throw new Error("Wix sync failed: " + message);
    }

    const resultMap = new Map();
    (Array.isArray(body.results) ? body.results : []).forEach(item => {
      resultMap.set(String(item.wixMyListId || item.myListId || ""), item);
    });

    const failed = [];
    let synced = 0;
    ready.forEach(item => {
      const result = resultMap.size ? resultMap.get(item.myListId) : { ok: true };
      if (!result || result.ok === false) {
        failed.push({ row: item.row, error: (result && (result.error || result.message)) || "No result returned by Wix." });
      } else {
        synced++;
      }
    });
    markSyncFailures_(sheet, headers, failed);

    ui.alert(
      "SYNC COMPLETE",
      "Sent: " + ready.length +
      "\nSynced: " + synced +
      "\nFailed: " + (failed.length + invalid.length) +
      "\nRequest ID: " + requestId,
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert("SYNC ERROR", error.message, ui.ButtonSet.OK);
    throw error;
  } finally {
    lock.releaseLock();
  }
}


function checkQuotationDeskSetup() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  try {
    const headers = getHeaderMap_(sheet, QD_CFG.HEADER_ROW);
    validateHeaders_(headers, QD_CFG.REQUIRED_QD_HEADERS);
    const customerId = getMetadataValue_(sheet, "CUSTOMER ID");
    if (!customerId) throw new Error("CUSTOMER ID is missing.");
    const pb = SpreadsheetApp.openById(QD_CFG.POINT_BASE_ID);
    QD_CFG.POINT_BASE_SHEETS.forEach(name => {
      if (!pb.getSheetByName(name)) throw new Error("WIX POINT BASE is missing tab: " + name);
    });

    let syncMessage = "Wix sync configuration: ready";
    try {
      getSyncConfig_();
    } catch (error) {
      syncMessage = "Wix sync configuration: not configured";
    }

    ui.alert(
      "QD SETUP",
      "Version: " + QD_CFG.VERSION +
      "\nCustomer ID: " + customerId +
      "\nQD File ID: " + SpreadsheetApp.getActive().getId() +
      "\nPoint Base access: ready" +
      "\n" + syncMessage,
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert("QD SETUP ERROR", error.message, ui.ButtonSet.OK);
    throw error;
  }
}


function buildPointBaseMap_(wantedBarcodes) {
  const output = Object.create(null);
  if (!wantedBarcodes || !wantedBarcodes.size) return output;

  const book = SpreadsheetApp.openById(QD_CFG.POINT_BASE_ID);
  QD_CFG.POINT_BASE_SHEETS.forEach(sheetName => {
    const sheet = book.getSheetByName(sheetName);
    if (!sheet) throw new Error("WIX POINT BASE is missing tab: " + sheetName);

    const headers = getHeaderMap_(sheet, 1);
    const required = [
      "STATUS", "COST FRESHNESS", "UNIT BARCODE", "ITEM NAME", "PACKING SIZE",
      "EA", "COST /PC", "COST /CTN", "DISC. 1", "DISC. 2", "DISC. 3",
      "NET COST /CTN"
    ];
    validateHeaders_(headers, required, "WIX POINT BASE " + sheetName);

    const barcodeCol = getHeaderCol_(headers, "UNIT BARCODE");
    const lastRow = findLastDataRow_(sheet, barcodeCol, 2);
    if (lastRow < 2) return;

    const barcodeValues = sheet.getRange(2, barcodeCol, lastRow - 1, 1).getDisplayValues();
    const hitRows = [];
    barcodeValues.forEach((value, index) => {
      const barcode = normalizeBarcode_(value[0]);
      if (barcode && wantedBarcodes.has(barcode)) hitRows.push(index + 2);
    });

    hitRows.forEach(row => {
      const record = {
        sourceSheet: sheetName,
        sourceRow: row,
        status: normalizeUpper_(getCellByHeader_(sheet, headers, row, "STATUS")),
        freshness: String(getCellByHeader_(sheet, headers, row, "COST FRESHNESS") || "").trim(),
        barcode: normalizeBarcode_(getCellByHeader_(sheet, headers, row, "UNIT BARCODE")),
        itemName: getCellByHeader_(sheet, headers, row, "ITEM NAME"),
        packingSize: getCellByHeader_(sheet, headers, row, "PACKING SIZE"),
        ea: getCellByHeader_(sheet, headers, row, "EA"),
        costPc: getCellByHeader_(sheet, headers, row, "COST /PC"),
        costCtn: getCellByHeader_(sheet, headers, row, "COST /CTN"),
        disc1: getCellByHeader_(sheet, headers, row, "DISC. 1"),
        disc2: getCellByHeader_(sheet, headers, row, "DISC. 2"),
        disc3: getCellByHeader_(sheet, headers, row, "DISC. 3"),
        netCostCtn: getCellByHeader_(sheet, headers, row, "NET COST /CTN")
      };
      addUniqueRecord_(output, record.barcode, record);
    });
  });

  return output;
}


function classifyPointBaseResult_(target, source) {
  if (!target.barcode) return { row: target.row, ok: false, reason: "BLANK" };
  if (!source) return { row: target.row, ok: false, reason: "NOT_FOUND" };
  if (source.duplicate) return { row: target.row, ok: false, reason: "DUPLICATE" };
  if (source.status !== "ACTIVE") return { row: target.row, ok: false, reason: "NOT_ACTIVE" };

  const requiredValues = [
    source.itemName, source.packingSize, source.ea, source.costPc,
    source.costCtn, source.netCostCtn
  ];
  if (requiredValues.some(value => isBlank_(value)) ||
      !isFinitePositive_(source.ea) ||
      !isFinitePositive_(source.costCtn) ||
      !isFinitePositive_(source.netCostCtn)) {
    return { row: target.row, ok: false, reason: "INCOMPLETE" };
  }

  return { row: target.row, ok: true, source: source };
}


function writeCostResults_(sheet, headers, success, failed) {
  const statusCol = getHeaderCol_(headers, QD_CFG.HEADERS.QUOTE_STATUS);
  const fields = [
    [QD_CFG.HEADERS.ITEM_NAME, "itemName"],
    [QD_CFG.HEADERS.PACKING_SIZE, "packingSize"],
    [QD_CFG.HEADERS.EA, "ea"],
    [QD_CFG.HEADERS.LP_PC, "costPc"],
    [QD_CFG.HEADERS.LP_CTN, "costCtn"],
    [QD_CFG.HEADERS.DISC_1, "disc1"],
    [QD_CFG.HEADERS.DISC_2, "disc2"],
    [QD_CFG.HEADERS.DISC_3, "disc3"]
  ];

  success.forEach(result => {
    fields.forEach(field => {
      sheet.getRange(result.row, getHeaderCol_(headers, field[0])).setValue(result.source[field[1]]);
    });
    const statusCell = sheet.getRange(result.row, statusCol);
    if (!normalizeStatus_(statusCell.getDisplayValue())) statusCell.setValue(QD_CFG.STATUS.RFQ);
    statusCell.clearNote();
  });

  failed.forEach(result => {
    [QD_CFG.HEADERS.LP_PC, QD_CFG.HEADERS.LP_CTN, QD_CFG.HEADERS.DISC_1,
      QD_CFG.HEADERS.DISC_2, QD_CFG.HEADERS.DISC_3, QD_CFG.HEADERS.SORT_ID]
      .forEach(header => sheet.getRange(result.row, getHeaderCol_(headers, header)).clearContent());
    const statusCell = sheet.getRange(result.row, statusCol);
    if (normalizeStatus_(statusCell.getDisplayValue()) === QD_CFG.STATUS.VIEW) {
      statusCell.setValue(QD_CFG.STATUS.RFQ);
    }
    statusCell.setNote("Cost refresh blocked: " + result.reason);
  });
}


function validateQuoteRow_(sheet, headers, row) {
  const errors = [];
  const barcode = normalizeBarcode_(getCellByHeader_(sheet, headers, row, QD_CFG.HEADERS.BARCODE));
  const costHealth = String(getCellByHeader_(sheet, headers, row, QD_CFG.HEADERS.COST_HEALTH) || "").trim();
  const netCost = getCellByHeader_(sheet, headers, row, QD_CFG.HEADERS.NET_COST_CTN);
  const quotePc = getCellByHeader_(sheet, headers, row, QD_CFG.HEADERS.QUOTE_PC);
  const quoteCtn = getCellByHeader_(sheet, headers, row, QD_CFG.HEADERS.QUOTE_CTN);
  const myListId = String(getCellByHeader_(sheet, headers, row, QD_CFG.HEADERS.WIX_MY_LIST_ID) || "").trim();

  if (!barcode) errors.push("UNIT BARCODE is missing");
  if (!myListId) errors.push("WIX MY LIST ID is missing");
  if (!isFinitePositive_(netCost)) errors.push("NET COST /CTN must be greater than 0");
  if (!isFinitePositive_(quotePc)) errors.push("QUOTE $/PC must be greater than 0");
  if (!isFinitePositive_(quoteCtn)) errors.push("QUOTE $/CTN must be greater than 0");
  if (costHealth !== "🟢" && costHealth !== "🟠") {
    errors.push("COST HEALTH must be green or orange");
  }

  return { ok: errors.length === 0, errors: errors };
}


function markSyncFailures_(sheet, headers, failures) {
  if (!failures.length) return;
  const statusCol = getHeaderCol_(headers, QD_CFG.HEADERS.QUOTE_STATUS);
  failures.forEach(item => {
    sheet.getRange(item.row, statusCol)
      .setValue(QD_CFG.STATUS.FAILED)
      .setNote("Wix sync failed: " + item.error);
  });
}


function getSelectedDataRows_(sheet, barcodeCol, maxRows) {
  const rangeList = SpreadsheetApp.getActive().getActiveRangeList();
  if (!rangeList) throw new Error("Select continuous product rows first.");

  const rowSet = new Set();
  rangeList.getRanges().forEach(range => {
    for (let row = range.getRow(); row <= range.getLastRow(); row++) {
      if (row >= QD_CFG.DATA_START_ROW && row <= QD_CFG.DATA_END_ROW) rowSet.add(row);
    }
  });
  const allRows = Array.from(rowSet).sort((a, b) => a - b);
  if (!allRows.length) throw new Error("Select product rows from Row " + QD_CFG.DATA_START_ROW + " downward.");
  for (let i = 1; i < allRows.length; i++) {
    if (allRows[i] !== allRows[i - 1] + 1) throw new Error("Select continuous rows only.");
  }

  const rows = allRows.slice(0, maxRows);
  const values = sheet.getRange(rows[0], barcodeCol, rows.length, 1).getDisplayValues();
  const result = rows.map((row, index) => ({ row: row, barcode: normalizeBarcode_(values[index][0]) }));
  result.remainingCount = Math.max(0, allRows.length - rows.length);
  return result;
}


function getSyncConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const url = String(properties.getProperty(QD_CFG.SYNC_URL_PROPERTY) || "").trim();
  const token = String(properties.getProperty(QD_CFG.SYNC_TOKEN_PROPERTY) || "").trim();
  if (!url || !token) {
    throw new Error(
      "Wix sync is not configured. Add " + QD_CFG.SYNC_URL_PROPERTY +
      " and " + QD_CFG.SYNC_TOKEN_PROPERTY + " in Apps Script Properties."
    );
  }
  return { url: url, token: token };
}


function getMetadataValue_(sheet, label) {
  const searchRows = Math.min(QD_CFG.HEADER_ROW - 1, sheet.getMaxRows());
  const searchCols = Math.min(20, sheet.getMaxColumns());
  const values = sheet.getRange(1, 1, searchRows, searchCols).getDisplayValues();
  const key = normalizeHeader_(label);
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (normalizeHeader_(values[r][c]) === key) {
        for (let next = c + 1; next < values[r].length; next++) {
          if (String(values[r][next] || "").trim()) return values[r][next];
        }
      }
    }
  }
  return "";
}


function getHeaderMap_(sheet, headerRow) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol) throw new Error("No headers found.");
  const values = sheet.getRange(headerRow, 1, 1, lastCol).getDisplayValues()[0];
  const map = Object.create(null);
  values.forEach((value, index) => {
    const key = normalizeHeader_(value);
    if (!key) return;
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      throw new Error("Duplicate header: " + value);
    }
    map[key] = index;
  });
  return map;
}


function validateHeaders_(map, required, scope) {
  const missing = required.filter(header => !hasHeader_(map, header));
  if (missing.length) throw new Error((scope ? scope + " — " : "") + "Missing header(s): " + missing.join(", "));
}


function hasHeader_(map, header) {
  return Object.prototype.hasOwnProperty.call(map, normalizeHeader_(header));
}


function getHeaderIndex_(map, header) {
  const key = normalizeHeader_(header);
  if (!Object.prototype.hasOwnProperty.call(map, key)) throw new Error("Missing header: " + header);
  return map[key];
}


function getHeaderCol_(map, header) {
  return getHeaderIndex_(map, header) + 1;
}


function getCellByHeader_(sheet, map, row, header) {
  return sheet.getRange(row, getHeaderCol_(map, header)).getValue();
}


function findLastDataRow_(sheet, column, minimumRow) {
  const minRow = minimumRow || QD_CFG.DATA_START_ROW;
  const last = sheet.getRange(sheet.getMaxRows(), column)
    .getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
  return last < minRow ? minRow - 1 : last;
}


function rangeTouchesColumn_(range, column) {
  return range.getColumn() <= column && range.getLastColumn() >= column;
}


function addUniqueRecord_(map, key, record) {
  if (!map[key]) {
    map[key] = record;
  } else if (map[key].duplicate) {
    map[key].matches.push(record);
  } else {
    map[key] = { duplicate: true, matches: [map[key], record] };
  }
}


function normalizeHeader_(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  return normalized.indexOf("COST HEALTH") === 0 ? "COST HEALTH" : normalized;
}


function normalizeUpper_(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}


function normalizeStatus_(value) {
  const status = normalizeUpper_(value);
  if (status === "NEW RFQ") return QD_CFG.STATUS.RFQ;
  return status;
}


function normalizeBarcode_(value) {
  return String(value === null || value === undefined ? "" : value)
    .trim().replace(/\s+/g, "").replace(/\.0$/, "");
}


function normalizeSortId_(value) {
  const text = String(value || "").trim();
  if (!text || normalizeUpper_(text) === "NOT IN CATALOGUE") {
    return { rank: 2, value: "ZZZZZZZZ" };
  }
  return { rank: 1, value: text };
}


function numberOrNull_(value) {
  if (isBlank_(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}


function isFinitePositive_(value) {
  if (isBlank_(value)) return false;
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}


function isBlank_(value) {
  return value === "" || value === null || value === undefined;
}

