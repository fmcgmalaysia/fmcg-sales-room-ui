const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createQaArchiveReader } = require('./private-archive-reader.cjs');
const { readSequencePage } = require('./sequence-page.cjs');

const conversation = 'QA-WAREHOUSE-SUPPORT-001';
const archived = [1, 2, 3].map(sequence => ({ sequence, from: 'WAREHOUSE', body: `Synthetic message ${sequence}` }));
const archive = { fixture: 'MASTER_CHAT_RETENTION_QA_V1', conversation, fromSequence: 1, throughSequence: 3, messages: archived };

test('Earlier messages reads only the configured archive and returns the original sequence', async () => {
  const calls = [];
  const readArchived = createQaArchiveReader({
    conversation, fileId: 'configured-private-file',
    readFile: async id => { calls.push(id); return JSON.stringify(archive); },
  });
  const recent = [{ sequence: 4 }, { sequence: 5 }];
  const page = readSequencePage({
    readRecent: async ({ before }) => ({ sequence: 5, archivedThrough: 3, messages: before === null ? recent : [] }),
    readArchived,
  });
  const first = await page();
  assert.deepEqual(first, { messages: recent, beforeSequence: 4 });
  assert.deepEqual(calls, []);
  const earlier = await page(first.beforeSequence);
  assert.deepEqual(earlier, { messages: archived, beforeSequence: null });
  assert.deepEqual(calls, ['configured-private-file']);
});

test('wrong conversation and missing or duplicate archive sequences are rejected', async () => {
  const badArchives = [
    { ...archive, conversation: 'OTHER-CONVERSATION' },
    { ...archive, messages: [archived[0], archived[0], archived[2]] },
    { ...archive, messages: archived.slice(1) },
  ];
  for (const badArchive of badArchives) {
    const readArchived = createQaArchiveReader({
      conversation, fileId: 'configured-private-file', readFile: async () => JSON.stringify(badArchive),
    });
    await assert.rejects(readArchived({ from: 1, through: 3 }), /Unexpected QA archive content/);
  }
});
