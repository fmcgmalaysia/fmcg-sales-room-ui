const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { readSequencePage, readStableRecent } = require('./sequence-page.cjs');

function fixture(sequence, initialBoundary) {
  const rows = Array.from({ length: sequence }, (_, index) => ({ sequence: index + 1, id: `m-${index + 1}` }));
  const drive = [];
  let boundary = initialBoundary;
  const page = readSequencePage({
    async readRecent({ before, limit }) {
      const newest = before === null ? sequence : before - 1;
      return { sequence, archivedThrough: boundary, messages: rows.slice(Math.max(boundary, newest - limit), newest) };
    },
    async readArchived({ from, through }) {
      drive.push([from, through]);
      return rows.slice(from - 1, through);
    },
  });
  return { rows, drive, page, archiveThrough: value => { boundary = value; } };
}

test('first open is CMS-only and explicit earlier pages preserve every sequence', async () => {
  const f = fixture(47, 21);
  const first = await f.page();
  assert.deepEqual(first.messages, f.rows.slice(27));
  assert.deepEqual(f.drive, []);
  const second = await f.page(first.beforeSequence);
  const third = await f.page(second.beforeSequence);
  assert.deepEqual([...third.messages, ...second.messages, ...first.messages], f.rows);
  assert.deepEqual(f.drive, [[8, 21], [1, 7]]);
  assert.equal(third.beforeSequence, null);
});

test('short recent page leaves earlier history available without opening Drive', async () => {
  const f = fixture(25, 23);
  const first = await f.page();
  assert.deepEqual(first.messages, f.rows.slice(23));
  assert.equal(first.beforeSequence, 24);
  assert.deepEqual(f.drive, []);
  assert.deepEqual((await f.page(first.beforeSequence)).messages, f.rows.slice(3, 23));
});

test('archive-only and empty conversations have distinct first-open cursors', async () => {
  const f = fixture(7, 7);
  assert.deepEqual(await f.page(), { messages: [], beforeSequence: 8 });
  assert.deepEqual(f.drive, []);
  assert.deepEqual(await f.page(8), { messages: f.rows, beforeSequence: null });
  assert.deepEqual(await fixture(0, 0).page(), { messages: [], beforeSequence: null });
});

test('a cursor stays stable as older messages move to Drive', async () => {
  const f = fixture(32, 3);
  const first = await f.page();
  f.archiveThrough(18);
  const second = await f.page(first.beforeSequence);
  assert.deepEqual([...second.messages, ...first.messages], f.rows);
  assert.deepEqual(f.drive, [[1, 12]]);
});

test('CMS re-reads a page when the archive boundary moves during its first read', async () => {
  let head = { revision: 'a', sequence: 6, archivedThrough: 0 };
  const rangeCalls = [];
  const readRecent = readStableRecent({
    readHead: async () => head,
    readRange: async ({ from, through }) => {
      rangeCalls.push([from, through]);
      head = { revision: 'b', sequence: 6, archivedThrough: 4 };
      return [{ sequence: 5 }, { sequence: 6 }];
    },
  });
  const page = readSequencePage({ readRecent, readArchived: () => assert.fail('Unexpected archive read') });
  assert.deepEqual(await page(), { messages: [{ sequence: 5 }, { sequence: 6 }], beforeSequence: 5 });
  assert.deepEqual(rangeCalls, [[1, 6], [5, 6]]);
});

test('an incomplete or duplicated storage page cannot silently hide a message', async () => {
  const first = readSequencePage({
    readRecent: async () => ({ sequence: 2, archivedThrough: 0, messages: [{ sequence: 1 }, { sequence: 1 }] }),
    readArchived: async () => assert.fail('Unexpected archive read'),
  });
  await assert.rejects(first(), /Incomplete or unordered/);
  const earlier = readSequencePage({
    readRecent: async () => ({ sequence: 2, archivedThrough: 2, messages: [] }),
    readArchived: async () => [{ sequence: 2 }],
  });
  await assert.rejects(earlier(3), /Incomplete or unordered/);
});

