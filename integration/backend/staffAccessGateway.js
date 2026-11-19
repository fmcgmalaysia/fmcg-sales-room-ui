import { createHash, timingSafeEqual } from 'crypto';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { canUseSalesRoomCustomer, normalizeStaffAccess, projectFmcgStaffScope, staffManagementRevision } from 'backend/staffManagementPolicy.js';
import { writeStaffManagement } from 'backend/staffManagementWrite.js';

const reply = (status, allowed = false) => ({ status, body: { allowed } });
const salesAssigneeAction = 'SALES_CREATION_ASSIGNEES';
const resolveSalesAssigneeAction = 'SALES_CREATION_ASSIGNEE';
const grantSalesAssigneeAction = 'SALES_GRANT_INITIAL_ACCESS';
const readOptions = { suppressAuth: true, consistentRead: true };
const staffIdPattern = /^(?:STF-[A-Z0-9]{5,20}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/;
const grantRevision = row => createHash('sha256').update(staffManagementRevision(row)).digest('hex');

function salesAssignee(staff, access) {
  const staffId = String(staff.title ?? '').trim();
  const staffName = String(staff.staffName ?? '').trim();
  if (!staffIdPattern.test(staffId) || !staffName ||
      access.salesFunction !== 'SALES' || access.salesRoom !== 'EDIT') return null;
  return { staffId, staffName };
}

async function readSalesOwner(actor, actorAccess, targetStaffId) {
  if (actor.role !== 'SUPER ADMIN' && !salesAssignee(actor, actorAccess)) return null;
  if (actor.role !== 'SUPER ADMIN' && targetStaffId && targetStaffId !== actor.title) return null;
  const id = targetStaffId || (actor.role === 'SUPER ADMIN' ? '' : actor.title);
  if (!staffIdPattern.test(id)) return null;
  const { items } = await wixData.query('StaffMasterAccess').eq('title', id).limit(2).find(readOptions);
  if (items.length !== 1 || items[0].staffStatus !== 'ACTIVE') return null;
  const row = items[0];
  const access = normalizeStaffAccess(row.staffAccess ?? {});
  const owner = salesAssignee(row, access);
  return owner ? { row, owner, access } : null;
}

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
        (!['ENTER', 'DIRECTORY_SCOPE', salesAssigneeAction, resolveSalesAssigneeAction].includes(action) &&
          (typeof customerId !== 'string' || !customerId || customerId.length > 160))) {
      return reply(400);
    }
    const targetStaffId = input.targetStaffId ?? '';
    if ([resolveSalesAssigneeAction, grantSalesAssigneeAction].includes(action) &&
        (typeof targetStaffId !== 'string' || (targetStaffId && !staffIdPattern.test(targetStaffId)))) return reply(400);
    if (action === grantSalesAssigneeAction && (!targetStaffId || !/^CUS-\d{6}-[A-Z0-9]{6}$/.test(customerId) ||
        typeof input.grantRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.grantRevision))) return reply(400);
    const { items } = await wixData.query('StaffMasterAccess').eq('staffEmail', email).limit(2)
      .find({ suppressAuth: true, consistentRead: true });
    const staff = items.length === 1 ? items[0] : null;
    const verifiedFmcgMember = action === 'DIRECTORY_SCOPE' && input.verifiedFmcgEmail === true;
    if (staff?.staffStatus !== 'ACTIVE' || !staff.title || (!staff.description && !verifiedFmcgMember)) return reply(200);
    const staffAccess = normalizeStaffAccess(staff.staffAccess ?? {});
    if (action === resolveSalesAssigneeAction || action === grantSalesAssigneeAction) {
      const owner = await readSalesOwner(staff, staffAccess, targetStaffId);
      if (!owner) return reply(200);
      if (action === resolveSalesAssigneeAction) return { status: 200, body: {
        allowed: true, owner: owner.owner, grantRevision: grantRevision(owner.row)
      } };

      if (owner.access.customerAccess[customerId] === 'EDIT') return reply(200, true);
      if (grantRevision(owner.row) !== input.grantRevision || owner.access.customerAccess[customerId]) return reply(409);
      const fingerprint = createHash('sha256').update(JSON.stringify([action, customerId, targetStaffId, input.grantRevision])).digest('hex');
      const requestId = `${fingerprint.slice(0, 8)}-${fingerprint.slice(8, 12)}-${fingerprint.slice(12, 16)}-${fingerprint.slice(16, 20)}-${fingerprint.slice(20, 32)}`;
      const confirmed = await writeStaffManagement({ requestId, fingerprint, actorId: staff.title, unchanged: undefined, prepare: async () => {
        const currentActor = await wixData.query('StaffMasterAccess').eq('staffEmail', email).limit(2).find(readOptions);
        const actor = currentActor.items.length === 1 ? currentActor.items[0] : null;
        if (!actor?.description || actor.title !== staff.title || actor.staffStatus !== 'ACTIVE') throw Error('Sales assignment expired.');
        const current = await readSalesOwner(actor, normalizeStaffAccess(actor.staffAccess ?? {}), targetStaffId);
        if (!current || grantRevision(current.row) !== input.grantRevision || current.access.customerAccess[customerId]) {
          throw Error('Sales assignment changed. Review access in LTPOS.');
        }
        return { row: { ...current.row, staffAccess: { ...current.access, customerAccess: { ...current.access.customerAccess, [customerId]: 'EDIT' } } } };
      }, project: row => row.title === targetStaffId && row.staffAccess?.customerAccess?.[customerId] === 'EDIT' });
      return confirmed ? reply(200, true) : reply(503);
    }
    if (action === salesAssigneeAction) {
      if (staff.role !== 'SUPER ADMIN') {
        const self = salesAssignee(staff, staffAccess);
        return self ? { status: 200, body: { allowed: true, mayAssignOthers: false, assignees: [self] } } : reply(200);
      }
      const result = await wixData.query('StaffMasterAccess').eq('staffStatus', 'ACTIVE').limit(1000)
        .find({ suppressAuth: true, consistentRead: true });
      const assignees = result.items.map(row => salesAssignee(row, normalizeStaffAccess(row.staffAccess ?? {}))).filter(Boolean);
      if (result.hasNext() || new Set(assignees.map(row => row.staffId)).size !== assignees.length) return reply(503);
      assignees.sort((a, b) => a.staffName.localeCompare(b.staffName));
      return { status: 200, body: { allowed: true, mayAssignOthers: true, assignees } };
    }
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
