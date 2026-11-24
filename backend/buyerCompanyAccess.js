import { createHash } from 'crypto';
import wixData from 'wix-data';
import { isWebQuotationReady } from 'backend/webQuotationCustomer.js';

const users = 'WixCustomerUsers';
const customers = 'WixCustomers';
const read = { suppressAuth: true, consistentRead: true };
const write = { suppressAuth: true };
const clean = value => typeof value === 'string' ? value.trim() : '';
const emailKey = value => clean(value).toLowerCase();
const upper = value => clean(value).toUpperCase();

export function buyerCompanyIdFromScope(scope) {
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope) ||
      !/^CUS-[A-Za-z0-9-]{1,80}$/.test(clean(scope.buyerCompanyId)) ||
      Object.keys(scope).some(key => key !== 'buyerCompanyId')) {
    throw new Error('Choose an authorized company.');
  }
  return clean(scope.buyerCompanyId);
}

export function companyUserEmail(user) {
  return emailKey(user?.email || user?.linkedLoginEmail);
}

export async function findCompanyLogin(email) {
  if (!emailKey(email)) return null;
  const result = await wixData.query(users).eq('email', emailKey(email)).limit(2).find(read);
  if (result.items.length > 1) throw new Error('Duplicate customer login records require admin review.');
  const login = result.items[0];
  return login?._id && !login.linkedLoginId ? login : null;
}

function requireMemberLogin(login, member, email) {
  if (!member?._id || !login?._id || companyUserEmail(login) !== emailKey(email) ||
      (login.wixMemberId && login.wixMemberId !== member._id)) {
    throw new Error('This member is not linked to a customer account.');
  }
  return login;
}

async function readCompany(customerId) {
  const result = await wixData.query(customers).eq('customerId', customerId).limit(2).find(read);
  if (result.items.length !== 1) return null;
  const customer = result.items[0];
  const lifecycle = upper(customer.lifecycleStatus || customer.customerStatus);
  const access = upper(customer.catalogueAccessStatus || customer.accessStatus || customer.customerStatus);
  return lifecycle !== 'ARCHIVED' && access === 'ACTIVE' && isWebQuotationReady(customer) ? customer : null;
}

function linkedAccessId(customerId, loginId) {
  return 'LINK-' + createHash('sha256').update(JSON.stringify([customerId, loginId])).digest('hex').slice(0, 32);
}

function isActiveAccess(user, login, customerId) {
  if (!user || clean(user.customerId) !== customerId || upper(user.status) !== 'ACTIVE') return false;
  return user._id === login._id || (user.linkedLoginId === login._id &&
    emailKey(user.linkedLoginEmail) === companyUserEmail(login) && !user.email && !user.wixMemberId);
}

export async function resolveBuyerCompany(member, email, scope) {
  const customerId = buyerCompanyIdFromScope(scope);
  const login = requireMemberLogin(await findCompanyLogin(email), member, email);
  const user = clean(login.customerId) === customerId ? login
    : await wixData.query(users).eq('_id', linkedAccessId(customerId, login._id)).limit(1)
      .find(read).then(result => result.items[0]);
  if (!isActiveAccess(user, login, customerId)) throw new Error('Access to this company is no longer available.');
  const customer = await readCompany(customerId);
  if (!customer) throw new Error('Access to this company is no longer available.');
  return { customer, user, grant: { loginId: login._id, userId: user._id } };
}

export async function checkBuyerDownloadGrant(customerId, grant) {
  if (!grant || !clean(grant.loginId) || !clean(grant.userId)) throw new Error('BUYER_DOWNLOAD_ACCESS_REVOKED');
  const [login, user, customer] = await Promise.all([
    wixData.get(users, grant.loginId, read).catch(() => null),
    wixData.get(users, grant.userId, read).catch(() => null),
    readCompany(customerId)
  ]);
  if (!login || login.linkedLoginId || !companyUserEmail(login) || !customer || !isActiveAccess(user, login, customerId)) {
    throw new Error('BUYER_DOWNLOAD_ACCESS_REVOKED');
  }
}

async function activeLinkedAccess(login) {
  const query = wixData.query(users).eq('linkedLoginId', login._id).eq('status', 'ACTIVE').limit(100);
  let result = await query.find(read);
  const rows = [...result.items];
  while (result.hasNext()) {
    result = await result.next();
    rows.push(...result.items);
  }
  return rows.filter(user => clean(user.customerId) !== clean(login.customerId) &&
    isActiveAccess(user, login, clean(user.customerId)));
}

export async function getActiveLinkedBuyerCompany(login) {
  for (const user of await activeLinkedAccess(login)) {
    const customer = await readCompany(clean(user.customerId));
    if (customer) return { user, customer };
  }
  return null;
}

export async function listBuyerCompanies(member, email) {
  const login = requireMemberLogin(await findCompanyLogin(email), member, email);
  const [links, original] = await Promise.all([
    activeLinkedAccess(login),
    upper(login.status) === 'ACTIVE' ? readCompany(clean(login.customerId)) : null
  ]);
  const ids = [...new Set(links.map(user => clean(user.customerId)))];
  const companies = [...await Promise.all(ids.map(readCompany)), original];
  const choices = companies.filter(Boolean)
    .map(customer => ({ customerId: clean(customer.customerId), companyName: clean(customer.title) }))
    .sort((left, right) => left.companyName.localeCompare(right.companyName) || left.customerId.localeCompare(right.customerId));
  return { companies: choices, originalCompanyId: clean(login.customerId) };
}

// Only called after the Sales Room verifies the staff action on the target company.
export async function saveLinkedCompanyUser(customerId, login, fields) {
  if (!login?._id || login.linkedLoginId || !companyUserEmail(login) ||
      clean(login.customerId) === customerId) throw new Error('An existing company login is required.');
  const id = linkedAccessId(customerId, login._id);
  const existing = (await wixData.query(users).eq('_id', id).limit(1).find(read)).items[0];
  if (existing && (existing.linkedLoginId !== login._id || clean(existing.customerId) !== customerId ||
      companyUserEmail(existing) !== companyUserEmail(login))) {
    throw new Error('This linked login requires administrator review.');
  }
  if (isActiveAccess(existing, login, customerId)) {
    if (existing.requestId === fields.requestId) return { user: existing, duplicateRequest: true };
    throw new Error('This login is already authorized for the company.');
  }
  if (existing && upper(existing.status) === 'PENDING') throw new Error('This company access is awaiting approval.');
  const next = {
    ...existing, ...fields, _id: id, userId: existing?.userId || id, customerId,
    linkedLoginId: login._id, linkedLoginEmail: companyUserEmail(login),
    primaryUser: false, status: 'ACTIVE'
  };
  return { user: await (existing ? wixData.update(users, next, write) : wixData.insert(users, next, write)) };
}
