import { handleMasterSupportCustomers } from 'backend/masterSupportCustomers.js';
import { receiveMasterWebQuotation, receiveMasterWebQuotationRead } from 'backend/masterWebQuotationHttp.js';
import { response } from 'wix-http-functions';
import { readMasterFxRates } from 'backend/masterFxRead.js';
import { readMasterCustomerNames } from 'backend/masterCustomerNames.js';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import { authentication } from 'wix-members-backend';
import wixData from 'wix-data';
import { verifyBuyerSelectionExportToken } from 'backend/buyerSelectionExportToken.js';
import { buildBuyerSelectionDownload } from 'backend/buyerSelectionDownload.js';
import { verifyBuyerOrderExportToken } from 'backend/buyerOrderExportToken.js';
import { buildBuyerOrderDownload } from 'backend/buyerOrderDownload.js';
import { getMasterStaffScope } from 'backend/masterStaffAccessClient.js';

const SITE_BASE = 'https://www.fmcgmalaysia.com';
const CALLBACK_URL = SITE_BASE + '/_functions/googleStaffAuth';
const LOGIN_URL = SITE_BASE + '/sales-room-login';
const BUYER_LOGIN_URL = SITE_BASE + '/';
const CUSTOMER_COLLECTION = 'WixCustomers';
const CUSTOMER_USER_COLLECTION = 'WixCustomerUsers';
const ACTIVE_STATUS = 'ACTIVE';

function redirectTo(url) {
  return response({ status: 302, headers: { Location: url, 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' } });
}
function loginRedirect(status, state = '') {
  const query = new URLSearchParams({ oauth: status });
  if (state) query.set('state', state);
  return redirectTo(LOGIN_URL + '?' + query.toString());
}
function buyerLoginRedirect(status, state = '') {
  const query = new URLSearchParams({ oauth: status });
  if (state) query.set('state', state);
  return redirectTo(BUYER_LOGIN_URL + '?' + query.toString());
}
function oauthRedirect(status, state = '') {
  return normalize(state).startsWith('B_') ? buyerLoginRedirect(status, state) : loginRedirect(status, state);
}
function normalize(value) { return String(value || '').trim(); }
function normalizeEmail(value) { return normalize(value).toLowerCase(); }
function validState(value) { return /^[A-Za-z0-9_-]{32,128}$/.test(normalize(value)); }
async function oauthSecrets() {
  const [clientId, clientSecret] = await Promise.all([getSecret('GOOGLE_OAUTH_CLIENT_ID'), getSecret('GOOGLE_OAUTH_CLIENT_SECRET')]);
  if (!clientId || !clientSecret) throw new Error('OAUTH_SECRETS_MISSING');
  return { clientId, clientSecret };
}
async function findAuthorizedBuyer(email) {
  const users = (await wixData.query(CUSTOMER_USER_COLLECTION).eq('email', email).limit(2).find({ suppressAuth: true, consistentRead: true })).items;
  if (users.length !== 1) return { authorized: false, reason: users.length > 1 ? 'DUPLICATE_BUYER_EMAIL' : 'BUYER_NOT_REGISTERED' };
  const user = users[0];
  if (normalize(user.status).toUpperCase() !== ACTIVE_STATUS) return { authorized: false, reason: 'BUYER_USER_INACTIVE' };

  const customerId = normalize(user.customerId);
  const customers = (await wixData.query(CUSTOMER_COLLECTION).eq('customerId', customerId).limit(2).find({ suppressAuth: true, consistentRead: true })).items;
  if (customers.length !== 1) return { authorized: false, reason: customers.length > 1 ? 'DUPLICATE_CUSTOMER_ID' : 'CUSTOMER_NOT_FOUND' };
  const customer = customers[0];
  const lifecycle = normalize(customer.lifecycleStatus || customer.customerStatus).toUpperCase();
  const access = normalize(customer.catalogueAccessStatus || customer.accessStatus || customer.customerStatus).toUpperCase();
  if (lifecycle === 'ARCHIVED' || ['SUSPENDED', 'BLOCKED', 'INACTIVE'].includes(access)) {
    return { authorized: false, reason: 'CUSTOMER_INACTIVE' };
  }
  return { authorized: true, user, customer };
}

export async function get_googleStaffAuthStart(request) {
  const state = normalize(request.query && request.query.state);
  if (!validState(state)) return loginRedirect('invalid_state');
  try {
    const { clientId } = await oauthSecrets();
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: CALLBACK_URL, response_type: 'code', scope: 'openid email', state, prompt: 'select_account', include_granted_scopes: 'true' });
    return redirectTo('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
  } catch (error) {
    console.error('Google OAuth start failed', error);
    return loginRedirect('configuration_error', state);
  }
}

export async function get_googleBuyerAuthStart(request) {
  const state = normalize(request.query && request.query.state);
  if (!validState(state) || !state.startsWith('B_')) return buyerLoginRedirect('invalid_state');
  try {
    const { clientId } = await oauthSecrets();
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: CALLBACK_URL, response_type: 'code', scope: 'openid email', state, prompt: 'select_account', include_granted_scopes: 'true' });
    return redirectTo('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
  } catch (error) {
    console.error('Buyer Google OAuth start failed', error);
    return buyerLoginRedirect('configuration_error', state);
  }
}

export async function get_googleStaffAuth(request) {
  const state = normalize(request.query && request.query.state);
  const code = normalize(request.query && request.query.code);
  const oauthError = normalize(request.query && request.query.error);
  if (!validState(state)) return loginRedirect('invalid_state');
  if (oauthError) return oauthRedirect(oauthError === 'access_denied' ? 'cancelled' : 'google_error', state);
  if (!code) return oauthRedirect('missing_code', state);
  try {
    const { clientId, clientSecret } = await oauthSecrets();
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'post', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: CALLBACK_URL, grant_type: 'authorization_code' }).toString()
    });
    if (!tokenResponse.ok) throw new Error('TOKEN_EXCHANGE_FAILED');
    const tokenData = await tokenResponse.json();
    const accessToken = normalize(tokenData.access_token);
    if (!accessToken) throw new Error('ACCESS_TOKEN_MISSING');
    const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { method: 'get', headers: { Authorization: 'Bearer ' + accessToken } });
    if (!userResponse.ok) throw new Error('USERINFO_FAILED');
    const user = await userResponse.json();
    const email = normalizeEmail(user.email);
    if (!email || user.email_verified !== true) return oauthRedirect('unverified_email', state);
    const isBuyer = state.startsWith('B_');
    const access = isBuyer ? await findAuthorizedBuyer(email) : await getMasterStaffScope(email, true);
    if (isBuyer ? !access.authorized : !access) {
      console.warn(isBuyer ? 'Buyer Room access denied' : 'Sales Room access denied');
      return oauthRedirect('not_authorized', state);
    }
    const sessionToken = await authentication.generateSessionToken(email);
    const query = new URLSearchParams({ oauth: 'success', state, token: sessionToken });
    return redirectTo((isBuyer ? BUYER_LOGIN_URL : LOGIN_URL) + '?' + query.toString());
  } catch (error) {
    console.error('Google OAuth callback failed', error);
    return oauthRedirect('server_error', state);
  }
}

