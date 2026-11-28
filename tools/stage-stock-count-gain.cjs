const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const baseline = require('./stock-count-gain-pages-base.json');
const root = path.resolve(__dirname, '..');
const publicUrl = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/';
const script = 'master-shared/stock-exceptions-20261128-count-gain.js';
const entries = ['account-room/index.html', 'warehouse-room/index.html'];
const hash = data => createHash('sha256').update(data).digest('hex');
const list = directory => fs.readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter(item => item.isFile()).map(item => path.relative(directory, path.join(item.parentPath, item.name)).replaceAll('\\', '/')).sort();

function verifyLocal(directory, manifest) {
  assert.deepEqual(list(directory), Object.keys(manifest).sort());
  for (const [name, expected] of Object.entries(manifest)) {
    assert.equal(hash(fs.readFileSync(path.join(directory, name))), expected, name);
  }
}

async function verifyPublic(manifest, directory) {
  const assets = Object.entries(manifest);
  const nonce = String(Date.now());
  for (let index = 0; index < assets.length; index += 8) {
    await Promise.all(assets.slice(index, index + 8).map(async ([name, expected]) => {
      const url = new URL(name, publicUrl);
      url.searchParams.set('stockCountVerify', nonce);
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(25000) });
      assert.ok(response.ok, `${name}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(hash(bytes), expected, `Public archive mismatch: ${name}`);
      if (directory) {
        const target = path.join(directory, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes, { flag: 'wx' });
      }
    }));
  }
  console.log(`${assets.length} public assets verified`);
}

function candidateFiles() {
  return Object.fromEntries([...entries, script].map(name => [name,
    Buffer.from(fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n'))]));
}

function stage(directory) {
  verifyLocal(directory, baseline);
  const files = candidateFiles();
  for (const name of entries) {
    const original = fs.readFileSync(path.join(directory, name), 'utf8');
    const reference = 'stock-exceptions.js?v=20261116-stock-receipt-v1';
    assert.equal(original.split(reference).length, 2, name);
    assert.equal(files[name].toString(), original.replace(reference, path.basename(script)), name);
  }
  assert.ok(!baseline[script]);
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), bytes);
  verifyLocal(directory, { ...baseline, ...Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)])) });
  console.log('Two department entry references changed and one stock count script added.');
}

async function main() {
  const [mode, argument] = process.argv.slice(2);
  if (mode === 'verify-base') return verifyPublic(baseline);
  if (mode === 'verify-release') {
    return verifyPublic({ ...baseline, ...Object.fromEntries(Object.entries(candidateFiles()).map(([name, bytes]) => [name, hash(bytes)])) });
  }
  assert.ok(argument);
  const directory = path.resolve(argument);
  if (mode === 'stage-live') {
    fs.mkdirSync(directory);
    await verifyPublic(baseline, directory);
  } else assert.equal(mode, 'stage');
  stage(directory);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
