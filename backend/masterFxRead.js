import { timingSafeEqual } from 'crypto';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
export async function readMasterFxRates(request) {
  const secret = await getSecret('MASTER_INTAKE_SHARED_SECRET');
  const keys = Object.keys(request.headers || {}).filter(key => key.toLowerCase() === 'authorization');
  const supplied = keys.length === 1 ? request.headers[keys[0]] : '';
  const expected = Buffer.from('Bearer ' + secret), actual = Buffer.from(typeof supplied === 'string' ? supplied : '');
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { status: 401, body: { ok: false } };
  try {
    const body = await request.body.json(), currencies = body.currencies;
    if (!Array.isArray(currencies) || !currencies.length || currencies.length > 30 ||
        new Set(currencies).size !== currencies.length || currencies.some(code => typeof code !== 'string' || !/^[A-Z]{3}$/.test(code))) throw Error('Invalid currencies.');
    const found = await wixData.query('WixFxRates').hasSome('currency', currencies).limit(1000).find({ suppressAuth: true, consistentRead: true });
    const rates = currencies.map(currency => {
      const matches = found.items.filter(row => row.currency === currency && row.active !== false);
      if (matches.length !== 1 || typeof matches[0].rateToMyr !== 'number' || !Number.isFinite(matches[0].rateToMyr) || matches[0].rateToMyr <= 0 ||
          (currency === 'MYR' && matches[0].rateToMyr !== 1)) throw Error('Current Admin FX unavailable.');
      const row = matches[0];
      return { currency, rateToMyr: row.rateToMyr, updatedAt: row.rateUpdatedAt || null };
    });
    return { status: 200, body: { ok: true, direction: 'MYR_PER_CURRENCY_UNIT', rates } };
  } catch (_) { return { status: 503, body: { ok: false, error: 'Current Admin FX rates could not be confirmed.' } }; }
}
