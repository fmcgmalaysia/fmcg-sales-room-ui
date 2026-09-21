import { response } from 'wix-http-functions';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import { authentication } from 'wix-members-backend';
import wixData from 'wix-data';

const SITE_BASE = 'https://fmcg999.wixstudio.com/fmcgmalaysia';
const CALLBACK_URL = SITE_BASE + '/_functions/googleStaffAuth';
const LOGIN_URL = SITE_BASE + '/sales-room-login';
const BUYER_LOGIN_URL = SITE_BASE + '/buyer-room-login';
const STAFF_COLLECTION = 'StaffMaster';
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
async function findAuthorizedStaff(email) {
  const result = await wixData.query(STAFF_COLLECTION).limit(1000).find({ suppressAuth: true });
  const matches = result.items.filter(item => normalizeEmail(item.staffEmail) === email);
  if (matches.length !== 1) return { authorized: false, reason: matches.length > 1 ? 'DUPLICATE_STAFF_EMAIL' : 'STAFF_NOT_REGISTERED' };
  const staff = matches[0];
  if (normalize(staff.status).toUpperCase() !== ACTIVE_STATUS) return { authorized: false, reason: 'STAFF_INACTIVE' };
  return { authorized: true, staff };
}
async function findAuthorizedBuyer(email) {
  const userResult = await wixData.query(CUSTOMER_USER_COLLECTION).limit(1000).find({ suppressAuth: true, consistentRead: true });
  const users = userResult.items.filter(item => normalizeEmail(item.email) === email);
  if (users.length !== 1) return { authorized: false, reason: users.length > 1 ? 'DUPLICATE_BUYER_EMAIL' : 'BUYER_NOT_REGISTERED' };
  const user = users[0];
  if (normalize(user.status).toUpperCase() !== ACTIVE_STATUS) return { authorized: false, reason: 'BUYER_USER_INACTIVE' };

  const customerId = normalize(user.customerId);
  const customerResult = await wixData.query(CUSTOMER_COLLECTION).limit(1000).find({ suppressAuth: true, consistentRead: true });
  const customers = customerResult.items.filter(item => normalize(item.customerId) === customerId);
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
    const access = isBuyer ? await findAuthorizedBuyer(email) : await findAuthorizedStaff(email);
    if (!access.authorized) {
      console.warn(isBuyer ? 'Buyer Room access denied' : 'Sales Room access denied', { reason: access.reason });
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
const QUOTE_LIST_COLLECTION = 'WixBuyerListItems';
const QUOTE_CUSTOMER_COLLECTION = 'WixCustomers';
function quoteJson(status, payload) {
  return response({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(payload) });
}
function quotePayload(record) {
  const raw = record?.payload;
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw || '{}')); } catch (_) { return {}; }
}
function quoteNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function quoteBarcode(value) { return String(value || '').replace(/\.0$/, '').trim(); }
async function quoteSecret() {
  try { return await getSecret('WIX_QUOTE_SYNC_TOKEN'); }
  catch (_) { return getSecret('NCT_ONBOARDING_SHARED_SECRET'); }
}

export async function post_quotationSync(request) {
  try {
    const expected = normalize(await quoteSecret());
    const authorization = normalize(request?.headers?.authorization);
    if (!expected || authorization !== 'Bearer ' + expected) return quoteJson(401, { ok: false, error: 'Unauthorized quotation sync.' });
    const body = await request.body.json();
    const customerId = normalize(body?.customerId);
    const qdFileId = normalize(body?.quotationDeskFileId);
    const quotations = Array.isArray(body?.quotations) ? body.quotations : [];
    if (!customerId || !qdFileId || !quotations.length) return quoteJson(400, { ok: false, error: 'Quotation sync payload is incomplete.' });
    const customers = await wixData.query(QUOTE_CUSTOMER_COLLECTION).eq('customerId', customerId).limit(2).find({ suppressAuth: true, consistentRead: true });
    if (customers.items.length !== 1) return quoteJson(404, { ok: false, error: 'Customer account was not found.' });
    const customer = customers.items[0];
    if (normalize(customer.qdFileId) !== qdFileId) return quoteJson(403, { ok: false, error: 'Quotation Desk identity does not match this customer.' });
    const currency = normalize(customer.preferredCurrency || customer.tradingCurrency || 'USD').toUpperCase();
    const results = [];
    for (const quotation of quotations) {
      const wixMyListId = normalize(quotation?.wixMyListId);
      try {
        if (!wixMyListId) throw new Error('WIX MY LIST ID is missing.');
        const record = await wixData.get(QUOTE_LIST_COLLECTION, wixMyListId, { suppressAuth: true });
        if (!record) throw new Error('Buyer list item was not found.');
        const item = quotePayload(record);
        if (normalize(item.customerId) !== customerId) throw new Error('Buyer list item belongs to another customer.');
        if (quoteBarcode(item.unitBarcode || item.barcode) !== quoteBarcode(quotation.unitBarcode)) throw new Error('Unit Barcode does not match the selected item.');
        const quotePerPc = quoteNumber(quotation.quotePerPc);
        const quotePerCtn = quoteNumber(quotation.quotePerCtn);
        if (!(quotePerPc > 0) || !(quotePerCtn > 0)) throw new Error('Both quotation prices must be greater than zero.');
        const now = new Date().toISOString();
        const next = { ...item, quoteStatus: 'VIEW QUOTE', quoteActive: true, quotePerPc, quotePerCtn, vipPriceEa: quotePerPc, vipPriceCtn: quotePerCtn, vipCurrency: currency, targetGp: quotation.targetGp ?? null, quoteSyncedAt: now, quoteRequestId: normalize(body.requestId), quoteActorEmail: normalizeEmail(body.actorEmail), lastEditedBy: normalizeEmail(body.actorEmail) || 'FMCG Malaysia' };
        await wixData.update(QUOTE_LIST_COLLECTION, { ...record, payload: JSON.stringify(next) }, { suppressAuth: true });
        results.push({ ok: true, wixMyListId, quoteStatus: 'VIEW QUOTE' });
      } catch (error) {
        results.push({ ok: false, wixMyListId, error: normalize(error?.message || error) });
      }
    }
    return quoteJson(200, { ok: true, requestId: normalize(body.requestId), results });
  } catch (error) {
    console.error('Quotation sync failed', error);
    return quoteJson(500, { ok: false, error: normalize(error?.message || error || 'Quotation sync failed.') });
  }
}
