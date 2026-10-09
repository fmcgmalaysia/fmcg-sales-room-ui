/** Server-only candidate. No router installation, deployment or CMS writes. */
var MASTER_POINTBASE_ID = '12tyTIrmjF6JxMY-JW8K3JLuz5TcCkEjQUFXsauberLg';
var MASTER_POINTBASE_TABS = ['FOOD', 'NONFOOD', 'OTHERS'];

// Called only by the existing authenticated central doPost dispatcher after its live comparison.
function WIX_masterCaptureCost(body) {
  return { kind: 'MASTER_POINTBASE_COST_V1', costs: MPC_captureOrderCosts_(body && body.barcodes) };
}

/** Manual read-only readiness check for the already authorized test product; never writes orders or QDs. */
function WIX_testMasterCostReadOnly() {
  var barcode = '7622201680350', cost = MPC_captureOrderCosts_([barcode])[barcode];
  var summary = { kind: 'MASTER_COST_READINESS_V1', unitBarcode: barcode,
    costCurrency: cost.costCurrency, costStatus: cost.costStatus, costIssues: cost.costIssues,
    matchedSource: cost.source ? { sheetName: cost.source.sheetName, row: cost.source.row } : null,
    availableFields: ['lpPc', 'lpCtn', 'disc1', 'disc2', 'disc3', 'netCostCtn', 'cbmPerCtn']
      .filter(function (key) { return typeof cost[key] === 'number' && Number.isFinite(cost[key]); }) };
  console.log(JSON.stringify(summary));
  return summary;
}

