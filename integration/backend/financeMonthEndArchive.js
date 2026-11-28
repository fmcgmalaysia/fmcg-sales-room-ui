import { Buffer } from 'buffer';
import { operationId } from 'backend/purchaseOperationJournal.js';

const chunkBytes = 200000;

export function createFinanceMonthEndArchive({get, insert}) {
  const key = (company, asOf) => operationId('FINANCE_MONTH_END_ORIGINAL', company, asOf);
  async function insertOnce(row) {
    try { return await insert(row); }
    catch (error) {
      const prior = await get(row._id);
      if (!prior) throw error;
      return prior;
    }
  }
  async function read(company, asOf) {
    const receipt = await get(key(company, asOf));
    if (!receipt) return null;
    const {digest, chunks} = receipt.details ?? {};
    if (receipt.company !== company || receipt.asOf !== asOf || !/^[a-f0-9]{32}$/.test(digest ?? '')
        || !Number.isSafeInteger(chunks) || chunks < 1) throw Error('Saved closing balance requires review.');
    const buffers = [];
    for (let index = 0; index < chunks; index += 8) {
      const batch = await Promise.all(Array.from({length:Math.min(8,chunks-index)}, (_, offset) =>
        get(operationId(receipt._id, digest, index + offset))));
      for (const row of batch) {
        if (row?.company !== company || row.asOf !== asOf || typeof row.details?.payload !== 'string')
          throw Error('Saved closing balance requires review.');
        buffers.push(Buffer.from(row.details.payload, 'base64'));
      }
    }
    const json = Buffer.concat(buffers).toString('utf8');
    if (operationId(json) !== digest) throw Error('Saved closing balance requires review.');
    return JSON.parse(json);
  }
  async function insertOriginal(report) {
    const {company, asOf} = report;
    const prior = await read(company, asOf);
    if (prior) return prior;
    const id = key(company, asOf);
    const json = JSON.stringify(report), digest = operationId(json), bytes = Buffer.from(json, 'utf8');
    let chunks = 0;
    for (let start = 0; start < bytes.length; start += chunkBytes) {
      const payload = bytes.subarray(start, start + chunkBytes).toString('base64');
      const chunk = await insertOnce({_id:operationId(id,digest,chunks++), title:asOf, company, asOf, details:{payload}});
      if (chunk.company !== company || chunk.asOf !== asOf || chunk.details?.payload !== payload)
        throw Error('Saved closing balance requires review.');
    }
    // A report becomes visible only when every piece is present and this marker exists.
    await insertOnce({_id:id,title:asOf,company,asOf,details:{digest,chunks}});
    return read(company, asOf);
  }
  return {read,insertOriginal};
}
