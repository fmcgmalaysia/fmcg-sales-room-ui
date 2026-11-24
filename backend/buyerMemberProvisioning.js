import wixData from 'wix-data';
import { elevate } from 'wix-auth';
import { members } from 'wix-members.v2';
import { isWebQuotationReady } from 'backend/webQuotationCustomer.js';

const read = { suppressAuth: true, consistentRead: true };
const createMember = elevate(members.createMember);
const getMember = elevate(members.getMember);
const normalizeEmail = value => String(value || '').trim().toLowerCase();

async function findMembers(email) {
  return (await wixData.query('Members/FullData').eq('loginEmail', email).limit(2).find(read)).items;
}

export async function hasApprovedBuyerMember(login) {
  const email = normalizeEmail(login.email);
  const matches = login.wixMemberId ? [{ _id: login.wixMemberId }] : await findMembers(email);
  if (matches.length !== 1 || !matches[0]?._id) return false;
  const member = await getMember(matches[0]._id, { fieldsets: ['FULL'] });
  return member?._id === matches[0]._id && member.status === 'APPROVED' &&
    normalizeEmail(member.loginEmail) === email;
}

// Called by the staff-only activation path after the customer and user are active.
// Creating a member here sends no email and leaves password setup to the buyer.
export async function prepareActivatedBuyerMember(activatedCustomer, activatedUser) {
  try {
    const email = normalizeEmail(activatedUser.email);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'REVIEW';
    const [customer, user, claims] = await Promise.all([
      wixData.get('WixCustomers', activatedCustomer._id, read),
      wixData.get('WixCustomerUsers', activatedUser._id, read),
      wixData.query('WixCustomerUsers').eq('email', email).limit(2).find(read)
    ]);
    if (!isWebQuotationReady(customer) || customer.customerId !== activatedCustomer.customerId ||
        !user || user.status !== 'ACTIVE' || !user.primaryUser || user.customerId !== customer.customerId ||
        (customer.primaryUserId && customer.primaryUserId !== user.userId) ||
        normalizeEmail(customer.primaryEmail) !== email || normalizeEmail(user.email) !== email ||
        claims.items.length !== 1 || claims.items[0]._id !== user._id) return 'REVIEW';

    let matches = user.wixMemberId ? [{ _id: user.wixMemberId }] : await findMembers(email);
    let member;
    if (!matches.length) {
      try {
        member = await createMember({ member: { loginEmail: email, privacyStatus: 'PRIVATE' } });
      } catch (error) {
        matches = await findMembers(email);
        // A successful parallel create may take a moment to appear in Wix's member search.
        for (const delay of [500, 1500]) {
          if (matches.length) break;
          await new Promise(resolve => setTimeout(resolve, delay));
          matches = await findMembers(email);
        }
        if (!matches.length) throw error;
      }
    }

    if (!member) {
      if (matches.length !== 1 || !matches[0]?._id) return 'REVIEW';
      member = await getMember(matches[0]._id, { fieldsets: ['FULL'] });
    }
    if (!member?._id || normalizeEmail(member.loginEmail) !== email || member.status !== 'APPROVED') return 'REVIEW';
    return 'READY';
  } catch {
    return 'RETRY';
  }
}
