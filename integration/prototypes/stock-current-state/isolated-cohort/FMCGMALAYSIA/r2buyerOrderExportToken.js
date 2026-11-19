import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_AUDIENCE = 'buyer-order-xlsx';
const TOKEN_VERSION = 1;

function normalize(value) { return String(value ?? '').trim(); }
function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64');
}
function signatureFor(encodedPayload, secret) {
  return createHmac('sha256', normalize(secret)).update(encodedPayload).digest();
}

export function createBuyerOrderExportToken(customerId, orderId, secret, lifetimeSeconds = 900) {
  const customer = normalize(customerId);
  const order = normalize(orderId);
  const key = normalize(secret);
  if (!customer || !order || !key) throw new Error('Order download authorization is unavailable.');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: TOKEN_VERSION,
    aud: TOKEN_AUDIENCE,
    customerId: customer,
    orderId: order,
    iat: now,
    exp: now + Math.max(300, Math.min(1800, Number(lifetimeSeconds) || 900))
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(signatureFor(encodedPayload, key));
  return { token: `${encodedPayload}.${signature}`, expiresAt: payload.exp * 1000 };
}

export function verifyBuyerOrderExportToken(token, secret) {
  const key = normalize(secret);
  const parts = normalize(token).split('.');
  if (!key || parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('INVALID_ORDER_EXPORT_TOKEN');
  const expected = signatureFor(parts[0], key);
  const actual = base64UrlDecode(parts[1]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('INVALID_ORDER_EXPORT_TOKEN');
  let payload;
  try { payload = JSON.parse(base64UrlDecode(parts[0]).toString('utf8')); }
  catch (_) { throw new Error('INVALID_ORDER_EXPORT_TOKEN'); }
  const now = Math.floor(Date.now() / 1000);
  if (payload?.v !== TOKEN_VERSION || payload?.aud !== TOKEN_AUDIENCE || !normalize(payload?.customerId)
      || !normalize(payload?.orderId) || !Number.isFinite(Number(payload?.exp)) || Number(payload.exp) < now
      || Number(payload.exp) > now + 1800) throw new Error('EXPIRED_ORDER_EXPORT_TOKEN');
  return { customerId: normalize(payload.customerId), orderId: normalize(payload.orderId), expiresAt: Number(payload.exp) * 1000 };
}
