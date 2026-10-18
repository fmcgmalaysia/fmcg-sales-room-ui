import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { requirePurchaseStaff } from 'backend/purchaseProjection.js';
export async function getPurchaseStaffContext() {
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') throw Error('Please sign in with your approved Master staff account.');
  let page = await wixData.query('StaffMasterAccess').limit(1000).find({ suppressAuth: true, consistentRead: true });
  const records = [...page.items];
  while (page.hasNext()) { page = await page.next(); records.push(...page.items); }
  return { ...requirePurchaseStaff(member, records), memberId: member._id };
}
