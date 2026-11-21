const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const hashes = require('./production-assets.json');

const pages = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/';
const entries = Object.entries(hashes);
const batchSize = 8;

async function restoreAssets(destination) {
  assert.equal(entries.length, 118);
  await fs.mkdir(destination);
  for (let offset = 0; offset < entries.length; offset += batchSize) {
    await Promise.all(entries.slice(offset, offset + batchSize).map(async ([name, expectedHash]) => {
      assert.match(name, /^[a-z0-9_-][a-z0-9_.-]*(?:\/[a-z0-9_-][a-z0-9_.-]*)*$/i);
      const response = await fetch(new URL(name, pages), {
        redirect: 'error',
        signal: AbortSignal.timeout(30_000)
      });
      assert.ok(response.ok, `${name} returned HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, `${name} differs from the archived production bytes`);
      const file = path.join(destination, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: 'wx' });
    }));
  }
  console.log(`Verified and restored all ${entries.length} archived production assets.`);
}

assert.ok(process.argv[2], 'Provide a new output directory.');
restoreAssets(path.resolve(process.argv[2])).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
