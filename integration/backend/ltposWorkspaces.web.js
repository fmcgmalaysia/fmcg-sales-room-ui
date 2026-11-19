import { webMethod, Permissions } from 'wix-web-module';
import { readManagedStaffIdentity } from 'backend/staffManagementAccess.js';
import { projectLtposWorkspaces } from 'backend/ltposWorkspacePolicy.js';

export const getLtposWorkspaces = webMethod(Permissions.SiteMember, async () => {
  try {
    const { record } = await readManagedStaffIdentity();
    return projectLtposWorkspaces(record);
  } catch {
    return { name: '', workspaceIds: [] };
  }
});
