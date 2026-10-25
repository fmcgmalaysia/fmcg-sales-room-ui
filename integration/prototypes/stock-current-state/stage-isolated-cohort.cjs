'use strict';
// Static release artifact only. NEVER copy backend, handoff, CSV, native evidence,
// retired outputs, repository metadata or deployment credentials to Pages.
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { buildIsolatedCohort } = require('./build-isolated-cohort.cjs');
const checkout = path.resolve(__dirname, '../../..');
const hash = source => createHash('sha256').update(source).digest('hex');
// Git normalizes these text blobs to LF, while Windows checkouts can be CRLF.
// Publish the same LF bytes on either host; binary assets remain byte-exact.
const staticBytes = (file, source) => /\.(?:html|js|css|svg)$/.test(file)
  ? Buffer.from(String(source).replace(/\r\n/g, '\n')) : Buffer.from(source);
const rootFiles = new Set(['index.html', 'buyer-room.html', 'buyer-login.html', 'catalogue-sidebar-v1.html']);
const staticPath = file => typeof file === 'string' && !file.includes('..') && !file.includes('\\')
  && (rootFiles.has(file) || /^(?:assets|master-shared|purchase-live|warehouse-room|support-room|account-room|sales-room)\/[A-Za-z0-9._-]+\.(?:html|js|css|png|jpg|jpeg|svg|ico|webp)$/.test(file));
function planIsolatedStatic({ tracked, commit, read = file => fs.readFileSync(path.join(checkout, file)), packet = buildIsolatedCohort() }) {
  if (!/^[a-f0-9]{40}$/.test(commit || '') || !Array.isArray(tracked) || new Set(tracked).size !== tracked.length) throw Error('Exact code version and distinct tracked file set required');
  const assets = new Map();
  for (const file of tracked.filter(staticPath)) assets.set(file, staticBytes(file, read(file)));
  for (const row of packet.report.staticResources) {
    if (!staticPath(row.target)) throw Error('Cohort resource outside public static allowlist');
    const source = packet.output.get('PAGES/' + row.target);
    if (typeof source !== 'string' || hash(source) !== row.sha256) throw Error('Exact compiled static resource required');
    assets.set(row.target, Buffer.from(source));
  }
  for (const required of rootFiles) if (!assets.has(required)) throw Error('Original public entry missing: ' + required);
  // Only actual script/link/image tags, never dynamic anchors inside inline JS.
  for (const [file, bytes] of assets) if (file.endsWith('.html')) {
    for (const match of String(bytes).matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g)) {
      const value = match[1].split(/[?#]/)[0];
      if (!value || /^(?:https?:|data:|\/\/)/i.test(value) || value.includes("'+") || value.includes('${')) continue;
      const target = value.startsWith('/') ? value.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(file), value));
      if (!assets.has(target)) throw Error('Public static dependency missing: ' + file + ' -> ' + target);
    }
  }
  const release = { schema: 'ISOLATED_STATIC_RELEASE_V1', cohort: packet.report.cohort, codeCommit: commit,
    resources: [...assets].map(([file, source]) => ({ path: file, sha256: hash(source) })).sort((a, b) => a.path.localeCompare(b.path)),
    backendInstalled: false, wixPublished: false, currentStockActivated: false, realBorrowingVerified: false };
  return { assets, release };
}
function stageIsolatedStatic(destination, plan) {
  const target = path.resolve(destination || '');
  if (!destination || fs.existsSync(target) || target === path.parse(target).root || target === checkout || target.startsWith(checkout + path.sep)) {
    throw Error('A new dedicated artifact folder outside the checkout is required');
  }
  // All paths/content validated BEFORE any artifact write. No delete/overwrite.
  for (const file of plan.assets.keys()) if (!staticPath(file)) throw Error('Unreviewed artifact path');
  fs.mkdirSync(target, { recursive: true });
  for (const [file, source] of plan.assets) { const output = path.join(target, file); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, source); }
  fs.writeFileSync(path.join(target, 'isolated-stock-release.json'), JSON.stringify(plan.release, null, 2) + '\n');
  return plan.release;
}
function verifyVersionedStatic(plan, readVersioned) {
  if (typeof readVersioned !== 'function') throw Error('Exact committed asset reader required');
  const overlays = new Set(buildIsolatedCohort().report.staticResources.map(row => row.target));
  for (const [file, source] of plan.assets) {
    const versioned = overlays.has(file) ? 'integration/prototypes/stock-current-state/isolated-cohort/PAGES/' + file : file;
    if (hash(staticBytes(file, readVersioned(plan.release.codeCommit, versioned))) !== hash(source)) throw Error('Asset is not the recorded committed version: ' + file);
  }
}
if (require.main === module) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: checkout, encoding: 'utf8' }).split('\0').filter(Boolean);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
  const plan = planIsolatedStatic({ tracked, commit });
  verifyVersionedStatic(plan, (version, file) => execFileSync('git', ['show', version + ':' + file], { cwd: checkout, maxBuffer: 8 * 1024 * 1024 }));
  const result = stageIsolatedStatic(process.argv[2], plan);
  process.stdout.write('Static-only isolated artifact: ' + result.resources.length + ' resources; no backend, handoff, CSV, native installation or activation\n');
}
module.exports = { staticPath, planIsolatedStatic, stageIsolatedStatic, verifyVersionedStatic };
