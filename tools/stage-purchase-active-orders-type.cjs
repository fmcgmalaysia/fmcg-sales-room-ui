const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const manifest = require('./purchase-active-orders-pages-base.json');
const assets = Object.entries(manifest);
const publicBase = 'https://fmcgmalaysia.github.io/fmcg-sales-room-ui/';
const entry = 'purchase-live/index-20261124-split-surplus.html';
const build = '20261128-purchase-active-orders-type-v1';
const replacements = [
  ['active-order-typography-20261125.css', 'href', 'active-order-typography-20261125.css'],
  ['app-20261125-dashboard-handle.js', 'src', 'app-20261125-dashboard-handle.js'],
  ['task-grid.js', 'src', 'task-grid.js?v=20261126-purchase-closed-remainder-v1'],
];
const changed = new Set([entry, ...replacements.map(([name]) => `purchase-live/${name}`)]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function verifyLive(checks, nonce, workDir) {
  for (let start = 0; start < checks.length; start += 8) {
    await Promise.all(checks.slice(start, start + 8).map(async ([name, expected]) => {
      assert.match(name, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/);
      assert.ok(!name.split('/').includes('..'));
      const url = new URL(name, publicBase);
      url.searchParams.set('verify', nonce);
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      assert.ok(response.ok, `${name}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(sha(bytes), expected, `Live bytes differ for ${name}`);
      if (workDir) {
        const file = path.join(workDir, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes, { flag: 'wx' });
      }
    }));
  }
  console.log(`Verified ${checks.length} public asset hashes.`);
}

function list(workDir) {
  return fs.readdirSync(workDir, { recursive: true, withFileTypes: true }).filter(item => item.isFile())
    .map(item => path.relative(workDir, path.join(item.parentPath, item.name)).split(path.sep).join('/')).sort();
}

function stage(workDir) {
  assert.deepEqual(list(workDir), assets.map(([name]) => name).sort());
  for (const [name, expected] of assets) assert.equal(sha(fs.readFileSync(path.join(workDir, name))), expected, name);
  let html = fs.readFileSync(path.join(workDir, entry), 'utf8');
  for (const [name, attr, previous] of replacements) {
    const current = `${attr}="${previous}"`;
    assert.equal(html.split(current).length, 2, current);
    html = html.replace(current, `${attr}="${name}?v=${build}"`);
    const editedSource = fs.readFileSync(path.join(__dirname, '../purchase-live', name), 'utf8').replace(/\r\n/g, '\n');
    fs.writeFileSync(path.join(workDir, 'purchase-live', name), editedSource);
  }
  const existing = '<meta charset="utf-8">';
  assert.equal(html.split(existing).length, 2);
  html = html.replace(existing, `${existing}<meta name="purchase-active-orders-build" content="${build}">`);
  fs.writeFileSync(path.join(workDir, entry), html);
  const actual = new Set(assets.filter(([name, hash]) => sha(fs.readFileSync(path.join(workDir, name))) !== hash).map(([name]) => name));
  assert.deepEqual(actual, changed);
  console.log(`${build}: ${actual.size} scoped assets updated, ${assets.length - actual.size} preserved.`);
}

async function main() {
  const [mode, directory] = process.argv.slice(2);
  const workDir = directory && path.resolve(directory);
  if (mode === 'verify-base') return verifyLive(assets, `purchase-active-base-${Date.now()}`);
  assert.ok(workDir, 'Provide the Pages directory.');
  if (mode === 'stage-live') {
    fs.mkdirSync(workDir);
    await verifyLive(assets, `purchase-active-base-${Date.now()}`, workDir);
    stage(workDir);
  } else if (mode === 'stage') {
    stage(workDir);
  } else if (mode === 'verify-release') {
    assert.deepEqual(list(workDir), assets.map(([name]) => name).sort());
    await verifyLive(assets.map(([name]) => [name, sha(fs.readFileSync(path.join(workDir, name)))]), `purchase-active-release-${Date.now()}`);
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
