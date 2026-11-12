import { webMethod, Permissions } from 'wix-web-module';
import { members } from 'wix-members.v2';
import wixData from 'wix-data';
import { getMasterStaffScope } from 'backend/masterStaffAccessClient.js';

const STAFF_COLLECTION = 'StaffMaster';
const ACTIVE_STATUS = 'ACTIVE';
const PRESENCE_ONLINE_MS = 2 * 60 * 1000;
const PRESENCE_AWAY_MS = 10 * 60 * 1000;

function normalize(value) {
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
  return normalize(value).toLowerCase();
}

function denied(reason) {
  return Object.freeze({ authorized: false, reason });
}

export const getCurrentStaffContext = webMethod(Permissions.SiteMember, async () => {
  let member;
  try {
    const current = await members.getCurrentMember({ fieldsets: ['FULL'] });
    member = current?.member ?? current;
  } catch {
    return denied('MEMBER_LOOKUP_ERROR');
  }
  const memberId = normalize(member?._id ?? member?.id);
  const email = normalizeEmail(member?.loginEmail);
  if (!memberId) return denied('NOT_LOGGED_IN');
  if (!email || member.status !== 'APPROVED' || member.loginEmailVerified !== true) {
    return denied('VERIFIED_STAFF_EMAIL_REQUIRED');
  }

  // Existing FMCG rows preserve historical sales IDs and QD references.
  // A local role, status or row alone cannot grant Sales Room access.
  let items;
  try {
    const result = await wixData.query(STAFF_COLLECTION).limit(1000)
      .find({ suppressAuth: true, consistentRead: true });
    items = result.items;
    if (items.length >= 1000) return denied('STAFF_CMS_QUERY_INCOMPLETE');
  } catch {
    return denied('STAFF_CMS_QUERY_ERROR');
  }
  const memberMatches = items.filter(item => normalize(item.wixMemberId) === memberId);
  const emailMatches = items.filter(item => normalizeEmail(item.staffEmail) === email);
  if (memberMatches.length > 1) return denied('DUPLICATE_WIX_MEMBER_ID');
  if (emailMatches.length > 1) return denied('DUPLICATE_STAFF_EMAIL');
  const legacy = memberMatches[0] ?? emailMatches[0];
  if (legacy && normalizeEmail(legacy.staffEmail) !== email) return denied('STAFF_EMAIL_MISMATCH');
  const linkedMemberId = normalize(legacy?.wixMemberId);
  if (linkedMemberId && linkedMemberId !== memberId) return denied('STAFF_MEMBER_MISMATCH');
  if (legacy && !normalize(legacy.staffId)) return denied('STAFF_RECORD_INCOMPLETE');

  let staff;
  try {
    staff = await getMasterStaffScope(email, true);
  } catch {
    return denied('MASTER_STAFF_ACCESS_UNAVAILABLE');
  }
  if (!staff) return denied('MASTER_STAFF_ACCESS_DENIED');
  const { customerScope } = staff;
  return Object.freeze({
    authorized: true,
    memberId,
    staffId: normalize(legacy?.staffId) || staff.staffId,
    staffName: staff.staffName,
    loginEmail: email,
    role: customerScope.allCustomers ? 'SUPER ADMIN' : 'STAFF',
    quotationDeskFileId: normalize(legacy?.quotationDeskFileId),
    identitySource: legacy ? 'MASTER_WITH_LEGACY_REFERENCES' : 'MASTER_VERIFIED_EMAIL',
    customerScope,
    canViewAllCustomers: customerScope.allCustomers
  });
});


function presenceDevice(value) {
  const device = normalize(value).toUpperCase();
  return ['DESKTOP', 'MOBILE', 'TABLET'].includes(device)
    ? device
    : 'UNKNOWN';
}

function presenceStatus(lastSeenAt, nowMs) {
  const seenMs = new Date(lastSeenAt || 0).getTime();
  if (!Number.isFinite(seenMs) || seenMs <= 0) return 'OFFLINE';
  const ageMs = Math.max(0, nowMs - seenMs);
  if (ageMs <= PRESENCE_ONLINE_MS) return 'ONLINE';
  if (ageMs <= PRESENCE_AWAY_MS) return 'AWAY';
  return 'OFFLINE';
}

export const recordStaffPresence = webMethod(
  Permissions.SiteMember,
  async (payload = {}) => {
    const context = await getCurrentStaffContext();
    if (!context?.authorized) {
      return Object.freeze({
        ok: false,
        error:
          context && 'reason' in context
            ? context.reason
            : 'STAFF_NOT_AUTHORIZED'
      });
    }

    if (context.identitySource === 'MASTER_VERIFIED_EMAIL') {
      return Object.freeze({ ok: true, staffId: context.staffId });
    }

    const result = await wixData
      .query(STAFF_COLLECTION)
      .limit(1000)
      .find({ suppressAuth: true });
    const matchingItems = result.items.filter(
      (item) => normalize(item.staffId) === normalize(context.staffId)
    );

    if (matchingItems.length !== 1) {
      return Object.freeze({
        ok: false,
        error:
          matchingItems.length > 1
            ? 'DUPLICATE_STAFF_ID'
            : 'STAFF_NOT_REGISTERED'
      });
    }

    const now = new Date();
    const mode = normalize(payload?.mode).toUpperCase();
    const item = matchingItems[0];
    const updated = {
      ...item,
      lastSeenAt: now,
      lastDevice: presenceDevice(payload?.device)
    };

    if (mode === 'ENTER' || !item.lastSalesRoomAccessAt) {
      updated.lastSalesRoomAccessAt = now;
    }

    await wixData.update(STAFF_COLLECTION, updated, { suppressAuth: true });

    return Object.freeze({
      ok: true,
      staffId: context.staffId,
      lastSeenAt: now.toISOString(),
      lastSalesRoomAccessAt: new Date(
        updated.lastSalesRoomAccessAt
      ).toISOString(),
      lastDevice: updated.lastDevice
    });
  }
);

export const getStaffPresenceForAdmin = webMethod(
  Permissions.SiteMember,
  async () => {
    const context = await getCurrentStaffContext();
    if (!context?.authorized || !context.canViewAllCustomers) {
      return Object.freeze({
        ok: false,
        error: 'ADMIN_REQUIRED'
      });
    }

    const result = await wixData
      .query(STAFF_COLLECTION)
      .limit(1000)
      .find({ suppressAuth: true });

    const now = new Date();
    const nowMs = now.getTime();
    const staff = result.items
      .filter(
        (item) => normalize(item.status).toUpperCase() === ACTIVE_STATUS
      )
      .map((item) => {
        const lastSeenAt = item.lastSeenAt
          ? new Date(item.lastSeenAt).toISOString()
          : '';
        const lastSalesRoomAccessAt = item.lastSalesRoomAccessAt
          ? new Date(item.lastSalesRoomAccessAt).toISOString()
          : '';

        return Object.freeze({
          staffId: normalize(item.staffId),
          staffName: normalize(item.title),
          staffEmail: normalizeEmail(item.staffEmail),
          role: normalize(item.role).toUpperCase(),
          status: presenceStatus(lastSeenAt, nowMs),
          lastSeenAt,
          lastSalesRoomAccessAt,
          lastDevice: presenceDevice(item.lastDevice)
        });
      })
      .filter((item) => item.staffId && item.staffName)
      .sort((a, b) => a.staffName.localeCompare(b.staffName));

    return Object.freeze({
      ok: true,
      generatedAt: now.toISOString(),
      staff
    });
  }
);
