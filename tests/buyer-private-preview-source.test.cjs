const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const page = readFileSync(join(__dirname, '..', 'buyer-room-20261126-protected-images.html'), 'utf8');
const previewSource = page.slice(page.indexOf('function safeSmallPicture('), page.indexOf('function attachSelectionPreview('));
const normalizePreview = runInNewContext(previewSource + '\nsafeSmallPicture', { URL });

test('displays inline JPEGs and both observed Wix private preview formats', () => {
  for (const source of [
    'https://download-files.wix.com/_api/download/file?downloadToken=qa-preview',
    'https://download-files.wixmp.com/media/qa-preview~mv2.jpg?token=qa-preview',
    'data:image/jpeg;base64,/9j/2Q=='
  ]) assert.equal(normalizePreview(source), source);
});

test('a legacy original or a non-preview response never becomes a thumbnail', () => {
  for (const source of [
    'https://static.wixstatic.com/media/test-original.jpg',
    'https://download-files.wix.com/_api/download/file',
    'http://download-files.wix.com/_api/download/file?downloadToken=test',
    'https://download-files.wix.com/media/test-original.jpg?downloadToken=test',
    'https://download-files.wix.com.example.invalid/_api/download/file?downloadToken=test',
    'https://download-files.wixmp.com/media/test-original.jpg',
    'https://download-files.wixmp.com/offsite/qa-preview.jpg?token=test',
    'https://download-files.wixmp.com/media/test-document.pdf?token=test',
    'https://public.wixmp.com/media/test-original.jpg?token=test',
    'data:image/svg+xml;base64,YQ=='
  ]) assert.equal(normalizePreview(source), '');
});
