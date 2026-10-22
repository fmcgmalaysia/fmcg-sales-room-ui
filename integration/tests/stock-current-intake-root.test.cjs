const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const load = require('./load-master-module.cjs');
const { createNctIntake, createNctReceiptReader } = load('nctIntake.js');
const { createCurrentOrderIntakeOperations } = require('../prototypes/stock-current-state/current-order-intake.cjs');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { planCollections } = require('../prototypes/stock-current-state/domain-scope.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const folder = path.join(__dirname, '../prototypes/stock-current-state'), copy = value => JSON.parse(JSON.stringify(value));
const body = company => ({ sourceSiteId: '5292b63a-30e5-4c0e-8762-a1b127bbc651', destination: company, orderId: 'ORDER',
  customerId: 'C', customerCompanyName: 'Customer', submissionId: company + '-ORDER', submittedByStaffId: 'S', submittedByStaffName: 'Original Sales',
  submittedAt: '2026-10-22T03:00:00.000Z', transactionCurrency: 'USD', fxRate: 4.3, estimatedShipmentDate: '2026-11-12',
  lines: [{ sourceLineId: 'L', unitBarcode: '00123', itemName: 'Item', packingSize: '12x1', eaPerCtn: 12, qtyCtn: 100, sellingPricePc: 2 }] });
async function fixture({ company = 'NCT', steps = 20, coverage = true, generated = false } = {}) {
  const rows = new Map(), reads = [], writes = []; let captures = 0, failTask = false, loseAccepted = false, attempt = 0, sdk = 0;
  const read = async (c, id) => { reads.push([c, id]); return copy(rows.get(c + '/' + id) || null); };
  const store = { read, insert: async (c, row) => {
    if (failTask && c === (company === 'NCT' ? 'NCTTasks' : 'NCTTasks1')) { failTask = false; throw Error('Interrupted task'); }
    if (rows.has(c + '/' + row._id)) throw Error('Duplicate'); rows.set(c + '/' + row._id, copy(row)); writes.push([c, copy(row)]);
    if (loseAccepted && row.action === 'ORDER_RECEIVED') { loseAccepted = false; throw Error('Lost accepted reply'); }
    return copy(row);
  }, compareAndSet: async (c, id, version, row) => {
    if (rows.get(c + '/' + id)?._version !== version) throw Error('Conditional conflict');
    rows.set(c + '/' + id, copy(row)); writes.push([c, copy(row)]); return copy(row);
  }, compareAndRemove: async (c, id, attempt) => {
    if (rows.get(c + '/' + id)?.attempt !== attempt) throw Error('Wrong owner'); rows.delete(c + '/' + id);
  } };
  const protocol = createSegmentedFencedProof({ company, store, domainWrites: true, stepsPerInvocation: steps, newAttempt: () => 'A' + ++attempt });
  await protocol.initialize();
  Object.assign(rows.get(protocol.ids.journal + '/' + protocol.ids.controlId), { mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST' });
  const captureCosts = async barcodes => { captures++; return Object.fromEntries(barcodes.map(unitBarcode => [unitBarcode, {
    unitBarcode, capturedAt: '2026-10-22T03:00:01.000Z', costCurrency: 'MYR', costStatus: 'CAPTURED', costIssues: [],
    lpPc: 1, lpCtn: 12, disc1: 0, disc2: 0, disc3: 0, netCostCtn: 12, cbmPerCtn: 0.1 }])); };
  let api = createCurrentOrderIntakeOperations;
  if (generated) {
    const source = fs.readFileSync(path.join(folder, 'stockCurrentCommands.js'), 'utf8');
    api = vm.runInNewContext(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';createCurrentOrderIntakeOperations;',
      { createHash: crypto.createHash, randomBytes: crypto.randomBytes, StockRuntimeBuffer: Buffer });
  }
  let native = fs.readFileSync(path.join(folder, 'stockCurrentOrderIntake.js'), 'utf8');
  if (coverage) native = native.replace('const writerCoverage = Object.freeze({});',
    'const writerCoverage = Object.freeze(' + JSON.stringify(Object.fromEntries(WRITERS.map(writer => [writer, { verified: true, build: 'TEST' }]))) + ');');
  const createCurrentOrderIntake = vm.runInNewContext(native.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';createCurrentOrderIntake;', {
    items: {}, fulfilmentStore: { read: async (c, id) => {
      const row = await read(c, id); return row ? { ...row, ...(row._version ? { stockCommitVersion: row._version } : {}) } : null;
    } }, operationId: hash, createNctIntake, createNctReceiptReader, createCurrentOrderIntakeOperations: api, planCollections,
    createSegmentedFencedProof: () => protocol,
    createSdkConditionalStore: config => {
      sdk++; assert.equal(config.company, company);
      assert.deepEqual(copy(config.dateTimeFields), { [protocol.ids.journal]: ['activityTime'],
        [company === 'NCT' ? 'NCTOrders' : 'NCTOrders1']: ['estimatedShipmentDate', 'masterReceivedTime', 'salesSubmissionTime'],
        [company === 'NCT' ? 'NCTTasks' : 'NCTTasks1']: ['lastCostCaptureTime'] }); return store;
    }
  });
  const receiver = fs.readFileSync(path.join(folder, 'nctReceiver.candidate.js'), 'utf8');
  const create = vm.runInNewContext(receiver.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';createNctReceiver;',
    { Buffer, timingSafeEqual: crypto.timingSafeEqual, createNctIntake, createNctReceiptReader, createCurrentOrderIntake });
  const handle = create({ store, getIntakeSecret: async () => 'SYNTHETIC-LOCAL-ONLY', captureCosts });
  const send = (input, authorized = true) => handle({ headers: { Authorization: 'Bearer ' + (authorized ? 'SYNTHETIC-LOCAL-ONLY' : 'WRONG') }, body: { json: async () => copy(input) } });
  async function finish(input = body(company)) {
    for (let i = 0; i < 300; i++) {
      const response = await send(input); assert.equal(response.status, 200, response.body.error);
      if (response.body.ok === true) return copy(response.body);
      assert.deepEqual(copy(response.body), { ok: false, pending: true, orderId: input.orderId, destination: company });
    }
    throw Error('Intake did not finish');
  }
  return { send, finish, rows, store, reads, writes, protocol, control: () => rows.get(protocol.ids.journal + '/' + protocol.ids.controlId),
    captures: () => captures, sdk: () => sdk, failTask: () => failTask = true, loseAccepted: () => loseAccepted = true };
}

test('generated original receiver/private root retain bearer auth before control, costs or SDK work', async () => {
  assert.match(execFileSync(process.execPath, [path.join(folder, 'build-current-intake.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const f = await fixture(), before = JSON.stringify(f.reads);
  assert.equal((await f.send(body('NCT'), false)).status, 401);
  assert.equal(JSON.stringify(f.reads), before); assert.equal(f.captures(), 0); assert.equal(f.sdk(), 0);
  assert.equal((await f.send({ ...body('NCT'), destination: 'OTHER' })).status, 503);
  assert.equal(f.captures(), 0); assert.equal(f.rows.size, 1);
});

test('native composition/default empty coverage and closed modes refuse all business writes, not legacy fallback', async () => {
  const f = await fixture({ coverage: false }); const before = JSON.stringify([...f.rows]);
  assert.equal((await f.send(body('NCT'))).status, 503); assert.equal(f.captures(), 0);
  assert.equal(JSON.stringify([...f.rows]), before);
  for (const mode of ['MAINTENANCE', 'SHADOW']) { f.control().mode = mode; assert.equal((await f.send(body('NCT'))).status, 503); }
  assert.equal(f.rows.size, 1);
  f.control().mode = 'LEGACY'; const receipt = await f.send(body('NCT'));
  assert.equal(receipt.body.ok, true); assert.equal(f.captures(), 1); assert.equal(f.rows.size, 6);
  assert.equal([...f.rows.values()].some(row => row.stockCounterSchema === 2), false);
});

test('NCT/GHR exact reads preserve original receipt/PO fields, typed-field schema and zero product checkpoint only', async () => {
  for (const company of ['NCT', 'GHR']) {
    const f = await fixture({ company, generated: true }), receipt = await f.finish();
    assert.equal(receipt.destination, company); assert.equal(receipt.taskIds.length, 1); assert.equal(f.captures(), 1);
    const taskCollection = company === 'NCT' ? 'NCTTasks' : 'NCTTasks1';
    const task = await f.store.read(taskCollection, receipt.taskIds[0]);
    assert.equal(task.stockCounterSchema, 2); assert.equal(task.stockDispatchedCumulative, 0); assert.equal(task.stockCounterGeneration, 1);
    assert.equal(task.purchaseQtyInCtn, 100); assert.equal(task.ourPoNumber, ''); assert.equal(task.receivedQtyInCtn, null);
    const product = [...f.rows.entries()].find(([key]) => key.startsWith('StockProducts/'))[1];
    assert.deepEqual([product.onHand, product.reservedUsable, product.available, product.status], [0, 0, 0, 'CLOSED']);
    assert.equal([...f.rows.keys()].some(key => /^(StockPositions|StockClaims|PurchaseOrders)\//.test(key)), false);
    assert.equal(f.control().generation, 1); assert.equal(f.control().pending, null);
    const otherTasks = company === 'NCT' ? 'NCTTasks1/' : 'NCTTasks/';
    assert.equal(f.reads.some(([c]) => c + '/' === otherTasks), false);
  }
});

test('bounded pending and read-only lookup never acknowledge partially applied original accepted marker', async () => {
  const f = await fixture({ steps: 2 }), input = body('NCT');
  const first = await f.send(input); assert.equal(first.body.pending, true); assert.equal(f.captures(), 1);
  const pending = JSON.stringify([...f.rows]);
  assert.equal((await f.send({ action: 'READ_RECEIPT', submission: input })).status, 503);
  assert.equal(JSON.stringify([...f.rows]), pending);
  assert.equal((await f.send({ ...input, lines: [{ ...input.lines[0], qtyCtn: 200 }] })).status, 503);
  assert.equal(JSON.stringify([...f.rows]), pending);
  f.loseAccepted(); const receipt = await f.finish(input);
  assert.equal(receipt.ok, true); assert.equal(f.captures(), 1); assert.equal(f.control().generation, 1);
  assert.equal([...f.rows.values()].filter(row => row.action === 'ORDER_RECEIVED').length, 1);
});

test('interrupted task resumes original frozen costs once and accepted replay preserves manually edited procurement rows', async () => {
  const f = await fixture({ steps: 100 }), input = body('NCT'); f.failTask();
  assert.equal((await f.send(input)).status, 503); assert.ok(f.control().pending);
  assert.equal([...f.rows.values()].some(row => row.action === 'ORDER_RECEIVED'), false);
  const receipt = await f.finish(input), task = f.rows.get('NCTTasks/' + receipt.taskIds[0]);
  task.lpCtn = 88; task.ourPoNumber = 'KEEP-PO'; task.supplierId = 'KEEP'; task.rowPosition = 90;
  const before = JSON.stringify([...f.rows]);
  assert.deepEqual(await f.finish(input), receipt); assert.equal(JSON.stringify([...f.rows]), before); assert.equal(f.captures(), 1);
  assert.equal((await f.send({ ...input, fxRate: 99 })).status, 503); assert.equal(JSON.stringify([...f.rows]), before);
  assert.deepEqual(copy((await f.send({ action: 'READ_RECEIPT', submission: input })).body), receipt);
});

test('existing original accepted receipt replays read-only after migration without fabricating task versions or another stock commit', async () => {
  const f = await fixture(), input = body('NCT');
  const original = await createNctIntake({ store: f.store, captureCosts: async () => ({}) })(input);
  const before = JSON.stringify([...f.rows]); assert.deepEqual(await f.finish(input), copy(original));
  assert.equal(JSON.stringify([...f.rows]), before); assert.equal(f.control().generation, 0); assert.equal(f.captures(), 0);
});

test('opposite preparation and malformed original request refuse before cost capture; segmented100lines are not silently truncated', async () => {
  const f = await fixture(), input = body('NCT');
  for (const invalid of [{ fxRate: 0 }, { estimatedShipmentDate: '2026-02-30' }, { sourceSiteId: 'OTHER' }]) {
    assert.equal((await f.send({ ...input, ...invalid })).status, 503); assert.equal(f.captures(), 0);
  }
  const id = hash(input.sourceSiteId, input.orderId, 'PREPARED');
  f.rows.set('NCTActivity1/' + id, { _id: id, company: 'GHR' });
  assert.equal((await f.send(input)).status, 503); assert.equal(f.captures(), 0); f.rows.delete('NCTActivity1/' + id);
  input.lines = Array.from({ length: 100 }, (_, i) => ({ ...input.lines[0], sourceLineId: 'L' + i }));
  const receipt = await f.finish(input); assert.equal(receipt.taskIds.length, 100); assert.equal(new Set(receipt.taskIds).size, 100);
  assert.equal([...f.rows.keys()].filter(key => key.startsWith('NCTTasks/')).length, 100); assert.equal(f.captures(), 1);
});

test('original Source immutable lock retains original company through pending/lost response and current final receipt', async () => {
  const { createNctSubmissionDelivery } = await require('./load-nct-delivery.cjs')();
  for (const company of ['NCT', 'GHR']) {
    const f = await fixture({ company, steps: 2 }); let held = null, sourceReceipt = null, delivered = 0, lost = false;
    const sourceOrder = { orderId: 'ORDER', customerId: 'C', companyName: 'Customer', currency: 'USD', status: 'CONFIRMED', isComplete: true, confirmedBy: 'BUYER' };
    const submit = createNctSubmissionDelivery({ store: {
      readOrder: async () => ({ data: { ...sourceOrder, ...(sourceReceipt ? { destination: company, masterReceipt: sourceReceipt, nctSubmissionBody: held?.preparedBody } : {}) } }),
      readLock: async () => copy(held), insertLock: async (_, proposal) => { if (held) throw Error('Held'); held = copy(proposal); return copy(held); },
      savePrepared: async (_, proposal) => { held = copy(proposal); }, releaseOwnLock: async () => {},
      writeAcceptedAuditOnce: async () => {}, saveTransferred: async (_, input, receipt) => { sourceReceipt = copy(receipt); }
    }, loadSnapshot: async () => ({ currentAdminRate: { currency: 'USD', active: true, rateToMyr: 4.3 }, history: [],
      lines: [{ lineId: 'L', orderId: 'ORDER', customerId: 'C', barcode: '00123', itemName: 'Item', packingSize: '12x1', eaPerCtn: 12, lockedUnitPriceEa: 2, quantityCtn: 100, currency: 'USD' }] }),
    deliver: async input => { delivered++; const result = await f.send(input); if (result.body.ok === true && !lost) { lost = true; throw Error('Lost final reply'); } return result.body; },
    lookupReceipt: async input => { const response = await f.send({ action: 'READ_RECEIPT', submission: input }); if (response.status !== 200) throw Error('Still pending'); return response.body; } });
    const args = { orderId: 'ORDER', destination: company, staff: { staffId: 'S', staffName: 'Sales' }, authorizeCustomer: async id => assert.equal(id, 'C') };
    await assert.rejects(submit(args)); assert.equal(held.preparedBody.destination, company); assert.equal(sourceReceipt, null);
    const calls = delivered;
    await assert.rejects(submit({ ...args, destination: company === 'NCT' ? 'GHR' : 'NCT' }), /Prepared submission identity conflict/);
    assert.equal(delivered, calls);
    for (let i = 0; i < 50 && !lost; i++) { try { await submit(args); } catch (_) {} }
    assert.equal(lost, true); assert.equal(sourceReceipt, null);
    const receipt = await submit({ ...args, reconcileOnly: true });
    assert.equal(receipt.ok, true); assert.equal(sourceReceipt.destination, company); assert.equal(f.captures(), 1);
    assert.equal([...f.rows.values()].filter(row => row.action === 'ORDER_RECEIVED').length, 1);
  }
});

test('generated intake uses the actual conditional SDK adapter and explicit DateTime codec without changing original nested snapshots', async () => {
  const { createSdkConditionalStore } = require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
  const native = new Map(), conditions = [];
  const items = {
    query: collection => { let id; return { eq: (_, value) => { id = value; return { limit: () => ({ find: async () => ({ items: native.has(collection + '/' + id) ? [structuredClone(native.get(collection + '/' + id))] : [] }) }) }; } }; },
    insert: async (collection, row) => { const key = collection + '/' + row._id; if (native.has(key)) throw Error('Duplicate'); native.set(key, structuredClone(row)); return structuredClone(row); },
    patch: (collection, id) => {
      const fields = {}, removed = [], patch = { setField: (key, value) => { fields[key] = value; return patch; },
        removeField: key => { removed.push(key); return patch; }, run: async ({ condition }) => {
          conditions.push(condition); const key = collection + '/' + id, row = native.get(key);
          if (!row || row.company !== condition.company.$eq || row.stockCommitVersion !== condition.stockCommitVersion.$eq) throw Error('Conditional conflict');
          const after = { ...row, ...structuredClone(fields) }; for (const field of removed) delete after[field];
          native.set(key, after); return structuredClone(after);
        } }; return patch;
    },
    remove: async (collection, id, { condition }) => {
      const key = collection + '/' + id, row = native.get(key);
      if (row?.company !== condition.company.$eq || row?.attempt !== condition.attempt.$eq) throw Error('Wrong attempt'); native.delete(key); return row;
    }
  };
  const store = createSdkConditionalStore({ company: 'NCT', items, collections: planCollections('NCT', true), dateTimeFields: {
    NCTActivity: ['activityTime'], NCTOrders: ['estimatedShipmentDate', 'masterReceivedTime', 'salesSubmissionTime'], NCTTasks: ['lastCostCaptureTime'] } });
  const protocol = createSegmentedFencedProof({ company: 'NCT', store, domainWrites: true }); await protocol.initialize();
  const before = await protocol.readControl();
  await store.compareAndSet('NCTActivity', before._id, before._version, { ...before, _version: 'ACTIVE-V1', mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST' });
  const runtimeSource = fs.readFileSync(path.join(folder, 'stockCurrentCommands.js'), 'utf8');
  const create = vm.runInNewContext(runtimeSource.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';createCurrentOrderIntakeOperations;',
    { createHash: crypto.createHash, randomBytes: crypto.randomBytes, StockRuntimeBuffer: Buffer });
  const input = body('NCT'); input.sourceSnapshot = { arbitraryIsoLookingText: '2026-10-22T03:00:00.000Z' };
  const operations = create({ company: 'NCT', store, protocol, createNctIntake, createNctReceiptReader,
    coverage: Object.fromEntries(WRITERS.map(writer => [writer, { verified: true, build: 'TEST' }])),
    readOppositePreparation: async () => null, captureCosts: async () => ({}), now: () => new Date('2026-10-22T03:00:01.000Z') });
  const receipt = await operations.receive(input); assert.equal(receipt.ok, true);
  const order = [...native.entries()].find(([key]) => key.startsWith('NCTOrders/'))[1];
  assert.equal(Object.prototype.toString.call(order.estimatedShipmentDate), '[object Date]');
  assert.equal(Object.prototype.toString.call(order.masterReceivedTime), '[object Date]');
  assert.equal(Object.prototype.toString.call(order.salesSubmissionTime), '[object Date]');
  const prepared = [...native.values()].find(row => row.action === 'INTAKE_PREPARED');
  assert.equal(Object.prototype.toString.call(prepared.activityTime), '[object Date]');
  assert.deepEqual(prepared.details.sourceSnapshot, input); assert.equal(typeof prepared.details.sourceSnapshot.submittedAt, 'string');
  const state = JSON.stringify([...native]); assert.deepEqual(copy(await operations.receive(input)), copy(receipt));
  assert.equal(JSON.stringify([...native]), state); assert.ok(conditions.every(condition => condition.company.$eq === 'NCT'));
  assert.equal((await protocol.readControl()).generation, 1);
});
