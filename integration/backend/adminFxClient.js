import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
const endpoint = 'https://fmcg999.wixstudio.com/fmcgmalaysia/_functions/masterFxRates';
export async function readCurrentAdminFx(currencies) {
  const secret = await getSecret('MASTER_INTAKE_SHARED_SECRET');
  if (!secret) throw Error('Current Admin FX connection is not configured.');
  const response = await fetch(endpoint, { method: 'post', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret }, body: JSON.stringify({ currencies }) });
  if (!response.ok) throw Error('Current Admin FX unavailable.');
  const data = await response.json();
  if (data.ok !== true || data.direction !== 'MYR_PER_CURRENCY_UNIT' || !Array.isArray(data.rates) || data.rates.length !== currencies.length) throw Error('Current Admin FX unavailable.');
  for (const currency of currencies) {
    const matches = data.rates.filter(row => row.currency === currency);
    if (matches.length !== 1 || typeof matches[0].rateToMyr !== 'number' || !Number.isFinite(matches[0].rateToMyr) || matches[0].rateToMyr <= 0 ||
        (currency === 'MYR' && matches[0].rateToMyr !== 1)) throw Error('Current Admin FX unavailable.');
  }
  return data.rates;
}
