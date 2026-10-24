'use strict';
// LOCAL candidate compiler only. No Wix/SDK/network/ACL/record/activation writes.
// Preserve original files; new backend identities isolate old module closures,
// not just their database rows. Each generated source has an exact before hash.
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { inspectInstall } = require('./build-current-install-manifest.cjs');
const { definition: uiDefinition } = require('./build-business-ui-install.cjs');
const { COHORT, COLLECTIONS, ROUTES, moduleName, imports, transformModule } = require('./isolated-cohort.cjs');
const { createFreshCohortBootstrap, controlFields } = require('./fresh-cohort-bootstrap.cjs');
const checkout = path.resolve(__dirname, '../../..');
const text = file => fs.readFileSync(path.join(checkout, file), 'utf8').replace(/\r\n/g, '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
function controlGuard() {
  const ids = ['NCT', 'GHR'].map(company => hash(JSON.stringify([company, 'STOCK_CONTROL'])).slice(0, 32));
  return 'const r2ControlIds = new Set(' + JSON.stringify(ids) + ');\n'
    + "function r2RequireControl(collection, row) { if (['R2NCTActivity','R2NCTActivity1'].includes(collection) && row && r2ControlIds.has(row._id) && (row.cohort !== '" + COHORT
    + "' || !['MAINTENANCE','SHADOW','ACTIVE'].includes(row.mode))) throw Error('Isolated cohort control unavailable; legacy fallback forbidden'); return row; }\n";
}
function once(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Exact isolated composition anchor changed: ' + before.slice(0, 90));
  return source.replace(before, () => after);
}
function buildIsolatedCohort() {
  const original = inspectInstall();
  if (original.errors.length) throw Error(original.errors.join('\n'));
  const sourceIndex = new Map(original.modules.map(row => [row.system + '/' + row.target, row.source]));
  const modules = new Map(), relays = [], publicModules = new Map(), bootstrapModules = [], staticResources = [], output = new Map(), retained = new Map();
  function visit(system, target) {
    const key = system + '/' + target;
    // Retain the native identity, selection/QD and FX reference authorities.
    // User approved isolating orders/stock only. Do not silently install the
    // repository-only identity labels or substitute the different FX module.
    if (system === 'FMCGMALAYSIA' && ['staffAuth.web.js', 'catalogueSelection.web.js', 'fxRates.web.js'].includes(target)) {
      retained.set(key, { system, target, nativeVerified: false, businessIsolationVerified: false });
      return target;
    }
    if (modules.has(key)) return moduleName(target);
    if (target === 'http-functions.js') throw Error('Original HTTP exports must be retained, not cloned');
    const sourceFile = sourceIndex.get(key)
      || (system === 'MASTER' ? 'integration/backend/' : 'backend/') + target;
    const source = text(sourceFile), dependencies = [];
    const row = { system, target: moduleName(target), originalTarget: target, source: sourceFile,
      sourceSha256: hash(source), dependencies, sha256: null };
    modules.set(key, row); // Cycles resolve to one immutable versioned identity.
    let generated = transformModule(source, system, dependency => {
      const resolved = visit(system, dependency);
      dependencies.push(system + '/' + resolved);
      return resolved;
    });
    if (system === 'FMCGMALAYSIA' && ['nctSalesIntake.js', 'masterFulfilmentClient.js', 'masterQuantityClient.js'].includes(target)) {
      let headers = 0;
      generated = generated.replace(/(['"]Content-Type['"]\s*:\s*['"]application\/json['"])/g, match => {
        headers++; return match + ", 'X-FMCG-Cohort': '" + COHORT + "'";
      });
      if (headers !== (target === 'nctSalesIntake.js' ? 2 : 1)) throw Error('Original cross-site JSON header anchors changed: ' + target);
    }
    if (system === 'MASTER' && target === 'stockCurrentCommands.js') {
      generated = controlGuard() + once(generated, 'function normalize(collection, row) {\n    if (!row) return null;',
        'function normalize(collection, row) {\n    if (!row) return null;\n    r2RequireControl(collection, row);');
    }
    if (system === 'MASTER' && target === 'customerFulfilmentService.js') {
      generated = controlGuard() + once(generated, 'return page.items[0]||null;', 'return r2RequireControl(collection,page.items[0]||null);');
      generated = once(generated, 'return rows;},', 'return rows.map(row=>r2RequireControl(collection,row));},');
    }
    // A missing dependency throws above. Never retain a legacy import on failure.
    row.dependencies = [...new Set(dependencies)].sort(); row.sha256 = hash(generated);
    output.set(system + '/' + row.target, generated);
    return row.target;
  }
  for (const row of original.modules) if (row.target !== 'http-functions.js') visit(row.system, row.target);
  function publicImports(source) {
    return source.replace(/(^import\s+[\s\S]*?\s+from\s+)(['"])public\/([^'"]+)\2/gm, (_, head, quote, name) => {
      const target = name.endsWith('.js') ? name : name + '.js';
      const sources = { 'taskChatBridge.js': 'integration/wix/task-chat-bridge.js',
        'packingListBridge.js': 'integration/prototypes/stock-current-state/packing-ui/packingListBridge.js' };
      if (!Object.hasOwn(sources, target)) throw Error('Unreviewed public relay dependency: ' + target);
      if (!publicModules.has(target)) {
        const sourceFile = sources[target], before = text(sourceFile);
        const generated = imports(before, dependency => visit('MASTER', dependency));
        publicModules.set(target, { system: 'MASTER', target: 'public/' + moduleName(target), source: sourceFile,
          sourceSha256: hash(before), sha256: hash(generated) });
        output.set('MASTER/public/' + moduleName(target), generated);
      }
      return head + quote + 'public/' + moduleName(target) + quote;
    });
  }
  const extraRelays = [
    ['buyer-room/wix/buyer-room-page.js', 'FMCGMALAYSIA'],
    ['buyer-room/catalogue/wix/catalogue-page-v3.js', 'FMCGMALAYSIA'],
    ['buyer-room/wix/order-received-lightbox.js', 'FMCGMALAYSIA']
  ];
  const inputs = uiDefinition().filter(row => row.kind === 'WIX_PAGE').map(row => [
    'integration/prototypes/stock-current-state/' + row.source, row.system || 'MASTER', row.target
  ]).concat(extraRelays.map(([file, system]) => [file, system, file]),
    [['integration/prototypes/stock-current-state/account-department-page.candidate.js', 'MASTER', 'integration/wix/account-department-page.js']]);
  for (const [sourceFile, system, target] of inputs) {
    const source = text(sourceFile);
    const generated = publicImports(imports(source, dependency => visit(system, dependency)))
      .replace(/(https:\/\/fmcgmalaysia\.github\.io\/fmcg-sales-room-ui\/[^'"\s]*[?&]v=)[A-Za-z0-9._-]+/g, '$120261024-r2');
    relays.push({ system, target, source: sourceFile, sourceSha256: hash(source), sha256: hash(generated) });
    output.set('relays/' + target, generated);
  }
  const staticInputs = uiDefinition().filter(row => row.kind === 'PAGES').map(row => [
    'integration/prototypes/stock-current-state/' + row.source, row.target
  ]).concat(['index.html', 'account-current.js', 'settlement.js', 'purchase-payments.js', 'stock-exceptions.js'].map(file => [
    'integration/prototypes/stock-current-state/account-ui/' + file, 'account-room/' + file
  ]));
  for (const [sourceFile, target] of staticInputs) {
    const before = text(sourceFile);
    const generated = before.replace(/([?&]v=)[A-Za-z0-9._-]+/g, '$120261024-r2');
    staticResources.push({ source: sourceFile, target, sourceSha256: hash(before), sha256: hash(generated) });
    output.set('PAGES/' + target, generated);
  }
  // Append these exports to a fresh exact native before-image, preserving every
  // original HTTP handler/import. No old client can be redirected by this patch.
  const additions = [
    "import { createNctReceiver as createR2NctReceiver } from 'backend/" + visit('MASTER', 'nctReceiver.js') + "';",
    "import { handleSalesFulfilment as handleR2SalesFulfilment } from 'backend/" + visit('MASTER', 'customerFulfilmentGateway.js') + "';",
    "import { readPurchaseQuantities as readR2PurchaseQuantities } from 'backend/" + visit('MASTER', 'purchaseQuantityRead.js') + "';",
    'const handleR2Intake = createR2NctReceiver({ store, getIntakeSecret: () => getSecret(\'MASTER_INTAKE_SHARED_SECRET\'), captureCosts: capturePointbaseCosts });',
    "const r2Response = result => response({ status: result.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(result.body) });",
    "async function r2Ingress(request, handler) { const keys = Object.keys(request.headers || {}).filter(key => key.toLowerCase() === 'x-fmcg-cohort'); if (keys.length !== 1 || request.headers[keys[0]] !== '" + COHORT + "') return r2Response({ status: 409, body: { ok: false, error: 'Order program changed. Refresh the original order; no new receipt was created.' } }); return r2Response(await handler(request)); }",
    'export async function post_' + ROUTES.nctIntake + '(request) { return r2Ingress(request, handleR2Intake); }',
    'export async function post_' + ROUTES.salesFulfilment + '(request) { return r2Ingress(request, handleR2SalesFulfilment); }',
    'export async function post_' + ROUTES.purchaseQuantities + '(request) { return r2Ingress(request, readR2PurchaseQuantities); }', ''
  ].join('\n');
  output.set('MASTER/http-functions.additions.js', additions);
  for (const system of Object.keys(COLLECTIONS)) {
    const source = ["import { webMethod, Permissions } from 'wix-web-module';", "import { currentMember } from 'wix-members-backend';",
      "import { items, collections } from '@wix/data';", "import { createHash } from 'crypto';",
      'const COHORT=' + JSON.stringify(COHORT) + ';', 'const COLLECTIONS=' + JSON.stringify({ [system]: COLLECTIONS[system] }) + ';',
      'const fields=' + JSON.stringify(controlFields) + ';',
      "const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32);",
      'const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);', createFreshCohortBootstrap.toString(),
      "async function authenticateAdmin(){const member=await currentMember.getMember({fieldsets:['FULL']});if(member?.status!=='APPROVED'||typeof member._id!=='string'||!member._id||member._id.length>200)throw Error('Actual approved administrator identity required');return{isAdmin:true,memberId:member._id};}",
      'const service=createFreshCohortBootstrap({system:' + JSON.stringify(system) + ',items,collections,authenticateAdmin});',
      'export const inspectFreshCohort=webMethod(Permissions.Admin,input=>service.inspect(input));',
      ...(system === 'MASTER' ? ['export const initializeFreshCohort=webMethod(Permissions.Admin,input=>service.initialize(input));'] : []), ''
    ].join('\n');
    output.set(system + '/r2cohortBootstrap.web.js', source);
    bootstrapModules.push({ system, target: 'r2cohortBootstrap.web.js', source: 'integration/prototypes/stock-current-state/fresh-cohort-bootstrap.cjs',
      sha256: hash(source), activationAllowed: false });
  }
  const http = text('integration/backend/http-functions.js');
  const report = {
    schema: 'ISOLATED_COHORT_CANDIDATE_V1', cohort: COHORT, candidateOnly: true, activationAllowed: false,
    retiredLocalOutputs: ['relays/integration/wix/packingListBridge.js',
      'FMCGMALAYSIA/r2catalogueSelection.web.js', 'FMCGMALAYSIA/r2fxRates.web.js'],
    originalModulesUntouched: true, originalHttpHandlersUntouched: true, collections: COLLECTIONS, routes: ROUTES,
    backend: [...modules.values()].sort((a, b) => (a.system + a.target).localeCompare(b.system + b.target)),
    relays, publicModules: [...publicModules.values()], bootstrapModules, staticResources, retainedDependencies: [...retained.values()],
    additionalControlFields: { cohort: 'TEXT', bootstrapMemberId: 'TEXT', bootstrapRequestId: 'TEXT' },
    httpAppend: { source: 'integration/backend/http-functions.js', beforeSha256: hash(http), additionsSha256: hash(additions) },
    requiredEvidence: ['Fresh native originals including added Buyer/Catalogue dependencies', 'Exact private new schemas/indexes/ACL and reference bindings',
      'Fresh empty-cohort initialization (not legacy migration/drain)', 'All-writer native coverage/capacity/recovery',
      'Old execution and cross-site/cached client separation', 'External file side-effect identity review', 'Four-stage release and real Buyer/split/borrow/Loaded acceptance']
  };
  return { report, output };
}
if (require.main === module) {
  const { report, output } = buildIsolatedCohort(), check = process.argv.includes('--check');
  output.set('manifest.json', JSON.stringify(report, null, 2) + '\n');
  const folder = path.join(__dirname, 'isolated-cohort');
  if (fs.existsSync(folder)) for (const entry of fs.readdirSync(folder, { recursive: true, withFileTypes: true })) {
    const relative = path.relative(folder, path.join(entry.parentPath, entry.name)).replace(/\\/g, '/');
    if (entry.isFile() && !output.has(relative) && !report.retiredLocalOutputs.includes(relative)) {
      throw Error('Unclassified stale output; never package or auto-delete: ' + relative);
    }
  }
  for (const [file, source] of output) {
    const target = path.join(__dirname, 'isolated-cohort', file);
    if (check) { if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Isolated candidate differs: ' + file); }
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source); }
  }
  process.stdout.write('Isolated candidate ' + (check ? 'verified' : 'built') + ': ' + report.backend.length + ' versioned backend modules, '
    + report.relays.length + ' paired relays; NOT installed or activated\n');
}
module.exports = { buildIsolatedCohort };
