import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const readFixture = (name, repositoryPath) => readFile(new URL(name, import.meta.url), 'utf8')
  .catch(() => readFile(new URL(repositoryPath, import.meta.url), 'utf8'));
const source = await readFixture('media-candidate.js', '../../backend/buyerSelectionDownload.js');
let quote = 1.25, quoteVersion = 'v1', files = [], uploads = 0, signings = 0, trashCalls = 0;
let failSigning = false, privateResult = true;
const wixData = {
  query(name) {
    const chain = { eq() { return chain; }, hasSome() { return chain; }, limit() { return chain; },
      async find() {
        const items = name === 'WixCustomers' ? [{ preferredCurrency: 'SGD', customerStatus: 'ACTIVE' }]
          : name === 'WixBuyerListItems' ? [{ payload: JSON.stringify({ customerId: 'CUS-TEST', productId: 'p1', barcode: '0123456789012', quoteStatus: 'VIEW QUOTE', vipCurrency: 'SGD', vipPriceEa: quote, quoteSyncedAt: quoteVersion }) }]
          : [{ _id: 'p1', barcode: '0123456789012', name: 'TEST', description: '100G x 24', ea: 24, m3Ctn: 0.0123 }];
        return { items, hasNext: () => false };
      } };
    return chain;
  }
};
const mediaManager = {
  async listFolders(filter) { return filter ? [{ folderName: 'CUS-TEST', folderId: 'customer' }] : [{ folderName: 'buyer-selection-exports', folderId: 'exports' }]; },
  async listFiles() { return files.map(file => ({ ...file })); },
  async upload(path, bytes, name, options) {
    assert.equal(path, '/buyer-selection-exports/CUS-TEST');
    assert.equal(options.metadataOptions.isPrivate, true);
    const file = { fileUrl: 'wix:document://v1/file-' + ++uploads, originalFileName: name, isPrivate: true, parentFolderId: 'customer' };
    files.push(file); return file;
  },
  async getFileInfo(url) { return { ...files.find(file => file.fileUrl === url), isPrivate: privateResult }; },
  async getDownloadUrl(url, minutes, name, redirect) {
    assert.equal(minutes, 10); assert.equal(redirect, null); assert.ok(name.endsWith('.xlsx'));
    if (failSigning) throw new Error('signing failed');
    return 'https://download-files.wixmp.com/test-' + ++signings;
  },
  async moveFilesToTrash(urls) { trashCalls++; files = files.filter(file => !urls.includes(file.fileUrl)); }
};
const code = source.replace(/^import .*;\r?\n/gm, '').replace(/export async function /g, 'async function ');
const api = new Function('wixData', 'mediaManager', 'buildBuyerSelectionExcel', 'createHash', code + '\nreturn { createBuyerSelectionMediaDownload };')(
  wixData, mediaManager, data => Buffer.from(JSON.stringify(data)), createHash);
const call = () => api.createBuyerSelectionMediaDownload('CUS-TEST', 'https://example.test/buyer-room');
const first = await call();
assert.equal(first.reused, false); assert.equal(uploads, 1);
for (let n = 0; n < 100; n++) { const next = await call(); assert.equal(next.reused, true); assert.notEqual(next.url, first.url); }
assert.equal(uploads, 1); assert.equal(files.length, 1);
quote = 1.5; quoteVersion = 'v2';
const changed = await call();
assert.notEqual(changed.versionKey, first.versionKey); assert.equal(uploads, 2); assert.equal(files.length, 1);
const priorTrash = trashCalls;
quote = 2; quoteVersion = 'v3'; failSigning = true;
await assert.rejects(call(), /signing failed/); assert.equal(trashCalls, priorTrash); assert.equal(files.length, 2);
failSigning = false; privateResult = false;
await assert.rejects(call(), /must remain private/); assert.equal(trashCalls, priorTrash);

const backend = await readFixture('backend-candidate.js', '../../backend/catalogueAuth.web.js');
const handler = backend.match(/export const createBuyerSelectionDownload = ([\s\S]*?\n\}\);)/)[1];
let mediaCalled = false;
const gated = new Function('webMethod', 'Permissions', 'resolveBuyerContext', 'createBuyerSelectionMediaDownload', 'return ' + handler)(
  (permission, fn) => { assert.equal(permission, 'member'); return fn; }, { SiteMember: 'member' },
  async () => { throw new Error('not authorized'); }, () => { mediaCalled = true; });
await assert.rejects(() => gated('other-customer'), /not authorized/); assert.equal(mediaCalled, false);
const before = await readFixture('catalogueAuth-before.js', '../verified-native-wix-fixed-file-download-20261006/catalogueAuth-unchanged.web.js');
assert.equal(backend.slice(backend.indexOf('export const createBuyerOrderDownload')).replace(/\r\n/g, '\n').trimEnd(), before.slice(before.indexOf('export const createBuyerOrderDownload')).replace(/\r\n/g, '\n').trimEnd());
console.log('PASS: private upload, 100 refreshes reuse one file, fresh signed URLs, changed quote replaces version, failed signing retains previous file, public-file rejection, authorization precedes media access, order backend unchanged.');
