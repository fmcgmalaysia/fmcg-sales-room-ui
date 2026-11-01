function markSelectedCostsVerifiedToday() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const allowedSheets = ['FOOD', 'NONFOOD', 'OTHERS'];

  if (allowedSheets.indexOf(sheet.getName()) === -1) {
    ss.toast('请在 FOOD、NONFOOD 或 OTHERS 页面选择产品行。', '价格没变', 6);
    return;
  }

  const selected = sheet.getActiveRange();
  if (!selected) {
    ss.toast('请先选择需要确认的产品行。', '价格没变', 6);
    return;
  }

  const firstRow = Math.max(3, selected.getRow());
  const lastRow = selected.getLastRow();
  if (lastRow < firstRow) {
    ss.toast('Row 1 和隐藏的 Row 2 不会被处理。', '价格没变', 6);
    return;
  }

  const rowCount = lastRow - firstRow + 1;
  const barcodes = sheet.getRange(firstRow, 6, rowCount, 1).getDisplayValues();
  const dateCells = [];
  for (let index = 0; index < barcodes.length; index++) {
    if (String(barcodes[index][0] || '').trim()) {
      dateCells.push('D' + (firstRow + index));
    }
  }

  if (!dateCells.length) {
    ss.toast('选中范围内没有包含 Unit Barcode 的产品。', '价格没变', 6);
    return;
  }

  sheet.getRangeList(dateCells)
    .setValue(new Date())
    .setNumberFormat('dd/MM/yy');
  SpreadsheetApp.flush();
  ss.toast('已更新 ' + dateCells.length + ' 个产品的成本确认日期。', '价格没变', 6);
}
