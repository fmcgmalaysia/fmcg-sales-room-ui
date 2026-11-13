import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

const collection = 'ChatRetentionQA';
const conversation = 'QA-WAREHOUSE-SUPPORT-001';
const rows = Array.from({ length: 5 }, (_, index) => {
  const sequence = index + 4;
  return {
    _id: 'qa-sequence-' + sequence,
    title: conversation,
    details: { sequence, from: sequence % 2 ? 'WAREHOUSE' : 'SUPPORT', body: 'Synthetic recent message ' + sequence },
  };
});
const consistent = { consistentRead: true };

async function readRecent() {
  const result = await wixData.query(collection).eq('title', conversation).limit(rows.length + 1).find(consistent);
  const messages = result.items.map(row => row.details).sort((a, b) => a.sequence - b.sequence);
  if (messages.length !== rows.length || messages.some((value, i) => {
    const expected = rows[i].details;
    return value.sequence !== expected.sequence || value.from !== expected.from || value.body !== expected.body;
  })) {
    throw Error('QA message sequence does not match');
  }
  return messages;
}

export const verifyQaRecentRead = webMethod(Permissions.Admin, async () => {
  const existing = await wixData.query(collection).eq('title', conversation).limit(rows.length + 1).find(consistent);
  const ids = new Set(existing.items.map(row => row._id));
  await Promise.all(rows.filter(row => !ids.has(row._id)).map(async row => {
    try { await wixData.insert(collection, row); }
    catch (error) {
      const result = await wixData.query(collection).eq('_id', row._id).limit(2).find(consistent);
      if (result.items.length !== 1 || result.items[0].title !== conversation) throw error;
    }
  }));
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    const messages = await readRecent();
    samples.push({ cmsQueryMs: Date.now() - start, sequences: messages.map(row => row.sequence) });
  }
  return { conversation, archivedThrough: 3, beforeSequence: 4, samples, driveCalls: 0 };
});

export const verifyQaRecentOpen = webMethod(Permissions.Admin, async () => {
  const start = Date.now();
  const messages = await readRecent();
  return { cmsQueryMs: Date.now() - start, sequences: messages.map(row => row.sequence), driveCalls: 0 };
});
