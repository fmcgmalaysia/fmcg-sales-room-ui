import { webMethod, Permissions } from 'wix-web-module';
import { members } from 'wix-members.v2';
import { getMasterStaffScope } from 'backend/masterStaffAccessClient.js';

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
    staffId: staff.staffId,
    staffName: staff.staffName,
    loginEmail: email,
    role: customerScope.allCustomers ? 'SUPER ADMIN' : 'STAFF',
    customerScope,
    canViewAllCustomers: customerScope.allCustomers
  });
});
