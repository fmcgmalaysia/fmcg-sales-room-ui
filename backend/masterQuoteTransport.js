import { createHmac, timingSafeEqual } from 'crypto';

const PURPOSE = 'master-to-fmcg-web-quotation-v1';
const MAX_AGE_MS = 60000;
const MAX_BYTES = 4096;
const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const sign = (secret, sentAt, body) => createHmac('sha256', secret).update(JSON.stringify([PURPOSE, sentAt, body])).digest('hex');

function header(headers, name) {
  const keys = Object.keys(headers || {}).filter(key => key.toLowerCase() === name);
  const value = keys.length === 1 ? headers[keys[0]] : '';
  return typeof value === 'string' ? value : '';
}

function prepareRequest(secret, payload, now) {
  const body = JSON.stringify(payload);
  if (!secret || !body || Buffer.byteLength(body) > MAX_BYTES) throw Error('Quotation gateway is unavailable.');
  const sentAt = String(now());
  return { method: 'POST', body, redirect: 'error', headers: { ...jsonHeaders,
    'X-Quotation-Sent-At': sentAt, 'X-Quotation-Signature': sign(secret, sentAt, body) } };
}

// Install with the verified live endpoint for the current environment only.
// Acknowledgements are bound to the same selection, publication and version.
export function createMasterQuoteSender({ endpoint, fetch, getSecret, now = Date.now }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.hostname !== 'fmcg999.wixstudio.com' || url.port || url.username || url.password || url.search || url.hash ||
      !['/my-site-1/_functions/masterWebQuotation', '/fmcgmalaysia/_functions/masterWebQuotation'].includes(url.pathname)) throw Error('Invalid quotation destination.');
  return async payload => {
    const request = prepareRequest(await getSecret(), payload, now);
    const response = await fetch(url.href, request);
    if (!response.ok) throw Error('FMCG quotation receipt is not confirmed.');
    const receipt = await response.json();
    if (receipt?.ok !== true || receipt.customerId !== payload.customerId || receipt.selectionId !== payload.selectionId ||
        receipt.requestId !== payload.requestId || receipt.version !== payload.version) throw Error('FMCG quotation receipt conflicts.');
    return receipt;
  };
}

export function createFmcgQuoteReceiver({ getSecret, putQuote, now = Date.now }) {
  const result = (status, body) => ({ status, headers: jsonHeaders, body: JSON.stringify(body) });
  return async request => {
    const sentAt = header(request.headers, 'x-quotation-sent-at');
    const proof = header(request.headers, 'x-quotation-signature');
    if (!/^\d{13}$/.test(sentAt) || !/^[a-f0-9]{64}$/.test(proof) || Math.abs(now() - Number(sentAt)) > MAX_AGE_MS) return result(401, { ok: false });
    try {
      const body = await request.body.text();
      if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_BYTES) return result(400, { ok: false });
      const secret = await getSecret();
      if (!secret || !timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(sign(secret, sentAt, body), 'hex'))) return result(401, { ok: false });
      return result(200, await putQuote(JSON.parse(body)));
    } catch {
      return result(409, { ok: false });
    }
  };
}
