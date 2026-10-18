/**
 * POINT BASE -> WIX FMCG MALAYSIA CMS
 *
 * Safety contract
 * ---------------
 * 1. UNIT BARCODE is the sole matching identity and is always treated as text.
 * 2. Existing Wix items are changed with PATCH only. Unmentioned fields survive.
 * 3. image, mainCategory and subCategories are never sent to Wix.
 * 4. Wix-only items are never changed.
 * 5. Ambiguous/invalid rows are skipped and written to WIX SYNC REPORT.
 * 6. The report contains failures only; successful counts appear in the dialog.
 *
 * Required Apps Script Properties
 * --------------------------------
 * WIX_API_KEY
 * WIX_SITE_ID
 * WIX_COLLECTION_ID   (expected: FMCGMALAYSIA)
 */

const PBW = Object.freeze({
  sheets: ['FOOD', 'NONFOOD', 'OTHERS'],
  headerRow: 1,
  dataStartRow: 3,
  reportSheet: 'WIX SYNC REPORT',

  queryLimit: 1000,
  patchBatch: 100, // Wix Bulk Patch maximum
  insertBatch: 500,
  maxPages: 500,
  retries: 4,

  // Safe first-sync default: a blank Point Base cell does not erase an existing
  // Wix value. Change to true only after Point Base is confirmed complete and
  // authoritative for every managed field.
  clearExistingWhenSourceBlank: false,

  allowedStatuses: ['ACTIVE', 'INACTIVE', 'DISCONTINUED', 'DRAFT'],
  optionalBarcodePlaceholders: ['', '-', 'N/A', 'NA'],
  // Stable legacy internal identities accepted in UNIT BARCODE.
  // TEMP codes remain blocked because replacing one later creates a second identity.
  unitInternalIdPatterns: [/^HG\d+$/i, /^HW\d+$/i],

  headers: Object.freeze({
    status: 'STATUS',
    principle: 'PRINCIPLE',
    brand: 'BRAND NAME',
    barcode: 'UNIT BARCODE',
    name: 'ITEM NAME',
    packing: 'PACKING SIZE',
    ea: 'EA',
    cbm: 'CBM /CTN',
    netWeight: 'NET WEIGHT',
    origin: 'COUNTRY ORIGIN',
    shelfLife: 'SHELF LIFE',
    innerBarcode: 'INNER BOX BARCODE',
    cartonBarcode: 'CARTON BARCODE',
    sortNo: 'SORT NO.'
  }),

  // These are Wix field IDs, not their display labels.
  fields: Object.freeze({
    status: 'pointBaseStatus',
    barcode: 'barcode',
    principle: 'principle',
    brand: 'brandName',
    name: 'name',
    packing: 'description',
    ea: 'price',
    cbm: 'm3Ctn',
    netWeight: 'netWeight',
    origin: 'countryOrigin',
    shelfLife: 'shelflife',
    innerBarcode: 'innerBoxBarcode',
    cartonBarcode: 'cartonBarcode',
    sortNo: 'pointBaseSortId'
  }),

  protectedFields: Object.freeze(['image', 'mainCategory', 'subCategories'])
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('WIX CATALOGUE')
    .addItem('1. Preview sync (no Wix changes)', 'previewPointBaseWixSync')
    .addItem('2. Execute sync', 'confirmAndExecutePointBaseWixSync')
    .addSeparator()
    .addItem('Audit barcode cell types', 'auditPointBaseBarcodeTypes')
    .addSeparator()
    .addItem('3. Preview image URL pull', 'previewWixImageUrlsToPointBase')
    .addItem('4. Pull image URLs from Wix', 'confirmAndPullWixImageUrlsToPointBase')
    .addSeparator()
    .addItem('5. Preview selected PRINCIPLE images', 'previewSelectedPrincipleWixImageUrlsToPointBase')
    .addItem('6. Pull selected PRINCIPLE images', 'confirmAndPullSelectedPrincipleWixImageUrlsToPointBase')
    .addToUi();
      SpreadsheetApp.getUi()
    .createMenu('价格没变')
    .addItem('确认选中行｜写入今日日期', 'markSelectedCostsVerifiedToday')
    .addToUi();
}


function previewPointBaseWixSync() {
  return pbwRun_(true);
}

function confirmAndExecutePointBaseWixSync() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert(
    'Execute Wix sync',
    'This will re-read Point Base and Wix, then update matched products and insert missing products.\n\n' +
      'Wix-only products, images, main categories and subcategories will not be changed.\n\n' +
      'Run Preview first. Continue?',
    ui.ButtonSet.OK_CANCEL
  );
  if (answer !== ui.Button.OK) return null;
  return pbwRun_(false);
}

