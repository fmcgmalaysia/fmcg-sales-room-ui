const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const load = require('./load-master-module.cjs');

const { createMasterQuotationService } = load('masterQuotationService.js');
const { createMasterQuotationRevisionStore } = load('masterQuotationRevisionStore.js');
const scope = { staffId: 'QA-SALES', customer: { customerId: 'QA-A', preferredCurrency: 'USD', rateToMyr: 4 } };
const epoch = '2026-11-20T09:00:00.000Z';
const selectionId = 'SEL-1';

function fixture(onDeliver = pending => ({ ...pending, ok: true })) {
  const selection = { customerId: 'QA-A', id: selectionId, barcode: '9556001315397', ea: 12 };
  const saved = new Map(), sent = [];
  const revisions = createMasterQuotationRevisionStore({
    latest: async () => [...saved.values()].at(-1) ?? null,
    read: async id => saved.get(id) ?? null,
    async insert(row) { assert(!saved.has(row._id)); saved.set(row._id, structuredClone(row)); return row; }
  });
  const service = createMasterQuotationService({
    revisions, readSelections: async () => selection.removed ? [] : [selection],
    readSelection: async () => selection.removed ? null : selection,
    readCurrentCosts: async () => ({ [selection.barcode]: {
      costStatus: 'CAPTURED', unitBarcode: selection.barcode, costCurrency: 'MYR', capturedAt: '2026-11-19T12:00:00.000Z',
      lpPc: 2, lpCtn: 24, eaPerCtn: 12, disc1: 0, disc2: 0, disc3: 0
    } }),
    async deliver(pending) { sent.push(pending); return onDeliver(pending); }
  });
  return { service, selection, sent, saved };
}
const command = (revision, fields = {}) => ({ selectionId, revision, requestId: randomUUID(), ...fields });

test('remove hides a published selection; restore protects against stale draft and publish until a new EA is entered', async () => {
  const { service, selection, sent, saved } = fixture();
  const oldPrice = { mode: 'EA', value: 2 };
  const draft = await service.saveDraft(scope, command(0, { input: oldPrice }));
  const published = await service.publish(scope, command(draft.revision, { enabled: true }));
  assert.equal(sent[0].priceCtn, 24);
  selection.removed = true;
  assert.equal((await service.list(scope)).length, 0);
  await assert.rejects(service.publish(scope, command(published.revision, { enabled: true })), /unavailable/);
  selection.removed = false;
  selection.selectionEpoch = epoch;
  const [restored] = await service.list(scope);
  assert.equal(restored.draft, null);
  assert.equal(restored.published.enabled, false);
  assert.equal(restored.selectionEpoch, epoch);
  assert.equal(restored.costMyr, 24);
  await assert.rejects(service.saveDraft(scope, command(restored.revision, { input: oldPrice })), /restored/);
  await assert.rejects(service.publish(scope, command(restored.revision, { enabled: true })), /restored/);
  await assert.rejects(service.publish(scope, command(restored.revision, { enabled: true, selectionEpoch: epoch })), /Save a draft/);
  const nextDraft = await service.saveDraft(scope, command(restored.revision, { input: { mode: 'EA', value: 3 }, selectionEpoch: epoch }));
  assert.equal((await service.list(scope))[0].draft.priceEa, 3);
  await service.publish(scope, command(nextDraft.revision, { enabled: true, selectionEpoch: epoch }));
  assert.equal(sent[1].priceCtn, 36);
  assert.equal(sent[1].selectionEpoch, epoch);
  assert.equal(sent[1].version, 2);
  assert.equal([...saved.values()][0].snapshot.draft.priceEa, 2, 'Old quote history remains intact');
});

test('a lost receipt from before removal can be reconciled without republishing through the restored selection', async () => {
  let ready = false;
  const { service, selection, sent } = fixture(pending => {
    if (!ready) throw Error('Network delayed the receipt');
    return { ...pending, ok: true, superseded: !pending.selectionEpoch };
  });
  const initial = await service.saveDraft(scope, command(0, { input: { mode: 'EA', value: 2 } }));
  const oldCommand = command(initial.revision, { enabled: true });
  assert.equal((await service.publish(scope, oldCommand)).pending, true);
  selection.selectionEpoch = epoch;
  const [beforeAck] = await service.list(scope);
  assert.equal(beforeAck.pending, true);
  assert.equal(beforeAck.draft, null);
  ready = true;
  await service.publish(scope, oldCommand);
  const [afterAck] = await service.list(scope);
  assert.equal(afterAck.pending, false);
  assert.equal(afterAck.published.enabled, false);
  assert.equal(afterAck.draft, null);
  assert.equal(sent[0].requestId, sent[1].requestId);
  assert.equal(sent[1].selectionEpoch, undefined);
});
