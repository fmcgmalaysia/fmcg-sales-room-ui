'use strict';
// Exact deployment destinations for the real business UI. No preview fixtures,
// database authority, permission changes, mode switches or deployment capability.
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const checkout = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const hash = text => createHash('sha256').update(text).digest('hex');
const group = (folder, destination, files) => files.map(file => ({ source: folder + '/' + file, target: destination + '/' + file, kind: 'PAGES' }));
function definition() {
  return [
    { source: 'source-ui/index.html', target: 'index.html', kind: 'PAGES' },
    ...group('source-ui', 'sales-room', ['current-requests.js', 'current-dates.js', 'order-adjustment.js', 'shipment-ui.js', 'customer-documents.js']),
    ...group('purchase-ui', 'purchase-live', ['index.html', 'app.js', 'task-grid.js', 'supplier-allocation.js', 'purchase-resume.js',
      'borrow-approval.js', 'borrow-approval.css', 'borrow-relations.js', 'borrow-relations.css', 'borrow-return.js',
      'borrow-outstanding.js', 'borrow-outstanding.css', 'stock-exceptions.js', 'stock-control.js']),
    ...group('warehouse-ui', 'warehouse-room', ['index.html', 'app.js', 'workroom.js', 'dispatch.js', 'packing-list-link.js',
      'stock-control-app.js', 'stock-control.css', 'stock-control-embedded.css', 'stock-control.html', 'stock-control-link.js',
      'warehouse-cbm-resume.js', 'warehouse-dispatch-resume.js', 'warehouse-preparation-resume.js', 'warehouse-receipt-resume.js', 'stock-exceptions.js']),
    ...group('packing-ui', 'support-room', ['packing-workbench.html', 'packing-workbench.js', 'packing-transport.js']),
    { source: 'purchase-room-page.candidate.js', target: 'integration/wix/purchase-room-page.js', kind: 'WIX_PAGE' },
    { source: 'warehouse-ui/warehouse-department-page.js', target: 'integration/wix/warehouse-department-page.js', kind: 'WIX_PAGE' },
    { source: 'packing-ui/support-department-page.js', target: 'integration/wix/support-department-page.js', kind: 'WIX_PAGE' },
    { source: 'packing-ui/packingListBridge.js', target: 'integration/wix/packingListBridge.js', kind: 'WIX_PUBLIC' }
  ];
}
function inspectBusinessUiInstall(entries = definition()) {
  const seen = new Set(), errors = [];
  const rows = entries.map(entry => {
    if (!['PAGES', 'WIX_PAGE', 'WIX_PUBLIC'].includes(entry.kind) || !/^[a-zA-Z0-9./-]+\.(?:js|css|html)$/.test(entry.source)
      || !/^[a-zA-Z0-9./-]+\.(?:js|css|html)$/.test(entry.target) || entry.source.split('/').includes('..') || entry.target.split('/').includes('..')
      || /preview|review-bridge/.test(entry.source + '/' + entry.target) || seen.has(entry.target)) throw Error('Exact unique business UI destination required');
    seen.add(entry.target);
    const source = read(path.join(__dirname, entry.source)), beforeFile = path.join(checkout, entry.target);
    if (entry.kind === 'PAGES' && /UX-REVIEW-ONLY|EXAMPLE-PO-|purchase-ux-review-bridge/.test(source)) throw Error('Review fixture cannot enter business UI');
    return { ...entry, sha256: hash(source), beforeSha256: fs.existsSync(beforeFile) ? hash(read(beforeFile)) : null };
  });
  for (const expected of definition()) if (!rows.some(row => row.target === expected.target && row.source === expected.source && row.kind === expected.kind)) {
    errors.push('Missing paired business UI ' + expected.target);
  }
  const deployed = new Map(rows.filter(row => row.kind === 'PAGES').map(row => [row.target, row]));
  for (const row of rows.filter(row => row.kind === 'PAGES' && row.target.endsWith('.html'))) {
    const html = read(path.join(__dirname, row.source));
    for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"#]+)"/g)) {
      if (/^(?:[a-z]+:|\/\/)/i.test(match[1])) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(row.target), match[1].split('?')[0]));
      if (target.startsWith('../') || !deployed.has(target) && !fs.existsSync(path.join(checkout, target))) errors.push('Missing business UI asset ' + row.target + ' -> ' + target);
    }
  }
  const backend = read(path.join(__dirname, 'current-install-manifest.json'));
  return { schema: 'BUSINESS_UI_INSTALL_V1', hashFormat: 'SHA256_UTF8_LF', noPreviewFixtures: true,
    originalPathsUntouched: true, deployPerformed: false, activationAllowed: false,
    backendInstallManifestSha256: hash(backend), install: rows, errors,
    releaseGates: ['Fresh live source and static-resource comparison', 'Paired real backend and authorized current data',
      'Required writer/recovery/capacity gates', 'Exact branch deployment authority at action time',
      'Pages resource versions, Wix published-live and public Loaded acceptance'] };
}
if (require.main === module) {
  const report = inspectBusinessUiInstall();
  if (report.errors.length) throw Error(report.errors.join('\n'));
  const file = path.join(__dirname, 'business-ui-install.json'), serialized = JSON.stringify(report, null, 2) + '\n';
  if (process.argv.includes('--check')) { if (read(file) !== serialized) throw Error('Business UI install source changed'); }
  else fs.writeFileSync(file, serialized);
  console.log('Business UI paired: ' + report.install.filter(row => row.kind === 'PAGES').length + ' real Pages paths, '
    + report.install.filter(row => row.kind !== 'PAGES').length + ' Wix relays; NO preview or deployment');
}
module.exports = { definition, inspectBusinessUiInstall };