// QUOTATION DESK -> BUYER ROOM RELEASE
export async function get_buyerSelectionExcel(request) {
  try {
    const authorization = verifyBuyerSelectionExportToken(request?.query?.token, await getSecret('BUYER_EXCEL_DOWNLOAD_SECRET'));
    const buyerRoomUrl = normalize(request?.baseUrl).replace(/\/_functions\/?$/i, '') + '/buyer-room';
    const file = await buildBuyerSelectionDownload(authorization.customerId, buyerRoomUrl);
    return response({
      status: 200,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${file.fileName}"`,
        'content-length': String(file.bytes.length),
        'cache-control': 'private, no-store, max-age=0',
        pragma: 'no-cache',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'cross-origin',
        'referrer-policy': 'no-referrer'
      },
      body: file.bytes
    });
  } catch (error) {
    const code = normalize(error?.message);
    const status = ['INVALID_EXPORT_TOKEN', 'EXPIRED_EXPORT_TOKEN'].includes(code) ? 403 : code === 'There are no products to export.' ? 404 : 500;
    console.error('Buyer selection direct download failed', { status, code });
    return response({
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' },
      body: JSON.stringify({ ok: false, error: status === 403 ? 'This download link has expired. Return to Buyer Room and try again.' : code || 'Excel download could not be created.' })
    });
  }
}

export async function get_buyerOrderExcel(request) {
  try {
    const authorization = verifyBuyerOrderExportToken(request?.query?.token, await getSecret('BUYER_EXCEL_DOWNLOAD_SECRET'));
    const buyerRoomUrl = normalize(request?.baseUrl).replace(/\/_functions\/?$/i, '') + '/buyer-room';
    let file;
    let lastError;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      try {
        file = await buildBuyerOrderDownload(authorization.customerId, authorization.orderId, buyerRoomUrl);
        break;
      } catch (error) {
        lastError = error;
        const message = normalize(error?.message);
        if (!['Order was not found.', 'Order is not ready for download.', 'Order lines are incomplete.'].includes(message)) throw error;
        if (attempt < 15) await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    if (!file) throw lastError || new Error('Order Excel could not be created.');
    return response({
      status: 200,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${file.fileName}"`,
        'content-length': String(file.bytes.length),
        'cache-control': 'private, no-store, max-age=0',
        pragma: 'no-cache',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'cross-origin',
        'access-control-allow-origin': 'https://fmcgmalaysia.github.io',
        'access-control-expose-headers': 'content-disposition',
        vary: 'Origin'
      },
      body: file.bytes
    });
  } catch (error) {
    const code = normalize(error?.message);
    const status = ['INVALID_ORDER_EXPORT_TOKEN', 'EXPIRED_ORDER_EXPORT_TOKEN'].includes(code) ? 403 : code === 'Order was not found.' ? 404 : 500;
    console.error('Buyer order direct download failed', { status, code });
    return response({
      status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store, max-age=0',
        'access-control-allow-origin': 'https://fmcgmalaysia.github.io',
        'access-control-expose-headers': 'content-disposition',
        vary: 'Origin'
      },
      body: JSON.stringify({ ok: false, error: status === 403 ? 'This order download link has expired.' : code || 'Order Excel could not be created.' })
    });
  }
}

export async function post_quotationSync() {
  return response({
    status: 410,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ ok: false, error: 'This action has been retired.' })
  });
}
export async function post_masterFxRates(request) {
  try {
    const result = await readMasterFxRates(request);
    return response({ status: result.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(result.body) });
  } catch (_) {
    return response({ status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: false, error: 'Current Admin FX rates could not be confirmed.' }) });
  }
}
export async function post_masterCustomerNames(request) {
  try {
    const result=await readMasterCustomerNames(request);
    return response({status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(result.body)});
  } catch (_) {return response({status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({ok:false,error:'Customer short names could not be confirmed.'})});}
}

export async function post_masterSupportCustomers(request) {
 try { const result=await handleMasterSupportCustomers(request); return response({status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(result.body)}); }
 catch (_) {return response({status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({ok:false,error:'Customer profiles could not be confirmed.'})});}
}

export async function post_masterWebQuotation(request) {
  return response(await receiveMasterWebQuotation(request));
}

export async function post_masterWebQuotationRead(request) {
  return response(await receiveMasterWebQuotationRead(request));
}
