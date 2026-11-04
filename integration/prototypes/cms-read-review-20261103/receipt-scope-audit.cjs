// Offline only. Read a pre-existing private CMS export; never connect to Wix.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const load = require('../../tests/load-master-module.cjs');
const { readWarehouseReceipts, RECEIPT_ACTION } = load('warehouseReceiving.js');
const { purchaseReceiptInfo } = load('purchaseReceiptInfo.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));

function decode(rows) {
  return rows.map(row => ({
    _id: row.ID, title: row['Activity ID'], description: row['Order ID'],
    image: row['Source Line ID'], imageAltText: row['Task ID'], action: row.Action,
    result: row.Result, activityTime: row['Activity Time'],
    initiatedByStaffName: row['Initiated By Staff Name'],
    details: row.Details ? JSON.parse(row.Details) : null
  }));
}
const scoped = (activity, poId) => activity.filter(event =>
  event.action === RECEIPT_ACTION && event.result === 'SAVED' && event.description === poId);

function receipt(id, previous, before, after, task = 'TASK-A', kind = 'DELIVERY') {
  return { title: id, description: 'PO-A', action: RECEIPT_ACTION, result: 'SAVED',
    activityTime: '2026-11-04T00:00:00Z', initiatedByStaffName: 'TEST',
    details: { beforeRevision: previous, lines: [{ taskId: task, orderId: 'ORDER-A',
      sourceLineId: 'LINE-A', beforeAccepted: before, beforeRejected: 0,
      accepted: after, rejected: 0, kind, reason: kind === 'CORRECTION' ? 'Recount' : '' }] } };
}

function run(snapshotPath) {
  const raw = fs.readFileSync(snapshotPath);
  const rows = JSON.parse(raw);
  assert.ok(Array.isArray(rows) && rows.length, 'An existing CMS export is required.');
  const activity = decode(rows), before = JSON.stringify(activity), groups = [];
  const check = (name, fn) => { fn(); groups.push(name); };
  const poIds = [...new Set(activity.filter(e => e.action === RECEIPT_ACTION && e.result === 'SAVED').map(e => e.description))];
  const receipts = poIds.map((id, index) => {
    const limited = scoped(activity, id);
    const full = readWarehouseReceipts(id, activity), narrow = readWarehouseReceipts(id, limited);
    assert.deepEqual(plain(narrow), plain(full));
    // This task list is derived only for testing the pure history formatter, not PO authorization.
    const po = { id, number: 'REDACTED', taskIds: [...new Set(limited.flatMap(e => e.details.lines.map(l => l.taskId)))] };
    assert.deepEqual(plain([...purchaseReceiptInfo([po], limited)]), plain([...purchaseReceiptInfo([po], activity)]));
    return { sample: index + 1, returnedEvents: limited.length, taskCount: po.taskIds.length,
      lastRevisionDigest: hash(full.revision), resultDigest: hash(JSON.stringify(plain(full))),
      serializedBytes: Buffer.byteLength(JSON.stringify(limited)) };
  });
  check('All receipt PO chains and Purchase receipt details equal the full exported Activity reader', () => assert.ok(receipts.length));
  check('Source snapshot and decoded records are unchanged', () => {
    assert.equal(JSON.stringify(activity), before);
    assert.equal(hash(fs.readFileSync(snapshotPath)), hash(raw));
  });

  const r1 = receipt('R1', '', 0, 170, 'TASK-A', 'PARTIAL');
  const r2 = receipt('R2', 'R1', 170, 200);
  const correction = receipt('R3', 'R2', 200, 190, 'TASK-A', 'CORRECTION');
  check('170 plus 30 and a signed correction retain original interpretation', () => {
    const history = purchaseReceiptInfo([{ id: 'PO-A', number: 'PO-A', taskIds: ['TASK-A'] }], [r1, r2, correction]).get('TASK-A');
    assert.deepEqual(plain(history.map(r => r.received)), [170, 30, -10]);
  });
  check('Missing intermediate receipt still rejects', () => assert.throws(() => readWarehouseReceipts('PO-A', [r2]), /history/));
  check('Conflicting successors still reject', () => assert.throws(() => readWarehouseReceipts('PO-A', [r1, r2, { ...r2, title: 'R2-OTHER' }]), /history/));
  check('Task filtering can lose a shared PO chain event; whole PO chain is required', () => {
    const other = receipt('R2', 'R1', 0, 40, 'TASK-B');
    const third = receipt('R3', 'R2', 170, 200);
    assert.equal(readWarehouseReceipts('PO-A', [r1, other, third]).lines.length, 2);
    assert.throws(() => readWarehouseReceipts('PO-A', [r1, third]), /history/);
  });
  check('Removing the complete tail is NOT detectable by this existing reader', () => {
    assert.equal(readWarehouseReceipts('PO-A', [r1]).lines[0].accepted, 170);
    assert.equal(readWarehouseReceipts('PO-A', [r1, r2]).lines[0].accepted, 200);
  });
  check('No receipts is distinct from proof of zero stock or no pending request', () => {
    assert.deepEqual(plain(readWarehouseReceipts('PO-A', [])), { revision: '', lines: [], history: [] });
    const prepared = { action: 'PURCHASE_OPERATION_PREPARED', description: 'NCT/PURCHASE', details: { plan: { event: r1 } } };
    assert.equal(scoped([prepared], 'PO-A').length, 0);
  });
  check('Company collection isolation is mandatory even with the same PO ID', () => {
    const foreign = receipt('FOREIGN', '', 0, 70);
    assert.equal(readWarehouseReceipts('PO-A', [foreign]).lines[0].accepted, 70);
    assert.throws(() => readWarehouseReceipts('PO-A', [r1, foreign]), /history/);
  });
  const unrelatedGrowth = [0, 1000, 100000].map(count => {
    const others = Array.from({ length: count }, (_, i) => ({ action: RECEIPT_ACTION, result: 'SAVED', description: 'OTHER-' + i }));
    const selected = scoped([r1, r2, ...others], 'PO-A');
    assert.equal(selected.length, 2);
    assert.equal(readWarehouseReceipts('PO-A', selected).lines[0].accepted, 200);
    return { unrelatedEvents: count, returnedEvents: selected.length };
  });
  groups.push('Unrelated row growth does not change modeled scoped return count; not a Wix latency test');
  const populated = field => rows.filter(row => row[field] !== undefined && row[field] !== null && row[field] !== '').length;
  const counts = {};
  for (const row of rows) counts[row.Action || '(missing)'] = (counts[row.Action || '(missing)'] || 0) + 1;
  return {
    status: 'OFFLINE_LEAF_EQUIVALENCE_ONLY_NOT_WORKSPACE_OR_RELEASE_ACCEPTANCE',
    snapshot: { source: 'Existing private native Wix CMS export dated 2026-11-03; not a fresh 2026-11-04 export',
      sha256: hash(raw), rows: rows.length, actionCounts: counts,
      populatedFields: Object.fromEntries(['company', 'status', 'stockKey', 'participantTaskIds', 'replacementSourceId', 'repaidQuantity'].map(f => [f, populated(f)])) },
    receiptPoCount: poIds.length, receiptEventCount: receipts.reduce((n, r) => n + r.returnedEvents, 0),
    receipts, diagnostics: groups, diagnosticCount: groups.length, unrelatedGrowth,
    productionWrites: 0, runtimeEdits: 0,
    limitations: [
      'Array filter models predicate results, not physical Wix index usage, API pagination or query latency.',
      'Existing reader validates returned chains but cannot prove a complete tail was returned.',
      'Entire workspace still needs procurement, intake, allocation, borrowing, quarantine, Loaded and Finance records.',
      'Fixture PO task lists derived from receipt history are not production authorization or membership evidence.',
      'Receipt reader is not a save-status, stock-balance, allocation, financial-lock or authentication reader.',
      'Do not deploy a new receipt endpoint solely for this proof: current workspace already holds the same history.'
    ],
    sourceHashes: Object.fromEntries(['warehouseReceiving.js', 'purchaseReceiptInfo.js'].map(name => [name, hash(fs.readFileSync(path.resolve(__dirname, '../../backend', name)))]))
  };
}
if (require.main === module) {
  if (!process.argv[2] || !process.argv[3]) throw Error('Usage: node receipt-scope-audit.cjs private-snapshot.json aggregate-results.json');
  const result = run(process.argv[2]);
  fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ diagnostics: result.diagnosticCount, rows: result.snapshot.rows,
    receiptPOs: result.receiptPoCount, receiptEvents: result.receiptEventCount, populatedFields: result.snapshot.populatedFields }));
}
module.exports = { run };
