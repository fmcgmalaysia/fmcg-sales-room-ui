/**
 * QUOTATION DESK — CATCH COST
 * Production module. Selected consecutive rows only, maximum 100.
 *
 * Never changes QUOTE STATUS, validation chips, formatting, or NET COST /CTN.
 * QD calculates NET COST /CTN; this module only compares it with POINT BASE.
 */

const QD_CATCH_COST_MAX_ROWS = 100;

function catchCostCurrentQuotationDesk() {
  const startedAt = Date.now();
  const timings = [];
  const recordTime = (label, stageStartedAt) =>
    timings.push(label + ": " + ((Date.now() - stageStartedAt) / 1000).toFixed(2) + " s");
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const cfg = ccConfig_();
  const lock = LockService.getDocumentLock();
  let notice;
  let stageStartedAt = Date.now();

  if (!lock.tryLock(30000)) {
    ui.alert("CATCH COST BLOCKED", "Another QD task is running. Please try again.", ui.ButtonSet.OK);
    return;
  }
  recordTime("Wait for lock", stageStartedAt);

  try {
    stageStartedAt = Date.now();
    const headers = ccHeaderMap_(sheet, cfg.HEADER_ROW);
    const profile = ccSheetProfile_(headers);
    ccRequireHeaders_(headers, [
      "UNIT BARCODE", "ITEM NAME", "PACKING SIZE", "EA",
      "LP /PC", "LP /CTN", "DISC 1", "DISC 2", "DISC 3",
      "NET COST /CTN"
    ], "QD");
    if (profile.costHealth) ccRequireHeaders_(headers, ["COST HEALTH"], "WIX QUOTATION");
    const columns = ccQdColumns_(headers, profile.costHealth);
    const targets = ccSelectedRows_(sheet, columns.barcode, cfg);
    recordTime("Validate headers and selection", stageStartedAt);

    stageStartedAt = Date.now();
    const wanted = new Map();
    targets.forEach(target => {
      if (!target.barcode) return;
      const key = target.barcode.toUpperCase();
      if (!wanted.has(key)) wanted.set(key, { barcode: target.barcode, rows: [] });
      wanted.get(key).rows.push(target.row);
    });
    const pointBase = wanted.size ? ccBuildPointBaseLookup_(wanted, cfg, timings) : new Map();
    recordTime("POINT BASE lookup total", stageStartedAt);

    const outcomes = new Map();
    const issueCounts = {
      blank: 0, notFound: 0, duplicate: 0, inactive: 0,
      discontinued: 0, otherStatus: 0, incomplete: 0, costMismatch: 0
    };
    targets.forEach(target => {
      if (!target.barcode) {
        outcomes.set(target.row, { kind: "problem", reason: "blank", light: "🔴", note: "UNIT BARCODE is blank." });
        issueCounts.blank++;
        return;
      }
      const classified = ccClassify_(pointBase.get(target.barcode.toUpperCase()) || []);
      outcomes.set(target.row, classified);
      if (classified.kind === "problem") issueCounts[classified.reason]++;
    });

    stageStartedAt = Date.now();
    const firstRow = targets[0].row;
    const currentBarcodes = sheet.getRange(firstRow, columns.barcode, targets.length, 1).getDisplayValues();
    targets.forEach((target, index) => {
      if (ccNormalizeBarcode_(currentBarcodes[index][0]) !== target.barcode) {
        throw new Error("Row " + target.row + " UNIT BARCODE changed during CATCH COST. Run it again.");
      }
    });
    recordTime("Recheck QD barcodes", stageStartedAt);

    stageStartedAt = Date.now();
    ccWriteCostInputs_(sheet, columns, targets, outcomes);
    SpreadsheetApp.flush();
    recordTime("Batch write cost inputs", stageStartedAt);

    stageStartedAt = Date.now();
    if (profile.costHealth) {
      issueCounts.costMismatch = ccWriteHealth_(sheet, columns, targets, outcomes);
      SpreadsheetApp.flush();
      recordTime("Verify QD net cost and write health", stageStartedAt);
    }

    const successCount = targets.filter(target => outcomes.get(target.row).kind === "success").length;
    const manualCount = profile.costHealth ? 0 : targets.filter(target => {
      const outcome = outcomes.get(target.row);
      return outcome && outcome.kind !== "success";
    }).length;
    const lines = profile.costHealth ? [
      "Selected: " + targets.length,
      "Source data updated: " + successCount,
      "Blank barcode: " + issueCounts.blank,
      "Not found: " + issueCounts.notFound,
      "Duplicate barcode: " + issueCounts.duplicate,
      "Inactive: " + issueCounts.inactive,
      "Discontinued: " + issueCounts.discontinued,
      "Other non-active status: " + issueCounts.otherStatus,
      "Incomplete source: " + issueCounts.incomplete,
      "QD / POINT BASE cost mismatch: " + issueCounts.costMismatch
    ] : [
      "Selected: " + targets.length,
      "POINT BASE products updated: " + successCount,
      "Manual products retained: " + manualCount
    ];
    const hasIssues = profile.costHealth && Object.keys(issueCounts)
      .some(key => key !== "blank" && issueCounts[key] > 0);
    notice = [hasIssues ? "CATCH COST COMPLETED WITH ISSUES" : "CATCH COST SUCCESS", lines.join("\n")];
  } catch (error) {
    notice = ["CATCH COST FAILED", error.message];
  } finally {
    lock.releaseLock();
    recordTime("Total time", startedAt);
    if (notice) ui.alert(notice[0], notice[1] + "\n\nTIME USED\n" + timings.join("\n"), ui.ButtonSet.OK);
  }
}

