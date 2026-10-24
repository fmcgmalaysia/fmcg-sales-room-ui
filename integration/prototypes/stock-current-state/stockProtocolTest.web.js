// Isolated administrator diagnostic. No business collection access or stock activation.
import wixData from 'wix-data';
import * as dataV2 from 'wix-data.v2';
import { webMethod, Permissions } from 'wix-web-module';

export const inspectStockProtocol = webMethod(Permissions.Admin, async () => ({
  collection: 'StockProtocolTest',
  legacyPatch: typeof wixData.patch,
  modules: Object.keys(dataV2).sort(),
  itemMethods: dataV2.items ? Object.keys(dataV2.items).sort() : [],
  patchSignature: String(dataV2.items.patchDataItem).slice(-4500),
  removeSignature: String(dataV2.items.removeDataItem).slice(-3500)
}));

// One named synthetic row per explicit run. No retry, cleanup, arbitrary collection or IDs.
export const probeStockCondition = webMethod(Permissions.Admin, async (runId) => {
  if (!/^[a-f0-9-]{36}$/i.test(runId || '')) throw Error('A fresh UUID is required.');
  const collection = 'StockProtocolTest', id = 'SPT-' + runId;
  await wixData.insert(collection, { _id: id, title: 'Conditional protocol test',
    company: 'NCT', stockVersion: 'V0', quantity: 20 }, { suppressAuth: true });
  const read = () => wixData.get(collection, id, { suppressAuth: true, consistentRead: true });
  const modifications = [
    { fieldPath: 'quantity', action: 'SET_FIELD', setFieldOptions: { value: 999 } },
    { fieldPath: 'stockVersion', action: 'SET_FIELD', setFieldOptions: { value: 'SHOULD-NOT-APPLY' } }
  ];
  let response = null, error = null;
  try {
    response = await dataV2.items.patchDataItem(id, { dataCollectionId: collection,
      fieldModifications: modifications,
      condition: { filter: { stockVersion: 'NOT-V0' } } });
  } catch (e) { error = { message: String(e.message || e).slice(0, 1600), code: e.code || null }; }
  const actual = await read();
  return { id, response, error, actual: { quantity: actual.quantity, stockVersion: actual.stockVersion },
    unchanged: actual.quantity === 20 && actual.stockVersion === 'V0',
    note: 'Unchanged alone is not a pass; invalid parameters must be distinguished from condition rejection.' };
});
