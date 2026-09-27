import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { request as httpsRequest } from 'https';
import { getSecret } from 'wix-secrets-backend';

const APPS_SCRIPT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzpMXT1ap2sOXRUkCAXx3BomPQK0E-0oTp6g3tna3Rs7cGHGRU0W2qRtwnU9YcC94qv/exec';
const SECRET_NAME = 'FMCG_QD_ROUTER_TOKEN';
const STAFF_COLLECTION = 'StaffMaster';
const FX_COLLECTION = 'WixFxRates';
const DEFAULT_RATES = Object.freeze([
  { currency: 'MYR', rateToMyr: 1 },
  { currency: 'USD', rateToMyr: 4 },
  { currency: 'SGD', rateToMyr: 3.2 }
]);

export const getFxRateSettings = webMethod(Permissions.SiteMember, async () => {
  await requireFxAdmin();
  const snapshot = await readFxRegistry();
  return { ok: true, ...snapshot };
});

export const saveAndSyncFxRates = webMethod(Permissions.SiteMember, async (rawRates) => {
  const admin = await requireFxAdmin();
  const rates = normalizeRates(rawRates);
  await saveFxRegistry(rates, admin.loginEmail);

  const sharedSecret = await getSecret(SECRET_NAME);
  const response = await postAppsScript({
    action: 'SYNC_FX_RATES',
    sharedSecret,
    actorEmail: admin.loginEmail,
    rates
  });
  const body = parseAppsScriptResponse(await response.text());
  if (!response.ok || !body.ok) throw new Error(body.error || 'FX rates were saved, but QD synchronization failed.');

  const result = body.result || {};
  await saveSyncSummary(admin.loginEmail, result);
  return { ok: true, rates, result, lastSyncAt: new Date() };
});

async function requireFxAdmin() {
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  if (!member || !member._id) throw new Error('Please sign in before opening FX Rate Settings.');
  const email = memberEmail(member);
  const result = await wixData.query(STAFF_COLLECTION).limit(1000).find({ suppressAuth: true });
  const matches = result.items.filter((item) =>
    normalize(item.wixMemberId) === normalize(member._id) ||
    (email && normalizeEmail(item.staffEmail) === email)
  );
  if (matches.length !== 1 || upper(matches[0].status) !== 'ACTIVE') throw new Error('This member is not authorized in STAFF MASTER.');
  const role = upper(matches[0].role);
  if (role !== 'ADMIN' && role !== 'SUPER ADMIN') throw new Error('FX Rate Settings are restricted to Admin roles.');
  return { loginEmail: email, role };
}

async function readFxRegistry() {
  const result = await wixData.query(FX_COLLECTION).limit(1000).find({ suppressAuth: true, consistentRead: true });
  const active = result.items.filter((item) => item.active !== false);
  const rates = normalizeRates(active.length ? active : DEFAULT_RATES);
  const meta = result.items.find((item) => upper(item.currency || item.title) === 'MYR') || {};
  return { rates, lastSyncAt: meta.lastSyncedAt || null, lastSyncSummary: normalize(meta.lastSyncSummary) };
}

async function saveFxRegistry(rates, actorEmail) {
  const existing = await wixData.query(FX_COLLECTION).limit(1000).find({ suppressAuth: true, consistentRead: true });
  const byCurrency = new Map(existing.items.map((item) => [upper(item.currency || item.title), item]));
  const activeCodes = new Set(rates.map((item) => item.currency));
  const now = new Date();
  for (const rate of rates) {
    const previous = byCurrency.get(rate.currency);
    const record = { ...(previous || {}), title: rate.currency, currency: rate.currency, rateToMyr: rate.rateToMyr, active: true, updatedBy: actorEmail, rateUpdatedAt: now };
    if (previous && previous._id) await wixData.update(FX_COLLECTION, record, { suppressAuth: true });
    else await wixData.insert(FX_COLLECTION, record, { suppressAuth: true });
  }
  for (const previous of existing.items) {
    const currency = upper(previous.currency || previous.title);
    if (currency && !activeCodes.has(currency)) await wixData.update(FX_COLLECTION, { ...previous, active: false, updatedBy: actorEmail, rateUpdatedAt: now }, { suppressAuth: true });
  }
}

async function saveSyncSummary(actorEmail, result) {
  const query = await wixData.query(FX_COLLECTION).eq('currency', 'MYR').limit(1).find({ suppressAuth: true, consistentRead: true });
  if (!query.items[0]) return;
  await wixData.update(FX_COLLECTION, {
    ...query.items[0],
    lastSyncedAt: new Date(),
    lastSyncSummary: `${Number(result.updated) || 0} updated · ${Number(result.skipped) || 0} skipped · ${Number(result.failed) || 0} failed`,
    updatedBy: actorEmail
  }, { suppressAuth: true });
}

function normalizeRates(input) {
  const values = Array.isArray(input) ? input : [];
  const unique = new Map();
  for (const item of values) {
    const currency = upper(item && (item.currency || item.title));
    const rate = currency === 'MYR' ? 1 : Number(item && item.rateToMyr);
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Every FX entry requires a three-letter currency code.');
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`${currency} requires a rate above 0.00.`);
    unique.set(currency, { currency, rateToMyr: Math.round(rate * 1000000) / 1000000 });
  }
  if (!unique.size) throw new Error('At least one FX rate is required.');
  unique.set('MYR', { currency: 'MYR', rateToMyr: 1 });
  return [...unique.values()].sort((a, b) => a.currency === 'MYR' ? -1 : b.currency === 'MYR' ? 1 : a.currency.localeCompare(b.currency));
}

function postAppsScript(payload) {
  const send = (url, method, body) => new Promise((resolve, reject) => {
    const request = httpsRequest(url, { method, headers: { 'Content-Type': 'application/json' } }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode || 0, headers: response.headers || {}, text }));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
  const body = JSON.stringify(payload);
  return send(APPS_SCRIPT_ENDPOINT, 'POST', body).then(async (first) => {
    let current = first;
    if ([301, 302, 303, 307, 308].includes(current.status)) {
      const location = normalize(current.headers.location);
      if (!location) throw new Error('QD redirect location is missing.');
      current = await send(location, 'GET', '');
    }
    return { ok: current.status >= 200 && current.status < 300, text: async () => current.text };
  });
}

function parseAppsScriptResponse(text) {
  const body = JSON.parse(String(text || '').replace(/^\)\]\}'\s*/, ''));
  return body && typeof body === 'object' ? body : {};
}

function memberEmail(member) {
  const first = member && member.contactDetails && member.contactDetails.emails && member.contactDetails.emails[0];
  return normalizeEmail(member && (member.loginEmail || (typeof first === 'string' ? first : first && first.email)));
}
function normalize(value) { return String(value == null ? '' : value).trim(); }
function normalizeEmail(value) { return normalize(value).toLowerCase(); }
function upper(value) { return normalize(value).toUpperCase(); }