function ccConfig_() {
  if (typeof QD_CFG !== "undefined") return QD_CFG;
  if (typeof QD_TOOLS_CFG !== "undefined") return QD_TOOLS_CFG;
  throw new Error("QD configuration is missing.");
}

function ccSheetProfile_(headers) {
  return { costHealth: ccHasHeader_(headers, "COST HEALTH") };
}

function ccQdColumns_(headers, requireHealth) {
  const columns = {
    health: ccHasHeader_(headers, "COST HEALTH") ? ccHeaderCol_(headers, "COST HEALTH") : null,
    barcode: ccHeaderCol_(headers, "UNIT BARCODE"),
    itemName: ccHeaderCol_(headers, "ITEM NAME"), packingSize: ccHeaderCol_(headers, "PACKING SIZE"),
    ea: ccHeaderCol_(headers, "EA"), lpPc: ccHeaderCol_(headers, "LP /PC"),
    lpCtn: ccHeaderCol_(headers, "LP /CTN"), disc1: ccHeaderCol_(headers, "DISC 1"),
    disc2: ccHeaderCol_(headers, "DISC 2"), disc3: ccHeaderCol_(headers, "DISC 3"),
    netCost: ccHeaderCol_(headers, "NET COST /CTN")
  };
  if (requireHealth && !columns.health) throw new Error("Missing header: COST HEALTH");
  const continuous = [columns.itemName, columns.packingSize, columns.ea, columns.lpPc,
    columns.lpCtn, columns.disc1, columns.disc2, columns.disc3];
  for (let index = 1; index < continuous.length; index++) {
    if (continuous[index] !== continuous[index - 1] + 1) {
      throw new Error("QD columns ITEM NAME through DISC 3 must remain continuous.");
    }
  }
  return columns;
}

function ccSelectedRows_(sheet, barcodeCol, cfg) {
  const rangeList = SpreadsheetApp.getActive().getActiveRangeList();
  if (!rangeList) throw new Error("Select consecutive product rows first.");
  const rowSet = new Set();
  rangeList.getRanges().forEach(range => {
    for (let row = range.getRow(); row <= range.getLastRow(); row++) {
      if (row >= cfg.DATA_START_ROW && row <= cfg.DATA_END_ROW) rowSet.add(row);
    }
  });
  const rows = Array.from(rowSet).sort((a, b) => a - b);
  if (!rows.length) throw new Error("Select product rows from Row " + cfg.DATA_START_ROW + " or below.");
  if (rows.length > QD_CATCH_COST_MAX_ROWS) throw new Error("Maximum " + QD_CATCH_COST_MAX_ROWS + " rows per run.");
  for (let index = 1; index < rows.length; index++) {
    if (rows[index] !== rows[index - 1] + 1) throw new Error("Select consecutive rows only.");
  }
  const barcodes = sheet.getRange(rows[0], barcodeCol, rows.length, 1).getDisplayValues();
  return rows.map((row, index) => ({ row: row, barcode: ccNormalizeBarcode_(barcodes[index][0]) }));
}

