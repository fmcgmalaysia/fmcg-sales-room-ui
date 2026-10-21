// Isolated administrator contract test. Uses only the retained synthetic fixture.
import wixData from 'wix-data';
import { items, Filter } from '@wix/data';
import { webMethod, Permissions } from 'wix-web-module';

export const verifyStockSdkCondition = webMethod(Permissions.Admin, async () => {
  const collection = 'StockProtocolTest', id = 'SPT-bc37b68f-c353-4d82-849a-3c67a34619aa';
  const read = async () => {
    const row = await wixData.get(collection, id, { suppressAuth: true, consistentRead: true });
    if (row.company !== 'NCT' || row.title !== 'Conditional protocol test') throw Error('Unexpected test fixture.');
    return { quantity: row.quantity, stockVersion: row.stockVersion };
  };
  const before = await read();
  if (before.quantity !== 20 || before.stockVersion !== 'V0') throw Error('Fixture already used; do not reset or replay.');
  const trace = [];
  async function attempt(label, version, quantity, nextVersion) {
    let ok = false, error = null;
    try {
      await items.patch(collection, id).setField('quantity', quantity).setField('stockVersion', nextVersion)
        .run({ condition: Filter('stockVersion').eq(version) });
      ok = true;
    } catch (e) { error = String(e.message || e).slice(0, 800); }
    return { label, ok, error };
  }
  trace.push(await attempt('wrong-version', 'NOT-V0', 999, 'WRONG'));
  const wrong = await read();
  if (wrong.quantity !== 20 || wrong.stockVersion !== 'V0') return { passed: false, stage: 'wrong-version-mutated', trace, actual: wrong };
  trace.push(await attempt('correct-version', 'V0', 19, 'V1'));
  const correct = await read();
  if (!trace[1].ok || correct.quantity !== 19 || correct.stockVersion !== 'V1') return { passed: false, stage: 'correct-version-not-applied', trace, actual: correct };
  trace.push(await attempt('late-old-version', 'V0', 999, 'OLD'));
  const late = await read();
  if (late.quantity !== 19 || late.stockVersion !== 'V1') return { passed: false, stage: 'old-version-overwrite', trace, actual: late };
  const competing = await Promise.all([
    attempt('candidate-A', 'V1', 18, 'V2-A'), attempt('candidate-B', 'V1', 17, 'V2-B')
  ]);
  trace.push(...competing);
  const actual = await read();
  const matchedWinner = actual.quantity === 18 && actual.stockVersion === 'V2-A'
    || actual.quantity === 17 && actual.stockVersion === 'V2-B';
  return { passed: matchedWinner && competing.filter(row => row.ok).length === 1,
    stage: 'conditional-update-only', id, before, actual, trace,
    limitation: 'No actual timeout/cancellation guarantee or conditional-delete positive test is proved. Fixture retained.' };
});
