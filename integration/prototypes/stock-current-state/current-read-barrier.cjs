'use strict';

const { hash } = require('./commit-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
// Query-only control barrier for the actual Warehouse current-read gateway.
// No initialization, mode changes, lock release or business write capability.
function createCurrentReadBarrier({ company, items }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function') throw Error('Current read scope required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', id = hash(company, 'STOCK_CONTROL');
  async function readControl() {
    const page = await items.query(journal).eq('_id', id).limit(2).find({ consistentRead: true });
    if (!Array.isArray(page?.items) || page.items.length !== 1) throw Error('Current inventory control unavailable');
    const row = page.items[0];
    if (row._id !== id || row.company !== company || typeof row.stockCommitVersion !== 'string' || !row.stockCommitVersion
      || !Number.isSafeInteger(row.generation) || row.generation < 0 || row.schemaVersion !== 1
      || !['LEGACY', 'SHADOW', 'ACTIVE', 'MAINTENANCE'].includes(row.mode)
      || row.pending !== null && (!row.pending || typeof row.pending.key !== 'string' || typeof row.pending.digest !== 'string')) throw Error('Current inventory control requires review');
    return { _id: id, company, _version: row.stockCommitVersion, generation: row.generation, mode: row.mode,
      schemaVersion: row.schemaVersion, pending: copy(row.pending) };
  }
  async function readSnapshot(readRows) {
    const before = await readControl(); if (before.pending) throw Error('Inventory pending');
    const rows = await readRows(copy(before)), after = await readControl();
    if (after.pending || JSON.stringify(before) !== JSON.stringify(after)) throw Error('Inventory changed during read');
    return { generation: after.generation, rows };
  }
  return { readControl, readSnapshot };
}
module.exports = { createCurrentReadBarrier };
