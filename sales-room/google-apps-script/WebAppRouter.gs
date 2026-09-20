/**
 * Keep the existing Script Property NCT_ONBOARDING_SHARED_SECRET.
 * Deploy as Web App, execute as the deployment owner.
 */
function doPost(e) {
  try {
    const body = JSON.parse(String(e && e.postData && e.postData.contents || '{}'));
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('NCT_ONBOARDING_SHARED_SECRET');
    if (!expectedSecret || String(body.sharedSecret || '') !== expectedSecret) {
      return WIX_json_({ ok: false, error: 'Unauthorized request.' });
    }

    const action = String(body.action || 'CREATE_QD').trim().toUpperCase();
    const result = action === 'ADD_SELECTION'
      ? WIX_addCatalogueSelection(body)
      : action === 'VERIFY_QD'
        ? WIX_verifyCustomerQuotationDesk(body)
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
