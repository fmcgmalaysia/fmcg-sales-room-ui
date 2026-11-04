import { createCurrentOrderIntake } from 'backend/stockCurrentOrderIntake.js';
import { timingSafeEqual } from 'crypto';
import { createNctIntake, createNctReceiptReader } from './nctIntake.js';

/** Backend-only authentication. Credentials never enter iframe messages or browser HTML. */
export function createNctReceiver({ store, getIntakeSecret, captureCosts }) {
  const receive = createNctIntake({ store, captureCosts });
  const readReceipt = createNctReceiptReader({ store });
  return async function handle(request) {
    let secret;
    try { secret = await getIntakeSecret(); }
    catch (error) { return { status: 503, body: { ok: false, error: 'Master intake is not configured.' } }; }
    if (typeof secret !== 'string' || !secret) return { status: 503, body: { ok: false, error: 'Master intake is not configured.' } };
    const headers = request.headers || {};
    const authKeys = Object.keys(headers).filter(key => key.toLowerCase() === 'authorization');
    const supplied = authKeys.length === 1 && typeof headers[authKeys[0]] === 'string' ? headers[authKeys[0]] : '';
    const expectedBytes = Buffer.from('Bearer ' + secret), suppliedBytes = Buffer.from(supplied);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      return { status: 401, body: { ok: false, error: 'Unauthorized request.' } };
    }
    let body;
    try { body = await request.body.json(); }
    catch (error) { return { status: 400, body: { ok: false, error: 'Invalid intake request.' } }; }
    try {
      const submission = body?.action === 'READ_RECEIPT' ? body.submission : body;
      const current = await createCurrentOrderIntake({ company: submission?.destination, captureCosts });
      if (current?.mode === 'LEGACY') return { status: 200, body: body?.action === 'READ_RECEIPT' ? await readReceipt(body.submission) : await receive(body) };
      if (current?.mode !== 'ACTIVE') throw Error('Current intake unavailable; retain original source order');
      return { status: 200, body: body?.action === 'READ_RECEIPT' ? await current.readReceipt(body.submission) : await current.receive(body) };
    }
    catch (error) { return { status: 503, body: { ok: false, error: 'Master did not acknowledge a complete receipt. Keep the Sales order unsubmitted.' } }; }
  };
}
