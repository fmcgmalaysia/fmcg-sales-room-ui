const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const day = 86_400_000;
const start = Date.parse('2026-11-13T00:00:00Z');
const warehouse = { company: 'NCT', department: 'WAREHOUSE', staffId: 'WH', taskId: 'AVATA-001-DESK-1' };
const support = { ...warehouse, department: 'SUPPORT', staffId: 'SP' };
const thread = 'NCT/AVATA-001-DESK-1/SUPPORT:WAREHOUSE';
const idFor = parts => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const order = (a, b) => a.at - b.at || a.id.localeCompare(b.id);

function fixture({ cmsMs = 0, driveMs = 0 } = {}) {
  const hot = new Map(), cold = new Map(), receipts = new Map(), archivedRequests = new Map();
  const reads = { cms: 0, drive: 0 };
  let now = start, driveAvailable = true;
  const pause = ms => ms ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
  function authorized(actor) {
    assert.equal(actor.company, warehouse.company, 'Company is not authorized');
    assert.equal(actor.taskId, warehouse.taskId, 'Task is not authorized');
    assert.ok(['WAREHOUSE', 'SUPPORT'].includes(actor.department), 'Department is not authorized');
  }

  async function send(actor, requestId, body, requiresAck = false, loseResponse = false) {
    authorized(actor);
    const id = idFor([thread, actor.staffId, requestId]);
    const existing = hot.get(id);
    if (existing) {
      assert.equal(existing.body, body, 'Request already used');
      assert.equal(existing.requiresAck, requiresAck, 'Request already used');
      return { id, at: existing.at };
    }
    const requestDigest = idFor([body, requiresAck]);
    const archived = archivedRequests.get(id);
    if (archived) {
      assert.equal(archived.requestDigest, requestDigest, 'Request already used');
      return { id, at: archived.at };
    }
    const message = { id, at: now++, body, from: actor.department, requiresAck };
    hot.set(id, message); // Models a unique insert, not a Wix read-then-update.
    if (loseResponse) throw Error('Response lost after commit');
    return { id, at: message.at };
  }

  function receipt(actor, id, kind) {
    authorized(actor);
    const message = hot.get(id) || cold.get(id);
    assert.ok(message && message.from !== actor.department, 'Receipt is not authorized');
    assert.ok(kind === 'READ' || (kind === 'ACK' && message.requiresAck), 'Invalid receipt');
    const key = idFor([thread, id, actor.staffId, kind]);
    if (!receipts.has(key)) receipts.set(key, { staffId: actor.staffId, messageId: id, kind });
    return receipts.get(key);
  }

  function archive({ failAt, limit = 20 } = {}) {
    const prefix = [...hot.values()].sort(order);
    const pending = prefix.findIndex(message => message.at > now - 30 * day ||
      message.requiresAck && ![...receipts.values()].some(r => r.messageId === message.id && r.kind === 'ACK'));
    const batch = prefix.slice(0, Math.min(limit, pending < 0 ? prefix.length : pending));
    for (const message of batch) {
      const saved = cold.get(message.id);
      if (saved) assert.deepEqual(saved, message);
      else cold.set(message.id, structuredClone(message));
    }
    if (failAt === 'copy') throw Error('Interrupted after archive copy');
    for (const message of batch) assert.deepEqual(cold.get(message.id), message);
    if (failAt === 'verify') throw Error('Interrupted after archive verification');
    for (const [i, message] of batch.entries()) {
      archivedRequests.set(message.id, { at: message.at, requestDigest: idFor([message.body, message.requiresAck]) });
      hot.delete(message.id);
      if (i === 0 && failAt === 'cleanup') throw Error('Interrupted during CMS cleanup');
    }
    return batch.length;
  }

  async function page(actor, cursor = null, { includeArchive = false, limit = 20, betweenReads } = {}) {
    authorized(actor);
    const eligible = message => !cursor || order(message, cursor) < 0;
    const latest = rows => rows.filter(eligible).sort((a, b) => order(b, a)).slice(0, limit);
    reads.cms++;
    await pause(cmsMs);
    const recent = latest([...hot.values()]);
    let messages = recent;
    if (includeArchive && recent.length < limit) {
      if (betweenReads) betweenReads();
      reads.drive++;
      await pause(driveMs);
      if (!driveAvailable) throw Error('History temporarily unavailable');
      const archived = latest([...cold.values()].filter(m => archivedRequests.has(m.id)));
      messages = latest([...new Map([...archived, ...recent].map(m => [m.id, m])).values()]);
    }
    return { messages, before: messages.at(-1) || cursor, earlier: messages.length === limit ||
      !includeArchive && (archivedRequests.size > 0 || recent.length > 0) };
  }

  return { send, receipt, archive, page, reads, hot, cold, receipts, archivedRequests, setDrive: value => driveAvailable = value, advance: ms => now += ms };
}

