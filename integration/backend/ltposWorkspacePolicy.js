import { requirePurchaseStaff } from 'backend/purchaseProjection.js';
import { requireAccountStaff } from 'backend/accountPurchaseReview.js';
import { requireWarehouseStaff } from 'backend/warehouseReceiving.js';
import { requirePackingStaff } from 'backend/packingListContext.js';

export function projectLtposWorkspaces(member, records) {
  const choices = [
    ['purchase', requirePurchaseStaff],
    ['support', (actor, rows) => requirePackingStaff(actor, rows, 'SUPPORT')],
    ['warehouse', requireWarehouseStaff],
    ['finance', requireAccountStaff]
  ];
  const workspaceIds = [];
  let name = '';
  for (const [id, requireAccess] of choices) {
    try {
      const staff = requireAccess(member, records);
      name = staff.staffName;
      workspaceIds.push(id);
    } catch {
      // A workroom's own access check decides whether its link appears.
    }
  }
  return { name, workspaceIds };
}
