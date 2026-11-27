// Actor names and member IDs come only from Wix and MASTER, never from a form.
export function validCatalogueReader(actor) {
  return Boolean(actor?.actorId && (actor.customerId || (actor.scope === 'staff-preview' &&
    ['STAFF', 'ADMIN'].includes(actor.actorType))));
}

export function createCatalogueReadIdentity({ getMember, readStaff, resolveBuyerCompany, readStaffCustomer }) {
  return async scope => {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).length !== 1) {
      throw Error('Choose a catalogue workspace.');
    }
    const member = await getMember();
    if (!member?._id) throw Error('Sign in to view the catalogue.');
    if (Object.hasOwn(scope, 'buyerCompanyId')) {
      const { customer, user } = await resolveBuyerCompany(member, member.loginEmail, scope);
      if (!customer?.customerId || customer.customerId !== scope.buyerCompanyId) throw Error('Company access unavailable.');
      return { actorId: member._id, actorType: 'CUSTOMER_USER', actorName: user.title || '',
        customerId: customer.customerId, companyName: customer.title || '' };
    }
    const preview = scope.staffPreview === true;
    const id = scope.assistCustomerId;
    if (!preview && (typeof id !== 'string' || !id.trim() || id.length > 160)) throw Error('Choose a catalogue workspace.');
    const staff = await readStaff();
    if (staff?.authorized !== true || staff.memberId !== member._id ||
        (staff.customerScope?.pages && !staff.customerScope.pages.includes('CATALOGUE'))) throw Error('Staff catalogue access unavailable.');
    const actor = { actorId: member._id, actorType: staff.canViewAllCustomers ? 'ADMIN' : 'STAFF', actorName: staff.staffName || '' };
    if (preview) return { ...actor, scope: 'staff-preview', customerId: '', companyName: '' };
    const customer = await readStaffCustomer(staff, id);
    if (String(customer?.customerId || '').trim() !== id) throw Error('Company access unavailable.');
    return { ...actor, customerId: id, companyName: String(customer?.title || '').trim(),
      staffId: staff.staffId, selectionLimit: customer.selectionLimit };
  };
}