test('Warehouse and Support see the same 20 recent messages with zero Drive calls', async () => {
  const f = fixture();
  for (let i = 0; i < 25; i++) await f.send(i % 2 ? warehouse : support, 'send-' + i, 'Message ' + i);
  f.setDrive(false);
  const [w, s] = await Promise.all([f.page(warehouse), f.page(support)]);
  assert.deepEqual(w, s);
  assert.equal(w.messages.length, 20);
  assert.equal(w.messages[0].body, 'Message 24');
  assert.deepEqual(f.reads, { cms: 2, drive: 0 });
});

test('lost response and concurrent retries return one identity; different input is rejected', async () => {
  const f = fixture();
  await assert.rejects(f.send(support, 'original', 'Keep this', true, true), /Response lost/);
  const saved = await Promise.all([f.send(support, 'original', 'Keep this', true), f.send(support, 'original', 'Keep this', true)]);
  assert.deepEqual(saved[0], saved[1]);
  assert.equal(f.hot.size, 1);
  await assert.rejects(f.send(support, 'original', 'Changed', true), /already used/);
  f.advance(31 * day);
  assert.equal(f.archive(), 0);
  assert.equal(f.receipt(warehouse, saved[0].id, 'READ').kind, 'READ');
  assert.equal(f.archive(), 0);
  f.receipt(warehouse, saved[0].id, 'ACK');
  assert.equal(f.archive(), 1);
  f.setDrive(false);
  assert.deepEqual(await f.send(support, 'original', 'Keep this', true), saved[0]);
  await assert.rejects(f.send(support, 'original', 'Changed', true), /already used/);
  assert.equal(f.archivedRequests.size, 1);
  assert.equal(f.hot.size, 0);
  assert.equal(f.receipts.size, 2);
});

test('receipts on archived messages remain personal and repeat safely', async () => {
  const f = fixture(), message = await f.send(warehouse, 'original', 'Old note');
  f.advance(31 * day);
  assert.equal(f.archive(), 1);
  const secondSupport = { ...support, staffId: 'SP2' };
  assert.equal(f.receipt(support, message.id, 'READ'), f.receipt(support, message.id, 'READ'));
  assert.notEqual(f.receipt(secondSupport, message.id, 'READ'), f.receipt(support, message.id, 'READ'));
  assert.throws(() => f.receipt(warehouse, message.id, 'READ'), /not authorized/);
  assert.equal(f.receipts.size, 2);
});

for (const failAt of ['copy', 'verify', 'cleanup']) {
  test('archive retry preserves every message after interruption at ' + failAt, async () => {
    const f = fixture();
    for (let i = 0; i < 26; i++) await f.send(support, 'old-' + i, 'Old ' + i);
    f.advance(31 * day);
    for (let i = 0; i < 7; i++) await f.send(warehouse, 'new-' + i, 'New ' + i);
    assert.throws(() => f.archive({ failAt }), /Interrupted/);
    const all = [], actor = warehouse;
    let cursor = null;
    do {
      const page = await f.page(actor, cursor, { includeArchive: true, limit: 10 });
      all.push(...page.messages);
      cursor = page.earlier ? page.before : null;
    } while (cursor);
    assert.equal(all.length, 33);
    assert.equal(new Set(all.map(m => m.id)).size, 33);
    assert.equal(all[0].body, 'New 6');
    assert.equal(all.at(-1).body, 'Old 0');
    while (f.archive()) {}
    assert.equal(f.hot.size, 7);
    assert.equal(f.cold.size, 26);
  });
}

