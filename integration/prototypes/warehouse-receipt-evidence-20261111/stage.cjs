const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const patch = require('./patch.cjs');

const root = path.resolve(__dirname, '../../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const normalize = source => source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

function one(source, before, after) {
  assert.equal(source.split(before).length, 2, before);
  return source.replace(before, () => after);
}

function version(source, oldBuild, assets) {
  source = one(source, `name="build" content="${oldBuild}"`, `name="build" content="${patch.build}"`);
  for (const [file, oldVersion] of assets) source = one(source, `${file}?v=${oldVersion}`, `${file}?v=${patch.build}`);
  return source;
}

function stage(previous, destination) {
  const baseline = JSON.parse(fs.readFileSync(path.join(previous, 'purchase-workflow-polish-release.json')));
  assert.equal(hash(JSON.stringify(baseline)), '2f473851faf337a17124f8d1d2fff17fbd5c77d723a20ce9e605a8bc3ad28a53');
  assert.equal(baseline.resources.length, 96);
  const sources = new Map(baseline.resources.map(item => {
    const bytes = fs.readFileSync(path.join(previous, item.path));
    assert.equal(hash(bytes), item.sha256, item.path);
    return [item.path, bytes];
  }));
  const loaded = "node.innerHTML='Loaded Qty '+summaryPill(summary,summary.loadedQty);";
  const trackedDesk = normalize(fs.readFileSync(path.join(root, 'master-shared/desk-delivery.js'), 'utf8'));
  const updatedLoaded = trackedDesk.match(/node\.innerHTML='Loaded '\+summaryPill\(summary\.loadedQty===0[^;]+;/)?.[0];
  assert.ok(updatedLoaded, 'Missing approved Purchase Loaded display patch');
  const changes = new Map([
    ['warehouse-room/app.js', patch.patchApp], ['warehouse-room/workroom.js', patch.patchWorkroom],
    ['warehouse-room/workroom.css', patch.patchCss], ['warehouse-room/index.html', patch.patchIndex],
    ['account-room/payment-layout.js', patch.patchFinance],
    ['account-room/index.html', s => version(s, '20261103-finance-po-payment-summary-v1', [['payment-layout.js', '20261102-two-site-closeout-v1']])],
    ['purchase-live/app.js', patch.patchPurchase],
    ['purchase-live/task-info.js', () => normalize(fs.readFileSync(path.join(root, 'purchase-live/task-info.js'), 'utf8'))],
    ['purchase-live/index.html', s => version(s, baseline.build, [['app.js', baseline.build], ['task-info.js', baseline.build], ['desk-delivery.js', '20261103-support-reusable-desk-v1']])],
    ['master-shared/desk-delivery.js', s => one(s, loaded, updatedLoaded)]
  ]);
  for (const [file, transform] of changes) sources.set(file, Buffer.from(transform(sources.get(file).toString('utf8'))));
  const resources = [...sources].map(([file, bytes]) => ({path:file, sha256:hash(bytes)}));
  const changed = resources.filter((item, i) => item.sha256 !== baseline.resources[i].sha256).map(item => item.path).sort();
  assert.deepEqual(changed, [...changes.keys()].sort());
  for (const [file, bytes] of sources) {
    const output = path.join(destination, file);
    fs.mkdirSync(path.dirname(output), {recursive:true});
    fs.writeFileSync(output, bytes);
  }
  const result={build:patch.build, base:baseline.build, changed, resources};
  fs.writeFileSync(path.join(destination,'warehouse-receipt-evidence-release.json'),JSON.stringify(result,null,2));
  return result;
}

module.exports={stage};
if(require.main===module)console.log(JSON.stringify(stage(process.argv[2],process.argv[3]).changed));
