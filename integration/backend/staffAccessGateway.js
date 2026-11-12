import { timingSafeEqual } from 'crypto';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { canUseSalesRoomCustomer, normalizeStaffAccess, projectFmcgStaffScope } from 'backend/staffManagementPolicy.js';

const reply = (status, allowed = false) => ({ status, body: { allowed } });

function matchesSecret(request, secret) {
  const headers = Object.entries(request.headers ?? {})
    .filter(([key]) => key.toLowerCase() === 'authorization');
  if (!secret || headers.length !== 1 || typeof headers[0][1] !== 'string') return false;
  const supplied = Buffer.from(headers[0][1]);
  const expected = Buffer.from('Bearer ' + secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

// The caller obtains loginEmail from the approved Wix member on FMCG.
// The shared token is exclusively for server-to-server staff authorization.
export async function checkFmcgStaffAccess(request) {
  try {
    if (!matchesSecret(request, await getSecret('MASTER_STAFF_AUTH_SHARED_SECRET'))) return reply(401);
    const raw = await request.body.text();
    if (raw.length > 1024) return reply(400);
    let input;
    try { input = JSON.parse(raw); } catch { return reply(400); }
    const email = typeof input?.loginEmail === 'string' ? input.loginEmail.trim().toLowerCase() : '';
    const action = input?.action;
    const customerId = input?.customerId;
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof action !== 'string' || action.length > 30 ||
        (!['ENTER', 'DIRECTORY_SCOPE'].includes(action) && (typeof customerId !== 'string' || !customerId || customerId.length > 160))) {
      return reply(400);
    }
    const { items } = await wixData.query('StaffMasterAccess').eq('staffEmail', email).limit(2)
      .find({ suppressAuth: true, consistentRead: true });
    const staff = items.length === 1 ? items[0] : null;
    const verifiedFmcgMember = action === 'DIRECTORY_SCOPE' && input.verifiedFmcgEmail === true;
    if (staff?.staffStatus !== 'ACTIVE' || !staff.title || (!staff.description && !verifiedFmcgMember)) return reply(200);
    const staffAccess = normalizeStaffAccess(staff.staffAccess ?? {});
    if (action === 'DIRECTORY_SCOPE') {
      const scope = projectFmcgStaffScope({ ...staff, staffAccess });
      if (!scope) return reply(200);
      return { status: 200, body: { allowed: true, scope,
        ...(verifiedFmcgMember ? { identity: { staffId: staff.title, staffName: staff.staffName } } : {}) } };
    }
    const allowed = action === 'ENTER'
      ? staff.role === 'SUPER ADMIN' || Boolean(staffAccess.salesRoom)
      : canUseSalesRoomCustomer({ ...staff, staffAccess }, action, customerId);
    return reply(200, allowed);
  } catch {
    return reply(503);
  }
}
