import { request as httpsRequest } from 'https';
import { getSecret } from 'wix-secrets-backend';
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzpMXT1ap2sOXRUkCAXx3BomPQK0E-0oTp6g3tna3Rs7cGHGRU0W2qRtwnU9YcC94qv/exec';
function failure(code) { const error = Error(code); error.code = code; return error; }
// Mirrors the verified Source onboarding transport: POST to Apps Script, GET its output redirect.
function nodeResponse(url, options) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: options.method, headers: options.headers || {} }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode || 0,
        headers: { get: name => response.headers[String(name).toLowerCase()] || '' },
        json: async () => JSON.parse(body) }));
    });
    req.setTimeout(20000, () => req.destroy(failure('POINTBASE_REQUEST_TIMEOUT')));
    req.on('error', error => reject(error.code === 'POINTBASE_REQUEST_TIMEOUT' ? error : failure('POINTBASE_REQUEST_FAILED')));
    if (options.body) req.write(options.body); req.end();
  });
}
function createPointbaseRequester({ send = nodeResponse, getSharedSecret = () => getSecret('FMCG_QD_ROUTER_TOKEN') } = {}) {
  return async fields => {
    const sharedSecret = await getSharedSecret();
    if (!sharedSecret) throw failure('POINTBASE_CONFIG_MISSING');
    let result = await send(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'MASTER_CAPTURE_COST', ...fields, sharedSecret }) });
    for (let hop = 0; [301, 302, 303, 307, 308].includes(result.status); hop++) {
      if (hop >= 3) throw failure('POINTBASE_REDIRECT_LIMIT');
      const location = result.headers?.get?.('location');
      let target; try { target = new URL(location); } catch { throw failure('POINTBASE_REDIRECT_MISSING'); }
      if (target.protocol !== 'https:' || target.hostname !== 'script.googleusercontent.com') throw failure('POINTBASE_REDIRECT_DENIED');
      result = await send(target.href, { method: 'GET' }); // Never forward credentials or POST data.
    }
    if (result.status < 200 || result.status >= 300) throw failure('POINTBASE_HTTP_' + result.status);
    let payload; try { payload = await result.json(); } catch { throw failure('POINTBASE_NON_JSON_RESPONSE'); }
    if (payload?.ok !== true) throw failure(/unauthori|shared.secret|authentic/i.test(String(payload?.error || '')) ?
      'POINTBASE_AUTH_REJECTED' : 'POINTBASE_SERVICE_REJECTED');
    return payload.result;
  };
}
export function createPointbaseCostClient(options) {
  const request = createPointbaseRequester(options);
  return async barcodes => {
    const result = await request({ barcodes });
    if (result?.kind !== 'MASTER_POINTBASE_COST_V1' || !result.costs || typeof result.costs !== 'object') throw failure('POINTBASE_RESULT_INVALID');
    return result.costs;
  };
}
export function createQuotationPointbaseClient(options) {
  const request = createPointbaseRequester(options);
  return async (mode, barcodes, requestKey) => {
    if (!['QUOTE_CAPTURE', 'QUOTE_CURRENT', 'QUOTE_STATUS'].includes(mode) ||
        (mode !== 'QUOTE_CURRENT' && !/^[a-f0-9]{64}$/.test(requestKey || ''))) throw failure('POINTBASE_REQUEST_INVALID');
    const result = await request({ mode, ...(barcodes ? { barcodes } : {}), ...(requestKey ? { requestKey } : {}) });
    if (result?.kind !== 'MASTER_QUOTATION_COST_V1' || (requestKey && result.requestKey !== requestKey) ||
        (mode === 'QUOTE_CURRENT' && (!result.costs || typeof result.costs !== 'object')) ||
        (mode !== 'QUOTE_CURRENT' && result.pending !== true &&
          ['updated', 'unchanged', 'failed'].some(key => !Number.isSafeInteger(result[key]) || result[key] < 0))) throw failure('POINTBASE_RESULT_INVALID');
    return result;
  };
}
export const capturePointbaseCosts = createPointbaseCostClient();
const quotationReferences = createQuotationPointbaseClient();
export const captureQuotationCosts = (barcodes, requestKey) => quotationReferences('QUOTE_CAPTURE', barcodes, requestKey);
export const readQuotationCosts = async barcodes => barcodes.length ? (await quotationReferences('QUOTE_CURRENT', barcodes)).costs : {};
export const readQuotationCostResult = requestKey => quotationReferences('QUOTE_STATUS', undefined, requestKey);
