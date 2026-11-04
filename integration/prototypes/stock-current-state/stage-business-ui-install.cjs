'use strict';
// Release packaging only: versioned static files plus the exact UI overlay.
// Does not install backend/Wix sources, change permissions, or enable inventory.
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { inspectBusinessUiInstall } = require('./build-business-ui-install.cjs');
const checkout = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const hash = text => createHash('sha256').update(text).digest('hex');
function stageBusinessUiInstall(destination, trackedFiles, commit) {
  const output = path.resolve(destination || '');
  if (!destination || output === path.parse(output).root || output === checkout || output.startsWith(checkout + path.sep)
    || fs.existsSync(output)) throw Error('A new dedicated output directory outside the checkout is required');
  const report = inspectBusinessUiInstall();
  if (report.errors.length || read(path.join(__dirname, 'business-ui-install.json')) !== JSON.stringify(report, null, 2) + '\n') throw Error('Paired business UI manifest must be current');
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw Error('Exact versioned code commit required');
  const files = trackedFiles || execFileSync('git', ['ls-files', '-z'], { cwd: checkout, encoding: 'utf8' }).split('\0').filter(Boolean);
  const seen = new Set();
  for (const file of files) {
    if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..') || seen.has(file) || file === 'stock-interface-release.json') throw Error('Exact unique tracked paths required');
    seen.add(file);
    const source = path.join(checkout, file);
    if (!fs.lstatSync(source).isFile()) throw Error('Only regular versioned files may be packaged');
  }
  for (const row of report.install.filter(row => row.kind === 'PAGES')) {
    const source = 'integration/prototypes/stock-current-state/' + row.source;
    if (!seen.has(source) || row.beforeSha256 !== null && !seen.has(row.target)) throw Error('Interface source and original must both be versioned');
    if (hash(read(path.join(checkout, source))) !== row.sha256) throw Error('Interface source hash changed');
  }
  // All checks above run before creating anything. Never delete or replace an
  // existing release folder, and never include untracked local evidence.
  fs.mkdirSync(output, { recursive: true });
  for (const file of files) {
    const target = path.join(output, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(checkout, file), target);
  }
  const resources = [];
  for (const row of report.install.filter(row => row.kind === 'PAGES')) {
    const source = read(path.join(__dirname, row.source)), target = path.join(output, row.target);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source);
    if (hash(read(target)) !== row.sha256) throw Error('Packaged interface hash differs');
    resources.push({ path: row.target, sha256: row.sha256 });
  }
  const release = { schema: 'STOCK_INTERFACE_RELEASE_V1', codeCommit: commit, resources,
    wixSourcesInstalled: false, backendInstalled: false, currentStockActivated: false,
    realBorrowingEnabled: false, loadedAcceptanceCompleted: false };
  fs.writeFileSync(path.join(output, 'stock-interface-release.json'), JSON.stringify(release, null, 2) + '\n');
  return release;
}
if (require.main === module) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
  const release = stageBusinessUiInstall(process.argv[2], undefined, commit);
  console.log('Formal static UI resources prepared: ' + release.resources.length + '; backend/Wix/stock activation unchanged');
}
module.exports = { stageBusinessUiInstall };
