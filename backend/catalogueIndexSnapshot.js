import { createHash } from 'crypto';
import { buildCatalogueIndex } from './cataloguePageIndex.js';

const options = { suppressAuth: true, consistentRead: true };
const products = 'FMCGMALAYSIA';
const headId = 'catalogue-index-head-v1';
const partIds = Array.from({ length: 16 }, (_, index) => 'catalogue-index-v1-' + (index + 1));
const maxPartBytes = 128 * 1024;

function pack(entries) {
  const parts = [];
  let rows = [], bytes = 2;
  for (const { id, principle, searchText } of entries) {
    const row = JSON.stringify([id, principle, searchText]);
    const rowBytes = Buffer.byteLength(row);
    if (rowBytes + 2 > maxPartBytes) throw Error('Catalogue index row exceeds its storage limit.');
    if (bytes + rowBytes + 1 > maxPartBytes) {
      parts.push('[' + rows.join(',') + ']');
      rows = [];
      bytes = 2;
    }
    rows.push(row);
    bytes += rowBytes + 1;
  }
  if (rows.length) parts.push('[' + rows.join(',') + ']');
  if (parts.length > partIds.length) throw Error('Catalogue index exceeds its storage limit.');
  return parts;
}

function generationFor(revision, parts) {
  const hash = createHash('sha256').update(revision);
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

export function createCatalogueIndexSnapshot(data, collection) {
  async function sourceRevision() {
    const [latest, count] = await Promise.all([
      data.query(products).descending('_updatedDate', '_id').fields('_id', '_updatedDate').limit(1).find(options),
      data.query(products).eq('pointBaseStatus', 'ACTIVE').count(options)
    ]);
    const item = latest.items[0];
    if (!item && count === 0) return 'empty';
    const updated = new Date(item?._updatedDate).getTime();
    if (!item?._id || !Number.isFinite(updated) || !Number.isSafeInteger(count) || count < 0) {
      throw Error('Catalogue source revision unavailable.');
    }
    return JSON.stringify([updated, item._id, count]);
  }

  async function readRows(stamp, saved) {
    const records = new Map(saved.items.map(item => [item._id, item]));
    const head = records.get(headId);
    if (head?.indexRevision !== stamp || !Number.isInteger(head.indexParts) ||
        head.indexParts < 0 || head.indexParts > partIds.length || !Number.isSafeInteger(head.indexRows) ||
        head.indexRows < 0) return null;
    const parts = [];
    const entries = [];
    const ids = new Set();
    for (const id of partIds.slice(0, head.indexParts)) {
      const part = records.get(id);
      if (part?.indexGeneration !== head.indexGeneration || typeof part.indexPayload !== 'string' ||
          Buffer.byteLength(part.indexPayload) > maxPartBytes) return null;
      parts.push(part.indexPayload);
      const rows = JSON.parse(part.indexPayload);
      if (!Array.isArray(rows)) return null;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 3 || row.some(value => typeof value !== 'string')) return null;
        const [productId, principle, searchText] = row;
        if (!productId || ids.has(productId)) return null;
        ids.add(productId);
        entries.push({ id: productId, principle, searchText });
      }
    }
    return entries.length === head.indexRows && generationFor(stamp, parts) === head.indexGeneration ? entries : null;
  }

  const savedRows = () => data.query(collection).hasSome('_id', [headId, ...partIds]).limit(partIds.length + 1).find(options);

  async function read() {
    try {
      const [stamp, stored] = await Promise.all([sourceRevision(), savedRows()]);
      return await readRows(stamp, stored);
    } catch {
      return null;
    }
  }

  async function refresh() {
    const [revision, stored] = await Promise.all([sourceRevision(), savedRows()]);
    const current = await readRows(revision, stored).catch(() => null);
    if (current) return { status: 'CURRENT', count: current.length };
    const entries = await buildCatalogueIndex(data);
    const parts = pack(entries);
    const generation = generationFor(revision, parts);
    if (await sourceRevision() !== revision) return { status: 'SOURCE_CHANGED', count: 0 };
    if (parts.length) {
      const result = await data.bulkSave(collection, parts.map((indexPayload, index) => ({
        _id: partIds[index], indexGeneration: generation, indexPayload
      })), options);
      if (result.errors?.length) throw Error('Catalogue index shards could not be saved.');
    }
    await data.save(collection, {
      _id: headId, indexRevision: revision, indexGeneration: generation, indexParts: parts.length, indexRows: entries.length
    }, options);
    const verified = await read();
    if (!verified) throw Error('Catalogue index readback failed.');
    return { status: 'BUILT', count: verified.length };
  }

  return { read, refresh };
}
