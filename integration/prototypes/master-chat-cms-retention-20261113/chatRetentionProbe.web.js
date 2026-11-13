import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

// Admin-only storage check for the empty independent Wix site.
// The collection does not exist on MASTER. All data below is synthetic.
const collection = 'ChatRetentionQA';
const id = 'chat-retention-qa-storage-v1';
const options = { consistentRead: true };

export const checkQaChatStorage = webMethod(Permissions.Admin, async () => {
  const fixture = { _id: id, title: 'Synthetic Warehouse and Support conversation' };
  const attempts = await Promise.allSettled([
    wixData.insert(collection, fixture),
    wixData.insert(collection, fixture),
  ]);
  const started = Date.now();
  const { items } = await wixData.query(collection).eq('_id', id).limit(2).find(options);
  if (items.length !== 1 || items[0].title !== fixture.title) throw Error('QA fixture mismatch');
  return {
    insertsAccepted: attempts.filter(attempt => attempt.status === 'fulfilled').length,
    matchingRows: items.length,
    cmsQueryMs: Date.now() - started,
  };
});
