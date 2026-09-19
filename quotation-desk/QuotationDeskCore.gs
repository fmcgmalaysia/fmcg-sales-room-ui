/**
 * QUOTATION DESK CORE
 * Shared menu, edit hook and active-sheet sorting for WIX QUOTATION and DRAFT.
 */

const QD_TOOLS_CFG = Object.freeze({
  POINT_BASE_ID: "12tyTIrmjF6JxMY-JW8K3JLuz5TcCkEjQUFXsauberLg",
  POINT_BASE_SHEETS: ["FOOD", "NONFOOD", "OTHERS"],
  HEADER_ROW: 5,
  FORMULA_ROW: 6,
  DATA_START_ROW: 7,
  DATA_END_ROW: 3003
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("必用工具")
    .addItem("SORT CURRENT SHEET BY SORT NO.", "sortCurrentQuotationDeskBySortId")
    .addItem("CATCH COST", "catchCostCurrentQuotationDesk")
    .addToUi();
}

function onEdit(e) {
  ccHandleCostEdit_(e);
}

function sortCurrentQuotationDeskBySortId() {
  const startedAt = Date.now();
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    ui.alert("SORT BLOCKED", "Another QD task is running. Please try again.", ui.ButtonSet.OK);
    return;
  }

  try {
    const cfg = ccConfig_();
    const headers = ccHeaderMap_(sheet, cfg.HEADER_ROW);
    ccRequireHeaders_(headers, ["UNIT BARCODE", "SORT NO."], sheet.getName());
    const barcodeCol = ccHeaderCol_(headers, "UNIT BARCODE");
    const sortCol = ccHeaderCol_(headers, "SORT NO.");
    const lastRow = sheet.getRange(sheet.getMaxRows(), barcodeCol)
      .getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
    if (lastRow < cfg.DATA_START_ROW) {
      ui.alert("SORT", "There are no product rows to sort.", ui.ButtonSet.OK);
      return;
    }

    const rowCount = lastRow - cfg.DATA_START_ROW + 1;
    const lastCol = sheet.getLastColumn();
    const data = sheet.getRange(cfg.DATA_START_ROW, 1, rowCount, lastCol);
    const values = data.getValues();
    const notes = data.getNotes();
    const barcodeIndex = barcodeCol - 1;
    const sortIndex = sortCol - 1;
    const rows = values.map((row, index) => ({
      row: row,
      notes: notes[index],
      originalIndex: index,
      barcode: ccNormalizeBarcode_(row[barcodeIndex]),
      sort: qdSortKey_(row[sortIndex])
    })).filter(item => item.barcode);

    rows.sort((a, b) => {
      if (a.sort.rank !== b.sort.rank) return a.sort.rank - b.sort.rank;
      const bySort = a.sort.value.localeCompare(b.sort.value, undefined, { numeric: true });
      return bySort || a.originalIndex - b.originalIndex;
    });

    const isFormal = ccHasHeader_(headers, "COST HEALTH");
    const movable = isFormal ? [
      "COST HEALTH", "QUOTE STATUS", "UNIT BARCODE", "ITEM NAME", "PACKING SIZE",
      "EA", "LP /PC", "DISC 1", "DISC 2", "DISC 3", "QUOTE $/PC",
      "TARGET GP", "WIX MY LIST ID"
    ] : [
      "UNIT BARCODE", "ITEM NAME", "PACKING SIZE", "EA", "LP /PC",
      "DISC 1", "DISC 2", "DISC 3", "ORDER QTY", "QUOTE $/PC", "CBM /CTN"
    ];

    movable.forEach(header => {
      if (!ccHasHeader_(headers, header)) return;
      const column = ccHeaderCol_(headers, header);
      const index = column - 1;
      const destination = sheet.getRange(cfg.DATA_START_ROW, column, rowCount, 1);
      destination.clearContent().clearNote();
      if (!rows.length) return;
      destination.offset(0, 0, rows.length, 1)
        .setValues(rows.map(item => [item.row[index]]))
        .setNotes(rows.map(item => [item.notes[index] || null]));
    });

    SpreadsheetApp.flush();
    ui.alert(
      "SORT DONE",
      rows.length + " product row(s) sorted by SORT NO.\n" +
      "Manual products without SORT NO. remain at the end.\n" +
      "Time used: " + ((Date.now() - startedAt) / 1000).toFixed(2) + " s",
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert("SORT ERROR", error.message, ui.ButtonSet.OK);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function qdSortKey_(value) {
  const text = String(value || "").trim();
  return text ? { rank: 1, value: text } : { rank: 2, value: "" };
}

