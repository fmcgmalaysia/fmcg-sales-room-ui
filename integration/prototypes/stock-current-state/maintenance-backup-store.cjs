'use strict';

const { hash } = require('./commit-proof.cjs');
const { same, copy, utf8Bytes } = require('./segmented-plan.cjs');
const { domainCollections } = require('./domain-scope.cjs');
const { encodeMaintenanceNativeImage, decodeMaintenanceNativeImage } = require('./maintenance-native-images.cjs');
const FORMAT = 'STOCK_NATIVE_BACKUP_PARTS_V1';
const actions = ['STOCK_MAINTENANCE_BACKUP_HEADER', 'STOCK_MAINTENANCE_BACKUP_PART', 'STOCK_MAINTENANCE_BACKUP_CONFIRMED'];
const hex = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const keys = (value, expected) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === expected.split(' ').sort().join(',');
const partId = (root, backup, index) => hash(root, backup, 'BACKUP_PART', index);
const metadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId']);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => hash(canonical(value));

// Reserved nonbusiness records only. This is classification, NOT proof of
// retention/privacy or a grant to execute any contained image. Native system
// metadata may be present on lists; every application field must match exactly.
function isMaintenanceBackupRecord(raw, company) {
  if (!actions.includes(raw?.action)) return false;
  const row = Object.fromEntries(Object.entries(raw).filter(([key]) => !metadata.has(key))), d = row.details;
  let valid = ['NCT', 'GHR'].includes(company) && keys(row, '_id company action details') && row.company === company
    && d?.format === FORMAT && hex(d.rootId) && hex(d.backupId);
  if (row.action === actions[0]) valid = valid && keys(d, 'format rootId requestId memberId checkpointId backupId payloadHash payloadBytes controlHash parts')
    && uuid(d.requestId) && typeof d.memberId === 'string' && !!d.memberId && hex(d.checkpointId) && hex(d.controlHash)
    && row._id === d.rootId && d.rootId === hash(company, 'STOCK_BACKUP', d.requestId, d.memberId)
    && hex(d.payloadHash) && count(d.payloadBytes) && d.payloadBytes > 0 && Array.isArray(d.parts) && d.parts.length > 0
    && d.parts.every((ref, index) => keys(ref, 'id hash bytes') && ref.id === partId(d.rootId, d.backupId, index)
      && hex(ref.hash) && count(ref.bytes) && ref.bytes > 0);
  else if (row.action === actions[1]) valid = valid && keys(d, 'format rootId backupId index payload hash')
    && count(d.index) && row._id === partId(d.rootId, d.backupId, d.index) && typeof d.payload === 'string'
    && d.payload.length > 0 && d.hash === hash(d.payload);
  else valid = valid && keys(d, 'format rootId backupId headerHash') && row._id === hash(d.rootId, 'BACKUP_CONFIRMED') && hex(d.headerHash);
  if (!valid) throw Error('Malformed reserved maintenance backup record');
  return true;
}

function decodeBackup(backup, company) {
  if (!keys(backup, 'schema company backupId payload') || backup.schema !== 'STOCK_MAINTENANCE_TYPED_BACKUP_V1'
    || backup.company !== company || backup.backupId !== hash('MAINTENANCE_NATIVE_BACKUP_V1', backup.payload)) throw Error('Exact typed maintenance backup required');
  const raw = decodeMaintenanceNativeImage(backup.payload), [orders, tasks, po] = domainCollections(company);
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const names = [orders, tasks, journal, po, 'SharedSuppliers', 'StockPositions', 'StockClaims', 'StockProducts'];
  if (!keys(raw, 'company control tables') || raw.company !== company || !keys(raw.tables, names.join(' '))
    || !same(encodeMaintenanceNativeImage(raw), backup.payload)) throw Error('Complete canonical native backup required');
  for (const name of names) {
    const rows = raw.tables[name];
    if (!Array.isArray(rows) || new Set(rows.map(row => row?._id)).size !== rows.length
      || rows.some(row => typeof row?._id !== 'string' || !row._id || Object.hasOwn(row, '_version')
        || (name === po || name.startsWith('Stock') ? row.company !== company
          : name !== 'SharedSuppliers' && Object.hasOwn(row, 'company') && row.company !== company)
        || name === journal && isMaintenanceBackupRecord(row, company))) throw Error('Native backup row scope conflict');
  }
  return raw;
}

