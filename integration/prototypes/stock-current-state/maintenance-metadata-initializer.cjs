'use strict';

const { hash } = require('./commit-proof.cjs');
const own = (row, field) => Object.prototype.hasOwnProperty.call(row, field);
const nativeDate = value => Object.prototype.toString.call(value) === '[object Date]' && Number.isFinite(value.getTime());
const typed = value => {
  if (nativeDate(value)) return ['date', value.toISOString()];
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return [typeof value, value];
  if (Array.isArray(value)) return ['array', value.map(typed)];
  if (value && Object.prototype.toString.call(value) === '[object Object]') return ['object', Object.keys(value).sort().map(key => [key, typed(value[key])])];
  throw Error('Unsupported native migration value');
};
const image = value => JSON.stringify(typed(value));
const business = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['_updatedDate', 'company', 'stockCommitVersion'].includes(key)));

// Private one-record step. It never scans, deletes, changes business fields, or
// treats timestamps as a substitute for proof that old writers have stopped.
// The server checkpoint owns collection/ID/images; browser input is only ordinal.
function createMaintenanceMetadataInitializer({ company, items, authenticateAdmin, verifyLegacyDrain, readControl, readCapturedRow }) {
  if (!['NCT', 'GHR'].includes(company) || ['query', 'patch'].some(method => typeof items?.[method] !== 'function')
    || [authenticateAdmin, verifyLegacyDrain, readControl, readCapturedRow].some(fn => typeof fn !== 'function')) throw Error('Private metadata initialization dependencies required');
  // Existing journal history is immutable and already supported by the current
  // readers. It is deliberately excluded from blanket metadata initialization.
  const allowed = new Set(company === 'NCT' ? ['NCTTasks', 'NCTOrders', 'PurchaseOrders'] : ['NCTTasks1', 'NCTOrders1', 'PurchaseOrders']);
  async function step(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'checkpointId,ordinal' || !/^[a-f0-9]{32}$/.test(input.checkpointId || '')
      || !Number.isSafeInteger(input.ordinal) || input.ordinal < 0) throw Error('Captured migration row ordinal required');
    const admin = await authenticateAdmin();
    if (admin?.isAdmin !== true || !admin.memberId) throw Error('Administrator metadata initialization required');
    const requireMaintenance = async () => {
      const control = await readControl();
      if (control?._id !== hash(company, 'STOCK_CONTROL') || control.company !== company || control.mode !== 'MAINTENANCE'
        || control.schemaVersion !== 1 || !control._version || control.pending !== null) throw Error('Unchanged maintenance metadata control required');
      if (await verifyLegacyDrain({ company, checkpointId: input.checkpointId }) !== true) throw Error('Legacy request drain is not verified');
      return image(control);
    };
    const controlImage = await requireMaintenance(), captured = await readCapturedRow({ company, ...input });
    const collection = captured?.collection, before = captured?.row;
    if (!allowed.has(collection) || captured.checkpointId !== input.checkpointId || captured.ordinal !== input.ordinal
      || typeof before?._id !== 'string' || !before._id || !nativeDate(before._updatedDate)
      || own(before, 'stockCommitVersion') || own(before, '_version') || own(before, 'company') && before.company !== company
      || before.stockOperationProtocol != null) throw Error('Exact unversioned captured business row required');
    image(before);
    const read = async () => {
      const page = await items.query(collection).eq('_id', before._id).limit(2).find({ consistentRead: true, returnTotalCount: true });
      if (!Array.isArray(page?.items) || page.totalCount !== 1 || page.items.length !== 1 || page.items[0]?._id !== before._id) throw Error('Complete exact metadata read required');
      image(page.items[0]); return page.items[0];
    };
    const version = hash('STOCK_METADATA_V2', company, input.checkpointId, collection, before._id);
    const afterMatches = row => row.company === company && row.stockCommitVersion === version && nativeDate(row._updatedDate)
      && image(business(row)) === image(business(before));
    const current = await read();
    if (afterMatches(current)) return { ok: true, initialized: false, alreadyConfirmed: true, ordinal: input.ordinal };
    if (image(current) !== image(before)) throw Error('Captured legacy row changed; no metadata written');
    if (await requireMaintenance() !== controlImage) throw Error('Maintenance control changed before initialization');
    // Date conjunction is the exact installed-SDK primitive already checked in
    // isolation. It is only used after independent old-writer quiescence proof.
    let patch = items.patch(collection, before._id).setField('company', company).setField('stockCommitVersion', version);
    await patch.run({ condition: { company: own(before, 'company') ? { $eq: company } : { $exists: false },
      stockCommitVersion: { $exists: false }, _updatedDate: { $eq: { $date: before._updatedDate.toISOString() } } } });
    // No catch/retry on an unknown result. A later explicit step first inspects
    // the durable exact metadata token; it never overwrites a different version.
    if (!afterMatches(await read())) throw Error('Metadata initialization image unconfirmed');
    if (await requireMaintenance() !== controlImage) throw Error('Maintenance changed; retain initialized row for review');
    return { ok: true, initialized: true, alreadyConfirmed: false, ordinal: input.ordinal };
  }
  return { step };
}
module.exports = { createMaintenanceMetadataInitializer };