function ccBuildPointBaseLookup_(wanted, cfg, timings) {
  const startedAt = Date.now();
  const book = SpreadsheetApp.openById(cfg.POINT_BASE_ID);
  if (timings) timings.push("Open POINT BASE: " + ((Date.now() - startedAt) / 1000).toFixed(2) + " s");
  const result = new Map();
  wanted.forEach((request, key) => result.set(key, []));

  cfg.POINT_BASE_SHEETS.forEach(sheetName => {
    let stageStartedAt = Date.now();
    const sheet = book.getSheetByName(sheetName);
    if (!sheet) throw new Error("WIX POINT BASE is missing tab: " + sheetName);
    const headers = ccHeaderMap_(sheet, 1);
    ccRequireHeaders_(headers, [
      "STATUS", "COST VERIFIED ON", "COST FRESHNESS", "UNIT BARCODE", "ITEM NAME", "PACKING SIZE",
      "EA", "COST /PC", "COST /CTN", "DISC. 1", "DISC. 2", "DISC. 3",
      "NET COST /CTN"
    ], "WIX POINT BASE " + sheetName);
    const cols = ccPointBaseColumns_(headers);
    const lastBarcodeRow = sheet.getRange(sheet.getMaxRows(), cols.barcode)
      .getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
    if (lastBarcodeRow < 2) return;
    const barcodeValues = sheet.getRange(2, cols.barcode, lastBarcodeRow - 1, 1).getDisplayValues();
    const hits = [];
    barcodeValues.forEach((value, index) => {
      const barcode = ccNormalizeBarcode_(value[0]);
      const key = barcode.toUpperCase();
      if (barcode && wanted.has(key)) hits.push({ row: index + 2, key: key });
    });
    if (timings) timings.push(sheetName + " scan barcodes (" + (lastBarcodeRow - 1) + " rows): " +
      ((Date.now() - stageStartedAt) / 1000).toFixed(2) + " s");

    stageStartedAt = Date.now();
    const lastNeededColumn = Math.max.apply(null, Object.keys(cols).map(key => cols[key]));
    let at = 0;
    let windows = 0;
    while (at < hits.length) {
      windows++;
      const startRow = hits[at].row;
      let endIndex = at + 1;
      while (endIndex < hits.length && hits[endIndex].row - startRow <= 99 &&
        hits[endIndex].row - hits[endIndex - 1].row <= 10) endIndex++;
      const endRow = hits[endIndex - 1].row;
      const height = endRow - startRow + 1;
      const values = sheet.getRange(startRow, 1, height, lastNeededColumn).getValues();
      const checkBarcodes = sheet.getRange(startRow, cols.barcode, height, 1).getDisplayValues();
      for (let index = at; index < endIndex; index++) {
        const hit = hits[index];
        const offset = hit.row - startRow;
        if (ccNormalizeBarcode_(checkBarcodes[offset][0]).toUpperCase() !== hit.key) {
          throw new Error("POINT BASE changed during lookup: " + sheetName + " Row " + hit.row);
        }
        const row = values[offset];
        result.get(hit.key).push({
          barcode: hit.key, source: sheetName + "!" + hit.row, status: ccUpper_(row[cols.status - 1]),
          costVerifiedOn: row[cols.costVerifiedOn - 1],
          freshness: String(row[cols.freshness - 1] || "").trim(),
          itemName: row[cols.itemName - 1], packingSize: row[cols.packingSize - 1],
          ea: row[cols.ea - 1], costPc: row[cols.costPc - 1], costCtn: row[cols.costCtn - 1],
          disc1: row[cols.disc1 - 1], disc2: row[cols.disc2 - 1], disc3: row[cols.disc3 - 1],
          netCostCtn: row[cols.netCostCtn - 1]
        });
      }
      at = endIndex;
    }
    if (timings) timings.push(sheetName + " read matches (" + hits.length + " rows / " + windows + " windows): " +
      ((Date.now() - stageStartedAt) / 1000).toFixed(2) + " s");
  });
  return result;
}