// Existing company journal read/insert capability ONLY. No updates, deletes,
// locks, mode/generation transition, new collection, or inventory authority.
// A real private-retention verifier is mandatory before the first storage read;
// this module never assumes the existing journal has a suitable native ACL.
function createMaintenanceBackupStore({ company, store, authenticateAdmin, verifyPrivateRetention, verifyLegacyDrain,
  readControl, readSnapshot, policy }) {
  if (!['NCT', 'GHR'].includes(company) || ['read', 'insert'].some(method => typeof store?.[method] !== 'function')
    || [authenticateAdmin, verifyPrivateRetention, verifyLegacyDrain, readControl, readSnapshot].some(fn => typeof fn !== 'function')
    || !policy || ['recordBudgetBytes', 'maxBackupBytes', 'maxFragments', 'partsPerInvocation'].some(key => !count(policy[key]) || !policy[key])
    || policy.recordBudgetBytes < 2048 || policy.recordBudgetBytes > 256000) throw Error('Explicit private backup storage dependencies/policies required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', bytes = row => utf8Bytes(JSON.stringify(row));
  function input(request) {
    if (!keys(request, 'requestId') || !uuid(request.requestId)) throw Error('Original backup request required');
  }
  async function authorize(memberId) {
    const admin = await authenticateAdmin();
    if (admin?.isAdmin !== true || typeof admin.memberId !== 'string' || !admin.memberId || memberId && memberId !== admin.memberId) throw Error('Administrator backup retention required');
    if (await verifyPrivateRetention({ company, collection: journal }) !== true) throw Error('Private native backup retention is not verified');
    return admin.memberId;
  }
  async function maintenance(control) {
    const actual = await readControl();
    if (actual?._id !== hash(company, 'STOCK_CONTROL') || actual.company !== company || actual.mode !== 'MAINTENANCE'
      || actual.schemaVersion !== 1 || actual.transferIndexVersion !== 2 || !actual._version || actual.pending !== null
      || !count(actual.generation) || control && !same(actual, control)) throw Error('Unchanged maintenance backup control required');
    if (await verifyLegacyDrain({ company, purpose: 'MAINTENANCE_BACKUP' }) !== true) throw Error('Legacy request drain is not verified');
    return actual;
  }
  function build(snapshot, requestId, memberId) {
    if (snapshot?.company !== company || snapshot.complete !== true || !hex(snapshot.expected?.checkpointId)) throw Error('Complete server-owned backup capture required');
    const raw = decodeBackup(snapshot.backup, company);
    if (!same(raw.control, snapshot.control)) throw Error('Original backup control image required');
    const rootId = hash(company, 'STOCK_BACKUP', requestId, memberId), backupId = snapshot.backup.backupId;
    const payload = JSON.stringify(snapshot.backup), parts = [];
    if (utf8Bytes(payload) > policy.maxBackupBytes) throw Error('Backup payload byte policy exceeded');
    let offset = 0;
    while (offset < payload.length) {
      if (parts.length >= policy.maxFragments) throw Error('Backup fragment policy exceeded');
      const index = parts.length, wrap = text => ({ _id: partId(rootId, backupId, index), company, action: actions[1],
        details: { format: FORMAT, rootId, backupId, index, payload: text, hash: hash(text) } });
      let low = 1, high = Math.min(payload.length - offset, policy.recordBudgetBytes), size = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (bytes(wrap(payload.slice(offset, offset + mid))) <= policy.recordBudgetBytes) { size = mid; low = mid + 1; } else high = mid - 1;
      }
      if (size && /[\uD800-\uDBFF]/.test(payload[offset + size - 1]) && /[\uDC00-\uDFFF]/.test(payload[offset + size] || '')) size--;
      if (!size) throw Error('Backup fragment metadata exceeds policy');
      parts.push(wrap(payload.slice(offset, offset + size))); offset += size;
    }
    const header = { _id: rootId, company, action: actions[0], details: { format: FORMAT, rootId, requestId, memberId,
      checkpointId: snapshot.expected.checkpointId, backupId, payloadHash: hash(payload), payloadBytes: utf8Bytes(payload), controlHash: fingerprint(snapshot.control),
      parts: parts.map(row => ({ id: row._id, hash: row.details.hash, bytes: utf8Bytes(row.details.payload) })) } };
    if (bytes(header) > policy.recordBudgetBytes) throw Error('Backup header exceeds record policy');
    return { header, parts };
  }
  async function exact(id) {
    const row = await store.read(journal, id);
    if (row !== null && (!isMaintenanceBackupRecord(row, company) || row._id !== id || bytes(row) > policy.recordBudgetBytes)) throw Error('Backup exact storage identity conflict');
    return row;
  }
  async function retainRecord(row, current) {
    if (current !== null && !same(current, row)) throw Error('Backup occupied identity conflict');
    if (current === null) await store.insert(journal, row);
    // Unknown replies propagate: do NOT catch/retry or publish a confirmation.
    if (!same(await exact(row._id), row)) throw Error('Backup storage readback differs');
  }
  async function inspectOwned(requestId, memberId, header) {
    const rootId = hash(company, 'STOCK_BACKUP', requestId, memberId);
    header = header || await exact(rootId);
    if (!header || header.action !== actions[0] || header.details.memberId !== memberId || header.details.requestId !== requestId
      || header.details.parts.length > policy.maxFragments || header.details.payloadBytes > policy.maxBackupBytes) throw Error('Original bounded backup header required');
    const confirmation = { _id: hash(rootId, 'BACKUP_CONFIRMED'), company, action: actions[2],
      details: { format: FORMAT, rootId, backupId: header.details.backupId, headerHash: fingerprint(header) } };
    if (!same(await exact(confirmation._id), confirmation)) throw Error('Backup confirmation is not complete');
    const pieces = []; let total = 0;
    for (const [index, ref] of header.details.parts.entries()) {
      const row = await exact(ref.id);
      if (row?.action !== actions[1] || row.details.rootId !== rootId || row.details.backupId !== header.details.backupId
        || row.details.index !== index || row.details.hash !== ref.hash || utf8Bytes(row.details.payload) !== ref.bytes) throw Error('Backup fragment readback is incomplete');
      total += ref.bytes; if (total > policy.maxBackupBytes) throw Error('Backup payload byte policy exceeded');
      pieces.push(row.details.payload);
    }
    const payload = pieces.join('');
    if (total !== header.details.payloadBytes || hash(payload) !== header.details.payloadHash) throw Error('Backup payload integrity conflict');
    const backup = JSON.parse(payload), raw = decodeBackup(backup, company);
    if (backup.backupId !== header.details.backupId || fingerprint(raw.control) !== header.details.controlHash || JSON.stringify(backup) !== payload) throw Error('Backup identity changed');
    await authorize(memberId);
    return { company, requestId, retainedBy: memberId, checkpointId: header.details.checkpointId, backupId: backup.backupId, backup, raw,
      durableBackupConfirmed: true, activationReady: false };
  }
  async function inspect(request) {
    input(request); const memberId = await authorize();
    return inspectOwned(request.requestId, memberId);
  }
  async function retain(request) {
    input(request); const memberId = await authorize(), rootId = hash(company, 'STOCK_BACKUP', request.requestId, memberId);
    const prior = await exact(rootId), complete = await exact(hash(rootId, 'BACKUP_CONFIRMED'));
    if (complete) return inspectOwned(request.requestId, memberId, prior);
    const control = await maintenance(), snapshot = await readSnapshot();
    if (!same(snapshot?.control, control)) throw Error('Backup capture changed maintenance control');
    const { header, parts } = build(snapshot, request.requestId, memberId);
    await authorize(memberId); await maintenance(control);
    await retainRecord(header, prior);
    let inserted = 0;
    for (const row of parts) {
      const current = await exact(row._id);
      if (current === null && inserted >= policy.partsPerInvocation) return { company, requestId: request.requestId,
        checkpointId: header.details.checkpointId, backupId: header.details.backupId, pending: true, durableBackupConfirmed: false };
      await authorize(memberId); await maintenance(control);
      await retainRecord(row, current); if (current === null) inserted++;
    }
    await authorize(memberId); await maintenance(control);
    const confirmation = { _id: hash(rootId, 'BACKUP_CONFIRMED'), company, action: actions[2],
      details: { format: FORMAT, rootId, backupId: header.details.backupId, headerHash: fingerprint(header) } };
    await retainRecord(confirmation, null);
    return inspectOwned(request.requestId, memberId, header);
  }
  function metadataReader(request) {
    input(request); const originalRequest = copy(request);
    return async entry => {
      if (!keys(entry, 'company checkpointId ordinal') || entry.company !== company || !hex(entry.checkpointId) || !count(entry.ordinal)) throw Error('Original retained metadata ordinal required');
      const retained = await inspect(originalRequest);
      if (retained.checkpointId !== entry.checkpointId) throw Error('Retained metadata checkpoint differs');
      const rows = domainCollections(company).flatMap(collection => retained.raw.tables[collection]
        .filter(row => !Object.hasOwn(row, 'stockCommitVersion')).map(row => ({ collection, row })));
      const selected = rows[entry.ordinal];
      if (!selected || Object.prototype.toString.call(selected.row._updatedDate) !== '[object Date]'
        || !Number.isFinite(selected.row._updatedDate.getTime()) || selected.row.stockOperationProtocol != null) throw Error('Typed retained metadata row required');
      return { ...selected, checkpointId: entry.checkpointId, ordinal: entry.ordinal };
    };
  }
  return { retain, inspect, metadataReader };
}

