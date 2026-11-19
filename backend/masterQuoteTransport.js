import { createHmac, timingSafeEqual } from 'crypto';
import { request as httpsRequest } from 'https';

const PURPOSE = 'master-to-fmcg-web-quotation-v1';
const MAX_AGE_MS = 60000;
const MAX_BYTES = 4096;
const READ_PURPOSE = 'master-to-fmcg-web-quotation-read-v1';
const MAX_READ_BYTES = 160000;
const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const sign = (secret, purpose, sentAt, body) => createHmac('sha256', secret).update(JSON.stringify([purpose, sentAt, body])).digest('hex');

function header(headers, name) {
  const keys = Object.keys(headers || {}).filter(key => key.toLowerCase() === name);
  const value = keys.length === 1 ? headers[keys[0]] : '';
  return typeof value === 'string' ? value : '';
}

function prepareRequest(secret, payload, now, purpose, maxBytes) {
  const body = JSON.stringify(payload);
  if (!secret || !body || Buffer.byteLength(body) > maxBytes) throw Error('Quotation gateway is unavailable.');
  const sentAt = String(now());
  return { method: 'POST', body, redirect: 'error', headers: { ...jsonHeaders,
    'X-Quotation-Sent-At': sentAt, 'X-Quotation-Signature': sign(secret, purpose, sentAt, body) } };
}

function quotationEndpoint(endpoint, functionName) {
  const url = new URL(endpoint);
  const paths = url.hostname === 'www.fmcgmalaysia.com' ? [`/_functions/${functionName}`] :
    url.hostname === 'fmcg999.wixstudio.com' ? [`/my-site-1/_functions/${functionName}`, `/fmcgmalaysia/_functions/${functionName}`] : [];
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || !paths.includes(url.pathname)) {
    throw Error('Invalid quotation destination.');
  }
  return url.href;
}

// Node's HTTPS transport never follows a redirect. Keep signed data at its destination.
function sendHttps(url, options) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { method: options.method, headers: { ...options.headers,
      'Content-Length': Buffer.byteLength(options.body) } }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        resolve({ ok: false });
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('error', reject);
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2_000_000) request.destroy(Error('Quotation response is too large.'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({ ok: true, json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(Error('Quotation gateway timed out.')));
    request.end(options.body);
  });
}

// Install with the verified live endpoint for the current environment only.
// Acknowledgements are bound to the same selection, publication and version.
export function createMasterQuoteSender({ endpoint, fetch = sendHttps, getSecret, now = Date.now }) {
  const url = quotationEndpoint(endpoint, 'masterWebQuotation');
  return async payload => {
    const request = prepareRequest(await getSecret(), payload, now, PURPOSE, MAX_BYTES);
    const response = await fetch(url, request);
    if (!response.ok) throw Error('FMCG quotation receipt is not confirmed.');
    const receipt = await response.json();
    if (receipt?.ok !== true || receipt.customerId !== payload.customerId || receipt.selectionId !== payload.selectionId ||
        receipt.requestId !== payload.requestId || receipt.version !== payload.version) throw Error('FMCG quotation receipt conflicts.');
    return receipt;
  };
}

function receiveSigned({ getSecret, operate, now, purpose, maxBytes }) {
  const result = (status, body) => ({ status, headers: jsonHeaders, body: JSON.stringify(body) });
  return async request => {
    const sentAt = header(request.headers, 'x-quotation-sent-at');
    const proof = header(request.headers, 'x-quotation-signature');
    if (!/^\d{13}$/.test(sentAt) || !/^[a-f0-9]{64}$/.test(proof) || Math.abs(now() - Number(sentAt)) > MAX_AGE_MS) return result(401, { ok: false });
    try {
      const body = await request.body.text();
      if (typeof body !== 'string' || Buffer.byteLength(body) > maxBytes) return result(400, { ok: false });
      const secret = await getSecret();
      if (!secret || !timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(sign(secret, purpose, sentAt, body), 'hex'))) return result(401, { ok: false });
      return result(200, await operate(JSON.parse(body)));
    } catch {
      return result(409, { ok: false });
    }
  };
}

export function createFmcgQuoteReceiver({ getSecret, putQuote, now = Date.now }) {
  return receiveSigned({ getSecret, operate: putQuote, now, purpose: PURPOSE, maxBytes: MAX_BYTES });
}

const key = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);

function validRead(input) {
  const { action, customerId, customerIds, selectionId } = input ?? {};
  if (action === 'customers') return customerIds === null ||
    (Array.isArray(customerIds) && customerIds.length <= 1000 && customerIds.every(key));
  if (action === 'selection') return key(customerId) && key(selectionId);
  return ['customer', 'selections'].includes(action) && key(customerId);
}

export function createFmcgQuotationReader({ getSecret, read, now = Date.now }) {
  return receiveSigned({ getSecret, now, purpose: READ_PURPOSE, maxBytes: MAX_READ_BYTES, operate: async input => {
    if (!validRead(input)) throw Error('Invalid quotation data request.');
    const { action, customerId, customerIds, selectionId } = input;
    return { ok: true, ...await read({ action, customerId, customerIds, selectionId }) };
  } });
}

export function createMasterQuotationReader({ endpoint, fetch = sendHttps, getSecret, now = Date.now }) {
  const url = quotationEndpoint(endpoint, 'masterWebQuotationRead');
  return async input => {
    if (!validRead(input)) throw Error('Invalid quotation data request.');
    const response = await fetch(url, prepareRequest(await getSecret(), input, now, READ_PURPOSE, MAX_READ_BYTES));
    if (!response.ok) throw Error('FMCG quotation data is unavailable.');
    const result = await response.json();
    if (result?.ok !== true) throw Error('FMCG quotation data is unavailable.');
    return result;
  };
}
