export function selectedBuyerCompanyId(location) {
  if (typeof location.query?.company === 'string') return location.query.company.trim();
  try { return (new URL(location.url).searchParams.get('company') || '').trim(); }
  catch (_) { return ''; }
}

export function buyerCompanyPath(page, companyId) {
  return page + (companyId ? '?company=' + encodeURIComponent(companyId) : '');
}

export function buyerCompanyChooser({ companies, originalCompanyId }, requestedId) {
  const selected = companies.find(company => company.customerId === requestedId);
  if (requestedId && !selected) return { companies, blocked: true, currentId: '', denied: true };
  if (requestedId) return { companies, blocked: false, currentId: requestedId, scoped: true };
  if (!companies.length) return { companies, blocked: true, currentId: '', denied: true };
  if (companies.length !== 1) return { companies, blocked: true, currentId: '' };
  const currentId = companies[0].customerId;
  return { companies, blocked: false, currentId, scoped: originalCompanyId !== currentId };
}
