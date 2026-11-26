import { createHash } from 'crypto';
import { validCatalogueReader } from './catalogueReadIdentity.js';

const actions = new Set(['CATALOGUE_LIST', 'CATALOGUE_DETAIL', 'BUYER_IMAGE']);

// One row per authenticated member across all of that member's companies.
// Windows use rolling buckets. Keeping the entire oldest partial bucket
// avoids admitting two full quotas on opposite sides of a window boundary.
export function createCatalogueReadBudget({ store, policy, onIncident, now = Date.now }) {
  for (const action of actions) {
    const rule = policy?.[action];
    if (!Number.isSafeInteger(rule?.bucketMs) || rule.bucketMs < 1 ||
        !Number.isSafeInteger(rule.buckets) || rule.buckets < 1 || rule.buckets > 60 ||
        !Number.isSafeInteger(rule.limit) || rule.limit < 1) throw Error('Invalid read budget policy.');
  }
  return async function reserveRead(actor, action, units) {
    if (!validCatalogueReader(actor) || !actions.has(action) || !Number.isSafeInteger(units) || units < 1) return false;
    const key = createHash('sha256').update('catalogue-member:' + actor.actorId).digest('hex').slice(0, 32);
    const rule = policy[action];
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await store.read(key);
      const tick = Math.floor(now() / rule.bucketMs);
      const previous = row?.usage?.[action] ?? [];
      if (!Number.isSafeInteger(tick) || !Array.isArray(previous) || previous.some(entry =>
        !Number.isSafeInteger(entry?.tick) || entry.tick < 0 || entry.tick > tick ||
        !Number.isSafeInteger(entry.units) || entry.units < 1)) return false;
      const usage = previous.filter(entry => entry.tick >= tick - rule.buckets);
      const used = usage.reduce((total, item) => total + item.units, 0);
      const denied = used + units > rule.limit;
      // Persist the first denial with the responsible company before returning.
      // The owner alert can be dispatched independently of the product read.
      const last = row?.denials?.[action];
      if (denied && last && (tick - last.tick <= rule.buckets ||
          ['PENDING', 'SENDING', 'RETRY'].includes(last.status))) return false;
      const next = { usage: { ...row?.usage }, denials: { ...row?.denials } };
      if (denied) {
        next.denials[action] = { tick, companyId: actor.customerId, companyName: actor.companyName || '',
          actorName: actor.actorName || '', actorType: actor.actorType || '', action, used, requested: units,
          at: now(), status: 'PENDING' };
      } else {
        const current = usage.find(entry => entry.tick === tick);
        next.usage[action] = usage.filter(entry => entry.tick !== tick);
        next.usage[action].push({ tick, units: (current?.units ?? 0) + units });
      }
      if (await store.replaceIfVersion(key, row?.version ?? 0, next)) {
        if (denied && onIncident) await onIncident(key, action);
        return !denied;
      }
    }
    return false;
  };
}
