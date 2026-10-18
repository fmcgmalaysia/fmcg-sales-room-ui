import { timingSafeEqual } from 'crypto';
import { createNctIntake } from './nctIntake.js';

/** Backend-only authentication. Credentials never enter iframe messages or browser HTML. */
export function createNctReceiver({ store, getIntakeSecret, captureCosts }) {
  const receive = createNctIntake({ store, captureCosts });
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
    try { return { status: 200, body: await receive(body) }; }
    catch (error) { return { status: 503, body: { ok: false, error: 'Master did not acknowledge a complete receipt. Keep the Sales order unsubmitted.' } }; }
  };
}
