'use strict';

const { hash } = require('./commit-proof.cjs');
const { copy, same } = require('./segmented-plan.cjs');
const { domainCollections } = require('./domain-scope.cjs');
const { stockBootstrapPreflight } = require('./bootstrap-preflight.cjs');
const { lifecycleBootstrapPreflight } = require('./lifecycle-bootstrap-preflight.cjs');
const { encodeMaintenanceNativeImage, decodeMaintenanceNativeImage } = require('./maintenance-native-images.cjs');
const { isMaintenanceBackupRecord } = require('./maintenance-backup-store.cjs');
const {Buffer}=require('node:buffer');

// Private maintenance reader only, not a public method or a mode/drain authority.
// Uses original business projectors; all pages (including archived/unprojected
// rows) are retained for review/backup. A browser cannot supply rows or budgets.
function createMaintenanceSnapshotReader({ company, items, store, protocol, authenticateAdmin, verifyLegacyDrain,
  projectPurchaseWorkspace, projectStockCard, projectPurchaseOrders, limits, maxBackupBytes, pageSize = 100 }) {
  const [orders, tasks, purchaseOrders] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const legacy = [orders, tasks, journal, 'SharedSuppliers', purchaseOrders];
  const current = { positions: 'StockPositions', claims: 'StockClaims', products: 'StockProducts' };
  const names = [...legacy, ...Object.values(current)];
  if (typeof items?.query !== 'function' || typeof store?.normalizeListedRow !== 'function'
    || ['readControl', 'readSnapshot'].some(method => typeof protocol?.[method] !== 'function')
    || [authenticateAdmin, verifyLegacyDrain, projectPurchaseWorkspace, projectStockCard, projectPurchaseOrders].some(fn => typeof fn !== 'function')
    || !limits || names.some(name => !Number.isSafeInteger(limits[name]) || limits[name] < 1)
    || !Number.isSafeInteger(maxBackupBytes) || maxBackupBytes < 1
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw Error('Explicit private maintenance snapshot dependencies/budgets required');

  async function readState(ownedMigration = null) {
    const admin = await authenticateAdmin();
    if (admin?.isAdmin !== true || typeof admin.memberId !== 'string' || !admin.memberId) throw Error('Administrator maintenance capture required');
    const requireDrain = async () => {
      if (await verifyLegacyDrain({ company, purpose: 'MAINTENANCE_CAPTURE' }) !== true) throw Error('Legacy request drain is not verified');
    };
    await requireDrain();
    let queries = 0;
    const snapshot = await protocol.readSnapshot(async control => {
      if (control?._id !== hash(company, 'STOCK_CONTROL') || control.company !== company || control.mode !== 'MAINTENANCE'
        || control.schemaVersion !== 1 || control.transferIndexVersion !== 2 || !control._version || control.pending !== null
        || !Number.isSafeInteger(control.generation) || control.generation < 0) throw Error('Verified maintenance capture control required');
      const tables = {}, capturedTables = {}; let retainedBytes = 0;
      for (const collection of names) {
        const rows = [], seen = new Set(); let expected = null, previous = null;
        do {
          let query = items.query(collection);
          // Historical company-specific tables include original rows with no
          // company metadata. Shared POs are scanned completely before filtering;
          // missing ownership is a review error, never silently omitted.
          if (Object.values(current).includes(collection)) query = query.eq('company', company);
          const page = await query.ascending('_id').skip(rows.length).limit(pageSize)
            .find({ consistentRead: true, returnTotalCount: true });
          queries++;
          if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount < rows.length
            || page.totalCount > limits[collection] || expected !== null && expected !== page.totalCount
            || page.items.length !== Math.min(pageSize, page.totalCount - rows.length)) throw Error('Incomplete or over-budget maintenance table: ' + collection);
          expected = page.totalCount;
          for (const row of page.items) {
            if (typeof row?._id !== 'string' || !row._id || seen.has(row._id) || previous !== null && previous >= row._id
              || Object.hasOwn(row, '_version')) throw Error('Distinct ordered native maintenance rows required');
            if (collection === purchaseOrders ? !['NCT', 'GHR'].includes(row.company)
              : collection !== 'SharedSuppliers' && (Object.values(current).includes(collection) ? row.company !== company
                : Object.hasOwn(row, 'company') && row.company !== company)) throw Error('Maintenance collection company conflict');
            seen.add(row._id); previous = row._id;
            const image = encodeMaintenanceNativeImage(row);
            if (collection !== journal || !isMaintenanceBackupRecord(row, company)) retainedBytes += Buffer.byteLength(JSON.stringify(image), 'utf8');
            if (retainedBytes > maxBackupBytes) throw Error('Maintenance backup exceeds explicit byte budget');
            rows.push(decodeMaintenanceNativeImage(image));
          }
        } while (rows.length < expected);
        capturedTables[collection] = rows;
        const ownedLock = row => {
          if (!ownedMigration || row._id !== hash(company + '/PURCHASE', 'LOCK')) return false;
          const fields = Object.keys(row).filter(key => !['_createdDate', '_updatedDate', '_owner', '_ownerId'].includes(key)).sort().join(',');
          if (fields !== '_id,attempt,company,owner' || row.company !== company
            || row.owner !== hash(company + '/PURCHASE', ownedMigration.requestId, admin.memberId)
            || typeof row.attempt !== 'string' || !row.attempt) throw Error('Exact owned migration capture lock required');
          return true;
        };
        if (ownedMigration && collection === journal && !rows.some(ownedLock)) throw Error('Owned migration capture lock missing');
        tables[collection] = collection === purchaseOrders ? rows.filter(row => row.company === company)
          : collection === journal ? rows.filter(row => !isMaintenanceBackupRecord(row, company) && !ownedLock(row)) : rows;
      }
      const metadataRows = [];
      for (const collection of [orders, tasks, purchaseOrders]) for (const row of tables[collection]) {
        if (!Object.hasOwn(row, 'stockCommitVersion')) {
          if (Object.prototype.toString.call(row._updatedDate) !== '[object Date]' || !Number.isFinite(row._updatedDate.getTime())
            || row.stockOperationProtocol != null) throw Error('Typed original metadata checkpoint required');
          metadataRows.push({ collection, row });
        }
      }
      const normalized = (collection, row) => Object.hasOwn(row, 'stockCommitVersion') ? store.normalizeListedRow(collection, row) : copy(row);
      const projectedTables = Object.fromEntries(legacy.map(collection => [collection, tables[collection].map(row =>
        collection === 'SharedSuppliers' || collection === journal ? copy(row) : normalized(collection, row))]));
      const workspace = projectPurchaseWorkspace({ company, orders: projectedTables[orders], tasks: projectedTables[tasks],
        activity: projectedTables[journal], suppliers: projectedTables.SharedSuppliers, staff: {} });
      if (workspace?.company !== company || !Array.isArray(workspace.tasks)) throw Error('Original complete maintenance workspace required');
      const context = { ...workspace, activity: projectedTables[journal] };
      // These are display/session metadata, not source business evidence. The
      // original projector's fetchedAt must not change a checkpoint on each read.
      delete context.staff; delete context.fetchedAt; delete context.readAt;
      const existing = { company, complete: true, transfers: tables[journal].filter(row => row.action === 'STOCK_TRANSFER_CURRENT').map(row => normalized(journal, row)) };
      for (const [kind, collection] of Object.entries(current)) existing[kind] = tables[collection].map(row => store.normalizeListedRow(collection, row));
      const taskRows = projectedTables[tasks], base = stockBootstrapPreflight({ company, context,
        purchaseRecords: projectedTables[purchaseOrders], existing, control, projectStockCard, projectPurchaseOrders, includeProjection: true });
      const expected = base.canBootstrap ? lifecycleBootstrapPreflight({ company, context, base, taskRows, generation: control.generation }) : base;
      if (metadataRows.length) expected.blockers = [...new Set([...expected.blockers, 'LEGACY_VERSION_INITIALIZATION_NOT_VERIFIED'])];
      const payload = encodeMaintenanceNativeImage({ company, control, tables });
      if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > maxBackupBytes) throw Error('Maintenance backup exceeds explicit byte budget');
      const backup = { schema: 'STOCK_MAINTENANCE_TYPED_BACKUP_V1', company, backupId: hash('MAINTENANCE_NATIVE_BACKUP_V1', payload), payload };
      // Strong pages are not a cross-table transaction. Re-read the complete
      // cohort and compare native images, not only counts, so an edit or same-size
      // replacement during capture cannot be mistaken for the original backup.
      // This is an additional freshness check, NOT proof of old-request drain.
      for (const collection of names) {
        const captured = capturedTables[collection]; let offset = 0;
        do {
          let query = items.query(collection);
          if (Object.values(current).includes(collection)) query = query.eq('company', company);
          const page = await query.ascending('_id').skip(offset).limit(pageSize)
            .find({ consistentRead: true, returnTotalCount: true });
          queries++;
          if (!Array.isArray(page?.items) || page.totalCount !== captured.length
            || page.items.length !== Math.min(pageSize, captured.length - offset)
            || page.items.some((row, index) => JSON.stringify(encodeMaintenanceNativeImage(row))
              !== JSON.stringify(encodeMaintenanceNativeImage(captured[offset + index])))) throw Error('Maintenance native cohort changed during capture');
          offset += page.items.length;
        } while (offset < captured.length);
      }
      const currentAdmin = await authenticateAdmin();
      if (currentAdmin?.isAdmin !== true || currentAdmin.memberId !== admin.memberId) throw Error('Maintenance capture administrator changed');
      await requireDrain();
      if (!same(control, await protocol.readControl())) throw Error('Maintenance capture control changed');
      return { company, control, context, taskRows, expected, existing, backup, metadataRows,
        complete: true, emptyCurrentConfirmed: ['positions', 'claims', 'products', 'transfers'].every(kind => !existing[kind].length),
        activationReady: false, durableBackupConfirmed: false };
    });
    return { ...snapshot.rows, metrics: { queries } };
  }
  async function read() {
    if (arguments.length) throw Error('Maintenance capture accepts no browser images or authority');
    return readState();
  }
  async function readOwnedMigration(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'checkpointId,requestId'
      || !/^[a-f0-9-]{36}$/i.test(input.requestId || '') || !/^[a-f0-9]{32}$/.test(input.checkpointId || '')) throw Error('Original owned migration capture identity required');
    const result = await readState(input);
    if (result.expected.checkpointId !== input.checkpointId) throw Error('Owned migration checkpoint changed');
    return result;
  }
  // Direct composition seam for createMaintenanceMigration.capture. A different
  // current cohort never adopts a previously displayed checkpoint. Durability
  // and the actual Admin/drain binding remain installation prerequisites.
  async function capture(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'checkpointId,company' || input.company !== company
      || !/^[a-f0-9]{32}$/.test(input.checkpointId || '')) throw Error('Original maintenance checkpoint identity required');
    const result = await read();
    if (result.expected.checkpointId !== input.checkpointId) throw Error('Maintenance checkpoint changed');
    return result;
  }
  return { read, capture, readOwnedMigration };
}
module.exports = { createMaintenanceSnapshotReader };