test('Drive failure surfaces on explicit history only and the same cursor can retry', async () => {
  let attempts = 0;
  const page = readSequencePage({
    readRecent: async () => ({ sequence: 1, archivedThrough: 1, messages: [] }),
    readArchived: async () => {
      if (++attempts === 1) throw Error('Archive offline');
      return [{ sequence: 1 }];
    },
  });
  const first = await page();
  assert.equal(attempts, 0);
  await assert.rejects(page(first.beforeSequence), /Archive offline/);
  assert.deepEqual(await page(first.beforeSequence), { messages: [{ sequence: 1 }], beforeSequence: null });
});

test('the existing Drive state machine supplies the original IDs and personal receipts across the boundary', async () => {
  const source = readFileSync(join(__dirname, '../../apps-script/purchase-documents/TaskChatState.gs'), 'utf8');
  const context = {};
  runInNewContext(source, context);
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const pages = new Map();
  let head = null;
  const store = {
    head: () => structuredClone(head),
    putHead: (_, value) => { head = structuredClone(value); },
    page: (_, pair, number) => structuredClone(pages.get(`${pair}:${number}`)),
    putPage: (_, pair, number, value) => pages.set(`${pair}:${number}`, structuredClone(value)),
    findMessage: (_, pair, id) => [...pages.values()]
      .filter(page => page.pair === pair).flatMap(page => page.messages).find(message => message.id === id),
  };
  const warehouse = { department: 'WAREHOUSE', memberId: 'wh', staffId: 'wh', staffName: 'Warehouse test' };
  const support = { department: 'SUPPORT', memberId: 'sp', staffId: 'sp', staffName: 'Support test' };
  const run = (actor, input) => context.taskChatRun_(store, {
    company: 'NCT', kind: 'DELIVERY', taskId: 'f'.repeat(32), pair: 'SUPPORT:WAREHOUSE', actor, ...input,
  }, hash, () => '2026-11-13T00:00:00.000Z');
  const requestId = sequence => `cccccccc-cccc-4ccc-8ccc-${String(sequence).padStart(12, '0')}`;
  const sends = [];
  for (let sequence = 1; sequence <= 30; sequence++) {
    const actor = sequence % 2 ? warehouse : support;
    const input = { operation: 'SEND', requestId: requestId(sequence), body: `Message ${sequence}`, requiresAck: true, baseSequence: sequence - 1 };
    sends.push(run(actor, input).message);
    if (sequence === 30) assert.equal(run(actor, input).message.id, sends.at(-1).id);
  }
  run(warehouse, { operation: 'READ', requestId: requestId(31), sequence: 30 });
  run(support, { operation: 'ACK', requestId: requestId(32), sequence: 1, messageId: sends[0].id });
  for (const actor of [warehouse, support]) {
    const recent = [...run(actor, { operation: 'PAGE' }).messages].filter(message => message.sequence > 18);
    let archiveReads = 0;
    const page = readSequencePage({
      readRecent: async ({ before }) => ({ sequence: 30, archivedThrough: 18, messages: before === null ? recent : [] }),
      readArchived: async ({ from, through }) => {
        archiveReads++;
        return [...run(actor, { operation: 'PAGE', beforeSequence: through + 1 }).messages]
          .filter(message => message.sequence >= from);
      },
    });
    const first = await page();
    assert.equal(archiveReads, 0);
    const earlier = await page(first.beforeSequence);
    assert.equal(archiveReads, 1);
    assert.deepEqual([...earlier.messages, ...first.messages].map(message => message.id), sends.map(message => message.id));
    assert.equal(earlier.messages[0].receipts[0].byStaffId, support.staffId);
    assert.equal(first.messages.at(-1).receipts[0].byStaffId, warehouse.staffId);
  }
});
