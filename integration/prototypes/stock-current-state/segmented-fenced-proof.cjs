'use strict';

// OFFLINE v2 candidate. Same company fence/CAS contract as v1, no live endpoint.
// Runtime/staging budgets still require actual platform acceptance before activation.
const { randomUUID } = require('node:crypto');
const { hash } = require('./commit-proof.cjs');
const { createSegmentedPlanCodec, same, copy } = require('./segmented-plan.cjs');
function createSegmentedFencedProof({ store, company = 'NCT', newAttempt = randomUUID,
  domainWrites = false, codecPolicy = {}, stepsPerInvocation = 20, maxStagedFragments = 32,
  coordination = 'EXCLUSIVE_LOCK', batchApplyReads = false }) {
  for (const method of ['read', 'insert', 'compareAndSet', 'compareAndRemove']) {
    if (typeof store?.[method] !== 'function') throw Error('Conditional storage required');
  }
  if (!Number.isSafeInteger(stepsPerInvocation) || stepsPerInvocation < 1
    || !Number.isSafeInteger(maxStagedFragments) || maxStagedFragments < 1
    || !['EXCLUSIVE_LOCK', 'CONTROL_CAS_CANDIDATE'].includes(coordination)
    || typeof batchApplyReads !== 'boolean') throw Error('Bounded execution policy required');
  const codec = createSegmentedPlanCodec({ ...codecPolicy, company, domainWrites });
  const { journal, lockId, controlId } = codec.ids, scope = company + '/PURCHASE';
  async function readControl() {
    const row = await store.read(journal, controlId);
    if (!row || row.company !== company || !row._version || !Number.isSafeInteger(row.generation) || row.generation < 0) throw Error('Control missing or invalid');
    return row;
  }
  async function initialize() { await store.insert(journal, { _id: controlId, company, generation: 0, pending: null, _version: 'GENESIS' }); }
  async function writeExpected(collection, before, after) {
    try {
      if (before) await store.compareAndSet(collection, after._id, before._version, copy(after));
      else await store.insert(collection, copy(after));
    } catch (error) {
      if (!same(await store.read(collection, after._id), after)) throw error;
    }
  }
  async function transition(collection, before, after) {
    await writeExpected(collection, before, after);
    if (!same(await store.read(collection, after._id), after)) throw Error('Conditional write unconfirmed');
  }
  const nextControl = (before, fields) => ({ ...before, ...fields, _version: hash(before._version, fields) });
  async function readImages(collection, ids) {
    // Same complete exact-ID adapter already used during preparation. A failed
    // or malformed batch NEVER falls back to individual queries or partial rows.
    const rows = [];
    if (typeof store.readMany === 'function') rows.push(...await store.readMany(collection, ids));
    else for (const id of ids) rows.push(await store.read(collection, id));
    if (rows.length !== ids.length || rows.some((row, index) => row !== null
      && (!row || row._id !== ids[index] || row.company !== company))) throw Error('Exact complete image batch required');
    return rows;
  }
  async function readSnapshot(readRows) {
    const before = await readControl();
    if (before.pending) throw Error('Inventory pending');
    const rows = await readRows(copy(before)), after = await readControl();
    if (after.pending || before._version !== after._version) throw Error('Inventory changed during read');
    return { generation: after.generation, rows };
  }
  async function commit({ requestId, memberId, input, prepare, validate = () => {}, authorize = () => {} }) {
    if (!/^[a-f0-9-]{36}$/i.test(requestId || '') || typeof memberId !== 'string' || !memberId
      || typeof prepare !== 'function' || typeof validate !== 'function' || typeof authorize !== 'function') throw Error('Operation identity required');
    const key = hash(scope, requestId, memberId), digest = hash(input), resultId = hash(key, 'RESULT'), attempt = newAttempt();
    if (typeof attempt !== 'string' || !attempt) throw Error('Attempt identity required');
    // Default deployed candidate retains its original lock contract. The opt-in
    // LOCAL review policy coordinates through the existing conditional control
    // transition; it never touches, releases or adopts a native UNKNOWN lock.
    const exclusive = coordination === 'EXCLUSIVE_LOCK';
    if (exclusive) await store.insert(journal, { _id: lockId, company, owner: key, attempt });
    try {
      let control = await readControl();
      if (control.pending && (control.pending.key !== key || control.pending.digest !== digest)) throw Error('Prior inventory save pending');
      const prior = await store.read(journal, resultId);
      let manifest = await store.read(journal, key);
      if (manifest && manifest.digest !== digest) throw Error('Request identity reused');
      if (manifest && (manifest.company !== company || manifest._id !== key
        || manifest.memberId !== memberId || manifest.requestId !== requestId || manifest.stockOperationProtocol !== 2
        || !Number.isSafeInteger(manifest.baseGeneration) || manifest.baseGeneration < 0)) throw Error('Operation manifest identity conflict');
      if (prior && (!manifest || prior.company !== company || prior._id !== resultId || prior.digest !== digest
        || prior.baseGeneration !== manifest.baseGeneration || prior.stockOperationProtocol !== 2
        || prior.outcome?.ok !== true || prior.outcome.operationId !== key
        || prior.outcome.generation !== manifest.baseGeneration + 1
        || !control.pending && control.generation < prior.outcome.generation)) throw Error('Operation result requires review');
      await authorize(copy({ control, key, digest, replay: !!manifest, baseGeneration: manifest?.baseGeneration ?? control.generation }));
      if (prior) {
        if (control.pending) {
          if (control.generation !== manifest.baseGeneration || control.pending.planHash !== manifest.planHash
            || control.pending.phase !== 'FINALIZE' || control.pending.cursor !== manifest.writeCount) throw Error('Result generation conflict');
          await transition(journal, control, nextControl(control, { generation: manifest.baseGeneration + 1, pending: null }));
        }
        return copy(prior.outcome);
      }
      if (!manifest) {
        if (control.pending) throw Error('Pending manifest missing');
        if (!Number.isSafeInteger(control.generation + 1)) throw Error('Inventory generation exhausted');
        const encoded = codec.encode({ key, digest, memberId, requestId, attempt, baseGeneration: control.generation, plan: await prepare() });
        // Refuse before staging, never silently truncate or pretend this is a measured
        // production limit. All fragments must be durable before unique root insert.
        if (encoded.fragments.length > maxStagedFragments) throw Error('Staging capacity requires review');
        for (const fragment of encoded.fragments) await transition(journal, null, fragment);
        manifest = encoded.manifest;
        await transition(journal, null, manifest);
      }
      if (manifest.baseGeneration !== control.generation) throw Error('Prepared generation stale');
      if (!Array.isArray(manifest.fragments) || manifest.fragments.length > maxStagedFragments) throw Error('Manifest capacity conflict');
      const fragments = await readImages(journal, manifest.fragments.map(ref => ref.id));
      const plan = codec.decode({ manifest, fragments, key, digest, memberId, requestId });
      const count = plan.writes.length;
      if (!control.pending) {
        const pending = { key, digest, planHash: manifest.planHash, phase: 'BEFORE', cursor: 0, count };
        const next = nextControl(control, { pending }); await transition(journal, control, next); control = next;
      }
      const p = control.pending;
      if (p.planHash !== manifest.planHash || p.count !== count || !['BEFORE', 'APPLY', 'VERIFY', 'FINALIZE'].includes(p.phase)
        || !Number.isSafeInteger(p.cursor) || p.cursor < 0 || p.cursor > count
        || p.phase === 'FINALIZE' && p.cursor !== count) throw Error('Pending progress conflict');
      let phase = p.phase, cursor = p.cursor, steps = 0;
      while (steps < stepsPerInvocation && phase !== 'FINALIZE') {
        if (cursor === count) {
          phase = phase === 'BEFORE' ? 'APPLY' : phase === 'APPLY' ? 'VERIFY' : 'FINALIZE'; cursor = phase === 'FINALIZE' ? count : 0;
          // Persist phase boundary BEFORE any following-phase action. Particularly,
          // an interrupted APPLY cannot accidentally re-enter BEFORE verification.
          const next = nextControl(control, { pending: { ...p, phase, cursor } });
          await transition(journal, control, next); control = next;
          continue;
        }
        if (phase !== 'APPLY' && typeof store.readMany === 'function') {
          const span = plan.writes.slice(cursor, cursor + Math.min(count - cursor, stepsPerInvocation - steps));
          const groups = new Map(), found = new Map();
          for (const change of span) {
            if (!groups.has(change.collection)) groups.set(change.collection, []);
            groups.get(change.collection).push(change.after._id);
          }
          for (const [collection, ids] of groups) {
            const rows = await readImages(collection, ids);
            ids.forEach((id, index) => found.set(collection + '/' + id, rows[index]));
          }
          for (const change of span) if (!same(found.get(change.collection + '/' + change.after._id), phase === 'BEFORE' ? change.before : change.after)) {
            throw Error(phase === 'BEFORE' ? 'Prepared before-image stale' : 'Final image conflict');
          }
          cursor += span.length; steps += span.length;
          continue;
        }
        if (phase === 'APPLY' && batchApplyReads && typeof store.readMany === 'function') {
          const span = plan.writes.slice(cursor, cursor + Math.min(count - cursor, stepsPerInvocation - steps));
          const groups = new Map(), found = new Map();
          for (const change of span) {
            if (!groups.has(change.collection)) groups.set(change.collection, []);
            groups.get(change.collection).push(change.after._id);
          }
          for (const [collection, ids] of groups) {
            const rows = await readImages(collection, ids);
            ids.forEach((id, index) => found.set(collection + '/' + id, rows[index]));
          }
          for (const change of span) {
            const current = found.get(change.collection + '/' + change.after._id);
            if (!same(current, change.before) && !same(current, change.after)) throw Error('Write version conflict');
          }
          for (const change of span) if (!same(found.get(change.collection + '/' + change.after._id), change.after)) {
            await writeExpected(change.collection, change.before, change.after);
          }
          // Exact complete strong readback precedes the durable cursor. A failed
          // batch or partial write leaves the original checkpoint unchanged.
          for (const [collection, ids] of groups) {
            const rows = await readImages(collection, ids);
            ids.forEach((id, index) => found.set(collection + '/' + id, rows[index]));
          }
          for (const change of span) if (!same(found.get(change.collection + '/' + change.after._id), change.after)) throw Error('Conditional batch write unconfirmed');
          cursor += span.length; steps += span.length;
          continue;
        }
        const change = plan.writes[cursor], current = await store.read(change.collection, change.after._id);
        if (phase === 'BEFORE') {
          if (!same(current, change.before)) throw Error('Prepared before-image stale');
        } else if (phase === 'APPLY') {
          if (!same(current, change.after)) {
            if (!same(current, change.before)) throw Error('Write version conflict');
            await transition(change.collection, change.before, change.after);
          }
        } else if (!same(current, change.after)) throw Error('Final image conflict');
        cursor++; steps++;
      }
      // Checkpoint may lag completed row writes after an interruption; replay checks
      // exact after-images, not blind increments. Never advances before row confirms.
      if (phase !== control.pending.phase || cursor !== control.pending.cursor) {
        const next = nextControl(control, { pending: { ...p, phase, cursor } });
        await transition(journal, control, next); control = next;
      }
      if (phase !== 'FINALIZE') return { ok: false, pending: true, phase, completedCount: cursor, totalRecords: count, requestId };
      await validate(copy(plan));
      const outcome = { ok: true, operationId: key, generation: manifest.baseGeneration + 1 };
      await transition(journal, null, { _id: resultId, company, stockOperationProtocol: 2, digest, baseGeneration: manifest.baseGeneration, outcome });
      await transition(journal, control, nextControl(control, { generation: manifest.baseGeneration + 1, pending: null }));
      return outcome;
    } finally {
      if (exclusive) await store.compareAndRemove(journal, lockId, attempt);
    }
  }
  return { initialize, readControl, readSnapshot, commit, ids: codec.ids, planFormat: 'SEGMENTED_V2' };
}
module.exports = { createSegmentedFencedProof };
