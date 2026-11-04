'use strict';
// Server/build-owned deployment cohort. Not a browser-controlled table alias.
// Original modules and original HTTP handlers remain installed and unchanged.
// New modules may import ONLY their paired versioned dependency graph.
const COHORT = 'MASTER_20261024_R2';
const PREFIX = 'r2';
const COLLECTIONS = Object.freeze({
  MASTER: Object.freeze(Object.fromEntries([
    'NCTOrders', 'NCTTasks', 'NCTActivity', 'NCTOrders1', 'NCTTasks1', 'NCTActivity1',
    'PurchaseOrders', 'StockPositions', 'StockClaims', 'StockProducts',
    'DepartmentChatIndex', 'AccountReadIndex'
  ].map(name => [name, 'R2' + name]))),
  FMCGMALAYSIA: Object.freeze(Object.fromEntries([
    'WixBuyerOrders', 'WixBuyerOrderLines', 'WixOrderAudit'
  ].map(name => [name, 'R2' + name])))
});
const ROUTES = Object.freeze({ nctIntake: 'r2NctIntake', salesFulfilment: 'r2SalesFulfilment', purchaseQuantities: 'r2PurchaseQuantities' });
function moduleName(target) {
  if (!/^[A-Za-z][A-Za-z0-9.-]*\.js$/.test(target) || target === 'http-functions.js' || target.startsWith(PREFIX)) {
    throw Error('Explicit unversioned backend module required');
  }
  return PREFIX + target;
}
function collectionTokens(source, system) {
  const map = COLLECTIONS[system];
  if (!map || typeof source !== 'string') throw Error('Known cohort system/source required');
  // One mechanical token pass covers quoted names, object keys and property
  // accesses (tables.PurchaseOrders) together. Never rewrite partial identifiers,
  // functions, customer data, remote payloads or already-versioned identifiers.
  return source.replace(new RegExp('\\b(?:' + Object.keys(map).join('|') + ')\\b', 'g'), name => map[name]);
}
function imports(source, resolve) {
  if (/\bimport\s*\(|\brequire\s*\([^\n]*['"]backend\/|^export\s+(?:\*|\{)[^\n]*\sfrom\s*['"]backend\//m.test(source)) throw Error('Unreviewed dynamic/backend re-export dependency');
  return source.replace(/(^import\s+[\s\S]*?\s+from\s+)(['"])((?:backend\/|\.\/)([^'"]+))\2/gm,
    (_, head, quote, specifier, name) => {
      const target = name.endsWith('.js') ? name : name + '.js';
      if (!/^[A-Za-z][A-Za-z0-9.-]*\.js$/.test(target)) throw Error('Flat explicit backend import required');
      return head + quote + 'backend/' + resolve(target) + quote;
    });
}
function transformModule(source, system, resolve) {
  let result = imports(collectionTokens(source, system), resolve);
  if (system === 'FMCGMALAYSIA') {
    for (const [old, next] of Object.entries(ROUTES)) {
      result = result.replaceAll('/master/_functions/' + old, '/master/_functions/' + next);
    }
  }
  return result;
}
module.exports = { COHORT, PREFIX, COLLECTIONS, ROUTES, moduleName, collectionTokens, imports, transformModule };
