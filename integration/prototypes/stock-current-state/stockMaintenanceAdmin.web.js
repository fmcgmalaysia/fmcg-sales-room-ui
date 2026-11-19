// Candidate native composition, NOT installed. No ACTIVE, schema/ACL mutation,
// legacy lock release, automatic retry, site publish or browser-supplied proof.
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { items, collections } from '@wix/data';
import { projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
import { projectStockCard } from 'backend/stockCardProjection.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections,
  createMaintenanceSnapshotReader, createMaintenanceBackupStore, createRetainedMaintenanceCapture,
  createMaintenanceInstalledReader, createMaintenanceMetadataInitializer, createMaintenanceMigration,
  createMaintenanceControlInitializer } from 'backend/stockCurrentCommands.js';

// This is deliberately NOT a Boolean that an administrator/browser can set.
// No supported provider drain/termination contract is established yet. Filling
// this seam requires reviewed implementation/evidence, not waiting or a timeout.
async function verifyLegacyDrain() {
  throw Error('STOCK_MAINTENANCE_BLOCKED: provider drain or sufficient legacy fencing is not established');
}
async function authenticateAdmin() {
  // Every exported caller below is already Permissions.Admin, enforced by Wix.
  // getMember supplies only the actual identity for original request ownership;
  // it does NOT grant Admin based on a StaffMasterAccess row or role title.
  // Owners/contributors without a usable member identity refuse, never fall back
  // to a browser ID or a fixed synthetic administrator.
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  if (member?.status !== 'APPROVED' || typeof member._id !== 'string' || !member._id || member._id.length > 200) {
    throw Error('Actual approved administrator member identity required');
  }
  return { isAdmin: true, memberId: member._id };
}
const exact = (value, names) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === names.split(' ').sort().join(',');
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
const hex = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
function request(input, operation) {
  const names = operation === 'control' ? 'company requestId' : operation === 'capture' ? 'company' : operation === 'retain' || operation === 'backup' ? 'company backupRequestId'
    : operation === 'metadata' ? 'company backupRequestId checkpointId ordinal' : 'company backupRequestId checkpointId requestId';
  if (!exact(input, names) || !['NCT', 'GHR'].includes(input.company)
    || Object.hasOwn(input, 'backupRequestId') && !uuid(input.backupRequestId)
    || Object.hasOwn(input, 'requestId') && !uuid(input.requestId)
    || Object.hasOwn(input, 'checkpointId') && !hex(input.checkpointId)
    || operation === 'metadata' && (!Number.isSafeInteger(input.ordinal) || input.ordinal < 0)) {
    throw Error('Exact original maintenance identity required; no images, flags or policy input');
  }
}
async function nativeServices(company, backupRequestId) {
  const originalAdmin = await authenticateAdmin();
  // Refuse BEFORE SDK item/metadata access while the actual boundary is unknown.
  // This is not an alternate route around the stopped native function tester.
  await verifyLegacyDrain({ company, purpose: 'NATIVE_MAINTENANCE_ENTRY' });
  const authenticate = async () => {
    const current = await authenticateAdmin();
    if (current.memberId !== originalAdmin.memberId) throw Error('Maintenance administrator changed');
    return current;
  };
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const orders = company === 'NCT' ? 'NCTOrders' : 'NCTOrders1', tasks = company === 'NCT' ? 'NCTTasks' : 'NCTTasks1';
  const store = createSdkConditionalStore({ company, items, collections: planCollections(company, true),
    dateTimeFields: { [journal]: ['activityTime'], [orders]: ['masterReceivedTime', 'salesSubmissionTime'],
      [tasks]: ['lastCostCaptureTime'] } });
  const protocol = createSegmentedFencedProof({ company, store, domainWrites: true });
  // Explicit refusal budgets, NOT measured production capacity or permission to
  // increase the site's item quota. Native capacity/recovery acceptance remains open.
  const limit = 10000, maxBytes = 8 * 1024 * 1024;
  const reader = createMaintenanceSnapshotReader({ company, items, store, protocol, authenticateAdmin: authenticate,
    verifyLegacyDrain, projectPurchaseWorkspace, projectStockCard, projectPurchaseOrders,
    limits: Object.fromEntries([orders, tasks, journal, 'SharedSuppliers', 'PurchaseOrders', 'StockPositions', 'StockClaims', 'StockProducts']
      .map(name => [name, limit])), maxBackupBytes: maxBytes });
  const verifyPrivateRetention = async input => {
    if (!exact(input, 'company collection') || input.company !== company || input.collection !== journal) throw Error('Exact private retention scope required');
    await authenticate();
    const metadata = await collections.getDataCollection(journal, { consistentRead: true });
    // Existing journal ACL is unconfirmed. Merely being able to query it is NOT
    // privacy evidence. This only reads; it never tightens existing business ACLs.
    return metadata?._id === journal && ['read', 'insert', 'update', 'remove'].every(key => metadata.permissions?.[key] === 'ADMIN');
  };
  const verifyControlSchema = async input => {
    if (!exact(input, 'company collection') || input.company !== company || input.collection !== journal) throw Error('Exact native control schema scope required');
    await authenticate();
    const metadata = await collections.getDataCollection(journal, { consistentRead: true });
    if (metadata?._id !== journal || !Array.isArray(metadata.fields) || metadata.fields.length > 500
      || new Set(metadata.fields.map(field => field.key)).size !== metadata.fields.length) return false;
    const required = { company: 'TEXT', stockCommitVersion: 'TEXT', mode: 'TEXT', schemaVersion: 'NUMBER',
      transferIndexVersion: 'NUMBER', generation: 'NUMBER', pending: 'OBJECT' };
    return Object.entries(required).every(([key, type]) => metadata.fields.some(field => field.key === key && field.type === type));
  };
  const control = createMaintenanceControlInitializer({ company, store, authenticateAdmin: authenticate, verifyLegacyDrain,
    verifyPrivateRetention, verifyControlSchema });
  const backups = createMaintenanceBackupStore({ company, store, authenticateAdmin: authenticate, verifyPrivateRetention,
    verifyLegacyDrain, readControl: protocol.readControl, readSnapshot: () => reader.read(),
    policy: { recordBudgetBytes: 64000, maxBackupBytes: maxBytes, maxFragments: 256, partsPerInvocation: 4 } });
  const installed = createMaintenanceInstalledReader({ company, items, store, authenticateAdmin: authenticate, verifyLegacyDrain,
    readControl: protocol.readControl, limits: { positions: limit, claims: limit, products: limit, transfers: limit, taskRows: limit },
    maxSnapshotBytes: maxBytes });
  const originalBackup = { requestId: backupRequestId };
  const metadata = () => createMaintenanceMetadataInitializer({ company, items, authenticateAdmin: authenticate, verifyLegacyDrain,
    readControl: protocol.readControl, readCapturedRow: backups.metadataReader(originalBackup) });
  const migration = () => createMaintenanceMigration({ company, store, authenticateAdmin: authenticate, verifyLegacyDrain,
    capture: createRetainedMaintenanceCapture({ company, backupStore: backups, backupRequest: originalBackup,
      readSnapshot: owned => owned ? reader.readOwnedMigration(owned) : reader.read() }), readInstalled: installed });
  return { reader, backups, metadata, migration, control };
}
// No catch/retry: an unknown mutation response remains unknown and original IDs
// must be retained for a later explicit inspection, never silently resubmitted.
export const initializeStockMaintenanceControl = webMethod(Permissions.Admin, async input => {
  request(input, 'control'); return (await nativeServices(input.company)).control.initialize({ requestId: input.requestId });
});
export const inspectStockMaintenanceControl = webMethod(Permissions.Admin, async input => {
  request(input, 'control'); return (await nativeServices(input.company)).control.inspect({ requestId: input.requestId });
});
export const captureStockMaintenance = webMethod(Permissions.Admin, async input => {
  request(input, 'capture'); return (await nativeServices(input.company)).reader.read();
});
export const retainStockMaintenanceBackup = webMethod(Permissions.Admin, async input => {
  request(input, 'retain'); return (await nativeServices(input.company, input.backupRequestId)).backups.retain({ requestId: input.backupRequestId });
});
export const inspectStockMaintenanceBackup = webMethod(Permissions.Admin, async input => {
  request(input, 'backup'); return (await nativeServices(input.company, input.backupRequestId)).backups.inspect({ requestId: input.backupRequestId });
});
export const initializeStockMaintenanceMetadata = webMethod(Permissions.Admin, async input => {
  request(input, 'metadata'); return (await nativeServices(input.company, input.backupRequestId)).metadata()
    .step({ checkpointId: input.checkpointId, ordinal: input.ordinal });
});
export const applyStockMaintenanceMigration = webMethod(Permissions.Admin, async input => {
  request(input, 'migration'); return (await nativeServices(input.company, input.backupRequestId)).migration()
    .apply({ checkpointId: input.checkpointId, requestId: input.requestId });
});
export const inspectStockMaintenanceMigration = webMethod(Permissions.Admin, async input => {
  request(input, 'migration'); return (await nativeServices(input.company, input.backupRequestId)).migration()
    .inspect({ checkpointId: input.checkpointId, requestId: input.requestId });
});
