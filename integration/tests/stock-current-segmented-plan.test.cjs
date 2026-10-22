const test = require('node:test'), assert = require('node:assert/strict');
const { createSegmentedPlanCodec, utf8Bytes, copy } = require('../prototypes/stock-current-state/segmented-plan.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const requestId = '11111111-1111-4111-8111-111111111111', memberId = 'M', company = 'NCT';
const key = hash(company + '/PURCHASE', requestId, memberId), digest = hash({ receipt: 300 });
const context = { key, digest, memberId, requestId, baseGeneration: 7, attempt: 'attempt1' };
const writes = (count, text = '巧克力😀\\"\n'.repeat(100)) => Array.from({ length: count }, (_, i) => ({ collection: 'StockPositions', before: null,
  after: { _id: 'S' + i, company, name: text, onHand: 100 } }));
const decode = (codec, encoded) => codec.decode({ ...context, ...encoded });
test('901large exact write images roundtrip; every actual serialized record remains below budget', () => {
  const codec = createSegmentedPlanCodec({ company }), encoded = codec.encode({ ...context, plan: { writes: writes(901) } });
  assert.ok(encoded.manifest.planBytes > 512 * 1024); assert.ok(encoded.fragments.length > 1);
  for (const record of [encoded.manifest, ...encoded.fragments]) {
    assert.ok(Buffer.byteLength(JSON.stringify(record)) <= codec.policy.recordBudgetBytes);
    assert.equal(utf8Bytes(JSON.stringify(record)), Buffer.byteLength(JSON.stringify(record)));
  }
  assert.deepEqual(decode(codec, encoded), encoded.plan);
  assert.equal(encoded.plan.writes[900].after._version, hash(key, 'StockPositions', 'S900'));
});
test('one image exceeding a record budget fragments without changing its JSON or Unicode', () => {
  const codec = createSegmentedPlanCodec({ company, recordBudgetBytes: 4096 });
  const encoded = codec.encode({ ...context, plan: { writes: writes(1, '😀"\\\n\t中文'.repeat(1200)) } });
  assert.ok(encoded.fragments.length > 1); assert.deepEqual(decode(codec, encoded), encoded.plan);
  for (const row of encoded.fragments) assert.ok(Buffer.byteLength(JSON.stringify(row)) <= 4096);
});
test('new staging attempts never reuse fragment IDs; operation/root stays stable', () => {
  const codec = createSegmentedPlanCodec({ company }), plan = { writes: writes(2) };
  const first = codec.encode({ ...context, plan }), next = codec.encode({ ...context, attempt: 'attempt2', plan });
  assert.equal(first.manifest._id, next.manifest._id); assert.equal(first.manifest.planHash, next.manifest.planHash);
  assert.notEqual(first.fragments[0]._id, next.fragments[0]._id);
});
test('missing, reordered, duplicate, changed, cross-company and opposite-attempt fragments fail closed', () => {
  const codec = createSegmentedPlanCodec({ company, recordBudgetBytes: 4096 });
  const original = codec.encode({ ...context, plan: { writes: writes(20) } });
  const mutations = [e => e.fragments.pop(), e => e.fragments.reverse(), e => { e.fragments[1] = e.fragments[0]; },
    e => { e.fragments[0].payload += ' '; }, e => { e.fragments[0].company = 'GHR'; },
    e => { e.fragments[0].attempt = 'other'; }, e => { e.manifest.writeCount++; },
    e => { e.manifest.planHash = 'wrong'; }, e => { e.manifest.fragments[0].bytes++; },
    e => { e.manifest.fragments[0].id = 'wrong'; }, e => { e.manifest.extra = true; },
    e => { e.manifest.baseGeneration = -1; }, e => { e.manifest.memberId = 'other'; }];
  for (const mutate of mutations) { const e = copy(original); mutate(e); assert.throws(() => decode(codec, e)); }
});
test('plan identity, scope, version and JSON guards remain mandatory before staging', () => {
  const codec = createSegmentedPlanCodec({ company });
  const invalid = [writes(1).map(w => ({ ...w, collection: 'StaffMasterAccess' })),
    writes(1).map(w => ({ ...w, after: { ...w.after, company: 'GHR' } })),
    [writes(1)[0], writes(1)[0]],
    writes(1).map(w => ({ ...w, before: { _id: 'other', company, _version: 'old' } })),
    writes(1).map(w => ({ ...w, before: { _id: 'S0', company, _version: hash(key, 'StockPositions', 'S0') } })),
    writes(1).map(w => ({ ...w, after: { ...w.after, onHand: NaN } }))];
  for (const planWrites of invalid) assert.throws(() => codec.encode({ ...context, plan: { writes: planWrites } }));
  for (const id of [key, hash(key, 'RESULT'), codec.ids.lockId, codec.ids.controlId]) {
    assert.throws(() => codec.encode({ ...context, plan: { writes: [{ collection: codec.ids.journal, before: null, after: { _id: id, company } }] } }), /identity/);
  }
  assert.throws(() => codec.encode({ ...context, plan: { writes: [{ collection: codec.ids.journal, before: null,
    after: { _id: 'fake-fragment', company, stockOperationProtocol: 2 } }] } }), /identity/);
});
test('server resource budgets refuse oversized work rather than silently truncate', () => {
  const codec = createSegmentedPlanCodec({ company, maxWrites: 1 });
  assert.throws(() => codec.encode({ ...context, plan: { writes: writes(2) } }), /write policy/);
  const bytes = createSegmentedPlanCodec({ company, maxPlanBytes: 500 });
  assert.throws(() => bytes.encode({ ...context, plan: { writes: writes(1) } }), /byte policy/);
  const fragments = createSegmentedPlanCodec({ company, recordBudgetBytes: 2048, maxFragments: 1 });
  assert.throws(() => fragments.encode({ ...context, plan: { writes: writes(10) } }), /Segment count/);
});