function ccPointBaseColumns_(headers) {
  return {
    status: ccHeaderCol_(headers, "STATUS"), costVerifiedOn: ccHeaderCol_(headers, "COST VERIFIED ON"),
    freshness: ccHeaderCol_(headers, "COST FRESHNESS"),
    barcode: ccHeaderCol_(headers, "UNIT BARCODE"), itemName: ccHeaderCol_(headers, "ITEM NAME"),
    packingSize: ccHeaderCol_(headers, "PACKING SIZE"), ea: ccHeaderCol_(headers, "EA"),
    costPc: ccHeaderCol_(headers, "COST /PC"), costCtn: ccHeaderCol_(headers, "COST /CTN"),
    disc1: ccHeaderCol_(headers, "DISC. 1"), disc2: ccHeaderCol_(headers, "DISC. 2"),
    disc3: ccHeaderCol_(headers, "DISC. 3"), netCostCtn: ccHeaderCol_(headers, "NET COST /CTN")
  };
}

function ccClassify_(matches) {
  if (!matches.length) return { kind: "problem", reason: "notFound", light: "🔴", note: "Barcode not found in POINT BASE." };
  if (matches.length > 1) return { kind: "problem", reason: "duplicate", light: "🔴", note: "Duplicate barcode: " + matches.map(item => item.source).join(" / ") };
  const source = matches[0];
  if (source.status !== "ACTIVE") {
    const reason = source.status === "INACTIVE" ? "inactive" :
      source.status === "DISCONTINUED" ? "discontinued" : "otherStatus";
    return { kind: "problem", reason: reason,
      light: reason === "inactive" || reason === "discontinued" ? "⚫" : "🔴",
      note: "POINT BASE status: " + (source.status || "BLANK") + " | " + source.source };
  }
  const missing = [];
  if (ccBlank_(source.itemName)) missing.push("ITEM NAME");
  if (ccBlank_(source.packingSize)) missing.push("PACKING SIZE");
  if (!ccNumber_(source.ea)) missing.push("EA");
  if (!ccNumber_(source.costPc) && !ccNumber_(source.costCtn)) missing.push("COST /PC or COST /CTN");
  if (!ccNumber_(source.netCostCtn)) missing.push("NET COST /CTN");
  if (missing.length) return { kind: "problem", reason: "incomplete", light: "🔴",
    note: "POINT BASE missing: " + missing.join(", ") + " | " + source.source };
  return { kind: "success", source: source };
}

function ccWriteCostInputs_(sheet, columns, targets, outcomes) {
  const firstRow = targets[0].row;
  if (!columns.health) {
    const productRange = sheet.getRange(firstRow, columns.itemName, targets.length, columns.lpPc - columns.itemName + 1);
    const productValues = productRange.getValues();
    const discountRange = sheet.getRange(firstRow, columns.disc1, targets.length, columns.disc3 - columns.disc1 + 1);
    const discountValues = discountRange.getValues();
    targets.forEach((target, index) => {
      const outcome = outcomes.get(target.row);
      if (outcome.kind !== "success") return;
      const source = outcome.source;
      productValues[index] = [source.itemName, source.packingSize, source.ea,
        ccNumber_(source.costPc) ? source.costPc : ""];
      discountValues[index] = [source.disc1, source.disc2, source.disc3];
    });
    productRange.setValues(productValues);
    discountRange.setValues(discountValues);
    return;
  }
  const width = columns.disc3 - columns.itemName + 1;
  const range = sheet.getRange(firstRow, columns.itemName, targets.length, width);
  const values = range.getValues();
  const formulas = range.getFormulas();
  const output = values.map((row, rowIndex) => row.map((value, colIndex) => formulas[rowIndex][colIndex] || value));
  targets.forEach((target, index) => {
    const outcome = outcomes.get(target.row);
    if (outcome.kind !== "success") return;
    const source = outcome.source;
    output[index] = [
      source.itemName, source.packingSize, source.ea,
      ccNumber_(source.costPc) ? source.costPc : "",
      ccNumber_(source.costPc) && ccNumber_(source.ea)
        ? "=" + ccColumnLetter_(columns.lpPc) + target.row + "*" + ccColumnLetter_(columns.ea) + target.row
        : source.costCtn,
      source.disc1, source.disc2, source.disc3
    ];
  });
  range.setValues(output);
}