// Server-only composition with the existing migration.capture seam. The only
// permitted change since the retained pre-initialization snapshot is the exact
// existing metadata initializer token/company/native update timestamp. A durable
// flag from the browser or an unrelated old backup cannot authorize migration.
function createRetainedMaintenanceCapture({ company, backupStore, readSnapshot, backupRequest }) {
  if (!['NCT', 'GHR'].includes(company) || typeof backupStore?.inspect !== 'function' || typeof readSnapshot !== 'function'
    || !keys(backupRequest, 'requestId') || !uuid(backupRequest.requestId)) throw Error('Original retained migration capture dependencies required');
  const originalRequest = copy(backupRequest), domain = new Set(domainCollections(company));
  const withoutMetadata = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['company', 'stockCommitVersion', '_updatedDate'].includes(key)));
  return async request => {
    if (!keys(request, 'company checkpointId') || request.company !== company || !hex(request.checkpointId)) throw Error('Original migration capture identity required');
    const retained = await backupStore.inspect(originalRequest), fresh = await readSnapshot();
    if (retained?.company !== company || retained.durableBackupConfirmed !== true || !retained.retainedBy
      || fresh?.company !== company || fresh.complete !== true || fresh.expected?.checkpointId !== request.checkpointId
      || fresh.emptyCurrentConfirmed !== true || !same(fresh.control, retained.raw?.control)) throw Error('Fresh migration capture and original durable backup required');
    const actual = decodeBackup(fresh.backup, company), original = decodeBackup(retained.backup, company);
    for (const collection of Object.keys(original.tables)) {
      const before = original.tables[collection], after = actual.tables[collection], map = new Map(after.map(row => [row._id, row]));
      if (before.length !== after.length) throw Error('Retained migration cohort changed');
      for (const row of before) {
        const current = map.get(row._id);
        if (!current) throw Error('Retained migration cohort changed');
        if (!domain.has(collection) || Object.hasOwn(row, 'stockCommitVersion')) {
          if (!same(encodeMaintenanceNativeImage(row), encodeMaintenanceNativeImage(current))) throw Error('Retained migration business image changed');
        } else if (current.company !== company || current.stockCommitVersion !== hash('STOCK_METADATA_V2', company, retained.checkpointId, collection, row._id)
          || Object.prototype.toString.call(current._updatedDate) !== '[object Date]' || !Number.isFinite(current._updatedDate.getTime())
          || !same(encodeMaintenanceNativeImage(withoutMetadata(row)), encodeMaintenanceNativeImage(withoutMetadata(current)))) {
          throw Error('Exact retained metadata initialization required; business fields unchanged');
        }
      }
    }
    // Reauthorize the same retained owner after the new complete snapshot. A
    // second administrator's unrelated receipt cannot be substituted in between.
    const after = await backupStore.inspect(originalRequest);
    if (after.retainedBy !== retained.retainedBy || after.backupId !== retained.backupId || after.checkpointId !== retained.checkpointId) throw Error('Retained backup authority changed');
    return { ...fresh, durableBackupConfirmed: true, backupIdentity: { requestId: originalRequest.requestId,
      backupId: retained.backupId, checkpointId: retained.checkpointId, retainedBy: retained.retainedBy } };
  };
}
module.exports = { createMaintenanceBackupStore, isMaintenanceBackupRecord, createRetainedMaintenanceCapture };
