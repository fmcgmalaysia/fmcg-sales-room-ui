import { randomUUID } from 'crypto';

// This collection must have administrator-only CMS permissions.
export function createCatalogueBudgetStore({ data, patch, collection }) {
  const readOptions = { suppressAuth: true, consistentRead: true };
  async function read(key) {
    const result = await data.query(collection).eq('_id', key).limit(1).find(readOptions);
    const row = result.items[0];
    if (!row) return null;
    if (!Number.isSafeInteger(row.version) || row.version < 1 || !row.usage || !row.denials) {
      throw Error('Catalogue usage state unavailable.');
    }
    return row;
  }
  return {
    read,
    async dueAlerts(time, limit = 25) {
      const result = await data.query(collection).gt('nextAlertAt', 0).le('nextAlertAt', time)
        .ascending('nextAlertAt').limit(limit).find(readOptions);
      return result.items;
    },
    async replaceIfVersion(key, version, next) {
      const fields = { usage: next.usage, denials: next.denials, version: version + 1, reservationId: randomUUID() };
      const pending = Object.values(next.denials).filter(event => ['PENDING', 'SENDING', 'RETRY'].includes(event.status));
      fields.nextAlertAt = pending.length ? Math.min(...pending.map(event => event.retryAfter || event.at || 1)) : 0;
      if (!version) {
        try {
          await data.insert(collection, { _id: key, ...fields }, { suppressAuth: true });
          return true;
        } catch (error) {
          if (await read(key)) return false;
          throw error;
        }
      }
      const updates = Object.entries(fields).map(([fieldPath, value]) => ({ fieldPath, action: 'SET_FIELD', value }));
      try {
        const saved = await patch(collection, key, updates, { condition: { version: { $eq: version } } });
        return saved?.version === version + 1 && saved.reservationId === fields.reservationId;
      } catch (error) {
        const current = await read(key);
        if (current && current.version !== version) return false;
        throw error;
      }
    }
  };
}
