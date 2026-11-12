import wixData from 'wix-data';
import { currentMember } from 'wix-members-backend';
import { webMethod, Permissions } from 'wix-web-module';
import { projectLtposWorkspaces } from 'backend/ltposWorkspacePolicy.js';

export const getLtposWorkspaces = webMethod(Permissions.SiteMember, async () => {
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') {
    return { name: '', workspaceIds: [] };
  }
  let page = await wixData.query('StaffMasterAccess').limit(1000)
    .find({ suppressAuth: true, consistentRead: true });
  const staff = [...page.items];
  while (page.hasNext()) {
    page = await page.next();
    staff.push(...page.items);
  }
  return projectLtposWorkspaces(member, staff);
});