test('cross-boundary pagination survives cleanup between its CMS and archive reads', async () => {
  const f = fixture();
  for (let i = 0; i < 6; i++) await f.send(warehouse, 'old-' + i, 'Old ' + i);
  f.advance(31 * day);
  await f.send(support, 'new', 'New');
  const first = await f.page(warehouse, null, { limit: 3 });
  assert.deepEqual(first.messages.map(m => m.body), ['New', 'Old 5', 'Old 4']);
  const next = await f.page(warehouse, first.before, { includeArchive: true, limit: 5, betweenReads: () => f.archive() });
  assert.deepEqual(next.messages.map(m => m.body), ['Old 3', 'Old 2', 'Old 1', 'Old 0']);
  assert.equal(f.reads.drive, 1);
});

test('conflicting archived content never replaces the CMS original on a history read', async () => {
  const f = fixture();
  const message = await f.send(support, 'original', 'Original body');
  f.advance(31 * day);
  assert.throws(() => f.archive({ failAt: 'copy' }), /Interrupted/);
  f.cold.get(message.id).body = 'Conflicting copy';
  assert.throws(() => f.archive(), /deep-equal/);
  assert.equal(f.hot.get(message.id).body, 'Original body');
  assert.equal(f.archivedRequests.has(message.id), false);
  assert.equal((await f.page(warehouse, null, { includeArchive: true })).messages[0].body, 'Original body');
});

test('older history can fail independently while current messages remain readable', async () => {
  const f = fixture();
  await f.send(warehouse, 'old', 'Old');
  f.advance(31 * day); f.archive();
  await f.send(support, 'new', 'New');
  f.setDrive(false);
  const first = await f.page(warehouse);
  assert.equal(first.messages[0].body, 'New');
  await assert.rejects(f.page(warehouse, first.before, { includeArchive: true }), /temporarily unavailable/);
  f.setDrive(true);
  assert.equal((await f.page(warehouse, first.before, { includeArchive: true })).messages[0].body, 'Old');
});

test('archive-only conversations expose earlier history without waiting for Drive', async () => {
  const f = fixture();
  await f.send(support, 'original', 'Archived conversation');
  f.advance(31 * day);
  assert.equal(f.archive(), 1);
  f.setDrive(false);
  const initial = await f.page(warehouse);
  assert.deepEqual(initial.messages, []);
  assert.equal(initial.earlier, true);
  assert.equal(f.reads.drive, 0);
  f.setDrive(true);
  const history = await f.page(warehouse, initial.before, { includeArchive: true });
  assert.equal(history.messages[0].body, 'Archived conversation');
});

test('company, task and department boundaries apply to reads, writes and receipts', async () => {
  const f = fixture(), message = await f.send(warehouse, 'original', 'Private');
  for (const actor of [{ ...support, company: 'GHR' }, { ...support, taskId: 'OTHER' }, { ...support, department: 'ACCOUNT' }]) {
    await assert.rejects(f.page(actor, null, { includeArchive: true }), /not authorized/);
    await assert.rejects(f.send(actor, 'other', 'Private'), /not authorized/);
    assert.throws(() => f.receipt(actor, message.id, 'READ'), /not authorized/);
  }
  assert.deepEqual(f.reads, { cms: 0, drive: 0 });
});

test('30 days is a minimum and archive batches are bounded', async () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) await f.send(support, 'note-' + i, 'note');
  f.advance(29 * day);
  assert.equal(f.archive(), 0);
  f.advance(day);
  assert.equal(f.archive({ limit: 3 }), 3);
  assert.equal(f.hot.size, 5);
});

test('injected latency demonstrates the first-open call path, not real Wix speed', async t => {
  const f = fixture({ cmsMs: 20, driveMs: 160 });
  await f.send(warehouse, 'old', 'Old');
  f.advance(31 * day); f.archive();
  await f.send(support, 'new', 'New');
  let begin = performance.now();
  const first = await f.page(warehouse);
  const recentMs = Math.round(performance.now() - begin);
  begin = performance.now();
  await f.page(warehouse, first.before, { includeArchive: true });
  const archiveMs = Math.round(performance.now() - begin);
  assert.deepEqual(f.reads, { cms: 2, drive: 1 });
  t.diagnostic(JSON.stringify({ injectedCmsMs: 20, injectedDriveMs: 160, recentMs, archiveMs }));
});