function MPC_text_(value) { return String(value == null ? '' : value).trim(); }
function MPC_header_(value) { return MPC_text_(value).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function MPC_columns_(headers) {
  var names = { status: 'STATUS', brand: 'BRAND NAME', barcode: 'UNIT BARCODE',
    itemName: 'ITEM NAME', packing: 'PACKING SIZE', ea: 'EA', lpPc: 'COST /PC',
    lpCtn: 'COST /CTN', disc1: 'DISC. 1', disc2: 'DISC. 2', disc3: 'DISC. 3',
    netCostCtn: 'NET COST /CTN', cbmPerCtn: 'CBM /CTN' };
  var columns = {};
  Object.keys(names).forEach(function (key) {
    var matches = [];
    headers.forEach(function (header, i) {
      if (MPC_header_(header) === MPC_header_(names[key])) matches.push(i);
    });
    if (matches.length !== 1) throw new Error('POINTBASE header missing or duplicated: ' + names[key]);
    columns[key] = matches[0];
  });
  return columns;
}

function MPC_failure_(barcode, at, code) {
  return { unitBarcode: barcode, capturedAt: at, costCurrency: 'MYR',
    costStatus: 'ERROR', costIssues: [code], productStatus: null,
    lpPc: null, lpCtn: null, disc1: null, disc2: null, disc3: null,
    netCostCtn: null, cbmPerCtn: null };
}

function MPC_snapshot_(barcode, raw, display, columns, source, at) {
  var result = MPC_failure_(barcode, at, '');
  result.costIssues = [];
  if (typeof raw[columns.barcode] !== 'string' || MPC_text_(raw[columns.barcode]) !== barcode ||
      MPC_text_(display[columns.barcode]) !== barcode) return MPC_failure_(barcode, at, 'BARCODE_NOT_STORED_AS_TEXT');
  result.source = source;
  result.productStatus = MPC_text_(display[columns.status]).toUpperCase();
  result.itemName = MPC_text_(display[columns.itemName]);
  result.packingSize = MPC_text_(display[columns.packing]);
  result.brandName = MPC_text_(display[columns.brand]);
  ['ea', 'lpPc', 'lpCtn', 'disc1', 'disc2', 'disc3', 'netCostCtn', 'cbmPerCtn'].forEach(function (key) {
    var value = raw[columns[key]], shown = MPC_text_(display[columns[key]]);
    var number = null;
    if (value !== null && value !== undefined && value !== '' && shown !== '') {
      number = typeof value === 'number' ? value : Number(shown.replace(/,/g, ''));
      if ((key === 'disc1' || key === 'disc2') && typeof value !== 'number' && /%$/.test(shown)) {
        number = Number(shown.replace(/,/g, '').slice(0, -1)) / 100;
      }
    }
    var valid = typeof number === 'number' && Number.isFinite(number);
    if (valid && (key === 'disc1' || key === 'disc2')) valid = number >= 0 && number <= 1;
    if (valid && ['ea', 'lpPc', 'lpCtn', 'cbmPerCtn'].indexOf(key) !== -1) valid = number > 0;
    if (valid && key === 'ea') valid = Number.isSafeInteger(number);
    if (valid && ['disc3', 'netCostCtn'].indexOf(key) !== -1) valid = number >= 0;
    result[key === 'ea' ? 'eaPerCtn' : key] = valid ?
      (key === 'cbmPerCtn' ? Number(number.toFixed(4)) : number) : null;
    if (!valid && key !== 'lpPc') result.costIssues.push('UNAVAILABLE_' + key.toUpperCase());
  });
  result.discount1Unit = 'FRACTION';
  result.discount2Unit = 'FRACTION';
  result.discount3Unit = 'AMOUNT_PER_CTN';
  if (result.productStatus !== 'ACTIVE') {
    result.costIssues.push(['INACTIVE', 'DISCONTINUED', 'DRAFT'].indexOf(result.productStatus) !== -1 ?
      'PRODUCT_' + result.productStatus : 'PRODUCT_STATUS_UNAVAILABLE');
  }
  result.costStatus = result.costIssues.length ? 'ERROR' : 'CAPTURED';
  return result;
}

/** Read only matching rows. Index reads only barcode cells, never cost catalogue export. */
function MPC_captureOrderCosts_(barcodes) {
  if (!Array.isArray(barcodes) || !barcodes.length ||
      barcodes.some(function (value) { return typeof value !== 'string' || !value.trim(); })) {
    throw new Error('Order requires non-empty text barcodes.');
  }
  var requested = Array.from(new Set(barcodes.map(MPC_text_)));
  var at = new Date().toISOString(), matches = Object.create(null), results = Object.create(null);
  requested.forEach(function (barcode) { matches[barcode] = []; });
  try {
    var spreadsheet = SpreadsheetApp.openById(MASTER_POINTBASE_ID);
    MASTER_POINTBASE_TABS.forEach(function (name) {
      var sheet = spreadsheet.getSheetByName(name);
      if (!sheet) throw new Error('Required POINTBASE sheet is unavailable.');
      var columns = MPC_columns_(sheet.getRange(1, 1, 1, 27).getDisplayValues()[0]);
      var last = sheet.getLastRow();
      if (last < 3) return;
      sheet.getRange(3, columns.barcode + 1, last - 2, 1).getDisplayValues().forEach(function (row, index) {
        var barcode = MPC_text_(row[0]);
        if (Object.prototype.hasOwnProperty.call(matches, barcode)) {
          matches[barcode].push({ sheet: sheet, columns: columns, sheetName: name, row: index + 3 });
        }
      });
    });
  } catch (error) {
    // A failed sheet read cannot prove uniqueness or absence in the complete source.
    requested.forEach(function (barcode) { results[barcode] = MPC_failure_(barcode, at, 'POINTBASE_READ_FAILED'); });
    return results;
  }
  requested.forEach(function (barcode) {
    var entries = matches[barcode];
    if (entries.length !== 1) {
      results[barcode] = MPC_failure_(barcode, at, entries.length ? 'DUPLICATE_BARCODE' : 'BARCODE_NOT_FOUND');
      return;
    }
    var entry = entries[0];
    try {
      var range = entry.sheet.getRange(entry.row, 1, 1, 27);
      results[barcode] = MPC_snapshot_(barcode, range.getValues()[0], range.getDisplayValues()[0], entry.columns,
        { spreadsheetId: MASTER_POINTBASE_ID, sheetName: entry.sheetName, row: entry.row }, at);
    } catch (error) { results[barcode] = MPC_failure_(barcode, at, 'POINTBASE_ROW_READ_FAILED'); }
  });
  return results;
}
