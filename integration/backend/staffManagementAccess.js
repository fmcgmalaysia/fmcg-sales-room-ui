import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { members } from 'wix-members.v2';
import { createHash } from 'crypto';
import { writeStaffManagement } from 'backend/staffManagementWrite.js';
import { resolveManagedStaff, canUseDepartment, canEnterDepartment } from 'backend/staffManagementPolicy.js';

// Server-only, request-local identity. Never send this directory record to a
// business page or cache it across requests: disabling an account must apply to
// the next operation, including operations from tabs that were already open.
export async function readManagedStaffIdentity() {
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  const email = String(member?.loginEmail ?? '').trim().toLowerCase();
  if (!member?._id || member.status !== 'APPROVED' || !email) {
    throw Error('Sign in with your approved staff account.');
  }
  const queryIdentity = () => wixData.query('StaffMasterAccess').eq('staffEmail', email)
    .or(wixData.query('StaffMasterAccess').eq('description', member._id))
    .limit(3).find({ suppressAuth: true, consistentRead: true });
  let rows = await queryIdentity();
  const candidate = rows.items.length === 1 ? rows.items[0] : null;
  if (candidate?.staffStatus === 'ACTIVE' && !String(candidate.description ?? '').trim() && candidate.staffEmail === email) {
    // This is the first binding only. Existing verified member bindings remain
    // unchanged. APPROVED alone does not prove ownership of a new email.
    const current = await members.getCurrentMember({ fieldsets: ['FULL'] });
    const verified = current?.member ?? current;
    if ((verified?._id ?? verified?.id) !== member._id || verified?.loginEmailVerified !== true ||
        String(verified.loginEmail ?? '').trim().toLowerCase() !== email) {
      throw Error('Sign in with your verified Google work email.');
    }
    const digest = createHash('sha256').update(JSON.stringify(['MASTER_BIND',candidate.title,email,member._id])).digest('hex');
    const requestId = `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
    await writeStaffManagement({ requestId, fingerprint: digest, actorId: candidate.title,
      prepare: async () => {
        const fresh = await queryIdentity();
        const row = fresh.items.length === 1 ? fresh.items[0] : null;
        if (!row || row.title !== candidate.title || row.staffStatus !== 'ACTIVE' || row.staffEmail !== email ||
            (row.description && row.description !== member._id)) throw Error('Staff identity changed. Sign in again.');
        return { row: { ...row, description: member._id } };
      }, project: row => ({staffId:row.title}) });
    rows = await queryIdentity();
  }
  return { member, record: resolveManagedStaff(member, rows.items) };
}

export function requireManagedDepartmentAccess(record, department, action, company, customerId) {
  // Only shared supplier/reference operations omit company. A malformed company
  // must never become an all-company grant.
  const allowed = company === undefined
    ? ['NCT', 'GHR'].some(id => canUseDepartment(record, department, action, customerId, id))
    : canUseDepartment(record, department, action, customerId, company);
  if (!allowed) throw Error('Staff permission does not allow this operation.');
}

export async function getManagedDepartmentContext(department, company, action = 'VIEW', customerId) {
  const { member, record } = await readManagedStaffIdentity();
  requireManagedDepartmentAccess(record, department, action, company, customerId);
  return { staffId: record.title, staffName: record.staffName, role: String(record.role).trim().toUpperCase(), memberId: member._id };
}

export async function readManagedWorkroomAccess(department, company) {
  const access = await readManagedCompanyAccess(company);
  if (!access.enter(department, 'VIEW')) throw Error('Staff permission does not allow this workroom.');
  return {
    staff: access.staff,
    can: (action, customerId) => access.can(department, action, customerId),
    require: (action, customerId) => access.require(department, action, customerId)
  };
}

export async function readManagedCompanyAccess(company) {
  if (!['NCT', 'GHR'].includes(company)) throw Error('Select NCT or GHR.');
  const { member, record } = await readManagedStaffIdentity();
  return {
    staff: { staffId: record.title, staffName: record.staffName, role: String(record.role).trim().toUpperCase(), memberId: member._id },
    enter: (department, action) => canEnterDepartment(record, department, action, company),
    can: (department, action, customerId) => canUseDepartment(record, department, action, customerId, company),
    require: (department, action, customerId) => requireManagedDepartmentAccess(record, department, action, company, customerId)
  };
}
