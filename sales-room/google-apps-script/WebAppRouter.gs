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
  var rates = Array.isArray(body && body.rates) ? body.rates : [];
  var rateByCurrency = {};
  rates.forEach(function (item) {
    var currency = String(item && item.currency || '').trim().toUpperCase();
    var rate = Number(item && item.rateToMyr);
    if (/^[A-Z]{3}$/.test(currency) && isFinite(rate) && rate > 0) rateByCurrency[currency] = rate;
  });
  if (!Object.keys(rateByCurrency).length) throw new Error('No valid FX rates were supplied.');

  var result = { scanned: 0, updated: 0, skipped: 0, failed: 0, details: [] };
  var files = DriveApp.getFolderById(APPROVED_QD_FOLDER_ID).getFiles();
  while (files.hasNext()) {
    var file = files.next();
    var fileId = file.getId();
    var fileName = file.getName();
    result.scanned++;
    try {
      if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) {
        result.skipped++;
        result.details.push({ fileId: fileId, fileName: fileName, status: 'SKIPPED', reason: 'File is not a Google Sheet.' });
        continue;
      }
      var spreadsheet = SpreadsheetApp.openById(fileId);
      var sheet = spreadsheet.getSheetByName('WIX QUOTATION');
      if (!sheet) {
        result.skipped++;
        result.details.push({ fileId: fileId, fileName: fileName, status: 'SKIPPED', reason: 'WIX QUOTATION sheet is missing.' });
        continue;
      }
      var currency = String(sheet.getRange('D3').getDisplayValue() || sheet.getRange('D3').getValue() || '').trim().toUpperCase();
      var rate = Number(rateByCurrency[currency]);
      if (!/^[A-Z]{3}$/.test(currency) || !isFinite(rate) || rate <= 0) {
        result.skipped++;
        result.details.push({ fileId: fileId, fileName: fileName, status: 'SKIPPED', currency: currency, reason: 'D3 currency has no saved FX rate.' });
        continue;
      }
      sheet.getRange('D4').setValue(rate).setNumberFormat('0.00');
      result.updated++;
      result.details.push({ fileId: fileId, fileName: fileName, status: 'UPDATED', currency: currency, rateToMyr: rate });
    } catch (error) {
      result.failed++;
      result.details.push({ fileId: fileId, fileName: fileName, status: 'FAILED', reason: String(error && error.message || error) });
    }
  }
  SpreadsheetApp.flush();
  return result;
}
