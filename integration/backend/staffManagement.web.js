import { createHash, randomUUID } from 'crypto';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { prepareStaffRegistration, projectManagedStaff, requireStaffManager } from 'backend/staffManagementPolicy.js';

const collection = 'StaffMasterAccess';
const readOptions = { suppressAuth: true, consistentRead: true };

async function directoryForManager() {
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  let page = await wixData.query(collection).limit(1000).find(readOptions);
  const rows = [...page.items];
  while (page.hasNext()) {
    page = await page.next();
    rows.push(...page.items);
  }
  requireStaffManager(member, rows);
  return rows;
}

export const getManagedStaffDirectory = webMethod(Permissions.SiteMember, async () => {
  const rows = await directoryForManager();
  return rows.map(projectManagedStaff);
});

export const registerPendingStaff = webMethod(Permissions.SiteMember, async input => {
  const rows = await directoryForManager();
  const email = String(input?.email ?? '').trim().toLowerCase();
  const key = createHash('sha256').update(email).digest('hex').slice(0, 32);
  const row = prepareStaffRegistration(input, rows, randomUUID());
  // Deterministic document IDs stop simultaneous registrations of one email
  // from both succeeding. The employee ID stays fixed after registration.
  const saved = await wixData.insert(collection, { ...row, _id: key }, { suppressAuth: true });
  return projectManagedStaff(saved);
});