function ccWriteHealth_(sheet, columns, targets, outcomes) {
  const firstRow = targets[0].row;
  const qdNetCosts = sheet.getRange(firstRow, columns.netCost, targets.length, 1).getValues();
  const healthRange = sheet.getRange(firstRow, columns.health, targets.length, 1);
  const health = healthRange.getValues();
  const notes = healthRange.getNotes();
  const referenceUpdates = {};
  let mismatchCount = 0;
  targets.forEach((target, index) => {
    const outcome = outcomes.get(target.row);
    if (outcome.kind === "problem") {
      if (outcome.reason === "blank") {
        health[index][0] = "";
        notes[index][0] = null;
        return;
      }
      health[index][0] = outcome.light;
      notes[index][0] = outcome.note;
      return;
    }
    const qdNet = Number(qdNetCosts[index][0]);
    const pbNet = Number(outcome.source.netCostCtn);
    const same = Number.isFinite(qdNet) && Number.isFinite(pbNet) &&
      Math.round(qdNet * 100) === Math.round(pbNet * 100);
    const metadata = ccHealthMetadata_(outcome.source);
    referenceUpdates[ccHealthReferenceKey_(metadata.barcode)] = JSON.stringify(metadata);
    if (!same) {
      mismatchCount++;
      health[index][0] = "🔴";
      notes[index][0] = ccSystemCostNote_(metadata);
      return;
    }
    const freshness = String(outcome.source.freshness || "").trim();
    health[index][0] = ["🟢", "🟠", "🔴"].indexOf(freshness) >= 0 ? freshness : "🔴";
    notes[index][0] = health[index][0] === "🟢" ? null :
      ccHealthWarningNote_(metadata, health[index][0]);
  });
  if (Object.keys(referenceUpdates).length) {
    PropertiesService.getDocumentProperties().setProperties(referenceUpdates, false);
  }
  healthRange.setValues(health).setNotes(notes);
  return mismatchCount;
}

function ccHeaderMap_(sheet, headerRow) {
  const values = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const map = Object.create(null);
  values.forEach((value, index) => {
    const key = ccNormalizeHeader_(value);
    if (!key) return;
    if (Object.prototype.hasOwnProperty.call(map, key)) throw new Error("Duplicate header: " + value);
    map[key] = index + 1;
  });
  return map;
}

function ccRequireHeaders_(map, headers, scope) {
  const missing = headers.filter(header => !Object.prototype.hasOwnProperty.call(map, ccNormalizeHeader_(header)));
  if (missing.length) throw new Error(scope + " missing header(s): " + missing.join(", "));
}

function ccHeaderCol_(map, header) {
  const key = ccNormalizeHeader_(header);
  if (!Object.prototype.hasOwnProperty.call(map, key)) throw new Error("Missing header: " + header);
  return map[key];
}

function ccHasHeader_(map, header) {
  return Object.prototype.hasOwnProperty.call(map, ccNormalizeHeader_(header));
}

function ccNormalizeHeader_(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  return normalized.indexOf("COST HEALTH") === 0 ? "COST HEALTH" : normalized;
}

function ccNormalizeBarcode_(value) {
  return String(value === null || value === undefined ? "" : value)
    .trim().replace(/\s+/g, "").replace(/\.0$/, "");
}

function ccUpper_(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function ccBlank_(value) {
  return value === "" || value === null || value === undefined;
}

function ccNumber_(value) {
  if (ccBlank_(value)) return false;
  return Number.isFinite(Number(value));
}

function ccColumnLetter_(columnNumber) {
  let output = "";
  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }
  return output;
}

/**
 * Called by the project's single onEdit(e) entry point.
 * Rechecks health immediately after a user changes barcode or any cost input.
 */
