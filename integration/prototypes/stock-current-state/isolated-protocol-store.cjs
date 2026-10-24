'use strict';

// Test namespace only. Never points logical collections at physical business collections.
function createIsolatedProtocolStore({ store, namespace }) {
  if (namespace !== 'PROTOCOL-70c1b2') throw Error('Fixed isolated namespace required');
  const collection = 'StockProtocolTest';
  const allowed = new Set(['NCTActivity', 'StockPositions', 'StockClaims', 'StockProducts']);
  function address(logical, id) {
    if (!allowed.has(logical) || typeof id !== 'string' || !id || id.length > 128) throw Error('Invalid isolated address');
    return namespace + ':' + logical + ':' + id;
  }
  function encode(logical, row) { return { ...row, _id: address(logical, row._id) }; }
  function decode(logical, id, row) {
    if (!row) return null;
    if (row._id !== address(logical, id)) throw Error('Isolated identity conflict');
    return { ...row, _id: id };
  }
  return {
    read: async (logical, id) => decode(logical, id, await store.read(collection, address(logical, id))),
    insert: async (logical, row) => decode(logical, row._id, await store.insert(collection, encode(logical, row))),
    compareAndSet: async (logical, id, version, row) => {
      if (row?._id !== id) throw Error('Isolated image identity conflict');
      return decode(logical, id, await store.compareAndSet(collection, address(logical, id), version, encode(logical, row)));
    },
    compareAndRemove: async (logical, id, attempt) => decode(logical, id,
      await store.compareAndRemove(collection, address(logical, id), attempt))
  };
}

module.exports = { createIsolatedProtocolStore };
