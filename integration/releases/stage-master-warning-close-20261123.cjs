const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const knownProduction = require('./master-warning-close-production-20261123.json');

const pages = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/';
const root = path.resolve(__dirname, '../..');
const version = '-20261123-warning-close';
const newFiles = [
  ['purchase-live/index.html', 'purchase-live/app.js'],
  ['support-room/workroom.html', 'support-room/workroom.js'],
  ['warehouse-room/index.html', 'warehouse-room/app.js'],
  ['account-room/index.html', 'account-room/payment-layout.js']
].flat().concat('master-shared/dismiss-page-warning.js')
  .map(name => name.replace(/\.(js|html)$/, `${version}.$1`));

async function stage(destination) {
  const entries = Object.entries(knownProduction);
  assert.equal(entries.length, 127);
  assert.equal(newFiles.some(name => Object.hasOwn(knownProduction, name)), false);
  await fs.mkdir(destination);
  for (let offset = 0; offset < entries.length; offset += 10) {
    await Promise.all(entries.slice(offset, offset + 10).map(async ([name, digest]) => {
      assert.match(name, /^[a-z0-9_-][a-z0-9_.-]*(?:\/[a-z0-9_-][a-z0-9_.-]*)*$/i);
      const response = await fetch(new URL(name, pages), {redirect:'error', signal:AbortSignal.timeout(25000)});
      assert(response.ok, `${name}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, `${name} differs from the verified live version`);
      const file = path.join(destination, name);
      await fs.mkdir(path.dirname(file), {recursive:true});
      await fs.writeFile(file, bytes, {flag:'wx'});
    }));
  }
  await Promise.all(newFiles.map(name => fs.copyFile(path.join(root, name), path.join(destination, name))));
  console.log(`Preserved ${entries.length} verified assets and added ${newFiles.length} versioned warning assets.`);
}

assert(process.argv[2], 'Provide a new output directory.');
stage(path.resolve(process.argv[2])).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
