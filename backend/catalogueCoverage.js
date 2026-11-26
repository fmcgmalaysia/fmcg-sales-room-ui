import { createHash } from 'crypto';
import { validCatalogueReader } from './catalogueReadIdentity.js';

const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 32);
export const catalogueCoverageKey = (actorId, action) => hash('catalogue-coverage:' + action + ':' + actorId);

export async function readDeliveredCatalogueIds(store, actor, ids, windowMs, now = Date.now) {
  const row = await store.read(catalogueCoverageKey(actor.actorId, 'CATALOGUE_LIST'));
  const time = now();
  return ids.filter(id => {
    const timestamp = row?.usage?.[hash(id)];
    return Number.isSafeInteger(timestamp) && timestamp <= time && timestamp > time - windowMs;
  });
}

// Called with the actual product IDs immediately before returning a response.
// A company switch changes incident attribution but retains the member's quota.
export function createCatalogueCoverage({ store, policy, onIncident, now = Date.now }) {
  for (const action of ['CATALOGUE_LIST', 'CATALOGUE_DETAIL', 'BUYER_IMAGE']) {
    const rule = policy?.[action];
    if (!Number.isSafeInteger(rule?.windowMs) || rule.windowMs < 1 ||
        !Number.isSafeInteger(rule.warnAt) || rule.warnAt < 1 ||
        !Number.isSafeInteger(rule.limit) || rule.limit < rule.warnAt || rule.limit > 2000) {
      throw Error('Invalid catalogue coverage policy.');
    }
  }
  return async (actor, action, ids) => {
    if (!validCatalogueReader(actor) || !Object.hasOwn(policy, action) ||
        !Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== 'string' || !id || id.length > 128)) return false;
    if (!ids.length) return true;
    const rule = policy[action];
    const requested = [...new Set(ids.map(hash))];
    const key = catalogueCoverageKey(actor.actorId, action);
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await store.read(key);
      const time = now();
      const seen = {};
      for (const [id, timestamp] of Object.entries(row?.usage ?? {})) {
        if (!Number.isSafeInteger(timestamp) || timestamp > time) return false;
        if (timestamp > time - rule.windowMs) seen[id] = timestamp;
      }
      const used = Object.keys(seen).length;
      const added = requested.filter(id => !Object.hasOwn(seen, id)).length;
      const denied = used + added > rule.limit;
      const severity = denied ? 'restricted' : used + added >= rule.warnAt ? 'warning' : '';
      const denials = { ...row?.denials };
      const recent = severity && denials[severity]?.at > time - rule.windowMs;
      const outstanding = severity && ['PENDING', 'SENDING', 'RETRY'].includes(denials[severity]?.status);
      const newIncident = severity && !recent && !outstanding;
      if (denied && !newIncident) return false;
      if (newIncident) {
        denials[severity] = {
          at: time, companyId: actor.customerId, companyName: actor.companyName || '',
          actorName: actor.actorName || '', actorType: actor.actorType || '', action,
          deliveredUnique: denied ? used : used + added, attemptedNew: added, status: 'PENDING'
        };
      }
      if (!denied) for (const id of requested) seen[id] = time;
      if (await store.replaceIfVersion(key, row?.version ?? 0, { usage: seen, denials })) {
        if (newIncident && onIncident) await onIncident(key, severity);
        return !denied;
      }
    }
    return false;
  };
}
