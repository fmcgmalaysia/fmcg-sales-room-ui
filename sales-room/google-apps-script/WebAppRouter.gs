/**
 * Uses the dedicated Script Property WIX_ONBOARDING_SHARED_SECRET.
 * Deploy as Web App, execute as the deployment owner.
 */
function doPost(e) {
  try {
    const body = JSON.parse(String(e && e.postData && e.postData.contents || '{}'));
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('WIX_ONBOARDING_SHARED_SECRET');
    if (!expectedSecret || String(body.sharedSecret || '') !== expectedSecret) {
      return WIX_json_({ ok: false, error: 'Unauthorized request.' });
    }

    const action = String(body.action || 'CREATE_QD').trim().toUpperCase();
    const result = action === 'ADD_SELECTION'
      ? WIX_addCatalogueSelection(body)
      : action === 'REMOVE_SELECTION'
        ? WIX_removeCatalogueSelection(body)
      : action === 'VERIFY_QD'
        ? WIX_verifyCustomerQuotationDesk(body)
      : action === 'GET_QUOTE_RISK_COUNTS'
        ? WIX_getQuoteRiskCounts(body)
      : action === 'SYNC_FX_RATES'
        ? WIX_syncFxRates(body)
      : action === 'PUBLISH_QUOTATIONS'
        ? WIX_publishCustomerQuotations(body)
        : WIX_createCustomerQuotationDesk(body);
    return WIX_json_({ ok: true, result: result });
  } catch (error) {
    return WIX_json_({ ok: false, error: String(error && error.message || error || 'Unknown QD service error.') });
  }
}

function WIX_json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function WIX_syncFxRates(body) {
  var APPROVED_QD_FOLDER_ID = '1frEBQD7vwPW6X_dqQSoItbFQDUQs3THL';
  var rows = Array.isArray(body && body.quotations) ? body.quotations : [];
  var result = { updated: 0, skipped: 0, failed: 0, details: [] };
  rows.forEach(function (item) {
    var customerId = String(item && item.customerId || '').trim();
    var fileId = String(item && item.qdFileId || '').trim();
    var expectedCurrency = String(item && item.currency || '').trim().toUpperCase();
    var rate = Number(item && item.rateToMyr);
    try {
      if (!customerId || !/^[A-Za-z0-9_-]{20,}$/.test(fileId) || !/^[A-Z]{3}$/.test(expectedCurrency) || !isFinite(rate) || rate <= 0) {
        result.skipped++;
        result.details.push({ customerId: customerId, status: 'SKIPPED', reason: 'Invalid customer, QD, currency or rate.' });
        return;
      }
      var file = DriveApp.getFileById(fileId);
      var parents = file.getParents();
      var inApprovedFolder = false;
      while (parents.hasNext()) {
        if (parents.next().getId() === APPROVED_QD_FOLDER_ID) { inApprovedFolder = true; break; }
      }
      if (!inApprovedFolder) {
        result.skipped++;
        result.details.push({ customerId: customerId, status: 'SKIPPED', reason: 'QD is outside the approved folder.' });
        return;
      }
      var spreadsheet = SpreadsheetApp.openById(fileId);
      var sheet = spreadsheet.getSheetByName('WIX QUOTATION');
      if (!sheet) {
        result.skipped++;
        result.details.push({ customerId: customerId, status: 'SKIPPED', reason: 'WIX QUOTATION sheet is missing.' });
        return;
      }
      var sheetCurrency = String(sheet.getRange('D3').getDisplayValue() || sheet.getRange('D3').getValue() || '').trim().toUpperCase();
      if (sheetCurrency !== expectedCurrency) {
        result.skipped++;
        result.details.push({ customerId: customerId, status: 'SKIPPED', reason: 'D3 currency mismatch.', expectedCurrency: expectedCurrency, actualCurrency: sheetCurrency });
        return;
      }
      sheet.getRange('D4').setValue(rate).setNumberFormat('0.00');
      SpreadsheetApp.flush();
      result.updated++;
      result.details.push({ customerId: customerId, status: 'UPDATED', currency: expectedCurrency, rateToMyr: rate });
    } catch (error) {
      result.failed++;
      result.details.push({ customerId: customerId, status: 'FAILED', reason: String(error && error.message || error) });
    }
  });
  return result;
}
