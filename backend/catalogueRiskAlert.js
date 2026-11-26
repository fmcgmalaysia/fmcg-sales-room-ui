import { randomUUID } from 'crypto';

const labels = { CATALOGUE_LIST: 'products in the catalogue', CATALOGUE_DETAIL: 'product details', BUYER_IMAGE: 'high-resolution images' };

// Deliver only incidents previously recorded by the read gate. The caller
// supplies the private ledger row identity, never notification text or names.
export function createCatalogueRiskAlert({ store, send, now = Date.now }) {
  return async function deliver(key, severity) {
    const burst = Object.hasOwn(labels, severity);
    if (!burst && !['warning', 'restricted'].includes(severity)) return 'ignored';
    const token = randomUUID();
    const row = await store.read(key);
    const event = row?.denials?.[severity];
    if (!event || !Object.hasOwn(labels, event.action) || event.status === 'ACCEPTED' ||
        (event.retryAfter ?? 0) > now()) return 'ignored';
    const attempts = (event.attempts || 0) + 1;
    const claim = { ...event, token, status: 'SENDING', attempts, retryAfter: now() + 300000 };
    const fields = { usage: row.usage, denials: { ...row.denials, [severity]: claim } };
    if (!await store.replaceIfVersion(key, row.version, fields)) return 'busy';
    const name = event.actorType === 'STAFF' || event.actorType === 'ADMIN'
      ? event.actorName || 'Staff member' : event.companyName || event.companyId;
    const status = severity === 'restricted' ? 'Additional access limited' : 'Review activity';
    const message = burst ? 'High read rate · Further requests limited · ' + labels[event.action]
      : status + ' · ' + event.deliveredUnique + ' distinct ' + labels[event.action];
    const notificationText = ((name || 'Catalogue user') + ' · ' + message).slice(0, 200);
    let accepted = false;
    try {
      await send({ notificationText, entryType: 'catalogue-security' });
      accepted = true;
    } catch {
      // Leave failures visible for the scheduled retry. A timeout can be
      // ambiguous: a later retry may duplicate an already-delivered push.
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await store.read(key);
      if (current?.denials?.[severity]?.token !== token) return 'claim-changed';
      const updated = { ...claim, status: accepted ? 'ACCEPTED' : 'RETRY',
        retryAfter: accepted ? 0 : now() + Math.min(3600000, 60000 * 2 ** Math.min(attempts - 1, 6)) };
      if (await store.replaceIfVersion(key, current.version, {
        usage: current.usage, denials: { ...current.denials, [severity]: updated }
      })) return updated.status;
    }
    return 'unconfirmed';
  };
}

// Runs independently of whether the account comes back. One scheduled run
// processes a bounded batch; pending items stay eligible on the next run.
export async function retryCatalogueAlerts(store, deliver, now = Date.now) {
  const time = now();
  const rows = await store.dueAlerts(time);
  let failures = 0;
  for (const row of rows) {
    for (const [severity, event] of Object.entries(row.denials)) {
      if (!['PENDING', 'RETRY', 'SENDING'].includes(event.status) || event.retryAfter > time) continue;
      try { await deliver(row._id, severity); }
      catch { failures++; }
    }
  }
  if (failures) throw Error('Catalogue alert retry incomplete.');
}
