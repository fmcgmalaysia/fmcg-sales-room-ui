'use strict';

const { hash } = require('./commit-proof.cjs');
const { same, copy, utf8Bytes } = require('./segmented-plan.cjs');
const { readCompanyCurrentSnapshot } = require('./company-current-snapshot.cjs');
const { encodeMaintenanceNativeImage } = require('./maintenance-native-images.cjs');

// PRIVATE original migration validate/inspect adapter, not a normal stock read.
// Unlike readSnapshot(), it may inspect an owned FINALIZE checkpoint, but never
// a different pending operation or an APPLY/VERIFY partial cohort. It has NO
// write, release, retry, mode-switch or activation capability.
function createMaintenanceInstalledReader({ company, items, store, authenticateAdmin, verifyLegacyDrain,
  readControl, limits, maxSnapshotBytes, pageSize = 100 }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function'
    || ['read', 'normalizeListedRow'].some(method => typeof store?.[method] !== 'function')
    || [authenticateAdmin, verifyLegacyDrain, readControl].some(fn => typeof fn !== 'function')
    || !limits || ['positions', 'claims', 'products', 'transfers', 'taskRows'].some(kind => !Number.isSafeInteger(limits[kind]) || limits[kind] < 1)
    || !Number.isSafeInteger(maxSnapshotBytes) || maxSnapshotBytes < 1
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw Error('Explicit private installed-reader dependencies/budgets required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', tasks = company === 'NCT' ? 'NCTTasks' : 'NCTTasks1';
  const lockId = hash(company + '/PURCHASE', 'LOCK');
  return async request => {
    if (!request || Object.keys(request).sort().join(',') !== 'checkpointId,company,requestId' || request.company !== company
      || !/^[a-f0-9-]{36}$/i.test(request.requestId || '') || !/^[a-f0-9]{32}$/.test(request.checkpointId || '')) throw Error('Original installed migration identity required');
    const admin = await authenticateAdmin();
    if (admin?.isAdmin !== true || typeof admin.memberId !== 'string' || !admin.memberId) throw Error('Administrator installed migration read required');
    const key = hash(company + '/PURCHASE', request.requestId, admin.memberId);
    const digest = hash({ kind: 'INITIAL_STOCK_MIGRATION_V2', checkpointId: request.checkpointId });
    async function boundary() {
      const currentAdmin = await authenticateAdmin();
      if (currentAdmin?.isAdmin !== true || currentAdmin.memberId !== admin.memberId) throw Error('Installed migration administrator changed');
      if (await verifyLegacyDrain({ company, checkpointId: request.checkpointId }) !== true) throw Error('Legacy request drain is not verified');
      const control = await readControl();
      if (control?._id !== hash(company, 'STOCK_CONTROL') || control.company !== company || control.mode !== 'MAINTENANCE'
        || control.schemaVersion !== 1 || control.transferIndexVersion !== 2 || !control._version
        || !Number.isSafeInteger(control.generation) || control.generation < 0) throw Error('Installed migration maintenance control required');
      const manifest = await store.read(journal, key), result = await store.read(journal, hash(key, 'RESULT'));
      const lock = await store.read(journal, lockId);
      if (manifest?._id !== key || manifest.company !== company || manifest.stockOperationProtocol !== 2 || manifest.action !== 'STOCK_PLAN_MANIFEST'
        || manifest.memberId !== admin.memberId || manifest.requestId !== request.requestId || manifest.digest !== digest
        || !/^[a-f0-9]{32}$/.test(manifest.planHash || '') || !Number.isSafeInteger(manifest.baseGeneration) || manifest.baseGeneration < 0
        || !Number.isSafeInteger(manifest.writeCount) || manifest.writeCount < 1) throw Error('Original installed migration manifest required');
      if (control.pending !== null) {
        const p = control.pending;
        if (!p || p.key !== key || p.digest !== digest || p.planHash !== manifest.planHash || p.phase !== 'FINALIZE'
          || p.cursor !== manifest.writeCount || p.count !== manifest.writeCount || control.generation !== manifest.baseGeneration
          || lock?.company !== company || lock._id !== lockId || lock.owner !== key || typeof lock.attempt !== 'string' || !lock.attempt
          || result !== null) throw Error('Owned FINALIZE migration read required');
      } else if (lock !== null || result?._id !== hash(key, 'RESULT') || result.company !== company || result.stockOperationProtocol !== 2
        || result.digest !== digest || result.baseGeneration !== manifest.baseGeneration || result.outcome?.ok !== true
        || result.outcome.operationId !== key || result.outcome.generation !== manifest.baseGeneration + 1
        || control.generation !== result.outcome.generation) throw Error('Confirmed original migration read required');
      return { control, manifest, result, lock };
    }
    const before = await boundary(), metrics = { queries: 0, exactReads: 0 };
    async function cohort() {
      // Reuse the existing complete all-status stock reader. Its ordinary barrier
      // is NOT weakened; this explicit private wrapper is bounded by boundary().
      const current = await readCompanyCurrentSnapshot({ company, items, store, limits, pageSize,
        protocol: { readSnapshot: async readRows => ({ rows: await readRows(), generation: before.control.generation }) } });
      metrics.queries += current.metrics.queries; metrics.exactReads += current.metrics.exactReads;
      const taskRows = [], seen = new Set(); let total = null;
      do {
        // Scan the exact company-owned task table WITHOUT filtering out missing
        // company/version metadata. Such a row is an error, never silently absent.
        const page = await items.query(tasks).ascending('_id').skip(taskRows.length).limit(pageSize)
          .find({ consistentRead: true, returnTotalCount: true });
        metrics.queries++;
        if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount < taskRows.length
          || page.totalCount > limits.taskRows || total !== null && total !== page.totalCount
          || page.items.length !== Math.min(pageSize, page.totalCount - taskRows.length)) throw Error('Incomplete or over-budget installed task cohort');
        total = page.totalCount;
        for (const raw of page.items) {
          if (typeof raw?._id !== 'string' || !raw._id || seen.has(raw._id) || raw.company !== company) throw Error('Installed task scope conflict');
          seen.add(raw._id);
          const listed = store.normalizeListedRow(tasks, raw), row = await store.read(tasks, raw._id); metrics.exactReads++;
          if (!row || row._id !== raw._id || row.company !== company || !same(listed, row)) throw Error('Installed exact task image changed');
          taskRows.push(copy(row));
        }
      } while (taskRows.length < total);
      const rows = { company, positions: current.positions, claims: current.claims, products: current.products,
        transfers: current.transfers, taskRows, complete: true, taskRowsComplete: true };
      if (utf8Bytes(JSON.stringify(encodeMaintenanceNativeImage(rows))) > maxSnapshotBytes) throw Error('Installed migration snapshot byte policy exceeded');
      return rows;
    }
    const first = await cohort(), second = await cohort(), after = await boundary();
    if (!same(before, after)) throw Error('Installed migration boundary changed during read');
    if (JSON.stringify(encodeMaintenanceNativeImage(first)) !== JSON.stringify(encodeMaintenanceNativeImage(second))) throw Error('Installed migration cohort changed during read');
    return { ...second, generation: after.control.generation, operationId: key, checkpointId: request.checkpointId,
      inspectionStage: after.control.pending === null ? 'CONFIRMED' : 'OWNED_FINALIZE', metrics, activationReady: false };
  };
}
module.exports = { createMaintenanceInstalledReader };
