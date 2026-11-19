'use strict';

// G0 offline proof only. No Wix import, endpoint, authorization, or production consumer.
// Assumes unique inserts and strongly consistent reads; does NOT assume conditional updates.
const { createHash } = require('node:crypto');
const copy = value => JSON.parse(JSON.stringify(value));
const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function createCommitProof({ store, company = 'NCT' }) {
  if (!['NCT', 'GHR'].includes(company)) throw Error('Invalid company');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const scope = company + '/PURCHASE';
  const lockId = hash(scope, 'LOCK'); // Same identity as the existing company journal.
  const controlId = hash(company, 'STOCK_CONTROL');
  const collections = new Set(['StockPositions', 'StockClaims', 'StockProducts', journal]);
  const initial = () => ({ _id: controlId, company, generation: 0, pending: null });
  const readControl = async () => {
    const row = await store.read(journal, controlId) || initial();
    if (row.company !== company || !Number.isSafeInteger(row.generation) || row.generation < 0) throw Error('Control conflict');
    return row;
  };
  const putControl = async row => {
    if (await store.read(journal, controlId)) await store.update(journal, row);
    else await store.insert(journal, row);
    if (!same(await readControl(), row)) throw Error('Control unconfirmed');
  };
  const checkPlan = plan => {
    if (!plan || !Array.isArray(plan.writes) || !plan.writes.length || plan.writes.length > 30
      || Buffer.byteLength(JSON.stringify(plan), 'utf8') > 180000) throw Error('Proof plan limit');
    const keys = new Set();
    for (const change of plan.writes) {
      const key = change.collection + '/' + change.after?._id;
      if (!collections.has(change.collection) || !change.after?._id || keys.has(key)
        || change.after.company !== company || change.before && (change.before._id !== change.after._id || change.before.company !== company)
        || change.collection === journal && [lockId, controlId].includes(change.after._id)) throw Error('Plan identity conflict');
      keys.add(key);
    }
  };
  async function readSnapshot(readRows) {
    const before = await readControl();
    if (before.pending) throw Error('Inventory pending');
    const rows = await readRows();
    const after = await readControl();
    if (after.pending || before.generation !== after.generation) throw Error('Inventory changed during read');
    return { generation: after.generation, rows };
  }
  async function commit({ requestId, memberId, input, prepare, validate = () => {} }) {
    if (!/^[a-f0-9-]{36}$/i.test(requestId || '') || !memberId) throw Error('Proof identity required');
    const key = hash(scope, requestId, memberId), digest = hash(input);
    const resultId = hash(key, 'RESULT');
    if (await store.read(journal, lockId)) throw Error('Save processing');
    await store.insert(journal, { _id: lockId, company, details: { owner: key } });
    try {
      let control = await readControl();
      if (control.pending && (control.pending.key !== key || control.pending.digest !== digest)) throw Error('Prior inventory save pending');
      const prior = await store.read(journal, resultId);
      if (prior) {
        if (prior.digest !== digest) throw Error('Request identity reused');
        if (control.pending) {
          // Finalize without applying old after-images again, even after later operations.
          if (control.generation !== prior.baseGeneration) throw Error('Result generation conflict');
          await putControl({ ...control, generation: prior.baseGeneration + 1, pending: null });
        }
        return copy(prior.outcome);
      }
      let receipt = await store.read(journal, key);
      if (receipt && receipt.digest !== digest) throw Error('Request identity reused');
      if (!receipt) {
        const plan = await prepare();
        checkPlan(plan);
        receipt = { _id: key, company, digest, baseGeneration: control.generation, plan: copy(plan) };
        await store.insert(journal, receipt);
      }
      checkPlan(receipt.plan);
      if (receipt.baseGeneration !== control.generation) throw Error('Prepared generation stale');
      if (!control.pending) {
        // All before-images must match before taking ownership of persistent pending state.
        for (const change of receipt.plan.writes) {
          if (!same(await store.read(change.collection, change.after._id), change.before)) throw Error('Prepared before-image stale');
        }
        control = { ...control, pending: { key, digest } };
        await putControl(control);
      }
      for (const change of receipt.plan.writes) {
        const current = await store.read(change.collection, change.after._id);
        if (same(current, change.after)) continue;
        if (!same(current, change.before)) throw Error('Write version conflict');
        if (current) await store.update(change.collection, copy(change.after));
        else await store.insert(change.collection, copy(change.after));
        if (!same(await store.read(change.collection, change.after._id), change.after)) throw Error('Write unconfirmed');
      }
      for (const change of receipt.plan.writes) {
        if (!same(await store.read(change.collection, change.after._id), change.after)) throw Error('Final image conflict');
      }
      await validate(copy(receipt.plan));
      const outcome = { ok: true, operationId: key, generation: receipt.baseGeneration + 1 };
      await store.insert(journal, { _id: resultId, company, digest, baseGeneration: receipt.baseGeneration, outcome });
      if ((await store.read(journal, resultId))?.digest !== digest) throw Error('Result unconfirmed');
      await putControl({ ...control, generation: receipt.baseGeneration + 1, pending: null });
      return outcome;
    } finally {
      const lock = await store.read(journal, lockId);
      if (lock?.details?.owner === key) await store.remove(journal, lockId);
    }
  }
  return { commit, readSnapshot, readControl, ids: { journal, controlId, lockId } };
}

module.exports = { createCommitProof, hash };
