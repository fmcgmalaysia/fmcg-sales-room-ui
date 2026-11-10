const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const build = '20261111-purchase-workflow-polish-v1';
const manifestName = 'purchase-workflow-polish-release.json';
const layeredStyles = ['active-layout.css', 'task-grid.css'];
const purchaseFiles = [
  ...layeredStyles, 'active-layout.js', 'active-orders.css', 'app.js',
  'customer-allocation.js', 'dashboard.css', 'dashboard.js', 'style.css',
  'task-grid.js', 'task-info.js'
];
const indexFile = 'purchase-live/index.html';
const changed = [...purchaseFiles.map(name => `purchase-live/${name}`), indexFile].sort();
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readSource = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

function versionIndex(index, previousBuild) {
  const buildMarker = `name="build" content="${previousBuild}"`;
  assert.equal(index.split(buildMarker).length, 2, 'Expected one prior build marker');
  index = index.replace(buildMarker, `name="build" content="${build}"`);
  for (const name of purchaseFiles) {
    const version = new RegExp(`(["']${name.replaceAll('.', '\\.')}\\?v=)[^"'\\s]+`, 'g');
    assert.equal([...index.matchAll(version)].length, 1, `Expected one reference for ${name}`);
    index = index.replace(version, (_, prefix) => prefix + build);
  }
  return index;
}

function stage(previous, destination) {
  const prior = JSON.parse(fs.readFileSync(path.join(previous, 'purchase-urgent-task-layout-release.json')));
  assert.deepEqual(prior, JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline-manifest.json'))));
  assert.equal(prior.resources.length, 96);
  const assets = new Map(prior.resources.map(({ path: file, sha256: expectedHash }) => {
    const bytes = fs.readFileSync(path.join(previous, file));
    assert.equal(sha256(bytes), expectedHash, file);
    return [file, bytes];
  }));

  for (const name of purchaseFiles) {
    const file = `purchase-live/${name}`;
    const source = layeredStyles.includes(name)
      ? assets.get(file).toString('utf8') + readSource(path.join(__dirname, `${name}.addition`))
      : readSource(path.join(root, file));
    assets.set(file, Buffer.from(source));
  }
  const index = versionIndex(assets.get(indexFile).toString('utf8'), prior.build);
  assert.equal(readSource(path.join(root, indexFile)), index, 'Tracked Purchase index differs from the staged index');
  assets.set(indexFile, Buffer.from(index));

  const resources = [...assets].map(([file, bytes]) => ({ path: file, sha256: sha256(bytes) }));
  assert.deepEqual(resources.filter((item, i) => item.sha256 !== prior.resources[i].sha256)
    .map(item => item.path).sort(), changed);
  for (const [file, bytes] of assets) {
    const output = path.join(destination, file);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes);
  }
  const result = { build, base: prior.build, changed, resources };
  fs.writeFileSync(path.join(destination, manifestName), JSON.stringify(result, null, 2));
  return result;
}

module.exports = { stage, versionIndex };
if (require.main === module) console.log(JSON.stringify(stage(process.argv[2], process.argv[3]).changed));