function executePointBaseWixSync() {
  // Kept as a callable function for compatibility with an existing assigned button.
  return confirmAndExecutePointBaseWixSync();
}

function pbwRun_(preview) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    SpreadsheetApp.getUi().alert('Another Wix sync is already running.');
    return null;
  }

  let plan = null;
  try {
    const ctx = pbwContext_();
    const source = pbwReadSource_();
    pbwValidateSortNumbers_(source);
    const cmsBefore = pbwQueryCms_(ctx);
    plan = pbwPlan_(source, cmsBefore);

    // Preview and execution reports both contain blockers/failures only.
    pbwWriteReport_(plan.report);

    if (preview) {
      SpreadsheetApp.getUi().alert(
        'Wix sync preview completed',
        pbwSummary_(plan, true) + '\n\nNo Wix data was changed.',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return plan.summary;
    }

    if (plan.summary.globalBlockers > 0) {
      SpreadsheetApp.getUi().alert(
        'Wix sync blocked',
        pbwSummary_(plan, true) + '\n\nResolve all global blockers and run Preview again. No Wix data was changed.',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return plan.summary;
    }

    pbwPatch_(ctx, plan);
    pbwInsert_(ctx, plan);
    pbwWriteReport_(plan.report);

    SpreadsheetApp.getUi().alert(
      'Wix sync completed',
      pbwSummary_(plan, false) + '\n\nProtected fields were never included in a write request.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return plan.summary;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const rows = plan && plan.report ? plan.report : [];
    rows.push(pbwReport_('SYSTEM', '', '', 'RUN FAILED', message));
    pbwWriteReport_(rows);
    SpreadsheetApp.getUi().alert(
      'Wix sync stopped',
      message + '\n\nNo further batches were sent. Check WIX SYNC REPORT.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function pbwContext_() {
  const properties = PropertiesService.getScriptProperties();
  const ctx = {
    apiKey: pbwText_(properties.getProperty('WIX_API_KEY')),
    siteId: pbwText_(properties.getProperty('WIX_SITE_ID')),
    collectionId: pbwText_(properties.getProperty('WIX_COLLECTION_ID'))
  };
  const missing = [];
  if (!ctx.apiKey) missing.push('WIX_API_KEY');
  if (!ctx.siteId) missing.push('WIX_SITE_ID');
  if (!ctx.collectionId) missing.push('WIX_COLLECTION_ID');
  if (missing.length) throw new Error('Missing Script Properties: ' + missing.join(', '));
  return ctx;
}

function pbwRequest_(ctx, url, method, payload, label) {
  const options = {
    method: method,
    headers: {
      Authorization: ctx.apiKey,
      'wix-site-id': ctx.siteId
    },
    muteHttpExceptions: true
  };
  if (payload !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }

  let lastError = null;
  for (let attempt = 1; attempt <= PBW.retries; attempt++) {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const responseText = response.getContentText();
    let json = {};

    if (responseText) {
      try {
        json = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(
          label + ' returned non-JSON (HTTP ' + code + '): ' + responseText.slice(0, 800)
        );
      }
    }

    if (code >= 200 && code < 300) return json;

    lastError = new Error(
      label + ' failed (HTTP ' + code + '): ' + JSON.stringify(json).slice(0, 1800)
    );

    const retryable = code === 429 || code >= 500;
    if (!retryable || attempt === PBW.retries) break;
    Utilities.sleep(Math.pow(2, attempt - 1) * 1000);
  }
  throw lastError || new Error(label + ' failed.');
}

function pbwQueryCms_(ctx) {
  const items = [];
  let cursor = '';

  for (let page = 0; page < PBW.maxPages; page++) {
    const query = cursor
      ? { cursorPaging: { cursor: cursor } }
      : { filter: {}, cursorPaging: { limit: PBW.queryLimit } };

    const response = pbwRequest_(
      ctx,
      'https://www.wixapis.com/wix-data/v2/items/query',
      'post',
      {
        dataCollectionId: ctx.collectionId,
        query: query,
        consistentRead: true
      },
      'Query Wix CMS page ' + (page + 1)
    );

    const pageItems = response.dataItems || [];
    Array.prototype.push.apply(items, pageItems);

    const cursors = response.pagingMetadata && response.pagingMetadata.cursors;
    cursor = cursors && cursors.next ? String(cursors.next) : '';
    if (!cursor || !pageItems.length) return items;
  }

  throw new Error('Wix query exceeded ' + PBW.maxPages + ' pages.');
}

function pbwText_(value) {
  return String(value == null ? '' : value).trim();
}

function pbwHeader_(value) {
  return pbwText_(value).toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function pbwHasAnyValue_(row) {
  return row.some(function(value) { return pbwText_(value) !== ''; });
}

function pbwNumber_(displayValue, rawValue, label) {
  const display = pbwText_(displayValue);
  if (!display) return null;

  const candidate = typeof rawValue === 'number'
    ? rawValue
    : Number(display.replace(/,/g, ''));

  if (!isFinite(candidate)) {
    throw new Error(label + ' is not a valid number: ' + displayValue);
  }
  return candidate;
}

function pbwAssertTextStored_(value, rawValue, label) {
  if (typeof rawValue === 'number') {
    throw new Error(
      label + ' is stored as a number. Format the cell as Plain text and re-enter the value.'
    );
  }
  if (/[eE][+-]?\d+/.test(value) || /^\d+\.0+$/.test(value)) {
    throw new Error(label + ' looks numeric/scientific, not text: ' + value);
  }
}

function pbwUnitIdentity_(displayValue, rawValue, label) {
  const identity = pbwText_(displayValue);
  if (!identity) throw new Error(label + ' is blank.');
  pbwAssertTextStored_(identity, rawValue, label);

  if (/^\d+$/.test(identity)) {
    if (identity.length < 6 || identity.length > 32) {
      throw new Error(label + ' has an unexpected length (' + identity.length + '): ' + identity);
    }
    return identity;
  }

  const isApprovedInternalId = PBW.unitInternalIdPatterns.some(function(pattern) {
    return pattern.test(identity);
  });
  if (isApprovedInternalId) return identity;

  if (/^TEMP/i.test(identity)) {
    throw new Error(label + ' uses a temporary identity. Replace it with a permanent identity: ' + identity);
  }
  throw new Error(
    label + ' must be a digit barcode or an approved permanent HG/HW identity: ' + identity
  );
}

function pbwOptionalBarcode_(displayValue, rawValue, label) {
  const value = pbwText_(displayValue);
  if (PBW.optionalBarcodePlaceholders.indexOf(value.toUpperCase()) !== -1) return '';

  pbwAssertTextStored_(value, rawValue, label);
  if (!/^\d+$/.test(value)) throw new Error(label + ' must contain digits only: ' + value);
  if (value.length < 6 || value.length > 32) {
    throw new Error(label + ' has an unexpected length (' + value.length + '): ' + value);
  }
  return value;
}

function pbwCapture_(errors, operation, fallback) {
  try {
    return operation();
  } catch (error) {
    errors.push(error && error.message ? error.message : String(error));
    return fallback;
  }
}

function pbwStatus_(value, label) {
  const status = pbwText_(value).toUpperCase();
  if (PBW.allowedStatuses.indexOf(status) === -1) {
    throw new Error(
      label + ' must be one of: ' + PBW.allowedStatuses.join(', ') + '. Found: ' + (status || '(blank)')
    );
  }
  return status;
}

function pbwReadSource_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const candidates = [];
  const report = [];
  let nonEmptyRows = 0;
  let invalidRows = 0;
  let globalIssues = 0;

  PBW.sheets.forEach(function(sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      report.push(pbwReport_('READ', sheetName, '', '', 'MISSING SHEET', 'Required sheet not found.'));
      globalIssues++;
      return;
    }

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow < PBW.dataStartRow) return;

    const labels = sheet.getRange(PBW.headerRow, 1, 1, lastColumn).getDisplayValues()[0];
    const found = {};
    labels.forEach(function(value, index) {
      const key = pbwHeader_(value);
      if (key && found[key] === undefined) found[key] = index;
    });

    const col = {};
    Object.keys(PBW.headers).forEach(function(key) {
      const normalized = pbwHeader_(PBW.headers[key]);
      if (found[normalized] === undefined) {
        throw new Error(sheetName + ' is missing header: ' + PBW.headers[key]);
      }
      col[key] = found[normalized];
    });

    const range = sheet.getRange(
      PBW.dataStartRow,
      1,
      lastRow - PBW.dataStartRow + 1,
      lastColumn
    );
    const displayRows = range.getDisplayValues();
    const rawRows = range.getValues();

    displayRows.forEach(function(displayRow, index) {
      if (!pbwHasAnyValue_(displayRow)) return;
      nonEmptyRows++;

      const rawRow = rawRows[index];
      const rowNumber = PBW.dataStartRow + index;
      const reportBarcode = pbwText_(displayRow[col.barcode]);
      const rowLabel = sheetName + ' row ' + rowNumber + ' ';
      const errors = [];

      const barcode = pbwCapture_(errors, function() {
        return pbwUnitIdentity_(
          displayRow[col.barcode], rawRow[col.barcode], rowLabel + 'UNIT BARCODE'
        );
      }, '');
      const status = pbwCapture_(errors, function() {
        return pbwStatus_(displayRow[col.status], rowLabel + 'STATUS');
      }, '');
      const innerBarcode = pbwCapture_(errors, function() {
        return pbwOptionalBarcode_(
          displayRow[col.innerBarcode], rawRow[col.innerBarcode], rowLabel + 'INNER BOX BARCODE'
        );
      }, '');
      const cartonBarcode = pbwCapture_(errors, function() {
        return pbwOptionalBarcode_(
          displayRow[col.cartonBarcode], rawRow[col.cartonBarcode], rowLabel + 'CARTON BARCODE'
        );
      }, '');
      const ea = pbwCapture_(errors, function() {
        return pbwNumber_(displayRow[col.ea], rawRow[col.ea], rowLabel + 'EA');
      }, null);
      const cbm = pbwCapture_(errors, function() {
        return pbwNumber_(displayRow[col.cbm], rawRow[col.cbm], rowLabel + 'CBM /CTN');
      }, null);

      if (errors.length) {
        invalidRows++;
        report.push(pbwReport_(
          'READ', sheetName, rowNumber, reportBarcode,
          'INVALID SOURCE ROW', errors.join(' | ')
        ));
        return;
      }

      candidates.push({
        sheet: sheetName,
        row: rowNumber,
        barcode: barcode,
        status: status,
        values: {
          principle: pbwText_(displayRow[col.principle]),
          brand: pbwText_(displayRow[col.brand]),
          name: pbwText_(displayRow[col.name]),
          packing: pbwText_(displayRow[col.packing]),
          ea: ea,
          cbm: cbm,
          netWeight: pbwText_(displayRow[col.netWeight]),
          origin: pbwText_(displayRow[col.origin]),
          shelfLife: pbwText_(displayRow[col.shelfLife]),
          innerBarcode: innerBarcode,
          cartonBarcode: cartonBarcode,
          sortNo: pbwText_(displayRow[col.sortNo])
        }
      });
    });
  });

  const groups = {};
  candidates.forEach(function(row) {
    (groups[row.barcode] || (groups[row.barcode] = [])).push(row);
  });

  const rows = [];
  let duplicateRows = 0;
  let duplicateGroups = 0;
  Object.keys(groups).forEach(function(barcode) {
    const group = groups[barcode];
    if (group.length === 1) {
      rows.push(group[0]);
      return;
    }

    duplicateGroups++;
    duplicateRows += group.length;
    group.forEach(function(row) {
      report.push(pbwReport_(
        'PREFLIGHT', row.sheet, row.row, barcode,
        'DUPLICATE POINT BASE BARCODE',
        'Barcode occurs ' + group.length + ' times in Point Base. No matching row will be synchronized.'
      ));
    });
  });

  return {
    rows: rows,
    report: report,
    nonEmptyRows: nonEmptyRows,
    invalidRows: invalidRows,
    duplicateRows: duplicateRows,
    duplicateGroups: duplicateGroups,
    globalIssues: globalIssues
  };
}

function pbwValidateSortNumbers_(source) {
  const groups = {};
  const validRows = [];
  let blankRows = 0;
  let duplicateRows = 0;
  let duplicateGroups = 0;

  source.rows.forEach(function(row) {
    const sortNo = pbwText_(row.values.sortNo);
    if (!sortNo) {
      blankRows++;
      source.report.push(pbwReport_(
        'PREFLIGHT', row.sheet, row.row, row.barcode,
        'MISSING SORT NO.',
        'SORT NO. is required. The entire Wix sync is blocked until this row is corrected.'
      ));
      return;
    }
    (groups[sortNo] || (groups[sortNo] = [])).push(row);
  });

  Object.keys(groups).forEach(function(sortNo) {
    const group = groups[sortNo];
    if (group.length === 1) {
      validRows.push(group[0]);
      return;
    }
    duplicateGroups++;
    duplicateRows += group.length;
    group.forEach(function(row) {
      source.report.push(pbwReport_(
        'PREFLIGHT', row.sheet, row.row, row.barcode,
        'DUPLICATE SORT NO.',
        'SORT NO. ' + sortNo + ' occurs ' + group.length +
          ' times. The entire Wix sync is blocked until every SORT NO. is unique.'
      ));
    });
  });

  source.rows = validRows;
  source.invalidRows += blankRows;
  source.duplicateRows += duplicateRows;
  source.duplicateGroups += duplicateGroups;
  source.globalIssues += blankRows + duplicateGroups;
  return source;
}

function pbwItemId_(item) {
  return pbwText_(
    item && (item.id || item._id || item.dataItemId || (item.data && item.data._id))
  );
}

function pbwCmsBarcode_(item) {
  const data = item && item.data ? item.data : {};
  const raw = data[PBW.fields.barcode];
  return {
    text: pbwText_(raw),
    isNumber: typeof raw === 'number'
  };
}

function pbwCanonicalDigits_(barcode) {
  if (!/^\d+$/.test(barcode)) return '';
  const withoutLeadingZeroes = barcode.replace(/^0+(?=\d)/, '');
  return withoutLeadingZeroes || '0';
}

function pbwComparable_(value) {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  return pbwText_(value);
}

function pbwDeepComparable_(value) {
  if (value === undefined) return '__UNDEFINED__';
  return JSON.stringify(value);
}

function pbwClone_(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function pbwShouldManageValue_(value) {
  if (PBW.clearExistingWhenSourceBlank) return true;
  return !(value === null || value === undefined || pbwComparable_(value) === '');
}

function pbwManagedData_(row, includeBarcode, existingItem) {
  const f = PBW.fields;
  const candidate = {};

  if (includeBarcode) candidate[f.barcode] = row.barcode;
  candidate[f.status] = row.status;
  candidate[f.principle] = row.values.principle;
  candidate[f.brand] = row.values.brand;
  candidate[f.name] = row.values.name;
  candidate[f.packing] = row.values.packing;
  candidate[f.ea] = row.values.ea;
  candidate[f.cbm] = row.values.cbm == null ? null : Number(Number(row.values.cbm).toFixed(4));
  candidate[f.netWeight] = row.values.netWeight;
  candidate[f.origin] = row.values.origin;
  candidate[f.shelfLife] = row.values.shelfLife;
  candidate[f.innerBarcode] = row.values.innerBarcode;
  candidate[f.cartonBarcode] = row.values.cartonBarcode;
  candidate[f.sortNo] = row.values.sortNo;

  const data = {};
  Object.keys(candidate).forEach(function(field) {
    const value = candidate[field];

    // Inserts omit blank optional values. Existing items retain blank-source fields
    // unless clearExistingWhenSourceBlank is deliberately enabled.
    if (!existingItem && (value === null || value === undefined || pbwComparable_(value) === '')) {
      return;
    }
    if (existingItem && !pbwShouldManageValue_(value)) return;

    data[field] = value;
  });
  return data;
}

function pbwMods_(desired, current) {
  const modifications = [];
  Object.keys(desired).forEach(function(field) {
    const value = desired[field];
    if (pbwComparable_(value) === pbwComparable_(current && current[field])) return;

    if (value === null || value === undefined || pbwComparable_(value) === '') {
      modifications.push({ fieldPath: field, action: 'REMOVE_FIELD' });
    } else {
      modifications.push({
        fieldPath: field,
        action: 'SET_FIELD',
        setFieldOptions: { value: value }
      });
    }
  });
  return modifications;
}

function pbwExpectedFromMods_(mods) {
  const expected = {};
  mods.forEach(function(mod) {
    expected[mod.fieldPath] = mod.action === 'REMOVE_FIELD'
      ? null
      : mod.setFieldOptions.value;
  });
  return expected;
}

function pbwProtectedSnapshot_(item) {
  const data = item && item.data ? item.data : {};
  const snapshot = {};
  PBW.protectedFields.forEach(function(field) {
    snapshot[field] = pbwClone_(data[field]);
  });
  return snapshot;
}

function pbwNewId_(barcode) {
  // Accepted identities contain only digits or stable HG/HW letters plus digits.
  return 'pb2_' + barcode;
}

function pbwPlan_(source, cmsItems) {
  const cmsMap = {};
  const cmsCanonicalMap = {};
  const cmsNumericIds = {};
  const report = source.report.slice();
  let cmsNumericItems = 0;

  cmsItems.forEach(function(item) {
    const id = pbwItemId_(item);
    const cmsBarcode = pbwCmsBarcode_(item);
    if (!cmsBarcode.text) return;

    (cmsMap[cmsBarcode.text] || (cmsMap[cmsBarcode.text] = [])).push(item);

    const canonical = pbwCanonicalDigits_(cmsBarcode.text);
    if (canonical) {
      (cmsCanonicalMap[canonical] || (cmsCanonicalMap[canonical] = [])).push(item);
    }
    if (cmsBarcode.isNumber) {
      cmsNumericItems++;
      if (id) cmsNumericIds[id] = true;
      report.push(pbwReport_(
        'PREFLIGHT', 'WIX CMS', '', cmsBarcode.text,
        'CMS UNIT BARCODE IS NUMERIC',
        'CMS item ID ' + (id || '(missing)') + ' does not store UNIT BARCODE as text.'
      ));
    }
  });

  let cmsDuplicateGroups = 0;
  Object.keys(cmsMap).forEach(function(barcode) {
    const group = cmsMap[barcode];
    if (group.length < 2) return;
    cmsDuplicateGroups++;
    report.push(pbwReport_(
      'PREFLIGHT', 'WIX CMS', '', barcode,
      'DUPLICATE CMS BARCODE',
      'CMS item IDs: ' + group.map(pbwItemId_).join(', ') + '. These items were not changed.'
    ));
  });

  const plan = {
    patches: [],
    inserts: [],
    report: report,
    summary: {
      sourceNonEmptyRows: source.nonEmptyRows,
      sourceValidUnique: source.rows.length,
      sourceInvalid: source.invalidRows,
      duplicatePointBaseRows: source.duplicateRows,
      cmsItems: cmsItems.length,
      cmsDuplicateGroups: cmsDuplicateGroups,
      cmsNumericItems: cmsNumericItems,
      globalBlockers: source.globalIssues + source.duplicateGroups +
        cmsDuplicateGroups + cmsNumericItems,
      matched: 0,
      plannedUpdates: 0,
      plannedInserts: 0,
      unchanged: 0,
      blocked: source.invalidRows + source.duplicateRows,
      patchSuccess: 0,
      insertSuccess: 0,
      apiFailures: 0,
      verificationFailures: 0
    }
  };

  source.rows.forEach(function(row) {
    const exactMatches = cmsMap[row.barcode] || [];

    if (exactMatches.length > 1) {
      plan.summary.blocked++;
      return; // Duplicate group is already present in the failure report.
    }

    if (exactMatches.length === 1) {
      const item = exactMatches[0];
      const id = pbwItemId_(item);

      if (!id) {
        plan.summary.blocked++;
        plan.report.push(pbwReport_(
          'PREFLIGHT', row.sheet, row.row, row.barcode,
          'MISSING CMS ITEM ID', 'Matched CMS item has no usable ID. No item changed.'
        ));
        return;
      }

      if (cmsNumericIds[id]) {
        plan.summary.blocked++;
        plan.report.push(pbwReport_(
          'PREFLIGHT', row.sheet, row.row, row.barcode,
          'CMS BARCODE IS NUMERIC',
          'The matched CMS barcode is not stored as text. Correct it manually before syncing.'
        ));
        return;
      }

      const desired = pbwManagedData_(row, false, true);
      const mods = pbwMods_(desired, item.data || {});
      plan.summary.matched++;

      if (!mods.length) {
        plan.summary.unchanged++;
        return;
      }

      plan.patches.push({
        source: row,
        dataItemId: id,
        fieldModifications: mods,
        expected: pbwExpectedFromMods_(mods),
        protectedBefore: pbwProtectedSnapshot_(item),
        applied: false
      });
      plan.summary.plannedUpdates++;
      return;
    }

    // Prevent a dangerous insert such as Point Base "0955..." when a legacy CMS
    // item contains the numeric/string barcode "955...".
    const canonical = pbwCanonicalDigits_(row.barcode);
    const possibleCollisions = (cmsCanonicalMap[canonical] || []).filter(function(item) {
      return pbwCmsBarcode_(item).text !== row.barcode;
    });
    if (possibleCollisions.length) {
      plan.summary.blocked++;
      plan.report.push(pbwReport_(
        'PREFLIGHT', row.sheet, row.row, row.barcode,
        'POSSIBLE LEADING-ZERO COLLISION',
        'No item inserted. Similar CMS barcode(s): ' +
          possibleCollisions.map(function(item) { return pbwCmsBarcode_(item).text; }).join(', ')
      ));
      return;
    }

    if (!row.values.name) {
      plan.summary.blocked++;
      plan.report.push(pbwReport_(
        'PREFLIGHT', row.sheet, row.row, row.barcode,
        'NEW PRODUCT MISSING NAME', 'ITEM NAME is required before a new CMS item can be inserted.'
      ));
      return;
    }

    const newData = pbwManagedData_(row, true, false);
    plan.inserts.push({
      source: row,
      id: pbwNewId_(row.barcode),
      data: newData,
      expected: newData,
      applied: false
    });
    plan.summary.plannedInserts++;
  });

  return plan;
}

function pbwBulkResults_(response, batch, plan, action) {
  const results = response.results || [];
  if (!results.length && batch.length) {
    throw new Error(action + ' response contained no per-item results.');
  }

  const seen = {};
  results.forEach(function(result, resultIndex) {
    const metadata = result.itemMetadata || {};
    const originalIndex = Number(metadata.originalIndex);
    const index = isFinite(originalIndex) ? originalIndex : resultIndex;
    const entry = batch[index];
    if (!entry) return;
    seen[index] = true;

    if (metadata.success === true && !metadata.error) {
      entry.applied = true;
      if (action === 'PATCH') plan.summary.patchSuccess++;
      if (action === 'INSERT') plan.summary.insertSuccess++;

      if (!result.dataItem || !result.dataItem.data) {
        plan.summary.verificationFailures++;
        plan.report.push(pbwReport_(
          'VERIFY', entry.source.sheet, entry.source.row, entry.source.barcode,
          action + ' RETURNED NO ITEM', 'Wix reported success but did not return the written item.'
        ));
      } else {
        const actualData = result.dataItem.data;
        pbwVerifyExpected_(entry, actualData, plan, action);
        if (action === 'PATCH') pbwVerifyProtected_(entry, actualData, plan);
      }
      return;
    }

    plan.summary.apiFailures++;
    plan.report.push(pbwReport_(
      'WRITE', entry.source.sheet, entry.source.row, entry.source.barcode,
      action + ' FAILED', JSON.stringify(metadata.error || result).slice(0, 1400)
    ));
  });

  batch.forEach(function(entry, index) {
    if (seen[index]) return;
    plan.summary.apiFailures++;
    plan.report.push(pbwReport_(
      'WRITE', entry.source.sheet, entry.source.row, entry.source.barcode,
      action + ' RESULT MISSING', 'Wix returned no result for this item.'
    ));
  });
}

function pbwAllowedFieldMap_(includeIdentity) {
  const f = PBW.fields;
  const allowed = {};
  [
    f.status, f.principle, f.brand, f.name, f.packing, f.ea, f.cbm,
    f.netWeight, f.origin, f.shelfLife, f.innerBarcode,
    f.cartonBarcode, f.sortNo
  ].forEach(function(field) { allowed[field] = true; });
  if (includeIdentity) allowed[f.barcode] = true;
  return allowed;
}

function pbwAssertPatchBatchSafe_(batch) {
  const allowed = pbwAllowedFieldMap_(false);
  batch.forEach(function(entry) {
    entry.fieldModifications.forEach(function(mod) {
      if (!allowed[mod.fieldPath]) {
        throw new Error('Unsafe PATCH field blocked before transmission: ' + mod.fieldPath);
      }
      if (PBW.protectedFields.indexOf(mod.fieldPath) !== -1) {
        throw new Error('Protected PATCH field blocked before transmission: ' + mod.fieldPath);
      }
    });
  });
}

function pbwAssertInsertBatchSafe_(batch) {
  const allowed = pbwAllowedFieldMap_(true);
  batch.forEach(function(entry) {
    Object.keys(entry.data).forEach(function(field) {
      if (!allowed[field]) {
        throw new Error('Unsafe INSERT field blocked before transmission: ' + field);
      }
      if (PBW.protectedFields.indexOf(field) !== -1) {
        throw new Error('Protected INSERT field blocked before transmission: ' + field);
      }
    });
  });
}

function pbwPatch_(ctx, plan) {
  for (let start = 0; start < plan.patches.length; start += PBW.patchBatch) {
    const batch = plan.patches.slice(start, start + PBW.patchBatch);
    // A whitelist violation is a programming/configuration fault, not an item error.
    // Let it stop the entire run instead of continuing with later batches.
    pbwAssertPatchBatchSafe_(batch);
    try {
      const response = pbwRequest_(
        ctx,
        'https://www.wixapis.com/wix-data/v2/bulk/items/patch',
        'post',
        {
          dataCollectionId: ctx.collectionId,
          patches: batch.map(function(entry) {
            return {
              dataItemId: entry.dataItemId,
              fieldModifications: entry.fieldModifications
            };
          }),
          returnEntity: true
        },
        'Patch Wix CMS batch ' + (Math.floor(start / PBW.patchBatch) + 1)
      );
      pbwBulkResults_(response, batch, plan, 'PATCH');
    } catch (error) {
      plan.summary.apiFailures += batch.length;
      batch.forEach(function(entry) {
        plan.report.push(pbwReport_(
          'WRITE', entry.source.sheet, entry.source.row, entry.source.barcode,
          'PATCH BATCH FAILED', error.message
        ));
      });
    }
  }
}

function pbwInsert_(ctx, plan) {
  for (let start = 0; start < plan.inserts.length; start += PBW.insertBatch) {
    const batch = plan.inserts.slice(start, start + PBW.insertBatch);
    pbwAssertInsertBatchSafe_(batch);
    try {
      const response = pbwRequest_(
        ctx,
        'https://www.wixapis.com/wix-data/v2/bulk/items/insert',
        'post',
        {
          dataCollectionId: ctx.collectionId,
          dataItems: batch.map(function(entry) {
            return { id: entry.id, data: entry.data };
          }),
          returnEntity: true
        },
        'Insert Wix CMS batch ' + (Math.floor(start / PBW.insertBatch) + 1)
      );
      pbwBulkResults_(response, batch, plan, 'INSERT');
    } catch (error) {
      plan.summary.apiFailures += batch.length;
      batch.forEach(function(entry) {
        plan.report.push(pbwReport_(
          'WRITE', entry.source.sheet, entry.source.row, entry.source.barcode,
          'INSERT BATCH FAILED', error.message
        ));
      });
    }
  }
}

function pbwVerifyExpected_(entry, actualData, plan, action) {
  Object.keys(entry.expected).forEach(function(field) {
    if (pbwComparable_(entry.expected[field]) === pbwComparable_(actualData[field])) return;
    plan.summary.verificationFailures++;
    plan.report.push(pbwReport_(
      'VERIFY', entry.source.sheet, entry.source.row, entry.source.barcode,
      action + ' VALUE MISMATCH',
      'Field ' + field + ' expected ' + JSON.stringify(entry.expected[field]) +
        ' but Wix returned ' + JSON.stringify(actualData[field])
    ));
  });
}

function pbwVerifyProtected_(entry, actualData, plan) {
  PBW.protectedFields.forEach(function(field) {
    const before = entry.protectedBefore[field];
    const after = actualData[field];
    if (pbwDeepComparable_(before) === pbwDeepComparable_(after)) return;
    plan.summary.verificationFailures++;
    plan.report.push(pbwReport_(
      'VERIFY', entry.source.sheet, entry.source.row, entry.source.barcode,
      'PROTECTED FIELD CHANGED',
      'Field ' + field + ' differs after sync. The sync request did not contain this field.'
    ));
  });
}

function pbwReport_(phase, sheet, row, barcode, result, details) {
  return [new Date(), phase, sheet, row, barcode, result, details];
}

function pbwWriteReport_(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PBW.reportSheet);
  if (!sheet) sheet = ss.insertSheet(PBW.reportSheet);

  const headers = [
    'TIMESTAMP', 'PHASE', 'SOURCE SHEET', 'SOURCE ROW',
    'UNIT BARCODE', 'FAILURE', 'DETAILS'
  ];
  const latestRows = rows || [];

  // Keep row 1 as the permanent header. Remove every previous run from row 2
  // downward before writing only the latest Preview/Execute result.
  const existingRows = sheet.getMaxRows();
  const existingColumns = Math.max(sheet.getMaxColumns(), headers.length);
  if (existingRows > 1) {
    sheet.getRange(2, 1, existingRows - 1, existingColumns).clearContent();
  }

  const requiredRows = latestRows.length + 1;
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (latestRows.length) {
    sheet.getRange(2, 1, latestRows.length, headers.length).setValues(latestRows);
  }
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

function pbwSummary_(plan, preview) {
  const s = plan.summary;
  const lines = [
    preview ? 'PREVIEW — NO WIX CHANGES' : 'EXECUTED',
    '',
    'Point Base non-empty rows: ' + s.sourceNonEmptyRows,
    'Valid unique products: ' + s.sourceValidUnique,
    'Matched in CMS: ' + s.matched,
    'Unchanged: ' + s.unchanged,
    preview ? 'Planned updates: ' + s.plannedUpdates : 'Updated successfully: ' + s.patchSuccess,
    preview ? 'Planned inserts: ' + s.plannedInserts : 'Inserted successfully: ' + s.insertSuccess,
    'Blocked source rows: ' + s.blocked,
    'Global blockers: ' + s.globalBlockers,
    'Duplicate CMS barcode groups: ' + s.cmsDuplicateGroups,
    'Numeric CMS unit barcodes: ' + s.cmsNumericItems
  ];

  if (!preview) {
    lines.push('Wix API failures: ' + s.apiFailures);
    lines.push('Verification failures: ' + s.verificationFailures);
  }

  lines.push('Failure report rows: ' + plan.report.length);
  return lines.join('\n');
}
