'use strict';
// Mechanical packaging of the EXISTING Purchase candidate, not a replacement UX
// or alternate inventory engine. Fixture bridge supplies reads and refuses saves.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..'), candidate = path.join(__dirname, 'purchase-ui');
const normalize = s => s.replace(/\r\n/g, '\n');
const read = file => normalize(fs.readFileSync(file, 'utf8'));
const inputs = [];
function asset(url) {
  const relative = url.split('?')[0];
  if (/^[a-z]+:|^\/|\\|(?:^|\/)\.\.(?:\/\.\.)/.test(relative)) throw Error('Local existing asset required');
  const original = relative.startsWith('../master-shared/') ? path.join(root, relative.slice(3)) : path.join(root, 'purchase-live', relative);
  const optional = path.join(candidate, relative), file = !relative.startsWith('../') && fs.existsSync(optional) ? optional : original;
  if (!file.startsWith(root + path.sep)) throw Error('Review asset escaped checkout');
  const source = read(file);
  inputs.push({ file: path.relative(root, file).replaceAll('\\', '/'), sha256: crypto.createHash('sha256').update(source).digest('hex') });
  return source;
}
let html = read(path.join(candidate, 'index.html'));
html = html.replace('<title>Purchase Department</title>', '<title>Purchase · Borrowing UI Review · Not Live</title>');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, url) => '<style>\n' + asset(url) + '\n</style>');
html = html.replace(/<script(?: defer)? src="([^"]+)"><\/script>/g, (_, url) => '<script>\n' + asset(url).replace(/<\/script/gi, '<\\/script') + '\n</script>');
const bridge = read(path.join(__dirname, 'purchase-ux-review-bridge.js'));
const banner = '<aside id="uxReviewBanner" role="note"><strong>UI REVIEW 界面候选 · NOT PUBLISHED 尚未发布</strong>'
  + '<span>Example customers and P.O.s only 示例客户与采购单 · No real saves 不保存真实数据</span>'
  + '<span>Active Orders → EXAMPLE A → ALLOC ALERT → 1 Borrow stock → Check eligible P.O.s 在ALLOC列点击ALERT，再选择借货及查看可借货采购单</span></aside>'
  + '<p id="uxReviewResult" role="status" hidden></p>';
html = html.replace('</head>', '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">'
  + '<style>#uxReviewBanner{padding:10px 20px;background:#fff3d6;color:#654b13;display:flex;flex-wrap:wrap;gap:6px 20px;font:12px Arial,sans-serif}#uxReviewBanner span{display:block}#uxReviewResult{padding:10px 20px;color:#92202e;background:#fff1f2;font:12px Arial,sans-serif}</style></head>');
html = html.replace('<body>', '<body>' + banner + '<script>\n' + bridge + '\n</script>');
if (/<(?:script|link)\b[^>]*(?:src|href)=/.test(html)) throw Error('Review must be self contained');
const target = path.join(__dirname, 'preview/purchase-workbench-review.html');
const manifest = JSON.stringify({ schema: 'PURCHASE_UX_REVIEW_V1', candidateOnly: true, cmsWrites: false, inputs }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (read(target) !== html || read(path.join(__dirname, 'preview/purchase-workbench-review.inputs.json')) !== manifest) throw Error('Review bundle drift');
} else {
  fs.writeFileSync(target, html);
  fs.writeFileSync(path.join(__dirname, 'preview/purchase-workbench-review.inputs.json'), manifest);
}
console.log('Existing Purchase candidate UI review ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; ' + inputs.length + ' exact assets; NO CMS writes or publication');
