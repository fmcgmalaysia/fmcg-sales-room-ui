'use strict';
// Standalone private exercise only; never enters a Pages/Wix install manifest.
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const checkout = path.resolve(__dirname, '../../..'), here = __dirname;
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const hash = text => createHash('sha256').update(text).digest('hex');
function buildOperationPractice() {
  const modules = new Map(), inputs = new Map();
  const record = file => { const text = read(file); inputs.set(path.relative(checkout, file).replaceAll('\\', '/'), hash(text)); return text; };
  function collect(file) {
    const key = path.relative(checkout, file).replaceAll('\\', '/');
    if (modules.has(key)) return key;
    if (!file.startsWith(checkout + path.sep)) throw Error('Exercise module escaped checkout');
    let text = record(file); modules.set(key, '');
    // The old overwrite protocol is deliberately excluded, as in the existing
    // command bundle. Only its shared deterministic hash is needed here.
    if (file === path.join(here, 'commit-proof.cjs')) text = "const {createHash}=require('node:crypto');module.exports={hash:(...p)=>createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0,32)};";
    const exported = [...text.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(m => m[1]);
    text = text.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\r?$/gm, (_, names, target) => 'const {' + names.replace(/\s+as\s+/g, ':') + '}=require(' + JSON.stringify(target) + ');');
    text = text.replace(/^export /gm, '');
    if (exported.length) text += '\nmodule.exports={' + exported.join(',') + '};';
    text = text.replace(/require\(['"]([^'"]+)['"]\)/g, (_, name) => {
      if (['crypto', 'node:crypto'].includes(name)) return 'require(' + JSON.stringify(collect(path.join(here, 'practice-crypto.cjs'))) + ')';
      if (name === 'node:buffer') return '({Buffer:{byteLength:s=>new TextEncoder().encode(s).length}})';
      const dependency = name.startsWith('backend/') ? path.join(checkout, 'integration', name) : name.startsWith('./') ? path.resolve(path.dirname(file), name) : null;
      if (!dependency) throw Error('Unsupported exercise dependency ' + name);
      return 'require(' + JSON.stringify(collect(dependency)) + ')';
    });
    if (/^import |^export /m.test(text)) throw Error('Uncompiled exercise module ' + key);
    modules.set(key, text); return key;
  }
  const entry = collect(path.join(here, 'operation-practice.cjs'));
  const shipment = collect(path.join(checkout, 'integration/backend/customerShipmentPlan.js'));
  const batches = collect(path.join(checkout, 'integration/backend/shipmentBatchAllocation.js'));
  const runtime = '(function(){const cache={},modules={' + [...modules].map(([name, source]) => JSON.stringify(name) + ':function(module,exports,require){\n' + source + '\n}').join(',\n')
    + '};function require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw Error("Missing exercise module "+id);const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports;}'
    + 'window.createPractice=()=>require(' + JSON.stringify(entry) + ').createOperationPractice({shipment:require(' + JSON.stringify(shipment) + '),batches:require(' + JSON.stringify(batches) + '),sessionId:crypto.randomUUID()});})();';
  function inlineAsset(url) {
    const relative = url.split('?')[0];
    const optional = path.join(here, 'purchase-ui', relative);
    const original = path.join(checkout, 'purchase-live', relative);
    const file = !relative.startsWith('../') && fs.existsSync(optional) ? optional : original;
    if (!file.startsWith(checkout + path.sep)) throw Error('Exercise asset escaped checkout');
    let text = record(file);
    // The local exercise must work without external font downloads. Keep the
    // original CSS inputs recorded; omit only network font declarations here.
    if (file.endsWith('.css')) text = text.replace(/@font-face\s*\{[^}]*https?:\/\/[^}]*\}/g, '');
    text = text.replace(/assets\/[a-zA-Z0-9._-]+\.(?:png|svg|webp)/g, relative => {
      const image = path.join(checkout, 'purchase-live', relative);
      if (!fs.existsSync(image)) return relative;
      const bytes = fs.readFileSync(image); inputs.set(path.relative(checkout, image).replaceAll('\\', '/'), hash(bytes));
      return 'data:image/' + (image.endsWith('.svg') ? 'svg+xml' : path.extname(image).slice(1)) + ';base64,' + bytes.toString('base64');
    });
    return text;
  }
  const script = text => '<script>\n' + text.replace(/<\/script/gi, '<\\/script') + '\n</script>';
  let inner = record(path.join(here, 'purchase-ui/index.html'));
  inner = inner.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, url) => '<style>' + inlineAsset(url) + '</style>');
  inner = inner.replace(/<script(?: defer)? src="([^"]+)"><\/script>/g, (_, url) => script(inlineAsset(url)));
  inner = inner.replace('</head>', '<style>' + record(path.join(checkout, 'sales-room/shipment-ui.css')) + '</style></head>');
  inner = inner.replace('</body>', script(record(path.join(here, 'source-ui/current-requests.js'))) + script(record(path.join(here, 'source-ui/shipment-ui.js')))
    + script("document.querySelector('#companySelect').disabled=true;document.querySelector('[data-view=active]').click();new MutationObserver(()=>{const p=document.querySelector('.split-shipment-plan');if(p)p.open=true;document.querySelectorAll('.master-shipment-dialog .dialog-body> :not(.split-shipment-plan):not([data-status])').forEach(el=>el.hidden=true);const d=document.querySelector('nav .demo');if(d&&d.textContent!=='OPERATION TEST · 假数据')d.textContent='OPERATION TEST · 假数据';}).observe(document.body,{childList:true,subtree:true});") + '</body>');
  const body = record(path.join(here, 'operation-practice-shell.html'));
  const html = body.replace('<!--PRACTICE_RUNTIME-->', () => script(runtime)).replace('<!--PRACTICE_BRIDGE-->', () => script(record(path.join(here, 'operation-practice-bridge.js'))))
    .replace('/*PRACTICE_UI*/null', () => JSON.stringify(inner).replace(/<\/script/gi, '<\\/script'));
  if (/https?:\/\//.test(inner.match(/<(?:script|link)[^>]*(?:src|href)=[^>]+/g)?.join('') || '')) throw Error('Exercise must be self-contained');
  record(__filename);
  const manifest = { schema: 'LOCAL_OPERATION_PRACTICE_V1', build: 'LOCAL-OPERATION-PRACTICE-20261025', cmsWrites: false, nativeAcceptance: false,
    productionFilesChanged: false, packagingOnly: ['Inline existing candidate assets', 'Omit external font declarations', 'Embed local fake-data test host'],
    modules: modules.size, inputs: [...inputs].map(([file, sha256]) => ({ file, sha256 })) };
  return { html, manifest };
}
if (require.main === module) {
  const { html, manifest } = buildOperationPractice(), target = path.resolve(process.argv.slice(2).find(a => a !== '--check') || path.join(here, 'preview/split-borrow-practice.html'));
  if (process.argv.includes('--check')) {
    if (read(target) !== html || read(target.replace(/\.html$/, '.inputs.json')) !== JSON.stringify(manifest, null, 2) + '\n') throw Error('Practice bundle or input fingerprints differ');
  } else { fs.writeFileSync(target, html); fs.writeFileSync(target.replace(/\.html$/, '.inputs.json'), JSON.stringify(manifest, null, 2) + '\n'); }
  console.log(JSON.stringify({ target, modules: manifest.modules, inputs: manifest.inputs.length, sha256: hash(html), cmsWrites: false }));
}
module.exports = { buildOperationPractice };
