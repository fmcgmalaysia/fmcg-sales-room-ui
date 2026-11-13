import { createHash, randomUUID } from 'crypto';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { prepareStaffRegistration, prepareStaffUpdate, projectManagedStaff, requireStaffManager } from 'backend/staffManagementPolicy.js';
import { readStaffSaveStatus, writeStaffManagement } from 'backend/staffManagementWrite.js';
import { requestSupportCustomers } from 'backend/supportCustomerClient.js';

const collection = 'StaffMasterAccess';
const readOptions = { suppressAuth: true, consistentRead: true };

async function directoryForManager() {
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') {
    throw Error('Sign in with your approved staff account.');
  }
  const identity = await wixData.query(collection).eq('description', member._id).limit(2).find(readOptions);
  requireStaffManager(member, identity.items);
  let page = await wixData.query(collection).limit(1000).find(readOptions);
  const rows = [...page.items];
  while (page.hasNext()) {
    page = await page.next();
    rows.push(...page.items);
  }
  requireStaffManager(member, rows);
  return rows.filter(row => row.staffStatus !== 'CONTROL');
}

export const getManagedStaffSaveStatus = webMethod(Permissions.SiteMember, async () => {
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  if (!member?._id) throw Error('Sign in with your approved staff account.');
  const identity = await wixData.query(collection).eq('description', member._id).limit(2).find(readOptions);
  requireStaffManager(member, identity.items);
  return readStaffSaveStatus();
});

export const getManagedStaffDirectory = webMethod(Permissions.SiteMember, async () => {
  const rows = await directoryForManager();
  return rows.map(projectManagedStaff);
});

export const registerPendingStaff = webMethod(Permissions.SiteMember, async input => {
  const rows = await directoryForManager();
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  const actor = requireStaffManager(member, rows);
  const email = String(input?.email ?? '').trim().toLowerCase();
  const key = createHash('sha256').update(email).digest('hex').slice(0, 32);
  return writeStaffManagement({ requestId: input?.requestId, actorId: actor.title,
    fingerprint: createHash('sha256').update(JSON.stringify(['REGISTER', input])).digest('hex'),
    prepare: async () => {
      const currentRows = await directoryForManager();
      const row = prepareStaffRegistration(input, currentRows, randomUUID());
      return { row: { ...row, _id: key }, insert: true };
    }, project: projectManagedStaff });
});

export const updateManagedStaff = webMethod(Permissions.SiteMember, async input => {
  const rows = await directoryForManager();
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  const actor = requireStaffManager(member, rows);
  return writeStaffManagement({ requestId: input?.requestId, actorId: actor.title,
    fingerprint: createHash('sha256').update(JSON.stringify(['UPDATE', input])).digest('hex'),
    prepare: async () => ({ row: prepareStaffUpdate(input, await directoryForManager(), actor.title) }),
    project: projectManagedStaff });
});

export const getManagedCustomerDirectory = webMethod(Permissions.SiteMember, async () => {
  const rows = await directoryForManager();
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  const actor = requireStaffManager(member, rows);
  const result = await requestSupportCustomers({ company: 'NCT', staff: {
    memberId: member._id, staffId: actor.title, staffName: actor.staffName, packingDepartment: 'SUPPORT'
  }});
  return result.customers.map(row => ({ id: row.id, name: row.companyName || row.name || row.shortName || row.id }));
});