function ccHandleCostEdit_(event) {
  if (!event || !event.range) return;
  const sheet = event.range.getSheet();
  const cfg = ccConfig_();
  if (event.range.getLastRow() < cfg.DATA_START_ROW) return;

  let headers;
  let columns;
  try {
    headers = ccHeaderMap_(sheet, cfg.HEADER_ROW);
    if (!ccHasHeader_(headers, "COST HEALTH")) return;
    columns = ccQdColumns_(headers, true);
  } catch (error) {
    return;
  }

  const firstEditedCol = event.range.getColumn();
  const lastEditedCol = event.range.getLastColumn();
  const touchesBarcode = firstEditedCol <= columns.barcode && lastEditedCol >= columns.barcode;
  const touchesCost = firstEditedCol <= columns.disc3 && lastEditedCol >= columns.ea;
  if (!touchesBarcode && !touchesCost) return;

  const firstRow = Math.max(event.range.getRow(), cfg.DATA_START_ROW);
  const lastRow = Math.min(event.range.getLastRow(), cfg.DATA_END_ROW);
  if (lastRow < firstRow) return;
  const rowCount = lastRow - firstRow + 1;
  SpreadsheetApp.flush();

  const barcodes = sheet.getRange(firstRow, columns.barcode, rowCount, 1).getDisplayValues();
  const netCosts = sheet.getRange(firstRow, columns.netCost, rowCount, 1).getValues();
  const healthRange = sheet.getRange(firstRow, columns.health, rowCount, 1);
  const health = healthRange.getValues();
  const notes = healthRange.getNotes();

  for (let index = 0; index < rowCount; index++) {
    const barcode = ccNormalizeBarcode_(barcodes[index][0]).toUpperCase();
    if (!barcode) {
      health[index][0] = "";
      notes[index][0] = null;
      continue;
    }
    const metadata = ccLoadHealthMetadata_(barcode);
    if (!metadata || barcode !== metadata.barcode) {
      health[index][0] = "🔴";
      notes[index][0] = "Run CATCH COST to establish the current POINT BASE reference.";
      continue;
    }
    const qdNet = Number(netCosts[index][0]);
    const same = Number.isFinite(qdNet) && Number.isFinite(metadata.netCost) &&
      Math.round(qdNet * 100) === Math.round(metadata.netCost * 100);
    if (!same) {
      health[index][0] = "🔴";
      notes[index][0] = ccSystemCostNote_(metadata);
    } else {
      health[index][0] = ["🟢", "🟠", "🔴"].indexOf(metadata.freshness) >= 0 ? metadata.freshness : "🔴";
      notes[index][0] = health[index][0] === "🟢" ? null :
        ccHealthWarningNote_(metadata, health[index][0]);
    }
  }
  healthRange.setValues(health).setNotes(notes);
}

function ccHealthMetadata_(source) {
  return {
    barcode: String(source.barcode || "").toUpperCase(),
    costPc: Number(source.costPc),
    costCtn: Number(source.costCtn),
    netCost: Number(source.netCostCtn),
    costVerifiedAt: ccDateMillis_(source.costVerifiedOn),
    freshness: String(source.freshness || "").trim()
  };
}

function ccHealthReferenceKey_(barcode) {
  return "CCREF:" + ccNormalizeBarcode_(barcode).toUpperCase();
}

function ccLoadHealthMetadata_(barcode) {
  if (!barcode) return null;
  const value = PropertiesService.getDocumentProperties().getProperty(ccHealthReferenceKey_(barcode));
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function ccSystemCostNote_(metadata) {
  return "SYSTEM COST / 系统成本:\n" + ccFixed2_(metadata.costPc) + " / PC（每件）\n" +
    ccFixed2_(metadata.costCtn) + " / CTN（每箱）";
}

function ccHealthWarningNote_(metadata, light) {
  if (light === "🔴") {
    const ageDays = ccCostAgeDays_(metadata.costVerifiedAt);
    if (ageDays !== null && ageDays > 30) {
      return "SYSTEM COST UPDATE OVERDUE\nLAST UPDATED " + ageDays + " DAYS AGO.\n" +
        "PLEASE INFORM ADMIN.\n\n" +
        "系统成本更新已逾期\n最后更新于 " + ageDays + " 天前。\n" +
        "请通知管理员。";
    }
  }
  return ccSystemCostNote_(metadata);
}

function ccDateMillis_(value) {
  if (ccBlank_(value)) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function ccCostAgeDays_(value) {
  const millis = Number(value);
  if (!Number.isFinite(millis)) return null;
  const verified = new Date(millis);
  const today = new Date();
  verified.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - verified.getTime()) / 86400000));
}

function ccFixed2_(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "-";
}

